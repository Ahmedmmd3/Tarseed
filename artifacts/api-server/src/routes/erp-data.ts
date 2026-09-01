import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, erpRecordsTable, organizationsTable, teamAuditLogsTable } from "@workspace/db";
import { isLocationAllowed } from "../lib/location-scope";
import { DEFAULT_ACCOUNT_DEFINITIONS, DEMO_SEED_KEY } from "../lib/seed-demo-data";
import { lockAndValidateDataGeneration, lockedWriteRejection, refreshAuthAfterOrganizationLock, requireAuth, requireCurrentDataGeneration, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseExecutor = typeof db | DatabaseTransaction;
type DemoIdSets = Map<string, Set<string>>;
const SPECIALIZED_MUTATION_TABLES = new Set(["inventoryBalances", "stockTransfers", "stockAdjustments", "sales", "invoices", "bankReconciliationSessions", "bankStatementLines"]);
const TABLE_MODULES: Record<string, string | string[]> = {
  products: ["inventory", "sales"], invoices: "sales", quotations: "sales", expenses: "accounting", customers: "sales", sales: "sales",
  returns_: "sales", suppliers: "inventory", purchaseOrders: "inventory", warehouses: ["inventory", "sales"],
  employees: "hr", projects: "operations", inventoryBalances: ["inventory", "sales"], stockTransfers: "inventory",
  stockAdjustments: "inventory",
  accounts: "accounting", journalEntries: "accounting", receivables: "accounting",
  financialClosures: "accounting", bankReconciliationSessions: "accounting", bankStatementLines: "accounting",
};

const REFERENCE_TABLE_BY_KEY: Record<string, string> = {
  accountId: "accounts",
  counterAccountId: "accounts",
  customerId: "customers",
  productId: "products",
  invoiceId: "invoices",
  sourceQuotationId: "quotations",
  originalInvoiceId: "invoices",
  expenseId: "expenses",
  journalId: "journalEntries",
};

function referencesDemoRecord(
  value: unknown,
  demoIds: DemoIdSets,
  path: string[] = [],
  rootTable = "",
  rootData: Record<string, unknown> = {},
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => referencesDemoRecord(item, demoIds, path, rootTable, rootData));
  }
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    let referencedTable = REFERENCE_TABLE_BY_KEY[key];
    if (key === "parent" && rootTable === "accounts") referencedTable = "accounts";
    if (key === "id" && path.includes("trialBalance")) referencedTable = "accounts";
    if (key === "sourceId") {
      const sourceType = String(rootData.sourceType ?? "");
      if (sourceType === "sale" || sourceType === "invoice") referencedTable = "invoices";
      if (sourceType === "expense") referencedTable = "expenses";
    }
    if (referencedTable && child !== null && child !== undefined
      && demoIds.get(referencedTable)?.has(String(child))) {
      return true;
    }
    if (referencesDemoRecord(child, demoIds, [...path, key], rootTable, rootData)) return true;
  }
  return false;
}

async function validateAccountHierarchy(
  executor: DatabaseExecutor,
  organizationId: number,
  accountId: number | null,
  candidate: Record<string, unknown>,
): Promise<void> {
  const parentId = candidate.parent == null || candidate.parent === "" ? null : Number(candidate.parent);
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
    throw new MutationRejected(400, "الحساب الأب غير صالح.");
  }
  if (accountId !== null && parentId === accountId) {
    throw new MutationRejected(409, "لا يمكن جعل الحساب أباً لنفسه.");
  }
  const rows = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "accounts"),
  ));
  const accounts = new Map(rows.map((row) => [row.id, row.data as Record<string, unknown>]));
  if (parentId !== null) {
    const parent = accounts.get(parentId);
    if (!parent) throw new MutationRejected(404, "الحساب الأب غير موجود في هذه المنشأة.");
    if (parent.status !== "active") throw new MutationRejected(409, "لا يمكن الإضافة تحت حساب أب موقوف.");
    if (parent.type !== candidate.type) throw new MutationRejected(409, "يجب أن يكون الحساب الأب من التصنيف المحاسبي نفسه.");
    const visited = new Set<number>();
    let cursor: number | null = parentId;
    while (cursor !== null) {
      if (cursor === accountId) throw new MutationRejected(409, "لا يمكن نقل الحساب تحت أحد حساباته الفرعية.");
      if (visited.has(cursor)) throw new MutationRejected(409, "دليل الحسابات يحتوي دورة غير صالحة.");
      visited.add(cursor);
      const next: unknown = accounts.get(cursor)?.parent;
      cursor = next == null || next === "" ? null : Number(next);
    }
  }
  if (accountId !== null && candidate.status === "inactive") {
    const activeChild = rows.some((row) => Number((row.data as Record<string, unknown>).parent) === accountId
      && (row.data as Record<string, unknown>).status === "active");
    if (activeChild) throw new MutationRejected(409, "لا يمكن تعطيل حساب له حسابات فرعية نشطة.");
  }
}

function requireTableAccess(request: Request, response: Response): { auth: AuthContext; tableName: string } | null {
  const auth = response.locals.auth as AuthContext;
  const raw = Array.isArray(request.params.table) ? request.params.table[0] : request.params.table;
  const tableName = String(raw || "");
  const modules = TABLE_MODULES[tableName];
  if (!modules) {
    response.status(404).json({ error: "نوع البيانات غير متاح." });
    return null;
  }
  if (!hasTableAccess(auth, tableName)) {
    response.status(403).json({ error: "ليس لديك صلاحية لهذه الوحدة." });
    return null;
  }
  return { auth, tableName };
}

function hasTableAccess(auth: AuthContext, tableName: string): boolean {
  const modules = TABLE_MODULES[tableName];
  const allowedModules = Array.isArray(modules) ? modules : [modules];
  return auth.roleId === "owner" || allowedModules.some((module) => auth.permissions[module] === true);
}

function canManageInventoryCatalog(auth: AuthContext): boolean {
  return auth.roleId === "owner" || auth.permissions.inventory === true;
}

function normalizeProductData(data: Record<string, unknown>, fallbackRate = 15): Record<string, unknown> | null {
  const vatRate = Number(data.vatRate ?? fallbackRate);
  if (![0, 5, 15].includes(vatRate)) return null;
  const barcode = typeof data.barcode === "string" ? data.barcode.trim() : "";
  return { ...data, barcode, vatRate };
}

async function ensureUniqueProductBarcode(
  executor: DatabaseExecutor,
  organizationId: number,
  data: Record<string, unknown>,
  excludeId?: number,
): Promise<void> {
  const barcode = typeof data.barcode === "string" ? data.barcode.trim().toLocaleLowerCase("en") : "";
  if (!barcode) return;
  const products = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "products"),
  ));
  if (products.some((row) => row.id !== excludeId
    && String((row.data as Record<string, unknown>).barcode ?? "").trim().toLocaleLowerCase("en") === barcode)) {
    throw new MutationRejected(409, "الباركود مستخدم لمنتج آخر داخل هذه المنشأة.", "duplicate_product_barcode");
  }
}

function rejectUnauthorizedInventoryCatalogMutation(access: { auth: AuthContext; tableName: string }, response: Response): boolean {
  if (access.tableName === "warehouses" && access.auth.roleId !== "owner") {
    response.status(403).json({ error: "إدارة مواقع التشغيل متاحة لمالك المنشأة فقط." });
    return true;
  }
  if (access.tableName === "products" && !canManageInventoryCatalog(access.auth)) {
    response.status(403).json({ error: "ليس لديك صلاحية لتعديل كتالوج المنتجات." });
    return true;
  }
  return false;
}

function isAccountingSource(tableName: string): boolean {
  return tableName === "invoices" || tableName === "purchaseOrders" || tableName === "expenses";
}

function specializedMutationMessage(tableName: string): string {
  return tableName === "invoices"
    ? "تُنشأ فواتير البيع وتُحفظ من نقطة البيع المعتمدة فقط."
    : "تُسجّل حركات المخزون من المسار المعتمد فقط.";
}

async function audit(auth: AuthContext, response: Response, action: string, entity: string): Promise<void> {
  const { teamAuditLogsTable } = await import("@workspace/db");
  await db.transaction(async (tx) => {
    // Audit rows are tenant writes; never let a just-suspended organization
    // append one after the protected mutation has committed.
    if (!await lockAndValidateDataGeneration(tx, response)) return;
    await tx.insert(teamAuditLogsTable).values({
      organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email,
      action, entity, details: "",
    });
  });
}

function validateJournal(data: Record<string, unknown>): string | null {
  if (typeof data.date !== "string" || !data.date || typeof data.description !== "string" || !data.description.trim()) {
    return "يجب إدخال تاريخ وبيان للقيد.";
  }
  if (data.status !== "draft" && data.status !== "posted") return "حالة القيد غير صحيحة.";
  if (!Array.isArray(data.lines) || data.lines.length < 2) return "يجب أن يحتوي القيد على سطرين على الأقل.";
  let debit = 0;
  let credit = 0;
  for (const rawLine of data.lines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) return "أسطر القيد غير صحيحة.";
    const line = rawLine as Record<string, unknown>;
    const lineDebit = Number(line.debit);
    const lineCredit = Number(line.credit);
    if (!String(line.accountId || "") || !Number.isFinite(lineDebit) || !Number.isFinite(lineCredit) || lineDebit < 0 || lineCredit < 0 || (lineDebit === 0 && lineCredit === 0) || (lineDebit > 0 && lineCredit > 0)) {
      return "كل سطر يحتاج حساباً ومبلغاً موجباً في المدين أو الدائن فقط.";
    }
    debit += lineDebit;
    credit += lineCredit;
  }
  return Math.abs(debit - credit) > 0.005 ? "إجمالي المدين يجب أن يساوي إجمالي الدائن." : null;
}

const quotationStatuses = new Set(["draft", "sent", "rejected"]);
const purchaseOrderStatuses = new Set(["draft", "sent", "partial", "received", "cancelled"]);
const purchaseOrderPaymentStatuses = new Set(["unpaid", "partial", "paid"]);

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

async function purchaseOrderData(
  executor: DatabaseExecutor,
  organizationId: number,
  data: Record<string, unknown>,
  numberOverride?: string,
): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const supplierName = typeof data.supplierName === "string" ? data.supplierName.trim() : "";
  if (!supplierName || supplierName.length > 160) return { error: "اسم المورد مطلوب وبحد أقصى 160 حرفاً." };
  const supplierId = data.supplierId === undefined || data.supplierId === "" ? undefined : Number(data.supplierId);
  if (supplierId !== undefined && (!Number.isInteger(supplierId) || supplierId <= 0)) return { error: "معرّف المورد غير صحيح." };
  if (supplierId !== undefined) {
    const [supplier] = await executor.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.id, supplierId),
      eq(erpRecordsTable.organizationId, organizationId),
      eq(erpRecordsTable.tableName, "suppliers"),
    )).limit(1);
    if (!supplier) return { error: "المورد غير موجود في هذه المنشأة." };
    if (String(supplier.data.name ?? "").trim() !== supplierName) return { error: "اسم المورد لا يطابق سجل المورد المحدد." };
  }

  const issueDate = typeof (data.issueDate ?? data.date) === "string" ? String(data.issueDate ?? data.date) : "";
  const expectedDate = typeof data.expectedDate === "string" ? data.expectedDate : "";
  if (!validDateKey(issueDate)) return { error: "تاريخ أمر الشراء غير صالح." };
  if (expectedDate && !validDateKey(expectedDate)) return { error: "تاريخ التسليم المتوقع غير صالح." };
  if (expectedDate && expectedDate < issueDate) return { error: "لا يمكن أن يسبق تاريخ التسليم المتوقع تاريخ الأمر." };
  const dueDate = typeof data.dueDate === "string" ? data.dueDate : "";
  if (dueDate && (!validDateKey(dueDate) || dueDate < issueDate)) return { error: "تاريخ استحقاق المورد غير صالح." };

  const warehouseId = Number(data.warehouseId);
  if (!Number.isInteger(warehouseId) || warehouseId <= 0) return { error: "موقع الاستلام غير صالح." };
  const [warehouse] = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, warehouseId),
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "warehouses"),
  )).limit(1);
  if (!warehouse || warehouse.data.status === "inactive") return { error: "موقع الاستلام غير موجود أو غير نشط." };

  const status = String(data.status ?? "draft");
  if (!purchaseOrderStatuses.has(status)) return { error: "حالة أمر الشراء غير صحيحة." };
  const paymentMethod = data.paymentMethod === "cash" ? "cash" : "credit";
  const paymentStatus = String(data.paymentStatus ?? "unpaid");
  if (!purchaseOrderPaymentStatuses.has(paymentStatus)) return { error: "حالة دفع أمر الشراء غير صحيحة." };
  if (paymentMethod === "credit" && !dueDate) return { error: "حدد تاريخ استحقاق المورد لأمر الشراء الآجل." };

  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) {
    return { error: "يجب أن يحتوي أمر الشراء على صنف واحد على الأقل وبحد أقصى 100 صنف." };
  }
  const items: Array<Record<string, unknown>> = [];
  const seenProducts = new Set<number>();
  let subtotal = 0;
  let vat = 0;
  let receivedSubtotal = 0;
  let receivedVat = 0;
  for (const rawItem of data.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return { error: "أحد أصناف أمر الشراء غير صحيح." };
    const item = rawItem as Record<string, unknown>;
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unitCost ?? item.unitCostExVat);
    const receivedQuantity = Number(item.receivedQuantity ?? 0);
    if (!Number.isInteger(productId) || productId <= 0 || seenProducts.has(productId)) {
      return { error: "كل منتج يجب أن يظهر مرة واحدة فقط في أمر الشراء." };
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000
      || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000
      || !Number.isFinite(receivedQuantity) || receivedQuantity < 0 || receivedQuantity > quantity) {
      return { error: "تحقق من كميات وتكاليف أصناف أمر الشراء." };
    }
    const [product] = await executor.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.id, productId),
      eq(erpRecordsTable.organizationId, organizationId),
      eq(erpRecordsTable.tableName, "products"),
    )).limit(1);
    if (!product) return { error: "أحد المنتجات غير موجود في هذه المنشأة." };
    const vatRate = Number(product.data.vatRate ?? item.vatRate ?? 15);
    if (![0, 5, 15].includes(vatRate)) return { error: "نسبة ضريبة أحد المنتجات غير صالحة." };
    const lineNet = roundMoney(quantity * unitCost);
    const vatAmount = roundMoney(lineNet * vatRate / 100);
    const receivedLineNet = roundMoney(receivedQuantity * unitCost);
    const receivedVatAmount = roundMoney(receivedLineNet * vatRate / 100);
    items.push({
      productId,
      productName: String(product.data.name ?? `صنف #${productId}`),
      quantity,
      receivedQuantity,
      unitCost: roundMoney(unitCost),
      unitCostExVat: roundMoney(unitCost),
      vatRate,
      lineNet,
      vatAmount,
      total: roundMoney(lineNet + vatAmount),
    });
    seenProducts.add(productId);
    subtotal = roundMoney(subtotal + lineNet);
    vat = roundMoney(vat + vatAmount);
    receivedSubtotal = roundMoney(receivedSubtotal + receivedLineNet);
    receivedVat = roundMoney(receivedVat + receivedVatAmount);
  }
  const receivedUnits = items.reduce((sum, item) => sum + Number(item.receivedQuantity), 0);
  const orderedUnits = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  if (status === "received" && receivedUnits !== orderedUnits) return { error: "الأمر المستلم بالكامل يجب أن تكون كل كمياته مستلمة." };
  if (status === "partial" && (receivedUnits <= 0 || receivedUnits >= orderedUnits)) return { error: "حالة الاستلام الجزئي لا تطابق الكميات المستلمة." };
  if ((status === "draft" || status === "sent" || status === "cancelled") && receivedUnits > 0) {
    return { error: "لا يمكن حفظ كميات مستلمة في هذه الحالة." };
  }
  const notes = typeof data.notes === "string" ? data.notes.trim() : "";
  if (notes.length > 5000) return { error: "ملاحظات أمر الشراء طويلة جداً." };
  const paid = roundMoney(Number(data.paid ?? 0));
  const total = roundMoney(subtotal + vat);
  if (!Number.isFinite(paid) || paid < 0 || paid > total) return { error: "المبلغ المدفوع غير صالح." };
  return {
    data: {
      ...(numberOverride ? { orderNumber: numberOverride } : {}),
      ...(supplierId === undefined ? {} : { supplierId }),
      supplierName,
      issueDate,
      date: issueDate,
      ...(expectedDate ? { expectedDate } : {}),
      warehouseId,
      warehouseName: String(warehouse.data.name ?? `موقع #${warehouseId}`),
      status,
      paymentMethod,
      paymentStatus,
      ...(dueDate ? { dueDate } : {}),
      items,
      subtotal,
      vat,
      tax: vat,
      total,
      receivedSubtotal,
      receivedVat,
      receivedTotal: roundMoney(receivedSubtotal + receivedVat),
      received: receivedUnits > 0,
      paid,
      ...(notes ? { notes } : {}),
    },
  };
}

function quotationData(
  data: Record<string, unknown>,
  numberOverride?: string,
): { data?: Record<string, unknown>; error?: string } {
  const customerName = typeof data.customerName === "string" ? data.customerName.trim() : "";
  const issueDate = typeof data.issueDate === "string" ? data.issueDate : "";
  const expiryDate = typeof data.expiryDate === "string" ? data.expiryDate : "";
  if (!customerName || customerName.length > 160) return { error: "اسم العميل مطلوب وبحد أقصى 160 حرفاً." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
    return { error: "تاريخا الإصدار والانتهاء يجب أن يكونا بصيغة صحيحة." };
  }
  if (issueDate > expiryDate) return { error: "يجب أن يسبق تاريخ الإصدار تاريخ الانتهاء." };
  const status = String(data.status ?? "draft");
  if (!quotationStatuses.has(status)) return { error: "حالة عرض السعر غير قابلة للتعديل." };
  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) {
    return { error: "يجب أن يحتوي عرض السعر على صنف واحد على الأقل وبحد أقصى 100 صنف." };
  }

  const items: Array<Record<string, unknown>> = [];
  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;
  for (const rawItem of data.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return { error: "أحد أصناف عرض السعر غير صحيح." };
    const item = rawItem as Record<string, unknown>;
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const discount = Number(item.discount ?? 0);
    const vatRate = Number(item.vatRate ?? 15);
    if (!description || description.length > 500
      || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000
      || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000
      || !Number.isFinite(discount) || discount < 0
      || !Number.isFinite(vatRate) || ![0, 5, 15].includes(vatRate)) {
      return { error: "تحقق من وصف الصنف والكمية والسعر والخصم ونسبة الضريبة." };
    }
    const gross = roundMoney(quantity * unitPrice);
    if (discount > gross) return { error: "لا يمكن أن يتجاوز خصم الصنف قيمته." };
    const lineNet = roundMoney(gross - discount);
    const vatAmount = roundMoney(lineNet * vatRate / 100);
    const total = roundMoney(lineNet + vatAmount);
    const productId = item.productId === undefined || item.productId === "" ? undefined : Number(item.productId);
    if (productId !== undefined && (!Number.isInteger(productId) || productId <= 0)) {
      return { error: "معرّف المنتج غير صحيح." };
    }
    items.push({
      description,
      ...(productId === undefined ? {} : { productId }),
      quantity,
      unitPrice: roundMoney(unitPrice),
      discount: roundMoney(discount),
      vatRate,
      lineNet,
      vatAmount,
      total,
    });
    subtotal = roundMoney(subtotal + gross);
    discountTotal = roundMoney(discountTotal + discount);
    tax = roundMoney(tax + vatAmount);
  }

  const customerId = data.customerId === undefined || data.customerId === "" ? undefined : Number(data.customerId);
  if (customerId !== undefined && (!Number.isInteger(customerId) || customerId <= 0)) return { error: "معرّف العميل غير صحيح." };
  const notes = typeof data.notes === "string" ? data.notes.trim() : "";
  if (notes.length > 5000) return { error: "الملاحظات طويلة جداً." };
  return {
    data: {
      ...(numberOverride ? { number: numberOverride } : { number: typeof data.number === "string" ? data.number.trim() : "" }),
      ...(customerId === undefined ? {} : { customerId }),
      customerName,
      issueDate,
      expiryDate,
      status,
      items,
      subtotal,
      discount: discountTotal,
      tax,
      total: roundMoney(subtotal - discountTotal + tax),
      ...(notes ? { notes } : {}),
    },
  };
}

async function nextQuotationNumber(executor: DatabaseExecutor, organizationId: number): Promise<string> {
  const records = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "quotations"),
  ));
  const highest = records.reduce((max, record) => {
    const match = /^QUO-(\d+)$/.exec(String(record.data.number ?? ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `QUO-${String(highest + 1).padStart(4, "0")}`;
}

async function nextPurchaseOrderNumber(executor: DatabaseExecutor, organizationId: number): Promise<string> {
  const records = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "purchaseOrders"),
  ));
  const highest = records.reduce((max, record) => {
    const match = /^PO-(\d+)$/.exec(String(record.data.orderNumber ?? ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `PO-${String(highest + 1).padStart(4, "0")}`;
}

class MutationRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function lockedMutationRejected(response: Response): MutationRejected {
  const rejection = lockedWriteRejection(response);
  return new MutationRejected(rejection.status, rejection.error, rejection.code);
}

function operationFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(operationFingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${operationFingerprint(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isUniqueConstraintViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function isClosedDate(
  auth: AuthContext,
  date: string,
  executor: DatabaseExecutor = db,
): Promise<boolean> {
  const closures = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, auth.organizationId),
    eq(erpRecordsTable.tableName, "financialClosures"),
  ));
  return closures.some((closure) => {
    const from = String(closure.data.from || "");
    const to = String(closure.data.to || "");
    return closure.data.status === "closed" && date >= from && date <= to;
  });
}

router.post("/accounting/initialize", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  if (!hasTableAccess(auth, "accounts")) {
    response.status(403).json({ error: "ليس لديك صلاحية لوحدة المحاسبة." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    if (!await lockAndValidateDataGeneration(tx, response)) return null;
    const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
    if (!currentAuth || !hasTableAccess(currentAuth, "accounts")) {
      response.locals.writeAccessFailure = "authorization_changed";
      return null;
    }

    const inserted = await tx.insert(erpRecordsTable).values(
      DEFAULT_ACCOUNT_DEFINITIONS.map((data) => ({
        organizationId: currentAuth.organizationId,
        tableName: "accounts",
        data,
      })),
    ).onConflictDoNothing().returning();
    const records = await tx.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.organizationId, currentAuth.organizationId),
      eq(erpRecordsTable.tableName, "accounts"),
    ));
    return { auth: currentAuth, created: inserted.length, records };
  });

  if (!result) {
    const rejection = lockedWriteRejection(response);
    response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
    return;
  }
  if (result.created > 0) {
    await audit(result.auth, response, "accounts_initialized", "accounts");
  }
  response.json({
    created: result.created,
    accounts: result.records.map((record) => ({ ...record.data, id: record.id, userId: result.auth.organizationId })),
  });
});

router.delete("/demo-data", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  if (auth.roleId !== "owner") {
    response.status(403).json({ error: "حذف البيانات التجريبية متاح لمالك المنشأة فقط." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    if (!await lockAndValidateDataGeneration(tx, response)) return null;
    const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
    if (!currentAuth || currentAuth.roleId !== "owner") {
      response.locals.writeAccessFailure = "authorization_changed";
      return null;
    }
    const organizationRecords = await tx.select().from(erpRecordsTable)
      .where(eq(erpRecordsTable.organizationId, currentAuth.organizationId));
    const demoIds: DemoIdSets = new Map();
    for (const record of organizationRecords) {
      if (record.data.demoSeedKey !== DEMO_SEED_KEY) continue;
      const ids = demoIds.get(record.tableName) ?? new Set<string>();
      ids.add(String(record.id));
      demoIds.set(record.tableName, ids);
    }
    const unsafeUserRecord = organizationRecords.find((record) =>
      record.data.demoSeedKey !== DEMO_SEED_KEY
      && referencesDemoRecord(record.data, demoIds, [], record.tableName, record.data));
    if (unsafeUserRecord) {
      return {
        kind: "blocked" as const,
        tableName: unsafeUserRecord.tableName,
      };
    }
    const deleted = await tx.delete(erpRecordsTable).where(and(
      eq(erpRecordsTable.organizationId, currentAuth.organizationId),
      sql`${erpRecordsTable.data}->>'demoSeedKey' = ${DEMO_SEED_KEY}`,
    )).returning({ id: erpRecordsTable.id });
    const [organization] = await tx.update(organizationsTable).set({
      dataGeneration: sql`${organizationsTable.dataGeneration} + 1`,
    }).where(eq(organizationsTable.id, currentAuth.organizationId)).returning({
      dataGeneration: organizationsTable.dataGeneration,
    });
    if (!organization) throw new Error("تعذر تحديث جيل بيانات المنشأة.");
    await tx.insert(teamAuditLogsTable).values({
      organizationId: currentAuth.organizationId,
      actorId: currentAuth.id,
      actorName: currentAuth.name || currentAuth.email,
      action: "demo_data_deleted",
      entity: "organization",
      details: JSON.stringify({ deletedRecords: deleted.length, demoSeedKey: DEMO_SEED_KEY }),
    });
    return { kind: "deleted" as const, deleted: deleted.length, dataGeneration: organization.dataGeneration };
  });

  if (!result) {
    const rejection = lockedWriteRejection(response);
    response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
    return;
  }
  if (result.kind === "blocked") {
    response.status(409).json({
      error: "تعذر حذف البيانات التجريبية بأمان بعد إنشاء معاملات أو حسابات مترابطة. احذفها قبل البدء بإدخال معاملاتك.",
      code: "DEMO_DATA_REFERENCED",
    });
    return;
  }
  response.json({ deleted: result.deleted, dataGeneration: result.dataGeneration });
});

router.get("/data/:table", requireAuth, requireSubscriptionAccess, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  if (!access) return;
  const records = await db.select().from(erpRecordsTable)
    .where(and(eq(erpRecordsTable.organizationId, access.auth.organizationId), eq(erpRecordsTable.tableName, access.tableName)));
  const data = records
    .filter(record => isLocationAllowed(access.auth, access.tableName, record.data, record.id))
    .map(record => ({ ...record.data, id: record.id, userId: access.auth.organizationId }));
  response.json({ records: data });
});

router.get("/data/purchaseOrders/:id/print", requireAuth, requireSubscriptionAccess, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const id = Number(request.params.id);
  if (!hasTableAccess(auth, "purchaseOrders")) {
    response.status(403).json({ error: "ليس لديك صلاحية لهذه الوحدة." });
    return;
  }
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: "معرّف أمر الشراء غير صالح." });
    return;
  }

  const [record] = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, id),
    eq(erpRecordsTable.organizationId, auth.organizationId),
    eq(erpRecordsTable.tableName, "purchaseOrders"),
  )).limit(1);
  if (!record || !isLocationAllowed(auth, "purchaseOrders", record.data, record.id)) {
    response.status(404).json({ error: "أمر الشراء غير متاح." });
    return;
  }

  const data = record.data as Record<string, unknown>;
  const warehouseId = Number(data.warehouseId);
  let warehouseName = String(data.warehouseName ?? "");
  if (!warehouseName && Number.isInteger(warehouseId) && warehouseId > 0) {
    const [warehouse] = await db.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.id, warehouseId),
      eq(erpRecordsTable.organizationId, auth.organizationId),
      eq(erpRecordsTable.tableName, "warehouses"),
    )).limit(1);
    warehouseName = warehouse ? String(warehouse.data.name ?? "") : "";
  }
  const items = Array.isArray(data.items)
    ? data.items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        productName: String(item.productName ?? item.name ?? ""),
        quantity: Number(item.quantity) || 0,
        unitCost: Number(item.unitCost ?? item.unitCostExVat) || 0,
        vatRate: Number(item.vatRate) || 0,
        lineNet: Number(item.lineNet) || 0,
        vatAmount: Number(item.vatAmount) || 0,
        total: Number(item.total ?? item.lineGross) || 0,
      }))
    : [];

  response.json({
    document: {
      orderNumber: String(data.orderNumber ?? ""),
      supplierName: String(data.supplierName ?? ""),
      warehouseName,
      issueDate: String(data.issueDate ?? data.date ?? ""),
      expectedDate: data.expectedDate ? String(data.expectedDate) : undefined,
      status: String(data.status ?? "draft"),
      items,
      subtotal: Number(data.subtotal) || 0,
      vat: Number(data.vat ?? data.tax) || 0,
      total: Number(data.total) || 0,
      notes: data.notes ? String(data.notes) : "",
    },
  });
});

router.post("/data/:table", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  if (!access) return;
  if (rejectUnauthorizedInventoryCatalogMutation(access, response)) return;
  if (SPECIALIZED_MUTATION_TABLES.has(access.tableName)) {
    response.status(405).json({ error: specializedMutationMessage(access.tableName) });
    return;
  }
  if (access.tableName === "financialClosures") {
    response.status(405).json({ error: "يتم الإقفال المالي من مسار الإقفال المعتمد فقط." });
    return;
  }
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات السجل غير صحيحة." });
    return;
  }
  const data = body as Record<string, unknown>;
  if (access.tableName === "receivables" && data.type === "payable"
    && (data.purchaseOrderId || data.purchaseId || data.purchaseReceiptOperationId)) {
    response.status(409).json({ error: "ذمم أوامر الشراء تُنشأ من استلام أمر الشراء فقط." });
    return;
  }
  const clientOperationId = typeof data.clientOperationId === "string" ? data.clientOperationId : "";
  const { clientOperationId: _clientOperationId, ...rawRecordData } = data;
  const initialRecordData = access.tableName === "products" ? normalizeProductData(rawRecordData) : rawRecordData;
  if (!initialRecordData) {
    response.status(400).json({ error: "اختر ضريبة المنتج: بدون ضريبة أو 5٪ أو 15٪." });
    return;
  }
  let recordData: Record<string, unknown> = initialRecordData;
  if (access.tableName === "products" && Object.hasOwn(body, "stock") && Number((body as Record<string, unknown>).stock) !== 0) {
    response.status(409).json({ error: "الرصيد الافتتاحي للمنتج يُسجّل بتسوية مخزون بعد إنشاء المنتج." });
    return;
  }
  if (!isLocationAllowed(access.auth, access.tableName, body as Record<string, unknown>)) {
    response.status(403).json({ error: "ليس لديك صلاحية للمواقع المحددة." });
    return;
  }
  if (isAccountingSource(access.tableName) && await isClosedDate(access.auth, String((body as Record<string, unknown>).date ?? (body as Record<string, unknown>).issueDate ?? ""))) {
    response.status(409).json({ error: "لا يمكن تعديل مصدر محاسبي في فترة مالية مقفلة." });
    return;
  }
  if (access.tableName === "journalEntries") {
    const data = body as Record<string, unknown>;
    const error = validateJournal(data);
    if (error) {
      response.status(400).json({ error });
      return;
    }
    if (data.status !== "draft") {
      response.status(403).json({ error: "أنشئ القيد كمسودة ثم رحّله بعد المراجعة." });
      return;
    }
    if (await isClosedDate(access.auth, String(data.date))) {
      response.status(409).json({ error: "الفترة المالية مقفلة ولا يمكن إنشاء قيد فيها." });
      return;
    }
  }
  let created;
  let record;
  try {
    ({ created, record } = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) {
        throw lockedMutationRejected(response);
      }
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasTableAccess(currentAuth, access.tableName)) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw lockedMutationRejected(response);
      }
      if (!isLocationAllowed(currentAuth, access.tableName, recordData)) {
        throw new MutationRejected(403, "ليس لديك صلاحية للمواقع المحددة.");
      }
      if (isAccountingSource(access.tableName) && await isClosedDate(
        currentAuth,
        String(recordData.date ?? recordData.issueDate ?? ""),
        tx,
      )) {
        throw new MutationRejected(409, "لا يمكن تعديل مصدر محاسبي في فترة مالية مقفلة.");
      }
      if (access.tableName === "journalEntries" && await isClosedDate(currentAuth, String(recordData.date), tx)) {
        throw new MutationRejected(409, "الفترة المالية مقفلة ولا يمكن إنشاء قيد فيها.");
      }
      if (access.tableName === "accounts") {
        await validateAccountHierarchy(tx, currentAuth.organizationId, null, recordData);
      }
      if (access.tableName === "products") {
        await ensureUniqueProductBarcode(tx, currentAuth.organizationId, recordData);
      }
      if (access.tableName === "quotations") {
        const normalized = quotationData(recordData);
        if (!normalized.data) throw new MutationRejected(400, normalized.error ?? "بيانات عرض السعر غير صحيحة.");
        const number = await nextQuotationNumber(tx, currentAuth.organizationId);
        recordData = {
          ...normalized.data,
          number,
          createdAt: new Date().toISOString(),
        };
      }
      if (access.tableName === "purchaseOrders") {
        const requestedStatus = String(recordData.status ?? "draft");
        if (requestedStatus !== "draft" && requestedStatus !== "sent") {
          throw new MutationRejected(409, "يمكن إنشاء أمر الشراء كمسودة أو مرسل فقط.");
        }
        const number = await nextPurchaseOrderNumber(tx, currentAuth.organizationId);
        const normalized = await purchaseOrderData(tx, currentAuth.organizationId, { ...recordData, status: requestedStatus }, number);
        if (!normalized.data) throw new MutationRejected(400, normalized.error ?? "بيانات أمر الشراء غير صحيحة.");
        recordData = {
          ...normalized.data,
          createdAt: new Date().toISOString(),
        };
      }
      const [inserted] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: access.tableName,
        clientOperationId: clientOperationId || null,
        data: recordData,
      }).onConflictDoNothing({
        target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId],
      }).returning();
      const saved = inserted ?? (clientOperationId
        ? (await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, access.auth.organizationId),
          eq(erpRecordsTable.tableName, access.tableName),
          eq(erpRecordsTable.clientOperationId, clientOperationId),
        )).limit(1))[0]
        : undefined);
      return { created: inserted, record: saved };
    }));
  } catch (error) {
    if (error instanceof MutationRejected) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    if (access.tableName === "accounts" && isUniqueConstraintViolation(error)) {
      response.status(409).json({ error: "رقم الحساب مستخدم داخل هذه المنشأة." });
      return;
    }
    throw error;
  }
  if (!record) {
    response.status(500).json({ error: "تعذر حفظ السجل." });
    return;
  }
  if (created) await audit(access.auth, response, `${access.tableName}_created`, String(record.id));
  response.status(created ? 201 : 200).json({ record: { ...record.data, id: record.id, userId: access.auth.organizationId } });
});

router.patch("/data/:table/:id", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  const id = Number(request.params.id);
  if (!access || !Number.isInteger(id)) {
    if (access) response.status(400).json({ error: "معرّف السجل غير صالح." });
    return;
  }
  if (rejectUnauthorizedInventoryCatalogMutation(access, response)) return;
  if (SPECIALIZED_MUTATION_TABLES.has(access.tableName)) {
    response.status(405).json({ error: specializedMutationMessage(access.tableName) });
    return;
  }
  if (isAccountingSource(access.tableName) && access.tableName !== "purchaseOrders") {
    response.status(405).json({ error: "يُلغى أو يُصحح المستند المحاسبي من مساره المتخصص حتى تتطابق القيود والمخزون والذمم." });
    return;
  }
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات السجل غير صحيحة." });
    return;
  }
  const clientOperationId = request.get("Idempotency-Key")?.trim() ?? "";
  if (clientOperationId.length > 200) {
    response.status(400).json({ error: "معرّف العملية طويل جداً." });
    return;
  }
  if (access.tableName === "products" && Object.hasOwn(body, "stock")) {
    response.status(405).json({ error: "إجمالي المنتج يُحدّث من أرصدة المواقع عبر حركات المخزون فقط." });
    return;
  }
  if (access.tableName === "products") {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) return { kind: "stale" as const };
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasTableAccess(currentAuth, access.tableName)) {
        response.locals.writeAccessFailure = "authorization_changed";
        return { kind: "stale" as const };
      }
      const [current] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, id), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "products"),
      )).for("update");
      if (!current) return { kind: "missing" as const };
      const data = normalizeProductData({ ...current.data, ...(body as Record<string, unknown>), stock: current.data.stock }, Number(current.data.vatRate ?? 15));
      if (!data) return { kind: "invalid-tax" as const };
      try {
        await ensureUniqueProductBarcode(tx, currentAuth.organizationId, data, current.id);
      } catch (error) {
        if (error instanceof MutationRejected && error.code === "duplicate_product_barcode") return { kind: "duplicate-barcode" as const };
        throw error;
      }
      if (!isLocationAllowed(currentAuth, access.tableName, data, current.id)) {
        return { kind: "forbidden" as const };
      }
      const [updated] = await tx.update(erpRecordsTable).set({ data, updatedAt: new Date() }).where(eq(erpRecordsTable.id, id)).returning();
      return { kind: "updated" as const, record: updated };
    });
    if (result.kind === "missing") {
      response.status(404).json({ error: "السجل غير متاح." });
      return;
    }
    if (result.kind === "stale") {
      const rejection = lockedWriteRejection(response);
      response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
      return;
    }
    if (result.kind === "forbidden") {
      response.status(403).json({ error: "ليس لديك صلاحية للمواقع المحددة." });
      return;
    }
    if (result.kind === "invalid-tax") {
      response.status(400).json({ error: "اختر ضريبة المنتج: بدون ضريبة أو 5٪ أو 15٪." });
      return;
    }
    if (result.kind === "duplicate-barcode") {
      response.status(409).json({ error: "الباركود مستخدم لمنتج آخر داخل هذه المنشأة.", code: "duplicate_product_barcode" });
      return;
    }
    await audit(access.auth, response, "products_updated", String(id));
    response.json({ record: { ...result.record.data, id: result.record.id, userId: access.auth.organizationId } });
    return;
  }
  if (access.tableName === "journalEntries" && clientOperationId) {
    const fingerprint = operationFingerprint(body);
    try {
      const result = await db.transaction(async (tx) => {
        if (!await lockAndValidateDataGeneration(tx, response)) {
          throw lockedMutationRejected(response);
        }
        const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
        if (!currentAuth || !hasTableAccess(currentAuth, access.tableName)) {
          response.locals.writeAccessFailure = "authorization_changed";
          throw lockedMutationRejected(response);
        }
        const [claimedOperation] = await tx.insert(erpRecordsTable).values({
          organizationId: currentAuth.organizationId,
          tableName: "mutationOperations",
          clientOperationId,
          data: {
            targetTable: access.tableName,
            targetId: id,
            fingerprint,
            state: "pending",
          },
        }).onConflictDoNothing({
          target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId],
        }).returning();

        if (!claimedOperation) {
          const [completedOperation] = await tx.select().from(erpRecordsTable).where(and(
            eq(erpRecordsTable.organizationId, currentAuth.organizationId),
            eq(erpRecordsTable.tableName, "mutationOperations"),
            eq(erpRecordsTable.clientOperationId, clientOperationId),
          )).limit(1);
          const operationData = completedOperation?.data;
          const savedRecord = operationData?.record;
          if (
            !completedOperation
            || operationData?.targetTable !== access.tableName
            || String(operationData.targetId) !== String(id)
            || operationData.fingerprint !== fingerprint
            || !savedRecord
            || typeof savedRecord !== "object"
            || Array.isArray(savedRecord)
          ) {
            throw new MutationRejected(409, "معرّف العملية مستخدم لطلب مختلف.");
          }
          return { record: savedRecord, replayed: true };
        }

        const [existing] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, id),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, access.tableName),
        )).for("update");
        if (!existing || !isLocationAllowed(currentAuth, access.tableName, existing.data, existing.id)) {
          throw new MutationRejected(404, "السجل غير متاح.");
        }
        if (existing.data.status === "posted") {
          throw new MutationRejected(409, "القيد المرحّل غير قابل للتعديل. أنشئ قيداً عكسياً بدلاً من ذلك.");
        }

        const data = { ...existing.data, ...(body as Record<string, unknown>) };
        const error = validateJournal(data);
        if (error) throw new MutationRejected(400, error);
        if (await isClosedDate(currentAuth, String(data.date), tx)) {
          throw new MutationRejected(409, "الفترة المالية مقفلة ولا يمكن ترحيل قيد فيها.");
        }
        if (!isLocationAllowed(currentAuth, access.tableName, data, existing.id)) {
          throw new MutationRejected(403, "ليس لديك صلاحية للمواقع المحددة.");
        }

        const [updated] = await tx.update(erpRecordsTable)
          .set({ data, updatedAt: new Date() })
          .where(eq(erpRecordsTable.id, id))
          .returning();
        const responseRecord = { ...updated.data, id: updated.id, userId: access.auth.organizationId };
        await tx.update(erpRecordsTable).set({
          data: {
            targetTable: access.tableName,
            targetId: id,
            fingerprint,
            record: responseRecord,
          },
          updatedAt: new Date(),
        }).where(eq(erpRecordsTable.id, claimedOperation.id));
        return { record: responseRecord, replayed: false };
      });
      if (!result.replayed) await audit(access.auth, response, `${access.tableName}_updated`, String(id));
      response.json({ record: result.record });
      return;
    } catch (error) {
      if (error instanceof MutationRejected) {
        response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
        return;
      }
      throw error;
    }
  }
  const [existing] = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, id), eq(erpRecordsTable.organizationId, access.auth.organizationId), eq(erpRecordsTable.tableName, access.tableName),
  ));
  if (!existing || !isLocationAllowed(access.auth, access.tableName, existing.data, existing.id)) {
    response.status(404).json({ error: "السجل غير متاح." });
    return;
  }
  if (access.tableName === "financialClosures") {
    response.status(405).json({ error: "لا يمكن تعديل الإقفال المالي بعد اعتماده." });
    return;
  }
  if (access.tableName === "journalEntries" && existing.data.status === "posted") {
    response.status(409).json({ error: "القيد المرحّل غير قابل للتعديل. أنشئ قيداً عكسياً بدلاً من ذلك." });
    return;
  }
  const data = { ...existing.data, ...(body as Record<string, unknown>) };
  if (isAccountingSource(access.tableName) && await isClosedDate(access.auth, String(data.date ?? data.issueDate ?? ""))) {
    response.status(409).json({ error: "لا يمكن تعديل مصدر محاسبي في فترة مالية مقفلة." });
    return;
  }
  if (access.tableName === "journalEntries") {
    const error = validateJournal(data);
    if (error) {
      response.status(400).json({ error });
      return;
    }
    if (await isClosedDate(access.auth, String(data.date))) {
      response.status(409).json({ error: "الفترة المالية مقفلة ولا يمكن ترحيل قيد فيها." });
      return;
    }
  }
  if (!isLocationAllowed(access.auth, access.tableName, data, existing.id)) {
    response.status(403).json({ error: "ليس لديك صلاحية للمواقع المحددة." });
    return;
  }
  let updated;
  try {
    [updated] = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) {
        throw lockedMutationRejected(response);
      }
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasTableAccess(currentAuth, access.tableName)) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw lockedMutationRejected(response);
      }
      const [current] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, id),
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, access.tableName),
      )).for("update");
      if (!current || !isLocationAllowed(currentAuth, access.tableName, current.data, current.id)) {
        throw new MutationRejected(404, "السجل غير متاح.");
      }
      if (access.tableName === "financialClosures") {
        throw new MutationRejected(405, "لا يمكن تعديل الإقفال المالي بعد اعتماده.");
      }
      if (access.tableName === "journalEntries" && current.data.status === "posted") {
        throw new MutationRejected(409, "القيد المرحّل غير قابل للتعديل. أنشئ قيداً عكسياً بدلاً من ذلك.");
      }
      if (access.tableName === "receivables" && current.data.type === "payable" && current.data.purchaseOrderId) {
        throw new MutationRejected(409, "ذمة أمر الشراء تُحدّث من مسار سداد المورد المعتمد فقط.");
      }
      if (access.tableName === "quotations" && (current.data.convertedInvoiceId || current.data.status === "accepted")) {
        throw new MutationRejected(409, "عرض السعر المحوّل إلى فاتورة غير قابل للتعديل.");
      }
      let currentData = { ...current.data, ...(body as Record<string, unknown>) };
      if (access.tableName === "receivables" && currentData.type === "payable"
        && (currentData.purchaseOrderId || currentData.purchaseId || currentData.purchaseReceiptOperationId)) {
        throw new MutationRejected(409, "ذمم أوامر الشراء تُنشأ وتُحدّث من مسارات الاستلام والسداد المعتمدة فقط.");
      }
      if (access.tableName === "quotations") {
        const normalized = quotationData(currentData, String(current.data.number ?? ""));
        if (!normalized.data) throw new MutationRejected(400, normalized.error ?? "بيانات عرض السعر غير صحيحة.");
        currentData = {
          ...normalized.data,
          createdAt: current.data.createdAt,
        };
      }
      if (access.tableName === "purchaseOrders") {
        if (current.data.status === "partial" || current.data.status === "received" || current.data.status === "cancelled" || current.data.received === true) {
          throw new MutationRejected(409, "لا يمكن تعديل أمر شراء بدأ استلامه أو أُلغي.");
        }
        const nextStatus = String(currentData.status ?? current.data.status);
        if (nextStatus !== "draft" && nextStatus !== "sent" && nextStatus !== "cancelled") {
          throw new MutationRejected(409, "لا يمكن تغيير حالة أمر الشراء يدوياً إلى حالة استلام.");
        }
        const normalized = await purchaseOrderData(
          tx,
          currentAuth.organizationId,
          {
            ...currentData,
            status: nextStatus,
            items: Array.isArray(currentData.items)
              ? currentData.items.map((item) => item && typeof item === "object" && !Array.isArray(item)
                ? { ...(item as Record<string, unknown>), receivedQuantity: 0 }
                : item)
              : currentData.items,
          },
          String(current.data.orderNumber ?? ""),
        );
        if (!normalized.data) throw new MutationRejected(400, normalized.error ?? "بيانات أمر الشراء غير صحيحة.");
        currentData = {
          ...normalized.data,
          createdAt: current.data.createdAt,
          ...(nextStatus === "cancelled" ? { cancelledAt: new Date().toISOString() } : {}),
        };
      }
      if (isAccountingSource(access.tableName) && await isClosedDate(
        currentAuth,
        String(currentData.date ?? currentData.issueDate ?? ""),
        tx,
      )) {
        throw new MutationRejected(409, "لا يمكن تعديل مصدر محاسبي في فترة مالية مقفلة.");
      }
      if (access.tableName === "journalEntries") {
        const error = validateJournal(currentData);
        if (error) throw new MutationRejected(400, error);
        if (await isClosedDate(currentAuth, String(currentData.date), tx)) {
          throw new MutationRejected(409, "الفترة المالية مقفلة ولا يمكن ترحيل قيد فيها.");
        }
      }
      if (access.tableName === "accounts") {
        await validateAccountHierarchy(tx, currentAuth.organizationId, current.id, currentData);
      }
      if (!isLocationAllowed(currentAuth, access.tableName, currentData, current.id)) {
        throw new MutationRejected(403, "ليس لديك صلاحية للمواقع المحددة.");
      }
      return tx.update(erpRecordsTable).set({ data: currentData, updatedAt: new Date() }).where(eq(erpRecordsTable.id, id)).returning();
    });
  } catch (error) {
    if (error instanceof MutationRejected) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    if (access.tableName === "accounts" && isUniqueConstraintViolation(error)) {
      response.status(409).json({ error: "رقم الحساب مستخدم داخل هذه المنشأة." });
      return;
    }
    throw error;
  }
  await audit(access.auth, response, `${access.tableName}_updated`, String(id));
  response.json({ record: { ...updated.data, id: updated.id, userId: access.auth.organizationId } });
});

router.post("/data/quotations/:id/convert", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ error: "معرّف عرض السعر غير صالح." });
    return;
  }
  if (!hasTableAccess(auth, "quotations")) {
    response.status(403).json({ error: "ليس لديك صلاحية لوحدة المبيعات." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedMutationRejected(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasTableAccess(currentAuth, "quotations")) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw lockedMutationRejected(response);
      }
      const [quotation] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, id),
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "quotations"),
      )).for("update");
      if (!quotation || !isLocationAllowed(currentAuth, "quotations", quotation.data, quotation.id)) {
        throw new MutationRejected(404, "عرض السعر غير متاح.");
      }
      if (quotation.data.convertedInvoiceId || quotation.data.status === "accepted") {
        throw new MutationRejected(409, "تم تحويل عرض السعر إلى فاتورة مسبقاً.", "quotation_already_converted");
      }
      if (quotation.data.status === "rejected") {
        throw new MutationRejected(409, "لا يمكن تحويل عرض سعر مرفوض.");
      }
      const normalized = quotationData(quotation.data, String(quotation.data.number ?? ""));
      if (!normalized.data) throw new MutationRejected(409, normalized.error ?? "بيانات عرض السعر غير صحيحة.");
      const today = new Date().toISOString().slice(0, 10);
      if (String(normalized.data.expiryDate) < today) {
        throw new MutationRejected(409, "انتهت صلاحية عرض السعر ولا يمكن تحويله.");
      }

      const createdAt = new Date().toISOString();
      const [draftInvoice] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "invoices",
        data: {
          number: "",
          issueDate: today,
          customerId: normalized.data.customerId,
          customerName: normalized.data.customerName,
          status: "draft",
          conversionState: "awaiting_fulfillment",
          items: normalized.data.items,
          subtotal: normalized.data.subtotal,
          discount: normalized.data.discount,
          tax: normalized.data.tax,
          total: normalized.data.total,
          paid: 0,
          sourceQuotationId: quotation.id,
          quotationNumber: normalized.data.number,
          notes: normalized.data.notes,
          createdAt,
        },
      }).returning();
      if (!draftInvoice) throw new MutationRejected(500, "تعذر إنشاء الفاتورة.");
      const invoiceNumber = `INV-${draftInvoice.id}`;
      const [invoice] = await tx.update(erpRecordsTable).set({
        data: {
          ...draftInvoice.data,
          number: invoiceNumber,
        },
        updatedAt: new Date(),
      }).where(eq(erpRecordsTable.id, draftInvoice.id)).returning();
      const [updatedQuotation] = await tx.update(erpRecordsTable).set({
        data: {
          ...quotation.data,
          status: "accepted",
          convertedInvoiceId: invoice.id,
          convertedAt: createdAt,
        },
        updatedAt: new Date(),
      }).where(eq(erpRecordsTable.id, quotation.id)).returning();
      await tx.insert(teamAuditLogsTable).values([
        {
          organizationId: currentAuth.organizationId,
          actorId: currentAuth.id,
          actorName: currentAuth.name || currentAuth.email,
          action: "quotation_converted",
          entity: String(quotation.id),
          details: JSON.stringify({ invoiceId: invoice.id }),
        },
        {
          organizationId: currentAuth.organizationId,
          actorId: currentAuth.id,
          actorName: currentAuth.name || currentAuth.email,
          action: "invoice_created_from_quotation",
          entity: String(invoice.id),
          details: JSON.stringify({ quotationId: quotation.id }),
        },
      ]);
      return {
        auth: currentAuth,
        quotation: updatedQuotation,
        invoice,
      };
    });
    response.status(201).json({
      quotation: { ...result.quotation.data, id: result.quotation.id, userId: result.auth.organizationId },
      invoice: { ...result.invoice.data, id: result.invoice.id, userId: result.auth.organizationId },
    });
  } catch (error) {
    if (error instanceof MutationRejected) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
});

router.delete("/data/:table/:id", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  const id = Number(request.params.id);
  if (!access || !Number.isInteger(id)) {
    if (access) response.status(400).json({ error: "معرّف السجل غير صالح." });
    return;
  }
  if (rejectUnauthorizedInventoryCatalogMutation(access, response)) return;
  if (SPECIALIZED_MUTATION_TABLES.has(access.tableName)) {
    response.status(405).json({ error: specializedMutationMessage(access.tableName) });
    return;
  }
  if (isAccountingSource(access.tableName) && access.tableName !== "purchaseOrders") {
    response.status(405).json({ error: "لا يُحذف المستند المحاسبي مباشرة. ألغِه من مساره المتخصص حتى تُعكس آثاره كاملة." });
    return;
  }
  if (access.tableName === "products") {
    const deleted = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) return "stale" as const;
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasTableAccess(currentAuth, access.tableName)) {
        response.locals.writeAccessFailure = "authorization_changed";
        return "stale" as const;
      }
      const [product] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, id), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "products"),
      )).for("update");
      if (!product) return "missing" as const;
      if (!isLocationAllowed(currentAuth, access.tableName, product.data, product.id)) {
        return "forbidden" as const;
      }
      const [reference] = await tx.select({ id: erpRecordsTable.id }).from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        sql`${erpRecordsTable.tableName} in ('inventoryBalances', 'stockTransfers', 'stockAdjustments', 'sales')`,
        sql`${erpRecordsTable.data}->>'productId' = ${String(id)}`,
      )).limit(1);
      if (reference) {
        response.status(409).json({ error: "لا يمكن حذف منتج له أرصدة أو حركات مخزون." });
        return null;
      }
      await tx.delete(erpRecordsTable).where(eq(erpRecordsTable.id, id));
      return "deleted" as const;
    });
    if (deleted === "missing") {
      response.status(404).json({ error: "السجل غير متاح." });
      return;
    }
    if (deleted === "stale") {
      const rejection = lockedWriteRejection(response);
      response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
      return;
    }
    if (deleted === "forbidden") {
      response.status(403).json({ error: "ليس لديك صلاحية للمواقع المحددة." });
      return;
    }
    if (deleted === null) return;
    await audit(access.auth, response, "products_deleted", String(id));
    response.sendStatus(204);
    return;
  }
  const [record] = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, id), eq(erpRecordsTable.organizationId, access.auth.organizationId), eq(erpRecordsTable.tableName, access.tableName),
  ));
  if (!record || !isLocationAllowed(access.auth, access.tableName, record.data, record.id)) {
    response.status(404).json({ error: "السجل غير متاح." });
    return;
  }
  if (access.tableName === "financialClosures") {
    response.status(405).json({ error: "لا يمكن حذف الإقفال المالي المعتمد." });
    return;
  }
  if (access.tableName === "journalEntries" && record.data.status === "posted") {
    response.status(409).json({ error: "القيد المرحّل غير قابل للحذف. أنشئ قيداً عكسياً بدلاً من ذلك." });
    return;
  }
  if (isAccountingSource(access.tableName) && await isClosedDate(access.auth, String(record.data.date ?? record.data.issueDate ?? ""))) {
    response.status(409).json({ error: "لا يمكن حذف مصدر محاسبي من فترة مالية مقفلة." });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) {
        throw lockedMutationRejected(response);
      }
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasTableAccess(currentAuth, access.tableName)) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw lockedMutationRejected(response);
      }
      const [current] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, id),
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, access.tableName),
      )).for("update");
      if (!current || !isLocationAllowed(currentAuth, access.tableName, current.data, current.id)) {
        throw new MutationRejected(404, "السجل غير متاح.");
      }
      if (access.tableName === "financialClosures") {
        throw new MutationRejected(405, "لا يمكن حذف الإقفال المالي المعتمد.");
      }
      if (access.tableName === "journalEntries" && current.data.status === "posted") {
        throw new MutationRejected(409, "القيد المرحّل غير قابل للحذف. أنشئ قيداً عكسياً بدلاً من ذلك.");
      }
      if (access.tableName === "quotations" && (current.data.convertedInvoiceId || current.data.status === "accepted")) {
        throw new MutationRejected(409, "عرض السعر المحوّل إلى فاتورة غير قابل للحذف.");
      }
      if (access.tableName === "purchaseOrders" && (current.data.status !== "draft" || current.data.received === true)) {
        throw new MutationRejected(409, "لا يمكن حذف أمر شراء بعد إرساله أو بدء استلامه. ألغِه بدلاً من ذلك.");
      }
      if (access.tableName === "receivables" && current.data.type === "payable" && current.data.purchaseOrderId) {
        throw new MutationRejected(409, "لا يمكن حذف ذمة مرتبطة باستلام أمر شراء.");
      }
      if (isAccountingSource(access.tableName) && await isClosedDate(
        currentAuth,
        String(current.data.date ?? current.data.issueDate ?? ""),
        tx,
      )) {
        throw new MutationRejected(409, "لا يمكن حذف مصدر محاسبي من فترة مالية مقفلة.");
      }
      await tx.delete(erpRecordsTable).where(eq(erpRecordsTable.id, id));
    });
  } catch (error) {
    if (error instanceof MutationRejected) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
  await audit(access.auth, response, `${access.tableName}_deleted`, String(id));
  response.sendStatus(204);
});

export default router;