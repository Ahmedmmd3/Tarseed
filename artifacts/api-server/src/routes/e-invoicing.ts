import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  db,
  eInvoiceDocumentsTable,
  eInvoiceUnitsTable,
  erpRecordsTable,
  type EInvoiceUnit,
} from "@workspace/db";
import {
  configurationIsComplete,
  decryptEInvoiceSecret,
  encryptEInvoiceSecret,
  generateCsr,
  generateInvoiceDocument,
  type SellerProfile,
} from "../lib/e-invoicing";
import { readPrivateInvoiceXml, savePrivateInvoiceXml } from "../lib/private-object-store";
import {
  requireAuth,
  requireCurrentDataGeneration,
  requireSubscriptionAccess,
  type AuthContext,
} from "../middleware/team-auth";

const router: IRouter = Router();

type RecordData = Record<string, unknown>;

function value(body: unknown): RecordData {
  return body && typeof body === "object" && !Array.isArray(body) ? body as RecordData : {};
}

function requiredText(raw: unknown, label: string, limit = 240): string {
  if (typeof raw !== "string" || !raw.trim()) throw new EInvoiceRouteError(`أدخل ${label}.`);
  const output = raw.trim();
  if (output.length > limit) throw new EInvoiceRouteError(`${label} أطول من الحد المسموح.`);
  return output;
}

function optionalText(raw: unknown, limit = 10_000): string | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.trim().length > limit) throw new EInvoiceRouteError("إحدى القيم النصية غير صالحة.");
  return raw.trim();
}

function safeId(raw: unknown): number {
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) throw new EInvoiceRouteError("معرّف المستند غير صالح.");
  return number;
}

function sellerFromUnit(unit: EInvoiceUnit): SellerProfile {
  return {
    sellerName: unit.sellerName,
    vatNumber: unit.vatNumber,
    commercialRegistrationNumber: unit.commercialRegistrationNumber,
    street: unit.street,
    buildingNumber: unit.buildingNumber,
    city: unit.city,
    postalCode: unit.postalCode,
    countryCode: unit.countryCode,
    vatRate: Number(unit.vatRate),
    pricesIncludeVat: unit.pricesIncludeVat,
  };
}

function canUseSales(auth: AuthContext): boolean {
  return auth.roleId === "owner" || auth.permissions.sales === true || auth.permissions.accounting === true;
}

function requireOwner(response: Response): AuthContext | null {
  const auth = response.locals.auth as AuthContext;
  if (auth.roleId !== "owner") {
    response.status(403).json({ error: "إعداد الفوترة الإلكترونية متاح لمالك المنشأة فقط." });
    return null;
  }
  return auth;
}

function requireSales(response: Response): AuthContext | null {
  const auth = response.locals.auth as AuthContext;
  if (!canUseSales(auth)) {
    response.status(403).json({ error: "ليس لديك صلاحية الوصول إلى الفواتير الإلكترونية." });
    return null;
  }
  return auth;
}

async function audit(auth: AuthContext, action: string, entity: string, details = ""): Promise<void> {
  const { teamAuditLogsTable } = await import("@workspace/db");
  await db.insert(teamAuditLogsTable).values({
    organizationId: auth.organizationId,
    actorId: auth.id,
    actorName: auth.name || auth.email,
    action,
    entity,
    details,
  });
}

async function unitForOrganization(organizationId: number): Promise<EInvoiceUnit> {
  const [existing] = await db.select().from(eInvoiceUnitsTable)
    .where(eq(eInvoiceUnitsTable.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(eInvoiceUnitsTable).values({ organizationId }).returning();
  return created;
}

function unitResponse(unit: EInvoiceUnit): RecordData {
  const seller = sellerFromUnit(unit);
  return {
    id: unit.id,
    unitName: unit.unitName,
    deviceSerialNumber: unit.deviceSerialNumber,
    environment: unit.environment,
    status: unit.status,
    sellerName: unit.sellerName,
    vatNumber: unit.vatNumber,
    commercialRegistrationNumber: unit.commercialRegistrationNumber,
    street: unit.street,
    buildingNumber: unit.buildingNumber,
    city: unit.city,
    postalCode: unit.postalCode,
    countryCode: unit.countryCode,
    vatRate: Number(unit.vatRate),
    pricesIncludeVat: unit.pricesIncludeVat,
    configurationComplete: configurationIsComplete(seller),
    csrReady: Boolean(unit.csrPem && unit.privateKeyCiphertext),
    credentialsReady: Boolean(unit.certificateCiphertext && unit.csidCiphertext && unit.secretCiphertext),
    certificateExpiresAt: unit.certificateExpiresAt?.toISOString() ?? null,
  };
}

class EInvoiceRouteError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function run(response: Response, handler: () => Promise<RecordData>): Promise<void> {
  try {
    response.json(await handler());
  } catch (error) {
    if (error instanceof EInvoiceRouteError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
}

router.get("/e-invoicing/setup", requireAuth, requireSubscriptionAccess, async (_request: Request, response: Response): Promise<void> => {
  const auth = requireOwner(response);
  if (!auth) return;
  await run(response, async () => ({ unit: unitResponse(await unitForOrganization(auth.organizationId)) }));
});

router.put("/e-invoicing/setup", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireOwner(response);
  if (!auth) return;
  await run(response, async () => {
    const body = value(request.body);
    const vatNumber = requiredText(body.vatNumber, "الرقم الضريبي", 15);
    if (!/^\d{15}$/.test(vatNumber)) throw new EInvoiceRouteError("الرقم الضريبي يجب أن يتكون من 15 رقماً.");
    const countryCode = requiredText(body.countryCode ?? "SA", "رمز الدولة", 2).toUpperCase();
    if (countryCode !== "SA") throw new EInvoiceRouteError("الفوترة الإلكترونية لهذه النسخة مهيأة للمنشآت السعودية فقط.");
    const vatRate = Number(body.vatRate ?? 15);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) throw new EInvoiceRouteError("نسبة الضريبة غير صالحة.");
    const current = await unitForOrganization(auth.organizationId);
    if (current.status === "ready") {
      throw new EInvoiceRouteError(
        "بيانات جهة الإصدار مقفلة بعد تفعيل الشهادة. أنشئ وحدة إصدار جديدة عند تغيير البيانات القانونية.",
        409,
      );
    }
    const seller = {
      sellerName: requiredText(body.sellerName, "الاسم القانوني للمنشأة"),
      vatNumber,
      commercialRegistrationNumber: requiredText(body.commercialRegistrationNumber, "رقم السجل التجاري"),
      street: requiredText(body.street, "الشارع"),
      buildingNumber: requiredText(body.buildingNumber, "رقم المبنى", 20),
      city: requiredText(body.city, "المدينة"),
      postalCode: requiredText(body.postalCode, "الرمز البريدي", 12),
      countryCode,
      vatRate,
      pricesIncludeVat: body.pricesIncludeVat === true,
    };
    const [updated] = await db.update(eInvoiceUnitsTable).set({
      unitName: requiredText(body.unitName ?? current.unitName, "اسم وحدة الإصدار"),
      deviceSerialNumber: requiredText(body.deviceSerialNumber ?? current.deviceSerialNumber, "الرقم التسلسلي لوحدة الإصدار"),
      environment: body.environment === "production" ? "production" : "sandbox",
      ...seller,
      vatRate: seller.vatRate.toFixed(2),
      status: current.csrPem ? "csr_generated" : "configured",
      updatedAt: new Date(),
    }).where(eq(eInvoiceUnitsTable.id, current.id)).returning();
    await audit(auth, "einvoice_configuration_saved", String(updated.id));
    return { unit: unitResponse(updated) };
  });
});

router.post("/e-invoicing/setup/csr", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (_request: Request, response: Response): Promise<void> => {
  const auth = requireOwner(response);
  if (!auth) return;
  await run(response, async () => {
    const current = await unitForOrganization(auth.organizationId);
    const seller = sellerFromUnit(current);
    if (!configurationIsComplete(seller)) throw new EInvoiceRouteError("أكمل بيانات المنشأة الضريبية والعنوان قبل إنشاء طلب الشهادة.");
    const generated = await generateCsr(seller, current.unitName, current.deviceSerialNumber);
    const [updated] = await db.update(eInvoiceUnitsTable).set({
      csrPem: generated.csrPem,
      privateKeyCiphertext: encryptEInvoiceSecret(generated.privateKeyPem),
      status: "csr_generated",
      updatedAt: new Date(),
    }).where(eq(eInvoiceUnitsTable.id, current.id)).returning();
    await audit(auth, "einvoice_csr_generated", String(updated.id));
    return { unit: unitResponse(updated), csrPem: generated.csrPem };
  });
});

router.put("/e-invoicing/credentials", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireOwner(response);
  if (!auth) return;
  await run(response, async () => {
    const body = value(request.body);
    const current = await unitForOrganization(auth.organizationId);
    if (!current.privateKeyCiphertext) throw new EInvoiceRouteError("أنشئ طلب الشهادة أولاً ثم أكمل اختبار الامتثال في بوابة فاتورة.");
    const certificateExpiresAt = optionalText(body.certificateExpiresAt, 40);
    const parsedExpiry = certificateExpiresAt ? new Date(certificateExpiresAt) : null;
    if (parsedExpiry && Number.isNaN(parsedExpiry.valueOf())) throw new EInvoiceRouteError("تاريخ انتهاء الشهادة غير صالح.");
    const [updated] = await db.update(eInvoiceUnitsTable).set({
      certificateCiphertext: encryptEInvoiceSecret(requiredText(body.certificatePem, "شهادة وحدة الإصدار", 30_000)),
      csidCiphertext: encryptEInvoiceSecret(requiredText(body.csid, "معرّف شهادة الحل", 5_000)),
      secretCiphertext: encryptEInvoiceSecret(requiredText(body.secret, "سر شهادة الحل", 5_000)),
      certificateExpiresAt: parsedExpiry,
      status: "ready",
      updatedAt: new Date(),
    }).where(eq(eInvoiceUnitsTable.id, current.id)).returning();
    await audit(auth, "einvoice_credentials_saved", String(updated.id));
    return { unit: unitResponse(updated) };
  });
});

router.get("/e-invoicing/documents", requireAuth, requireSubscriptionAccess, async (_request: Request, response: Response): Promise<void> => {
  const auth = requireSales(response);
  if (!auth) return;
  await run(response, async () => {
    const records = await db.select().from(eInvoiceDocumentsTable).where(eq(
      eInvoiceDocumentsTable.organizationId,
      auth.organizationId,
    )).orderBy(desc(eInvoiceDocumentsTable.issuedAt)).limit(200);
    return {
      documents: records.map((document) => ({
        id: document.id,
        invoiceRecordId: document.invoiceRecordId,
        parentDocumentId: document.parentDocumentId,
        documentType: document.documentType,
        status: document.status,
        invoiceNumber: document.invoiceNumber,
        uuid: document.uuid,
        invoiceCounter: document.invoiceCounter,
        qrPayload: document.qrPayload,
        submissionReference: document.submissionReference,
        submissionError: document.submissionError,
        submissionAttempts: document.submissionAttempts,
        issuedAt: document.issuedAt.toISOString(),
        lastSubmissionAt: document.lastSubmissionAt?.toISOString() ?? null,
        xmlAvailable: Boolean(document.xmlObjectPath),
      })),
    };
  });
});

router.get("/e-invoicing/documents/:id/xml", requireAuth, requireSubscriptionAccess, async (request: Request, response: Response): Promise<void> => {
  const auth = requireSales(response);
  if (!auth) return;
  try {
    const id = safeId(Array.isArray(request.params.id) ? request.params.id[0] : request.params.id);
    const [document] = await db.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.id, id),
      eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
    )).limit(1);
    if (!document?.xmlObjectPath) throw new EInvoiceRouteError("ملف XML غير متاح لهذا المستند.", 404);
    const xml = await readPrivateInvoiceXml(document.xmlObjectPath);
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="zatca-${document.invoiceNumber}.xml"`);
    response.send(xml);
  } catch (error) {
    if (error instanceof EInvoiceRouteError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/e-invoicing/documents/:id/submit", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireSales(response);
  if (!auth) return;
  await run(response, async () => {
    const id = safeId(Array.isArray(request.params.id) ? request.params.id[0] : request.params.id);
    const [document] = await db.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.id, id),
      eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
    )).limit(1);
    if (!document?.xmlObjectPath) throw new EInvoiceRouteError("لا يوجد XML مهيأ لإرساله.", 409);
    const unit = await unitForOrganization(auth.organizationId);
    const csid = decryptEInvoiceSecret(unit.csidCiphertext);
    const secret = decryptEInvoiceSecret(unit.secretCiphertext);
    if (!csid || !secret || unit.status !== "ready") {
      throw new EInvoiceRouteError("أكمل شهادة الحل وبيانات CSID من إعدادات الفوترة قبل الإرسال.", 409);
    }
    if (unit.environment === "production" || unit.environment === "sandbox") {
      throw new EInvoiceRouteError(
        "الإرسال إلى الهيئة مقفل حتى تُستبدل طبقة التوقيع باعتماد مرحلة الامتثال الرسمي من الهيئة.",
        409,
      );
    }
    if (!["pending_submission", "rejected"].includes(document.status)) {
      throw new EInvoiceRouteError("لا يمكن إرسال هذا المستند في حالته الحالية.", 409);
    }
    const baseUrl = unit.environment === "production"
      ? process.env.ZATCA_PRODUCTION_BASE_URL
      : process.env.ZATCA_SANDBOX_BASE_URL;
    if (!baseUrl) throw new EInvoiceRouteError("عنوان بيئة فاتورة غير مهيأ على الخادم. أضف عنوان البيئة المعتمد قبل الإرسال.", 409);
    const xml = await readPrivateInvoiceXml(document.xmlObjectPath);
    const endpoint = document.documentType === "standard"
      ? "/invoices/clearance/single"
      : "/invoices/reporting/single";
    const [claimed] = await db.update(eInvoiceDocumentsTable).set({
      status: "submitting",
      submissionAttempts: sql`${eInvoiceDocumentsTable.submissionAttempts} + 1`,
      lastSubmissionAt: new Date(),
      submissionError: null,
      updatedAt: new Date(),
    }).where(and(
      eq(eInvoiceDocumentsTable.id, document.id),
      eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
      notInArray(eInvoiceDocumentsTable.status, ["submitting", "cleared", "reported", "submission_unknown"]),
    )).returning();
    if (!claimed) throw new EInvoiceRouteError("هناك محاولة إرسال قيد المعالجة أو نتيجة غير مؤكدة لهذا المستند.", 409);
    let remote: globalThis.Response;
    try {
      remote = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoint}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Version": "V2",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${csid}:${secret}`).toString("base64")}`,
        },
        body: JSON.stringify({
          invoiceHash: document.invoiceHash,
          uuid: document.uuid,
          invoice: Buffer.from(xml, "utf8").toString("base64"),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      await db.update(eInvoiceDocumentsTable).set({
        status: "submission_unknown",
        submissionError: "انقطع الاتصال قبل استلام نتيجة الهيئة. راجع سجل الهيئة قبل إعادة الإرسال.",
        updatedAt: new Date(),
      }).where(eq(eInvoiceDocumentsTable.id, document.id));
      await audit(auth, "einvoice_submission_unknown", String(document.id));
      throw new EInvoiceRouteError("نتيجة الإرسال غير مؤكدة؛ لا تعِد المحاولة قبل مراجعة سجل الهيئة.", 503);
    }
    const remoteText = await remote.text();
    let remoteBody: RecordData = {};
    try { remoteBody = JSON.parse(remoteText) as RecordData; } catch { remoteBody = { message: remoteText }; }
    const authorityStatus = document.documentType === "standard"
      ? remoteBody.clearanceStatus
      : remoteBody.reportingStatus;
    const expectedStatus = document.documentType === "standard" ? "CLEARED" : "REPORTED";
    const accepted = remote.ok && typeof authorityStatus === "string" && authorityStatus.toUpperCase() === expectedStatus;
    const status = accepted ? (document.documentType === "standard" ? "cleared" : "reported") : "rejected";
    const [updated] = await db.update(eInvoiceDocumentsTable).set({
      status,
      submissionReference: typeof authorityStatus === "string" ? authorityStatus : remote.headers.get("request-id"),
      submissionError: accepted ? null : String(
        remoteBody.message
        ?? remoteBody.error
        ?? `لم تؤكد الهيئة قبول المستند برمز ${remote.status}.`,
      ).slice(0, 2_000),
      updatedAt: new Date(),
    }).where(eq(eInvoiceDocumentsTable.id, document.id)).returning();
    await audit(auth, accepted ? "einvoice_submitted" : "einvoice_submission_rejected", String(document.id), String(remote.status));
    if (!accepted) throw new EInvoiceRouteError(updated.submissionError || "لم تؤكد الهيئة قبول الفاتورة.", 422);
    return { document: { id: updated.id, status: updated.status, submissionReference: updated.submissionReference } };
  });
});

router.post("/e-invoicing/documents/:id/notes", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireSales(response);
  if (!auth) return;
  await run(response, async () => {
    const id = safeId(Array.isArray(request.params.id) ? request.params.id[0] : request.params.id);
    const body = value(request.body);
    const noteType: "credit_note" | "debit_note" = body.type === "debit_note" ? "debit_note" : "credit_note";
    const [original] = await db.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.id, id),
      eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
    )).limit(1);
    if (!original) throw new EInvoiceRouteError("لم يتم العثور على الفاتورة الأصلية.", 404);
    const [invoice] = await db.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.id, original.invoiceRecordId),
      eq(erpRecordsTable.organizationId, auth.organizationId),
      eq(erpRecordsTable.tableName, "invoices"),
    )).limit(1);
    if (!invoice) throw new EInvoiceRouteError("بيانات الفاتورة الأصلية غير متاحة.", 409);
    const amountValue = Number(body.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) throw new EInvoiceRouteError("أدخل مبلغ الإشعار بشكل صحيح.");
    const quantity = 1;
    const reason = requiredText(body.reason, "سبب الإشعار");
    const created = await db.transaction(async (tx) => {
      const [unit] = await tx.select().from(eInvoiceUnitsTable).where(
        eq(eInvoiceUnitsTable.organizationId, auth.organizationId),
      ).for("update");
      if (!unit) throw new EInvoiceRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
      const seller = sellerFromUnit(unit);
      if (!configurationIsComplete(seller)) throw new EInvoiceRouteError("لا يمكن إصدار إشعار قبل إكمال إعدادات الفوترة.");
      const invoiceNumber = `${noteType === "credit_note" ? "CN" : "DN"}-${original.invoiceNumber}-${unit.nextInvoiceCounter}`;
      const generated = generateInvoiceDocument({
        invoiceNumber,
        invoiceCounter: unit.nextInvoiceCounter,
        previousInvoiceHash: unit.previousInvoiceHash,
        documentType: noteType,
        issueAt: new Date(),
        customerName: String(invoice.data.customerName ?? "عميل نقدي"),
        customerVatNumber: optionalText(body.customerVatNumber, 15),
        paymentMethod: String(invoice.data.paymentMethod ?? "cash"),
        lines: [{ name: reason, sku: "", quantity, unitPrice: amountValue, total: amountValue }],
        seller,
        parentInvoiceUuid: original.uuid,
        privateKeyPem: decryptEInvoiceSecret(unit.privateKeyCiphertext),
        certificatePem: decryptEInvoiceSecret(unit.certificateCiphertext),
      });
      const [note] = await tx.insert(eInvoiceDocumentsTable).values({
        organizationId: auth.organizationId,
        unitId: unit.id,
        invoiceRecordId: original.invoiceRecordId,
        parentDocumentId: original.id,
        documentType: noteType,
        status: "pending_compliance",
        invoiceNumber,
        uuid: generated.uuid,
        invoiceCounter: unit.nextInvoiceCounter,
        previousInvoiceHash: unit.previousInvoiceHash,
        invoiceHash: generated.invoiceHash,
        qrPayload: generated.qrPayload,
        xmlDigest: generated.invoiceHash,
        issuedAt: new Date(),
      }).returning();
      const xmlObjectPath = await savePrivateInvoiceXml(auth.organizationId, note.id, generated.xml);
      const [updated] = await tx.update(eInvoiceDocumentsTable).set({ xmlObjectPath, updatedAt: new Date() })
        .where(eq(eInvoiceDocumentsTable.id, note.id)).returning();
      await tx.update(eInvoiceUnitsTable).set({
        nextInvoiceCounter: unit.nextInvoiceCounter + 1,
        previousInvoiceHash: generated.invoiceHash,
        updatedAt: new Date(),
      }).where(eq(eInvoiceUnitsTable.id, unit.id));
      return updated;
    });
    await audit(auth, "einvoice_note_issued", String(created.id), noteType);
    return { document: { id: created.id, invoiceNumber: created.invoiceNumber, status: created.status, qrPayload: created.qrPayload } };
  });
});

export default router;