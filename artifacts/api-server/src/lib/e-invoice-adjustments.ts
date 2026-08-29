import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  eInvoiceDocumentsTable,
  eInvoiceUnitsTable,
  erpRecordsTable,
} from "@workspace/db";
import {
  configurationIsComplete,
  decryptEInvoiceSecret,
  generateInvoiceDocument,
  type InvoiceInput,
  type SellerProfile,
} from "./e-invoicing";
import { savePrivateInvoiceXml } from "./private-object-store";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AdjustmentType = "credit_note" | "debit_note";
type AdjustmentLine = { taxExclusiveAmount: number; taxAmount: number; vatRate: number };

export class EInvoiceAdjustmentError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export type IssueEInvoiceAdjustmentInput = {
  organizationId: number;
  invoiceRecordId: number;
  parentDocumentId?: number;
  operationId: string;
  documentType: AdjustmentType;
  reason: string;
  taxExclusiveAmount: number;
  taxAmount?: number;
  adjustmentLines?: AdjustmentLine[];
  issueAt: Date;
  customerVatNumber?: string;
};

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sellerFromUnit(unit: typeof eInvoiceUnitsTable.$inferSelect): SellerProfile {
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

function sameAdjustment(
  existing: typeof eInvoiceDocumentsTable.$inferSelect,
  input: IssueEInvoiceAdjustmentInput,
): boolean {
  return existing.invoiceRecordId === input.invoiceRecordId
    && existing.parentDocumentId === (input.parentDocumentId ?? existing.parentDocumentId)
    && existing.documentType === input.documentType
    && existing.adjustmentReason === input.reason
    && Number(existing.taxExclusiveAmount) === money(input.taxExclusiveAmount)
    && Number(existing.taxAmount) === money(input.taxAmount ?? Number(existing.taxAmount));
}

function generatedInput(
  unit: typeof eInvoiceUnitsTable.$inferSelect,
  original: typeof eInvoiceDocumentsTable.$inferSelect,
  invoice: typeof erpRecordsTable.$inferSelect,
  input: Pick<IssueEInvoiceAdjustmentInput, "documentType" | "reason" | "taxExclusiveAmount" | "taxAmount" | "adjustmentLines" | "issueAt" | "customerVatNumber">,
  invoiceNumber: string,
): InvoiceInput {
  const seller = sellerFromUnit(unit);
  const taxExclusiveAmount = money(input.taxExclusiveAmount);
  const taxAmount = money(input.taxAmount ?? taxExclusiveAmount * seller.vatRate / 100);
  const adjustmentLines = input.adjustmentLines?.length
    ? input.adjustmentLines
    : [{ taxExclusiveAmount, taxAmount, vatRate: taxExclusiveAmount > 0 ? taxAmount / taxExclusiveAmount * 100 : seller.vatRate }];
  return {
    invoiceNumber,
    invoiceCounter: unit.nextInvoiceCounter,
    previousInvoiceHash: unit.previousInvoiceHash,
    documentType: input.documentType,
    issueAt: input.issueAt,
    customerName: String(invoice.data.customerName ?? "عميل نقدي"),
    customerVatNumber: input.customerVatNumber ?? (typeof invoice.data.customerVatNumber === "string" ? invoice.data.customerVatNumber : undefined),
    customerAddress: typeof invoice.data.customerAddress === "string" ? invoice.data.customerAddress : undefined,
    paymentMethod: String(invoice.data.paymentMethod ?? "cash"),
    lines: adjustmentLines.map((line) => ({
      name: input.reason,
      sku: "",
      quantity: 1,
      unitPrice: line.taxExclusiveAmount,
      total: line.taxExclusiveAmount,
      vatRate: line.vatRate,
      vatAmount: line.taxAmount,
    })),
    seller: { ...seller, pricesIncludeVat: false },
    parentInvoiceUuid: original.uuid,
    taxExclusiveAmountOverride: taxExclusiveAmount,
    taxAmountOverride: taxAmount,
    privateKeyPem: decryptEInvoiceSecret(unit.privateKeyCiphertext),
    certificatePem: decryptEInvoiceSecret(unit.certificateCiphertext),
  };
}

export async function issueEInvoiceAdjustment(
  tx: Transaction,
  input: IssueEInvoiceAdjustmentInput,
): Promise<{ document: typeof eInvoiceDocumentsTable.$inferSelect; replayed: boolean } | null> {
  const [existing] = await tx.select().from(eInvoiceDocumentsTable).where(and(
    eq(eInvoiceDocumentsTable.organizationId, input.organizationId),
    eq(eInvoiceDocumentsTable.operationId, input.operationId),
  )).limit(1);
  if (existing) {
    if (!sameAdjustment(existing, input)) {
      throw new EInvoiceAdjustmentError("معرّف عملية الإشعار مستخدم لطلب مختلف.");
    }
    return { document: existing, replayed: true };
  }

  const [original] = input.parentDocumentId
    ? await tx.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.id, input.parentDocumentId),
      eq(eInvoiceDocumentsTable.organizationId, input.organizationId),
      eq(eInvoiceDocumentsTable.invoiceRecordId, input.invoiceRecordId),
      inArray(eInvoiceDocumentsTable.documentType, ["simplified", "standard"]),
    )).limit(1).for("update")
    : await tx.select().from(eInvoiceDocumentsTable).where(and(
      eq(eInvoiceDocumentsTable.organizationId, input.organizationId),
      eq(eInvoiceDocumentsTable.invoiceRecordId, input.invoiceRecordId),
      inArray(eInvoiceDocumentsTable.documentType, ["simplified", "standard"]),
    )).orderBy(desc(eInvoiceDocumentsTable.id)).limit(1).for("update");
  if (!original) return null;

  const [invoice] = await tx.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, input.invoiceRecordId),
    eq(erpRecordsTable.organizationId, input.organizationId),
    eq(erpRecordsTable.tableName, "invoices"),
  )).limit(1).for("update");
  if (!invoice) throw new EInvoiceAdjustmentError("بيانات الفاتورة الأصلية غير متاحة.");

  const [unit] = await tx.select().from(eInvoiceUnitsTable).where(
    eq(eInvoiceUnitsTable.organizationId, input.organizationId),
  ).for("update");
  if (!unit) throw new EInvoiceAdjustmentError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);

  const seller = sellerFromUnit(unit);
  const taxExclusiveAmount = money(input.taxExclusiveAmount);
  const explicitTaxAmount = input.taxAmount == null ? null : money(input.taxAmount);
  if (
    !Number.isFinite(taxExclusiveAmount)
    || taxExclusiveAmount < 0
    || (explicitTaxAmount != null && (!Number.isFinite(explicitTaxAmount) || explicitTaxAmount < 0))
    || taxExclusiveAmount + (explicitTaxAmount ?? 0) <= 0
  ) {
    throw new EInvoiceAdjustmentError("يجب أن يكون مبلغ الإشعار موجباً.", 400);
  }
  const taxAmount = explicitTaxAmount ?? money(taxExclusiveAmount * seller.vatRate / 100);
  const taxInclusiveAmount = money(taxExclusiveAmount + taxAmount);
  const configured = configurationIsComplete(seller);
  const invoiceNumber = `${input.documentType === "credit_note" ? "CN" : "DN"}-${original.invoiceNumber}-${unit.nextInvoiceCounter}`;
  const credentialsReady = Boolean(unit.privateKeyCiphertext && unit.certificateCiphertext);
  const generated = configured && credentialsReady
    ? await generateInvoiceDocument(generatedInput(unit, original, invoice, input, invoiceNumber))
    : null;

  const [note] = await tx.insert(eInvoiceDocumentsTable).values({
    organizationId: input.organizationId,
    unitId: unit.id,
    invoiceRecordId: input.invoiceRecordId,
    parentDocumentId: original.id,
    operationId: input.operationId,
    documentType: input.documentType,
    status: generated?.signatureValid
      ? "pending_compliance"
      : (configured ? "pending_credentials" : "pending_configuration"),
    invoiceNumber,
    uuid: generated?.uuid ?? randomUUID(),
    invoiceCounter: generated ? unit.nextInvoiceCounter : null,
    previousInvoiceHash: unit.previousInvoiceHash,
    invoiceHash: generated?.invoiceHash ?? unit.previousInvoiceHash,
    qrPayload: generated?.qrPayload ?? "",
    xmlDigest: generated?.invoiceHash ?? unit.previousInvoiceHash,
    localValidationError: generated?.localValidationError ?? null,
    adjustmentReason: input.reason,
    adjustmentLines: input.adjustmentLines ?? null,
    taxExclusiveAmount: String(taxExclusiveAmount),
    taxAmount: String(generated?.taxAmount ?? taxAmount),
    taxInclusiveAmount: String(generated?.taxInclusiveAmount ?? taxInclusiveAmount),
    issuedAt: input.issueAt,
  }).returning();

  let document = note;
  if (generated) {
    const xmlObjectPath = await savePrivateInvoiceXml(input.organizationId, note.id, generated.xml);
    [document] = await tx.update(eInvoiceDocumentsTable).set({
      xmlObjectPath,
      updatedAt: new Date(),
    }).where(eq(eInvoiceDocumentsTable.id, note.id)).returning();
    await tx.update(eInvoiceUnitsTable).set({
      nextInvoiceCounter: unit.nextInvoiceCounter + 1,
      previousInvoiceHash: generated.invoiceHash,
      complianceStatus: "not_started",
      complianceSuiteStatus: "not_started",
      complianceSuiteResults: null,
      complianceError: null,
      lastComplianceCheckAt: null,
      updatedAt: new Date(),
    }).where(eq(eInvoiceUnitsTable.id, unit.id));
  }

  return { document, replayed: false };
}

export async function materializePendingEInvoiceAdjustments(
  tx: Transaction,
  organizationId: number,
): Promise<number> {
  const [unit] = await tx.select().from(eInvoiceUnitsTable).where(
    eq(eInvoiceUnitsTable.organizationId, organizationId),
  ).for("update");
  if (
    !unit
    || !configurationIsComplete(sellerFromUnit(unit))
    || !unit.privateKeyCiphertext
    || !unit.certificateCiphertext
  ) {
    return 0;
  }

  const pending = await tx.select().from(eInvoiceDocumentsTable).where(and(
    eq(eInvoiceDocumentsTable.organizationId, organizationId),
    inArray(eInvoiceDocumentsTable.documentType, ["credit_note", "debit_note"]),
    inArray(eInvoiceDocumentsTable.status, ["pending_configuration", "pending_credentials"]),
  )).orderBy(eInvoiceDocumentsTable.id).for("update");
  let nextUnit = unit;
  let materialized = 0;
  for (const note of pending) {
    if (
      !note.parentDocumentId
      || !note.adjustmentReason
      || note.taxExclusiveAmount == null
      || note.taxAmount == null
    ) continue;
    const [[storedOriginal], [invoice]] = await Promise.all([
      tx.select().from(eInvoiceDocumentsTable).where(and(
        eq(eInvoiceDocumentsTable.id, note.parentDocumentId),
        eq(eInvoiceDocumentsTable.organizationId, organizationId),
      )).limit(1),
      tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, note.invoiceRecordId),
        eq(erpRecordsTable.organizationId, organizationId),
        eq(erpRecordsTable.tableName, "invoices"),
      )).limit(1),
    ]);
    if (!storedOriginal || !invoice) continue;
    let original = storedOriginal;
    if (!original.xmlObjectPath || original.invoiceCounter == null || original.localValidationError) {
      const invoiceLines = Array.isArray(invoice.data.items) ? invoice.data.items : [];
      if (!invoiceLines.length || !["simplified", "standard"].includes(original.documentType)) continue;
      const originalTaxExclusiveAmount = money(Number(invoice.data.subtotal));
      const originalTaxAmount = money(Number(invoice.data.tax));
      if (!Number.isFinite(originalTaxExclusiveAmount) || !Number.isFinite(originalTaxAmount)) continue;
      const generatedOriginal = await generateInvoiceDocument({
        invoiceNumber: original.invoiceNumber,
        invoiceCounter: nextUnit.nextInvoiceCounter,
        previousInvoiceHash: nextUnit.previousInvoiceHash,
        documentType: original.documentType as "simplified" | "standard",
        issueAt: original.issuedAt,
        customerName: String(invoice.data.customerName ?? "عميل نقدي"),
        customerVatNumber: typeof invoice.data.customerVatNumber === "string" ? invoice.data.customerVatNumber : undefined,
        customerAddress: typeof invoice.data.customerAddress === "string" ? invoice.data.customerAddress : undefined,
        paymentMethod: String(invoice.data.paymentMethod ?? "cash"),
        lines: invoiceLines.map((line, index) => {
          const item = line && typeof line === "object" ? line as Record<string, unknown> : {};
          return {
            name: String(item.name ?? `بند ${index + 1}`),
            sku: String(item.sku ?? ""),
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPriceExVat ?? item.lineNet) / Number(item.quantity),
            total: Number(item.lineNet),
            vatRate: Number(item.vatRate),
            vatAmount: Number(item.vatAmount),
          };
        }),
        seller: { ...sellerFromUnit(nextUnit), pricesIncludeVat: false },
        taxExclusiveAmountOverride: originalTaxExclusiveAmount,
        taxAmountOverride: originalTaxAmount,
        privateKeyPem: decryptEInvoiceSecret(nextUnit.privateKeyCiphertext),
        certificatePem: decryptEInvoiceSecret(nextUnit.certificateCiphertext),
      });
      if (!generatedOriginal.signatureValid) continue;
      const originalXmlObjectPath = await savePrivateInvoiceXml(organizationId, original.id, generatedOriginal.xml);
      [original] = await tx.update(eInvoiceDocumentsTable).set({
        status: "pending_compliance",
        uuid: generatedOriginal.uuid,
        invoiceCounter: nextUnit.nextInvoiceCounter,
        previousInvoiceHash: nextUnit.previousInvoiceHash,
        invoiceHash: generatedOriginal.invoiceHash,
        qrPayload: generatedOriginal.qrPayload,
        xmlDigest: generatedOriginal.invoiceHash,
        localValidationError: generatedOriginal.localValidationError,
        xmlObjectPath: originalXmlObjectPath,
        updatedAt: new Date(),
      }).where(eq(eInvoiceDocumentsTable.id, original.id)).returning();
      nextUnit = {
        ...nextUnit,
        nextInvoiceCounter: nextUnit.nextInvoiceCounter + 1,
        previousInvoiceHash: generatedOriginal.invoiceHash,
      };
    }
    if (!original.xmlObjectPath || original.invoiceCounter == null || original.localValidationError) continue;
    const invoiceNumber = `${note.documentType === "credit_note" ? "CN" : "DN"}-${original.invoiceNumber}-${nextUnit.nextInvoiceCounter}`;
    const generated = await generateInvoiceDocument(generatedInput(nextUnit, original, invoice, {
      documentType: note.documentType as AdjustmentType,
      reason: note.adjustmentReason,
      taxExclusiveAmount: Number(note.taxExclusiveAmount),
      taxAmount: Number(note.taxAmount),
      adjustmentLines: Array.isArray(note.adjustmentLines)
        ? note.adjustmentLines as AdjustmentLine[]
        : undefined,
      issueAt: note.issuedAt,
    }, invoiceNumber));
    const xmlObjectPath = await savePrivateInvoiceXml(organizationId, note.id, generated.xml);
    await tx.update(eInvoiceDocumentsTable).set({
      status: generated.signatureValid ? "pending_compliance" : "pending_credentials",
      invoiceNumber,
      uuid: generated.uuid,
      invoiceCounter: nextUnit.nextInvoiceCounter,
      previousInvoiceHash: nextUnit.previousInvoiceHash,
      invoiceHash: generated.invoiceHash,
      qrPayload: generated.qrPayload,
      xmlDigest: generated.invoiceHash,
      localValidationError: generated.localValidationError,
      xmlObjectPath,
      updatedAt: new Date(),
    }).where(eq(eInvoiceDocumentsTable.id, note.id));
    nextUnit = {
      ...nextUnit,
      nextInvoiceCounter: nextUnit.nextInvoiceCounter + 1,
      previousInvoiceHash: generated.invoiceHash,
    };
    materialized += 1;
  }
  if (materialized > 0) {
    await tx.update(eInvoiceUnitsTable).set({
      nextInvoiceCounter: nextUnit.nextInvoiceCounter,
      previousInvoiceHash: nextUnit.previousInvoiceHash,
      complianceStatus: "not_started",
      complianceSuiteStatus: "not_started",
      complianceSuiteResults: null,
      complianceError: null,
      lastComplianceCheckAt: null,
      updatedAt: new Date(),
    }).where(eq(eInvoiceUnitsTable.id, unit.id));
  }
  return materialized;
}