import { Router, type IRouter, type Request, type Response } from "express";
import { X509Certificate } from "node:crypto";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  db,
  eInvoiceDocumentsTable,
  eInvoiceUnitsTable,
  erpRecordsTable,
  organizationsTable,
  type EInvoiceUnit,
} from "@workspace/db";
import {
  configurationIsComplete,
  complianceSuiteIsPassed,
  decryptEInvoiceSecret,
  encryptEInvoiceSecret,
  generateCsr,
  generateInvoiceDocument,
  officialValidationStatus,
  parseComplianceSuiteResults,
  ZATCA_COMPLIANCE_FIXTURES,
  type ZatcaComplianceFixtureResult,
  type SellerProfile,
} from "../lib/e-invoicing";
import {
  EInvoiceAdjustmentError,
  issueEInvoiceAdjustment,
  materializePendingEInvoiceAdjustments,
} from "../lib/e-invoice-adjustments";
import { readPrivateInvoiceXml, savePrivateInvoiceXml } from "../lib/private-object-store";
import {
  requireAuth,
  requireCurrentDataGeneration,
  requireSubscriptionAccess,
  lockAndValidateDataGeneration,
  lockedWriteRejection,
  hasSubscriptionAccess,
  type AuthContext,
} from "../middleware/team-auth";
import { isLocationAllowed } from "../lib/location-scope";

const router: IRouter = Router();
const DEFAULT_CERTIFICATE_EXPIRY_WARNING_DAYS = 30;
const MIN_CERTIFICATE_EXPIRY_WARNING_DAYS = 1;
const MAX_CERTIFICATE_EXPIRY_WARNING_DAYS = 365;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

type RecordData = Record<string, unknown>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

function certificateExpiryWarningDays(raw: unknown, fallback = DEFAULT_CERTIFICATE_EXPIRY_WARNING_DAYS): number {
  if (raw == null || raw === "") return fallback;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < MIN_CERTIFICATE_EXPIRY_WARNING_DAYS || days > MAX_CERTIFICATE_EXPIRY_WARNING_DAYS) {
    throw new EInvoiceRouteError(`فترة التنبيه يجب أن تكون بين ${MIN_CERTIFICATE_EXPIRY_WARNING_DAYS} و${MAX_CERTIFICATE_EXPIRY_WARNING_DAYS} يوماً.`);
  }
  return days;
}

type CertificateStatus = "missing" | "valid" | "expiring" | "expired";

type CertificateStateUnit = Pick<
  EInvoiceUnit,
  "certificateCiphertext" | "certificateExpiresAt" | "certificateExpiryWarningDays"
>;

function certificateState(unit: CertificateStateUnit, now = new Date()): {
  status: CertificateStatus;
  daysRemaining: number | null;
  warningDays: number;
  usable: boolean;
} {
  const warningDays = certificateExpiryWarningDays(unit.certificateExpiryWarningDays);
  if (!unit.certificateExpiresAt || Number.isNaN(unit.certificateExpiresAt.valueOf())) {
    return { status: "missing", daysRemaining: null, warningDays, usable: false };
  }
  let certificateExpiry: Date;
  try {
    const certificatePem = decryptEInvoiceSecret(unit.certificateCiphertext);
    if (!certificatePem) return { status: "missing", daysRemaining: null, warningDays, usable: false };
    certificateExpiry = certificateExpiryFromPem(certificatePem);
  } catch {
    return { status: "missing", daysRemaining: null, warningDays, usable: false };
  }
  // Use the earlier of the persisted value and the X.509 value. A stale or
  // tampered persisted date must never make an expired certificate usable.
  const effectiveExpiry = new Date(Math.min(
    unit.certificateExpiresAt.getTime(),
    certificateExpiry.getTime(),
  ));
  const millisecondsRemaining = effectiveExpiry.getTime() - now.getTime();
  const daysRemaining = Math.ceil(millisecondsRemaining / DAY_IN_MILLISECONDS);
  if (millisecondsRemaining <= 0) {
    return { status: "expired", daysRemaining, warningDays, usable: false };
  }
  return {
    status: daysRemaining <= warningDays ? "expiring" : "valid",
    daysRemaining,
    warningDays,
    usable: true,
  };
}

function certificateExpiryFromPem(certificatePem: string): Date {
  try {
    const certificate = new X509Certificate(certificatePem);
    const expiresAt = new Date(certificate.validTo);
    if (Number.isNaN(expiresAt.valueOf())) throw new Error("Invalid certificate expiry");
    return expiresAt;
  } catch {
    throw new EInvoiceRouteError("شهادة وحدة الإصدار غير صالحة. الصق شهادة PEM التي أصدرتها بوابة فاتورة.");
  }
}

function requireUsableCertificate(unit: EInvoiceUnit): void {
  const certificate = certificateState(unit);
  if (certificate.status === "expired") {
    throw new EInvoiceRouteError("انتهت شهادة وحدة الإصدار. جدّدها ثم أعد فحص الامتثال قبل إرسال الفواتير.", 409);
  }
  if (certificate.status === "missing") {
    throw new EInvoiceRouteError("لا يمكن الإرسال قبل حفظ شهادة يمكن التحقق من تاريخ انتهائها.", 409);
  }
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
  // Unit creation is a write too. Lock the same organization row used by
  // tenant mutations so an administrative suspension cannot race it.
  return db.transaction(async (tx) => {
    const [organization] = await tx.select().from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId)).for("update");
    if (!organization || !hasSubscriptionAccess(organization)) {
      throw new EInvoiceRouteError(
        organization?.platformAccessSuspendedAt
          ? "تم تعليق وصول هذه المنشأة من إدارة المنصة."
          : "يتطلب الوصول إلى لوحة التحكم اشتراكاً فعالاً أو فترة تجريبية سارية.",
        402,
        { code: organization?.platformAccessSuspendedAt ? "platform_access_suspended" : "subscription_required" },
      );
    }
    const [existing] = await tx.select().from(eInvoiceUnitsTable)
      .where(eq(eInvoiceUnitsTable.organizationId, organizationId)).limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(eInvoiceUnitsTable).values({ organizationId }).returning();
    return created;
  });
}

async function requireLockedWrite(tx: Transaction, response: Response): Promise<void> {
  if (!await lockAndValidateDataGeneration(tx, response)) {
    const rejection = lockedWriteRejection(response);
    throw new EInvoiceRouteError(rejection.error, rejection.status, { code: rejection.code });
  }
}

function authorityXmlFromResponse(body: RecordData): string | undefined {
  const candidates = [body.clearedInvoice, body.invoice, body.xml];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const decoded = Buffer.from(candidate, "base64").toString("utf8");
    if (decoded.trimStart().startsWith("<")) return decoded;
    if (candidate.trimStart().startsWith("<")) return candidate;
  }
  return undefined;
}

function complianceErrorFromResponse(body: RecordData): string | undefined {
  const validation = value(body.validationResults);
  const errors = validation.errorMessages;
  if (Array.isArray(errors) && errors.length) {
    return errors.map((entry) => {
      const item = value(entry);
      return String(item.message ?? item.code ?? "خطأ تحقق غير محدد");
    }).join(" | ").slice(0, 2_000);
  }
  const message = body.message ?? body.error;
  return typeof message === "string" && message ? message.slice(0, 2_000) : undefined;
}

function complianceSuiteResponse(unit: EInvoiceUnit): RecordData {
  const results = parseComplianceSuiteResults(unit.complianceSuiteResults);
  return {
    status: unit.complianceSuiteStatus,
    checkedAt: unit.lastComplianceCheckAt?.toISOString() ?? null,
    fixtures: ZATCA_COMPLIANCE_FIXTURES.map((fixture) => ({
      id: fixture.id,
      label: fixture.label,
      documentType: fixture.documentType,
      scenario: fixture.scenario,
      result: results.find((result) => result.fixtureId === fixture.id) ?? null,
    })),
  };
}

async function authorityRequest(
  baseUrl: string,
  endpoint: string,
  csid: string,
  secret: string,
  document: { invoiceHash: string; uuid: string; xmlObjectPath: string | null },
): Promise<{ response: globalThis.Response; body: RecordData }> {
  if (!document.xmlObjectPath) throw new EInvoiceRouteError("لا يوجد XML مهيأ لإرساله.", 409);
  const xml = await readPrivateInvoiceXml(document.xmlObjectPath);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoint}`, {
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
  const text = await response.text();
  try {
    return { response, body: JSON.parse(text) as RecordData };
  } catch {
    return { response, body: { message: text } };
  }
}

function unitResponse(unit: EInvoiceUnit): RecordData {
  const seller = sellerFromUnit(unit);
  const certificate = certificateState(unit);
  const readyForSubmission = Boolean(
    configurationIsComplete(seller)
    && unit.certificateCiphertext
    && unit.csidCiphertext
    && unit.secretCiphertext
    && unit.complianceSuiteStatus === "passed"
    && certificate.usable,
  );
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
    certificateExpiryWarningDays: certificate.warningDays,
    certificateStatus: certificate.status,
    certificateDaysRemaining: certificate.daysRemaining,
    certificateUsable: certificate.usable,
    readyForSubmission,
    complianceStatus: unit.complianceStatus,
    complianceSuiteStatus: unit.complianceSuiteStatus,
    complianceSuiteResults: parseComplianceSuiteResults(unit.complianceSuiteResults),
    complianceSuite: complianceSuiteResponse(unit),
    lastComplianceCheckAt: unit.lastComplianceCheckAt?.toISOString() ?? null,
    complianceError: unit.complianceError,
  };
}

class EInvoiceRouteError extends Error {
  constructor(message: string, readonly status = 400, readonly details: RecordData = {}) {
    super(message);
  }
}

async function run(response: Response, handler: () => Promise<RecordData>): Promise<void> {
  try {
    response.json(await handler());
  } catch (error) {
    if (error instanceof EInvoiceRouteError || error instanceof EInvoiceAdjustmentError) {
      const details = error instanceof EInvoiceRouteError ? error.details : {};
      response.status(error.status).json({ error: error.message, ...details });
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
    const updated = await db.transaction(async (tx) => {
      await requireLockedWrite(tx, response);
      await tx.insert(eInvoiceUnitsTable).values({ organizationId: auth.organizationId }).onConflictDoNothing();
      const [current] = await tx.select().from(eInvoiceUnitsTable)
        .where(eq(eInvoiceUnitsTable.organizationId, auth.organizationId)).for("update");
      if (!current) throw new EInvoiceRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
      if (current.csrPem || current.certificateCiphertext) {
        throw new EInvoiceRouteError("بيانات جهة الإصدار مقفلة بعد إنشاء طلب الشهادة. أنشئ وحدة إصدار جديدة عند تغيير البيانات القانونية.", 409);
      }
      const [saved] = await tx.update(eInvoiceUnitsTable).set({
        unitName: requiredText(body.unitName ?? current.unitName, "اسم وحدة الإصدار"),
        deviceSerialNumber: requiredText(body.deviceSerialNumber ?? current.deviceSerialNumber, "الرقم التسلسلي لوحدة الإصدار"),
        environment: body.environment === "production" ? "production" : "sandbox",
        ...seller, vatRate: seller.vatRate.toFixed(2),
        certificateExpiryWarningDays: certificateExpiryWarningDays(body.certificateExpiryWarningDays, current.certificateExpiryWarningDays),
        status: current.csrPem ? "csr_generated" : "configured", updatedAt: new Date(),
      }).where(eq(eInvoiceUnitsTable.id, current.id)).returning();
      const { teamAuditLogsTable } = await import("@workspace/db");
      await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: "einvoice_configuration_saved", entity: String(saved.id), details: "" });
      return saved;
    });
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
    const updated = await db.transaction(async (tx) => {
      await requireLockedWrite(tx, response);
      const [locked] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.id, current.id)).for("update");
      if (!locked) throw new EInvoiceRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
      const [saved] = await tx.update(eInvoiceUnitsTable).set({ csrPem: generated.csrPem, privateKeyCiphertext: encryptEInvoiceSecret(generated.privateKeyPem), status: "csr_generated", updatedAt: new Date() }).where(eq(eInvoiceUnitsTable.id, locked.id)).returning();
      const { teamAuditLogsTable } = await import("@workspace/db");
      await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: "einvoice_csr_generated", entity: String(saved.id), details: "" });
      return saved;
    });
    return { unit: unitResponse(updated), csrPem: generated.csrPem };
  });
});

router.put("/e-invoicing/setup/certificate-warning", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireOwner(response);
  if (!auth) return;
  await run(response, async () => {
    const body = value(request.body);
    const warningDays = certificateExpiryWarningDays(body.certificateExpiryWarningDays);
    const updated = await db.transaction(async (tx) => {
      await requireLockedWrite(tx, response);
      const [current] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.organizationId, auth.organizationId)).for("update");
      if (!current) throw new EInvoiceRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
      const [saved] = await tx.update(eInvoiceUnitsTable).set({ certificateExpiryWarningDays: warningDays, updatedAt: new Date() }).where(eq(eInvoiceUnitsTable.id, current.id)).returning();
      const { teamAuditLogsTable } = await import("@workspace/db");
      await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: "einvoice_certificate_warning_updated", entity: String(saved.id), details: String(warningDays) });
      return saved;
    });
    return { unit: unitResponse(updated) };
  });
});

router.put("/e-invoicing/credentials", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireOwner(response);
  if (!auth) return;
  await run(response, async () => {
    const body = value(request.body);
    const certificatePem = requiredText(body.certificatePem, "شهادة وحدة الإصدار", 30_000);
    const parsedExpiry = certificateExpiryFromPem(certificatePem);
    const updated = await db.transaction(async (tx) => {
      await requireLockedWrite(tx, response);
      const [current] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.organizationId, auth.organizationId)).for("update");
      if (!current?.privateKeyCiphertext) throw new EInvoiceRouteError("أنشئ طلب الشهادة أولاً ثم أكمل اختبار الامتثال في بوابة فاتورة.");
      const [saved] = await tx.update(eInvoiceUnitsTable).set({
        certificateCiphertext: encryptEInvoiceSecret(certificatePem), csidCiphertext: encryptEInvoiceSecret(requiredText(body.csid, "معرّف شهادة الحل", 5_000)),
        secretCiphertext: encryptEInvoiceSecret(requiredText(body.secret, "سر شهادة الحل", 5_000)), certificateExpiresAt: parsedExpiry,
        status: "credentials_saved", complianceStatus: "not_started", complianceSuiteStatus: "not_started", complianceSuiteResults: null, complianceError: null, lastComplianceCheckAt: null, updatedAt: new Date(),
      }).where(eq(eInvoiceUnitsTable.id, current.id)).returning();
      await tx.update(eInvoiceDocumentsTable).set({ status: "pending_compliance", updatedAt: new Date() }).where(and(eq(eInvoiceDocumentsTable.organizationId, auth.organizationId), eq(eInvoiceDocumentsTable.unitId, current.id), inArray(eInvoiceDocumentsTable.status, ["pending_submission", "rejected"])));
      await materializePendingEInvoiceAdjustments(tx, auth.organizationId);
      const { teamAuditLogsTable } = await import("@workspace/db");
      await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: "einvoice_credentials_saved", entity: String(saved.id), details: "" });
      return saved;
    });
    return { unit: unitResponse(updated) };
  });
});

router.get("/e-invoicing/documents", requireAuth, requireSubscriptionAccess, async (_request: Request, response: Response): Promise<void> => {
  const auth = requireSales(response);
  if (!auth) return;
  await run(response, async () => {
    const unit = await unitForOrganization(auth.organizationId);
    const certificate = certificateState(unit);
    const records = await db.select().from(eInvoiceDocumentsTable).where(eq(
      eInvoiceDocumentsTable.organizationId,
      auth.organizationId,
    )).orderBy(desc(eInvoiceDocumentsTable.issuedAt)).limit(200);
    const invoiceRecordIds = [...new Set(records.map((document) => document.invoiceRecordId))];
    const invoiceRecords = invoiceRecordIds.length
      ? await db.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, auth.organizationId),
        eq(erpRecordsTable.tableName, "invoices"),
        inArray(erpRecordsTable.id, invoiceRecordIds),
      ))
      : [];
    const allowedInvoiceRecordIds = new Set(invoiceRecords
      .filter((record) => isLocationAllowed(auth, "invoices", record.data, record.id))
      .map((record) => record.id));
    const visibleRecords = records.filter((document) => allowedInvoiceRecordIds.has(document.invoiceRecordId));
    return {
      documents: visibleRecords.map((document) => ({
        id: document.id,
        invoiceRecordId: document.invoiceRecordId,
        parentDocumentId: document.parentDocumentId,
        parentInvoiceNumber: document.parentDocumentId
          ? records.find((candidate) => candidate.id === document.parentDocumentId)?.invoiceNumber ?? null
          : null,
        documentType: document.documentType,
        status: document.status === "pending_submission" && !certificate.usable
          ? (certificate.status === "expired" ? "certificate_expired" : "certificate_action_required")
          : document.status,
        invoiceNumber: document.invoiceNumber,
        uuid: document.uuid,
        invoiceCounter: document.invoiceCounter,
        qrPayload: document.qrPayload,
        submissionReference: document.submissionReference,
        submissionError: document.submissionError,
        submissionAttempts: document.submissionAttempts,
        localValidationError: document.localValidationError,
        authorityXmlAvailable: Boolean(document.authorityXmlObjectPath),
        issuedAt: document.issuedAt.toISOString(),
        lastSubmissionAt: document.lastSubmissionAt?.toISOString() ?? null,
        adjustmentReason: document.adjustmentReason,
        taxExclusiveAmount: document.taxExclusiveAmount == null ? null : Number(document.taxExclusiveAmount),
        taxAmount: document.taxAmount == null ? null : Number(document.taxAmount),
        taxInclusiveAmount: document.taxInclusiveAmount == null ? null : Number(document.taxInclusiveAmount),
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
    const [invoice] = document
      ? await db.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, document.invoiceRecordId),
        eq(erpRecordsTable.organizationId, auth.organizationId),
        eq(erpRecordsTable.tableName, "invoices"),
      )).limit(1)
      : [];
    if (!document || !invoice || !isLocationAllowed(auth, "invoices", invoice.data, invoice.id)) {
      throw new EInvoiceRouteError("المستند غير متاح.", 404);
    }
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

router.get("/e-invoicing/documents/:id/authority-xml", requireAuth, requireSubscriptionAccess, async (request: Request, response: Response): Promise<void> => {
  const auth = requireSales(response);
  if (!auth) return;
  try {
    const id = safeId(Array.isArray(request.params.id) ? request.params.id[0] : request.params.id);
    const [document] = await db.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.id, id),
      eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
    )).limit(1);
    const [invoice] = document
      ? await db.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, document.invoiceRecordId),
        eq(erpRecordsTable.organizationId, auth.organizationId),
        eq(erpRecordsTable.tableName, "invoices"),
      )).limit(1)
      : [];
    if (!document || !invoice || !isLocationAllowed(auth, "invoices", invoice.data, invoice.id)) {
      throw new EInvoiceRouteError("المستند غير متاح.", 404);
    }
    if (!document?.authorityXmlObjectPath) throw new EInvoiceRouteError("لم تُعد الهيئة نسخة XML لهذا المستند.", 404);
    const xml = await readPrivateInvoiceXml(document.authorityXmlObjectPath);
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="zatca-authority-${document.invoiceNumber}.xml"`);
    response.send(xml);
  } catch (error) {
    if (error instanceof EInvoiceRouteError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/e-invoicing/compliance/check", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireOwner(response);
  if (!auth) return;
  await run(response, async () => {
    const outcome = await db.transaction(async (tx) => {
    await requireLockedWrite(tx, response);
    const body = value(request.body);
    const preferredDocumentId = body.documentId == null ? null : safeId(body.documentId);
    const [unit] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.organizationId, auth.organizationId)).for("update");
    if (!unit) throw new EInvoiceRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
    requireUsableCertificate(unit);
    const csid = decryptEInvoiceSecret(unit.csidCiphertext);
    const secret = decryptEInvoiceSecret(unit.secretCiphertext);
    if (!csid || !secret) throw new EInvoiceRouteError("احفظ Compliance CSID وبياناته قبل فحص الامتثال.", 409);
    if (unit.environment !== "sandbox") {
      throw new EInvoiceRouteError("فحص الامتثال يجب أن يتم في بيئة Sandbox قبل تهيئة الإنتاج.", 409);
    }
    const baseUrl = process.env.ZATCA_SANDBOX_BASE_URL;
    if (!baseUrl) throw new EInvoiceRouteError("عنوان Sandbox المعتمد غير مهيأ على الخادم.", 409);
    const documents = await tx.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
      eq(eInvoiceDocumentsTable.unitId, unit.id),
    )).orderBy(desc(eInvoiceDocumentsTable.issuedAt));
    const preferredDocument = preferredDocumentId == null
      ? null
      : documents.find((document) => document.id === preferredDocumentId) ?? null;
    if (preferredDocumentId != null && !preferredDocument) {
      throw new EInvoiceRouteError("المستند المحدد لا يتبع لوحدة الإصدار الحالية.", 404);
    }
    await tx.update(eInvoiceUnitsTable).set({
      complianceStatus: "checking",
      complianceSuiteStatus: "checking",
      complianceError: null,
      updatedAt: new Date(),
    }).where(eq(eInvoiceUnitsTable.id, unit.id));
    const checkedAt = new Date().toISOString();
    const results: ZatcaComplianceFixtureResult[] = [];
    for (const fixture of ZATCA_COMPLIANCE_FIXTURES) {
      const document = preferredDocument?.documentType === fixture.documentType
        ? preferredDocument
        : documents.find((candidate) => candidate.documentType === fixture.documentType);
      if (!document || !document.xmlObjectPath || document.localValidationError) {
        results.push({
          fixtureId: fixture.id,
          label: fixture.label,
          documentType: fixture.documentType,
          documentId: document?.id ?? null,
          invoiceNumber: document?.invoiceNumber ?? null,
          status: "missing",
          httpStatus: null,
          authorityMessage: `لا يوجد مستند ${fixture.label} موقّع وجاهز لاختبار Sandbox.`,
          checkedAt,
        });
        continue;
      }
      try {
        const remote = await authorityRequest(baseUrl, "/compliance/invoices", csid, secret, document);
        const responseError = complianceErrorFromResponse(remote.body);
        const validationStatus = officialValidationStatus(remote.body);
        const passed = remote.response.ok && validationStatus === "PASS" && !responseError;
        const returnedXml = authorityXmlFromResponse(remote.body);
        if (returnedXml) {
          const authorityXmlObjectPath = await savePrivateInvoiceXml(auth.organizationId, document.id, returnedXml, "authority");
          await tx.update(eInvoiceDocumentsTable).set({ authorityXmlObjectPath, updatedAt: new Date() })
            .where(eq(eInvoiceDocumentsTable.id, document.id));
        }
        results.push({
          fixtureId: fixture.id,
          label: fixture.label,
          documentType: fixture.documentType,
          documentId: document.id,
          invoiceNumber: document.invoiceNumber,
          status: passed ? "passed" : "failed",
          httpStatus: remote.response.status,
          authorityMessage: passed
            ? null
            : (responseError ?? `لم تؤكد أداة الهيئة الرسمية اجتياز الحالة (النتيجة: ${validationStatus}).`),
          checkedAt,
        });
      } catch {
        results.push({
          fixtureId: fixture.id,
          label: fixture.label,
          documentType: fixture.documentType,
          documentId: document.id,
          invoiceNumber: document.invoiceNumber,
          status: "unknown",
          httpStatus: null,
          authorityMessage: "انقطع الاتصال قبل استلام نتيجة هذه الحالة. راجع بوابة الهيئة قبل إعادة الفحص.",
          checkedAt,
        });
      }
    }
    const accepted = complianceSuiteIsPassed(results);
    const hasUnknownResult = results.some((result) => result.status === "unknown");
    const error = accepted
      ? null
      : results.filter((result) => result.status !== "passed")
        .map((result) => `${result.label}: ${result.authorityMessage ?? "لم تجتز الحالة."}`)
        .join(" | ")
        .slice(0, 2_000);
    const [updatedUnit] = await tx.update(eInvoiceUnitsTable).set({
      status: accepted ? "compliance_passed" : "credentials_saved",
      complianceStatus: accepted ? "passed" : (hasUnknownResult ? "unknown" : "failed"),
      complianceSuiteStatus: accepted ? "passed" : (hasUnknownResult ? "unknown" : "failed"),
      complianceSuiteResults: JSON.stringify(results),
      complianceError: error,
      lastComplianceCheckAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(eInvoiceUnitsTable.id, unit.id)).returning();
    if (accepted) {
      const passedDocumentIds = results.flatMap((result) => result.status === "passed" && result.documentId ? [result.documentId] : []);
      await tx.update(eInvoiceDocumentsTable).set({ status: "pending_submission", updatedAt: new Date() })
        .where(and(
          eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
          eq(eInvoiceDocumentsTable.unitId, unit.id),
          eq(eInvoiceDocumentsTable.status, "pending_compliance"),
          inArray(eInvoiceDocumentsTable.id, passedDocumentIds),
        ));
    }
    const { teamAuditLogsTable } = await import("@workspace/db");
    await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: accepted ? "einvoice_compliance_passed" : "einvoice_compliance_failed", entity: String(unit.id), details: JSON.stringify(results.map((result) => ({
      fixture: result.fixtureId,
      status: result.status,
      httpStatus: result.httpStatus,
    }))) });
    const resultPayload = {
      unit: unitResponse(updatedUnit),
      suite: complianceSuiteResponse(updatedUnit),
    };
    return accepted
      ? { kind: "accepted" as const, payload: resultPayload }
      : { kind: "failed" as const, unknown: hasUnknownResult, payload: resultPayload };
    });
    if (outcome.kind === "failed") {
      throw new EInvoiceRouteError(
        outcome.unknown
          ? "نتيجة حزمة الامتثال غير مؤكدة؛ راجع سجل الهيئة قبل إعادة الفحص."
          : "لم تجتز جميع حالات حزمة الامتثال الرسمية.",
        outcome.unknown ? 503 : 422,
        outcome.payload,
      );
    }
    return outcome.payload;
  });
});

router.post("/e-invoicing/documents/:id/submit", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = requireSales(response);
  if (!auth) return;
  await run(response, async () => {
    const outcome = await db.transaction(async (tx) => {
    await requireLockedWrite(tx, response);
    const id = safeId(Array.isArray(request.params.id) ? request.params.id[0] : request.params.id);
    const [document] = await tx.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.id, id),
      eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
    )).limit(1).for("update");
    const [invoice] = document
      ? await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, document.invoiceRecordId),
        eq(erpRecordsTable.organizationId, auth.organizationId),
        eq(erpRecordsTable.tableName, "invoices"),
      )).limit(1).for("update")
      : [];
    if (!document || !invoice || !isLocationAllowed(auth, "invoices", invoice.data, invoice.id)) {
      throw new EInvoiceRouteError("المستند غير متاح.", 404);
    }
    if (!document?.xmlObjectPath) throw new EInvoiceRouteError("لا يوجد XML مهيأ لإرساله.", 409);
    const [unit] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.organizationId, auth.organizationId)).for("update");
    if (!unit) throw new EInvoiceRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
    requireUsableCertificate(unit);
    const documentCompliancePassed = parseComplianceSuiteResults(unit.complianceSuiteResults)
      .some((result) => result.status === "passed" && result.documentId === document.id);
    if (!unit.csidCiphertext || !unit.secretCiphertext || unit.complianceSuiteStatus !== "passed" || !documentCompliancePassed) {
      throw new EInvoiceRouteError("لا يمكن الإرسال قبل اجتياز حزمة حالات الامتثال الرسمية في Sandbox، بما فيها هذا المستند.", 409);
    }
    if (!["pending_submission", "rejected"].includes(document.status)) {
      throw new EInvoiceRouteError("لا يمكن إرسال هذا المستند في حالته الحالية.", 409);
    }
    const [parentDocument] = document.parentDocumentId
      ? await tx.select({ documentType: eInvoiceDocumentsTable.documentType })
        .from(eInvoiceDocumentsTable)
        .where(and(
          eq(eInvoiceDocumentsTable.id, document.parentDocumentId),
          eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
        )).limit(1)
      : [];
    const requiresClearance = document.documentType === "standard" || parentDocument?.documentType === "standard";
    const endpoint = requiresClearance
      ? "/invoices/clearance/single"
      : "/invoices/reporting/single";
    const [claimed] = await tx.update(eInvoiceDocumentsTable).set({
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
    const [latestUnit] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.id, unit.id)).for("update");
    if (!latestUnit) throw new EInvoiceRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
    const latestCertificate = certificateState(latestUnit);
    let submissionCredentials: { baseUrl: string; csid: string; secret: string } | null = null;
    try {
      requireUsableCertificate(latestUnit);
      const latestCsid = decryptEInvoiceSecret(latestUnit.csidCiphertext);
      const latestSecret = decryptEInvoiceSecret(latestUnit.secretCiphertext);
      const latestDocumentCompliancePassed = parseComplianceSuiteResults(latestUnit.complianceSuiteResults)
        .some((result) => result.status === "passed" && result.documentId === document.id);
      if (!latestCsid || !latestSecret || latestUnit.complianceSuiteStatus !== "passed" || !latestDocumentCompliancePassed) {
        throw new EInvoiceRouteError("تغيّرت بيانات الشهادة أو حالة الامتثال قبل الإرسال. أعد فحص الامتثال قبل المحاولة.", 409);
      }
      const latestBaseUrl = latestUnit.environment === "production"
        ? process.env.ZATCA_PRODUCTION_BASE_URL
        : process.env.ZATCA_SANDBOX_BASE_URL;
      if (!latestBaseUrl) throw new EInvoiceRouteError("عنوان بيئة فاتورة غير مهيأ على الخادم. أضف عنوان البيئة المعتمد قبل الإرسال.", 409);
      submissionCredentials = { baseUrl: latestBaseUrl, csid: latestCsid, secret: latestSecret };
    } catch (error) {
      await tx.update(eInvoiceDocumentsTable).set({
        status: latestCertificate.usable ? "pending_compliance" : "pending_submission",
        submissionError: error instanceof Error ? error.message : "لم تعد الشهادة صالحة للإرسال.",
        updatedAt: new Date(),
      }).where(eq(eInvoiceDocumentsTable.id, document.id));
      return { kind: "credential_error" as const, error: error instanceof Error ? error.message : "لم تعد الشهادة صالحة للإرسال." };
    }
    if (!submissionCredentials) return { kind: "credential_error" as const, error: "تعذر تجهيز بيانات الإرسال." };
    let remote: { response: globalThis.Response; body: RecordData };
    try {
      remote = await authorityRequest(
        submissionCredentials.baseUrl,
        endpoint,
        submissionCredentials.csid,
        submissionCredentials.secret,
        document,
      );
    } catch {
      await tx.update(eInvoiceDocumentsTable).set({
        status: "submission_unknown",
        submissionError: "انقطع الاتصال قبل استلام نتيجة الهيئة. راجع سجل الهيئة قبل إعادة الإرسال.",
        updatedAt: new Date(),
      }).where(eq(eInvoiceDocumentsTable.id, document.id));
      const { teamAuditLogsTable } = await import("@workspace/db");
      await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: "einvoice_submission_unknown", entity: String(document.id), details: "" });
      return { kind: "unknown" as const };
    }
    const authorityStatus = requiresClearance
      ? remote.body.clearanceStatus
      : remote.body.reportingStatus;
    const expectedStatus = requiresClearance ? "CLEARED" : "REPORTED";
    const accepted = remote.response.ok && typeof authorityStatus === "string" && authorityStatus.toUpperCase() === expectedStatus;
    const status = accepted ? (requiresClearance ? "cleared" : "reported") : "rejected";
    const returnedXml = authorityXmlFromResponse(remote.body);
    const authorityXmlObjectPath = returnedXml
      ? await savePrivateInvoiceXml(auth.organizationId, document.id, returnedXml, "authority")
      : null;
    const [updated] = await tx.update(eInvoiceDocumentsTable).set({
      status,
      submissionReference: typeof authorityStatus === "string" ? authorityStatus : remote.response.headers.get("request-id"),
      authorityXmlObjectPath: authorityXmlObjectPath ?? document.authorityXmlObjectPath,
      submissionError: accepted ? null : String(
        remote.body.message
        ?? remote.body.error
        ?? `لم تؤكد الهيئة قبول المستند برمز ${remote.response.status}.`,
      ).slice(0, 2_000),
      updatedAt: new Date(),
    }).where(eq(eInvoiceDocumentsTable.id, document.id)).returning();
    const { teamAuditLogsTable } = await import("@workspace/db");
    await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: accepted ? "einvoice_submitted" : "einvoice_submission_rejected", entity: String(document.id), details: String(remote.response.status) });
    if (!accepted) return { kind: "rejected" as const, error: updated.submissionError || "لم تؤكد الهيئة قبول الفاتورة." };
    return { kind: "accepted" as const, document: { id: updated.id, status: updated.status, submissionReference: updated.submissionReference } };
    });
    if (outcome.kind === "credential_error") throw new EInvoiceRouteError(outcome.error, 409);
    if (outcome.kind === "unknown") throw new EInvoiceRouteError("نتيجة الإرسال غير مؤكدة؛ لا تعِد المحاولة قبل مراجعة سجل الهيئة.", 503);
    if (outcome.kind === "rejected") throw new EInvoiceRouteError(outcome.error, 422);
    return { document: outcome.document };
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
    if (!isLocationAllowed(auth, "invoices", invoice.data, invoice.id)) {
      throw new EInvoiceRouteError("المستند غير متاح.", 404);
    }
    const operationId = request.get("Idempotency-Key")?.trim() ?? "";
    if (!operationId || operationId.length > 180) throw new EInvoiceRouteError("معرّف عملية الإشعار مطلوب.");
    const amountValue = Number(body.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) throw new EInvoiceRouteError("أدخل مبلغ الإشعار بشكل صحيح.");
    const reason = requiredText(body.reason, "سبب الإشعار");
    const created = await db.transaction(async (tx) => {
      await requireLockedWrite(tx, response);
      const [lockedOriginal] = await tx.select().from(eInvoiceDocumentsTable).where(and(
        eq(eInvoiceDocumentsTable.id, original.id),
        eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
      )).limit(1).for("update");
      const [lockedInvoice] = lockedOriginal
        ? await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, lockedOriginal.invoiceRecordId),
          eq(erpRecordsTable.organizationId, auth.organizationId),
          eq(erpRecordsTable.tableName, "invoices"),
        )).limit(1).for("update")
        : [];
      if (!lockedOriginal || !lockedInvoice || !isLocationAllowed(auth, "invoices", lockedInvoice.data, lockedInvoice.id)) {
        throw new EInvoiceRouteError("المستند غير متاح.", 404);
      }
      const [unit] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.id, lockedOriginal.unitId)).limit(1);
      if (unit?.environment === "production" && !["reported", "cleared", "accepted"].includes(String(lockedOriginal.status))) {
        throw new EInvoiceRouteError("لا يمكن إصدار إشعار إنتاجي قبل قبول الفاتورة الأصلية من الهيئة.", 409);
      }
      const siblingNotes = await tx.select().from(eInvoiceDocumentsTable).where(and(
        eq(eInvoiceDocumentsTable.organizationId, auth.organizationId),
        eq(eInvoiceDocumentsTable.parentDocumentId, lockedOriginal.id),
      ));
      const previouslyAdjusted = siblingNotes
        .filter((note) => note.operationId !== operationId && note.documentType === noteType)
        .reduce((sum, note) => sum + Number(note.taxExclusiveAmount ?? 0), 0);
      const originalNet = Number(lockedOriginal.taxExclusiveAmount ?? lockedInvoice.data.subtotal ?? lockedInvoice.data.total ?? 0);
      if (!Number.isFinite(originalNet) || amountValue + previouslyAdjusted > originalNet + 0.001) {
        throw new EInvoiceRouteError("إجمالي الإشعارات لا يمكن أن يتجاوز صافي الفاتورة الأصلية.", 409);
      }
      const issued = await issueEInvoiceAdjustment(tx, {
        organizationId: auth.organizationId,
        invoiceRecordId: lockedOriginal.invoiceRecordId,
        parentDocumentId: lockedOriginal.id,
        operationId,
        documentType: noteType,
        reason,
        taxExclusiveAmount: amountValue,
        issueAt: new Date(),
        customerVatNumber: optionalText(body.customerVatNumber, 15),
      });
      if (!issued) throw new EInvoiceRouteError("لم يتم العثور على الفاتورة الأصلية.", 404);
      const { teamAuditLogsTable } = await import("@workspace/db");
      if (!issued.replayed) {
        await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: "einvoice_note_issued", entity: String(issued.document.id), details: noteType });
      }
      return issued;
    });
    return {
      replayed: created.replayed,
      document: {
        id: created.document.id,
        invoiceNumber: created.document.invoiceNumber,
        status: created.document.status,
        qrPayload: created.document.qrPayload,
      },
    };
  });
});

export default router;