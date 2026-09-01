import { createHash } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, eInvoiceDocumentsTable, erpRecordsTable, organizationsTable, teamAuditLogsTable } from "@workspace/db";
import { lockAndValidateDataGeneration, lockedWriteRejection, refreshAuthAfterOrganizationLock, requireAuth, requireCurrentDataGeneration, requireOwner, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";
import { isLocationAllowed } from "../lib/location-scope";
import { buildLedgerReport } from "../lib/accounting-ledger";
import { auditDetails, JournalAdjustmentError, prepareJournalAdjustment, type JournalAdjustmentAction, type JournalRecord } from "../lib/journal-adjustments";
import { EInvoiceAdjustmentError, issueEInvoiceAdjustment } from "../lib/e-invoice-adjustments";

const router: IRouter = Router();

type AnyRecord = Record<string, unknown> & { id: number };
type ErpRecord = typeof erpRecordsTable.$inferSelect;
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseExecutor = typeof db | DatabaseTransaction;

class AccountingMutationError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

type SourceTable = "invoices" | "purchaseOrders" | "expenses";
type SourceAction = "cancel" | "correct";

class SourceCorrectionError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

function lockedAccountingMutationError(response: Response): AccountingMutationError {
  const rejection = lockedWriteRejection(response);
  return new AccountingMutationError(rejection.status, rejection.error, rejection.code);
}

const asNumber = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

const asDate = (value: unknown): string => {
  if (typeof value !== "string" || !value) return "";
  return value.slice(0, 10);
};

const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function requireAccounting(_request: Request, response: Response, next: NextFunction): void {
  const auth = response.locals.auth as AuthContext | undefined;
  if (!auth || !hasAccountingAccess(auth)) {
    response.status(403).json({ error: "ليس لديك صلاحية لوحدة المحاسبة." });
    return;
  }
  next();
}

function hasAccountingAccess(auth: AuthContext): boolean {
  return auth.roleId === "owner" || auth.permissions.accounting === true;
}

const inPeriod = (record: Record<string, unknown>, from: string, to: string): boolean => {
  const date = asDate(record.date ?? record.issueDate ?? record.createdAt);
  return !date || (date >= from && date <= to);
};

async function organizationRecordsFor(
  auth: AuthContext,
  tableName: string,
  executor: DatabaseExecutor = db,
): Promise<AnyRecord[]> {
  const rows = await executor.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, auth.organizationId),
    eq(erpRecordsTable.tableName, tableName),
  ));
  return rows.map((row): AnyRecord => {
    const data = row.data as Record<string, unknown>;
    return { ...data, id: row.id };
  });
}

async function recordsFor(
  auth: AuthContext,
  tableName: string,
  executor: DatabaseExecutor = db,
): Promise<AnyRecord[]> {
  const records = await organizationRecordsFor(auth, tableName, executor);
  if (tableName !== "journalEntries") {
    return records.filter((record) => isLocationAllowed(auth, tableName, record, record.id));
  }

  const sourceTableByType: Record<string, string> = {
    sale: "invoices",
    purchase: "purchaseOrders",
    expense: "expenses",
  };
  const sourceIds = [...new Set(records.flatMap((record) => {
    const sourceTable = sourceTableByType[String(record.sourceType ?? "")];
    const sourceId = Number(record.sourceId);
    return sourceTable && Number.isInteger(sourceId) && sourceId > 0 ? [sourceId] : [];
  }))];
  const sourceRows = sourceIds.length
    ? await executor.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.organizationId, auth.organizationId),
      inArray(erpRecordsTable.id, sourceIds),
    ))
    : [];
  const sourcesById = new Map(sourceRows.map((row) => [row.id, row]));
  return records.filter((record) => {
    const sourceTable = sourceTableByType[String(record.sourceType ?? "")];
    const sourceId = Number(record.sourceId);
    if (!sourceTable || !Number.isInteger(sourceId) || sourceId <= 0) {
      return isLocationAllowed(auth, tableName, record, record.id);
    }
    const source = sourcesById.get(sourceId);
    return Boolean(
      source
      && source.tableName === sourceTable
      && isLocationAllowed(auth, source.tableName, source.data, source.id),
    );
  });
}

async function guardedAudit(response: Response, auth: AuthContext, action: string, entity: string, details: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!await lockAndValidateDataGeneration(tx, response)) return false;
    await tx.insert(teamAuditLogsTable).values({
      organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email,
      action, entity, details,
    });
    return true;
  });
}

function normalizeLines(value: unknown): Array<{ accountId: string; debit: number; credit: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object")
    .map((line) => ({
      accountId: String(line.accountId ?? line.account ?? ""),
      debit: asNumber(line.debit),
      credit: asNumber(line.credit),
    }));
}

function sourceTable(value: unknown): SourceTable | null {
  return value === "invoices" || value === "purchaseOrders" || value === "expenses" ? value : null;
}

function sourceTypeFor(tableName: SourceTable): "sale" | "purchase" | "expense" {
  return tableName === "invoices" ? "sale" : tableName === "purchaseOrders" ? "purchase" : "expense";
}

function sourceDate(data: Record<string, unknown>, fallback?: string): string {
  return asDate(data.issueDate ?? data.date ?? data.createdAt) || fallback || new Date().toISOString().slice(0, 10);
}

function sourceAmount(data: Record<string, unknown>): number {
  if (Array.isArray(data.receipts)) return asNumber(data.receivedTotal);
  return asNumber(data.total ?? data.amount ?? data.totalAmount);
}

function sourceTaxExclusiveAmount(data: Record<string, unknown>): number {
  if (Array.isArray(data.receipts)) return asNumber(data.receivedSubtotal);
  const subtotal = asNumber(data.subtotal ?? data.netAmount);
  if (subtotal > 0) return subtotal;
  return Math.max(0, sourceAmount(data) - asNumber(data.tax ?? data.vatAmount));
}

function sourceLabel(tableName: SourceTable): string {
  return tableName === "invoices" ? "فاتورة بيع" : tableName === "purchaseOrders" ? "أمر شراء" : "مصروف";
}

function sourceCorrectionAccess(auth: AuthContext, tableName: SourceTable): boolean {
  if (auth.roleId === "owner") return true;
  if (tableName === "invoices") return auth.permissions.sales === true || auth.permissions.accounting === true;
  if (tableName === "purchaseOrders") return auth.permissions.inventory === true || auth.permissions.accounting === true;
  return auth.permissions.accounting === true;
}

function validSourceCorrectionDate(value: unknown): value is string {
  return typeof value === "string" && isValidIsoDate(value);
}

function sourceReplacement(
  tableName: SourceTable,
  current: Record<string, unknown>,
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SourceCorrectionError(400, "بيانات المستند المصحح غير صحيحة.");
  }
  const allowed = tableName === "invoices"
    ? ["number", "issueDate", "warehouseId", "customerId", "customerName", "customerVatNumber", "customerAddress", "paymentMethod", "dueDate", "items", "subtotal", "tax", "total", "paid"]
    : tableName === "purchaseOrders"
      ? ["orderNumber", "supplierId", "supplierName", "date", "warehouseId", "status", "items", "subtotal", "tax", "total", "paid", "paymentMethod", "dueDate", "received"]
      : ["description", "amount", "date", "category", "vendor", "paymentMethod", "paid"];
  const patch = raw as Record<string, unknown>;
  const merged = { ...current };
  for (const key of allowed) {
    if (Object.hasOwn(patch, key)) merged[key] = patch[key];
  }
  if (tableName === "invoices") {
    const issueDate = sourceDate(merged);
    if (!validSourceCorrectionDate(issueDate)) throw new SourceCorrectionError(400, "تاريخ الفاتورة المصححة غير صحيح.");
    const total = sourceAmount(merged);
    if (total <= 0) throw new SourceCorrectionError(400, "إجمالي الفاتورة المصححة يجب أن يكون موجباً.");
    if (merged.items != null && !Array.isArray(merged.items)) throw new SourceCorrectionError(400, "أصناف الفاتورة المصححة غير صحيحة.");
  } else if (tableName === "purchaseOrders") {
    const date = sourceDate(merged);
    if (!validSourceCorrectionDate(date)) throw new SourceCorrectionError(400, "تاريخ أمر الشراء المصحح غير صحيح.");
    if (sourceAmount(merged) <= 0) throw new SourceCorrectionError(400, "إجمالي أمر الشراء المصحح يجب أن يكون موجباً.");
    if (merged.items != null && !Array.isArray(merged.items)) throw new SourceCorrectionError(400, "أصناف أمر الشراء المصحح غير صحيحة.");
  } else {
    if (!validSourceCorrectionDate(sourceDate(merged))) throw new SourceCorrectionError(400, "تاريخ المصروف المصحح غير صحيح.");
    if (sourceAmount(merged) <= 0) throw new SourceCorrectionError(400, "مبلغ المصروف المصحح يجب أن يكون موجباً.");
  }
  return merged;
}

function movementMap(tableName: SourceTable, data: Record<string, unknown>): Map<string, { productId: number; warehouseId: number; quantity: number }> {
  const result = new Map<string, { productId: number; warehouseId: number; quantity: number }>();
  const appliesToStock = tableName === "invoices"
    || (tableName === "purchaseOrders" && (data.status === "completed" || data.received === true));
  if (!appliesToStock || !Array.isArray(data.items)) return result;
  const fallbackWarehouse = Number(data.warehouseId);
  for (const rawItem of data.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const item = rawItem as Record<string, unknown>;
    const productId = Number(item.productId);
    const warehouseId = Number(item.warehouseId ?? fallbackWarehouse);
    const quantity = tableName === "purchaseOrders" && Array.isArray(data.receipts)
      ? Number(item.receivedQuantity ?? 0)
      : Number(item.quantity);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(warehouseId) || warehouseId <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue;
    const key = `${productId}:${warehouseId}`;
    const existing = result.get(key);
    result.set(key, { productId, warehouseId, quantity: (existing?.quantity ?? 0) + quantity });
  }
  return result;
}

async function consumeCorrectionFifo(
  tx: DatabaseTransaction,
  organizationId: number,
  productId: number,
  warehouseId: number,
  quantity: number,
): Promise<Array<Record<string, unknown>>> {
  const layers = await tx.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId), eq(erpRecordsTable.tableName, "inventoryLayers"),
    sql`${erpRecordsTable.data}->>'productId' = ${String(productId)}`,
    sql`${erpRecordsTable.data}->>'warehouseId' = ${String(warehouseId)}`,
  )).orderBy(erpRecordsTable.id).for("update");
  let needed = quantity;
  const allocations: Array<Record<string, unknown>> = [];
  for (const layer of layers) {
    const available = asNumber(layer.data.remainingQuantity);
    if (available <= 0) continue;
    const used = Math.min(needed, available);
    const unitCostExVat = asNumber(layer.data.unitCostExVat);
    if (unitCostExVat < 0) throw new SourceCorrectionError(409, "تكلفة إحدى طبقات FIFO غير صالحة.");
    await tx.update(erpRecordsTable).set({ data: { ...layer.data, remainingQuantity: available - used }, updatedAt: new Date() }).where(eq(erpRecordsTable.id, layer.id));
    allocations.push({ layerId: layer.id, quantity: used, unitCostExVat, costAmount: Math.round(used * unitCostExVat * 100) / 100 });
    needed -= used;
    if (needed <= 0) break;
  }
  if (needed > 0.000001) throw new SourceCorrectionError(409, "طبقات FIFO لا تكفي لتصحيح الفاتورة.");
  return allocations;
}

function journalLinesForSource(
  tableName: SourceTable,
  data: Record<string, unknown>,
  accounts: AnyRecord[],
): Array<{ accountId: string; debit: number; credit: number }> {
  const type = sourceTypeFor(tableName);
  const account = (code: string) => accounts.find((item) => String(item.code) === code && item.status !== "inactive");
  const total = sourceAmount(data);
  const tax = Array.isArray(data.receipts) ? asNumber(data.receivedVat) : asNumber(data.tax);
  const net = Array.isArray(data.receipts) ? asNumber(data.receivedSubtotal) : asNumber(data.subtotal ?? total - tax);
  const cogs = asNumber(data.cogsTotal);
  const cashOrAr = account(data.paymentMethod === "credit" || data.customerId ? "1200" : data.paymentMethod === "card" ? "1100" : "1000");
  if (total <= 0 || !cashOrAr) {
    throw new SourceCorrectionError(409, "يلزم مبلغ موجب وحسابات افتراضية نشطة مطابقة في دليل الحسابات.");
  }
  if (type === "sale") {
    const sales = account("4000"); const outputVat = account("2100"); const inventory = account("1300"); const cogsAccount = account("5500") ?? account("6000");
    if (!sales || !outputVat || !inventory || !cogsAccount) throw new SourceCorrectionError(409, "الحسابات الافتراضية للبيع غير مكتملة.");
    return [
      { accountId: String(cashOrAr.id), debit: total, credit: 0 }, { accountId: String(sales.id), debit: 0, credit: net },
      { accountId: String(outputVat.id), debit: 0, credit: tax }, { accountId: String(cogsAccount.id), debit: cogs, credit: 0 },
      { accountId: String(inventory.id), debit: 0, credit: cogs },
    ];
  }
  if (type === "purchase") {
    const inventory = account("1300"); const inputVat = account("1400"); const settlement = account(data.paymentMethod === "credit" ? "2000" : "1000");
    if (!inventory || !inputVat || !settlement) throw new SourceCorrectionError(409, "الحسابات الافتراضية للشراء غير مكتملة.");
    return [{ accountId: String(inventory.id), debit: net, credit: 0 }, { accountId: String(inputVat.id), debit: tax, credit: 0 }, { accountId: String(settlement.id), debit: 0, credit: total }];
  }
  const expenseCategoryMap: Record<string, string> = {
    "إيجار": "5100",
    "رواتب": "5200",
    "مرافق": "5300",
    "كهرباء": "5300",
    "ماء": "5300",
    "تسويق": "5400",
    "إعلان": "5400",
    "نقل": "5500",
    "مواصلات": "5500",
    "صيانة": "5600",
    "مشتريات": "5000",
    "أخرى": "5900",
  };
  const expense = account(expenseCategoryMap[String(data.category ?? "")] ?? "5900") ?? account("5100"); const cash = account("1000");
  if (!expense || !cash) throw new SourceCorrectionError(409, "الحسابات الافتراضية للمصروف غير مكتملة.");
  return [{ accountId: String(expense.id), debit: total, credit: 0 }, { accountId: String(cash.id), debit: 0, credit: total }];
}

function sourceHasCredit(data: Record<string, unknown>, tableName: SourceTable): boolean {
  if (tableName === "invoices") return data.paymentMethod === "credit";
  if (tableName === "purchaseOrders") return data.paymentMethod === "credit" || asNumber(data.paid) < sourceAmount(data);
  return false;
}

function sourceParty(data: Record<string, unknown>, tableName: SourceTable): string {
  return String(tableName === "invoices"
    ? data.customerName ?? "عميل غير محدد"
    : tableName === "purchaseOrders"
      ? data.supplierName ?? "مورد غير محدد"
      : data.vendor ?? "غير محدد");
}

function sourceReference(data: Record<string, unknown>, tableName: SourceTable, id: number): string {
  return String(tableName === "invoices"
    ? data.number ?? data.invoiceNumber ?? `#${id}`
    : tableName === "purchaseOrders"
      ? data.orderNumber ?? data.number ?? `#${id}`
      : data.reference ?? data.description ?? `#${id}`);
}

export function calculateReport(accounts: AnyRecord[], journals: AnyRecord[], from: string, to: string) {
  const balances = new Map<string, number>();
  for (const account of accounts) balances.set(String(account.id), asNumber(account.openingBalance ?? account.balance));

  const postedToDate = journals.filter((journal) => journal.status === "posted" && asDate(journal.date) <= to);
  const postedInPeriod = postedToDate.filter((journal) => inPeriod(journal, from, to));
  const periodMovements = new Map<string, number>();
  for (const journal of postedToDate) {
    for (const line of normalizeLines(journal.lines)) {
      const account = accounts.find((item) => String(item.id) === line.accountId);
      if (!account) continue;
      const current = balances.get(line.accountId) ?? 0;
      const debitNormal = account.type === "asset" || account.type === "expense";
      balances.set(line.accountId, current + (debitNormal ? line.debit - line.credit : line.credit - line.debit));
    }
  }
  for (const journal of postedInPeriod) {
    for (const line of normalizeLines(journal.lines)) {
      const account = accounts.find((item) => String(item.id) === line.accountId);
      if (!account) continue;
      const debitNormal = account.type === "asset" || account.type === "expense";
      const current = periodMovements.get(line.accountId) ?? 0;
      periodMovements.set(line.accountId, current + (debitNormal ? line.debit - line.credit : line.credit - line.debit));
    }
  }

  const withBalances: Array<AnyRecord & { calculatedBalance: number }> = accounts.map((account) => {
    const balance = balances.get(String(account.id)) ?? 0;
    return { ...account, calculatedBalance: balance };
  });
  const total = (type: string) => withBalances
    .filter((account) => account.type === type && account.status !== "inactive")
    .reduce((sum, account) => sum + asNumber(account.calculatedBalance), 0);
  const movementFor = (type: string) => accounts
    .filter((account) => account.type === type && account.status !== "inactive")
    .reduce((sum, account) => sum + (periodMovements.get(String(account.id)) ?? 0), 0);
  const revenue = movementFor("revenue");
  const expense = movementFor("expense");
  const netIncome = revenue - expense;
  const assets = total("asset");
  const liabilities = total("liability");
  const baseEquity = total("equity");
  const unclosedEarnings = total("revenue") - total("expense");
  const equity = baseEquity + unclosedEarnings;
  const trialBalance = withBalances
    .filter((account) => account.status !== "inactive")
    .map((account) => {
      const balance = asNumber(account.calculatedBalance);
      const debitNormal = account.type === "asset" || account.type === "expense";
      const debit = debitNormal ? balance : -balance;
      const credit = debitNormal ? -balance : balance;
      return {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        debit: debit > 0 ? debit : 0,
        credit: credit > 0 ? credit : 0,
      };
    });

  return {
    period: { from, to },
    totals: { revenue, expense, netIncome, assets, liabilities, equity, trialDebit: trialBalance.reduce((s, a) => s + a.debit, 0), trialCredit: trialBalance.reduce((s, a) => s + a.credit, 0) },
    trialBalance,
    incomeStatement: {
      revenue: withBalances.filter((a) => a.type === "revenue" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: periodMovements.get(String(a.id)) ?? 0 })),
      expense: withBalances.filter((a) => a.type === "expense" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: periodMovements.get(String(a.id)) ?? 0 })),
      netIncome,
    },
    balanceSheet: {
      assets: withBalances.filter((a) => a.type === "asset" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: asNumber(a.calculatedBalance) })),
      liabilities: withBalances.filter((a) => a.type === "liability" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: asNumber(a.calculatedBalance) })),
      equity: withBalances.filter((a) => a.type === "equity" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: asNumber(a.calculatedBalance) })),
      baseEquity,
      unclosedEarnings,
      totalAssets: assets,
      totalLiabilitiesAndEquity: liabilities + equity,
    },
    journals: postedInPeriod.length,
  };
}

function derivePartyBalances(records: AnyRecord[], type: "receivable" | "payable", to: string) {
  return records
    .filter((record) => {
      if (record.status === "cancelled" || record.status === "canceled" || record.status === "voided" || record.status === "draft") return false;
      const transactionDate = asDate(record.date ?? record.issueDate ?? record.createdAt);
      return (record.type === type || (type === "receivable" && record.customerId) || (type === "payable" && record.supplierId))
        && (!transactionDate || transactionDate <= to);
    })
    .map((record) => {
      const amount = asNumber(record.amount ?? record.total ?? record.totalAmount);
      const paid = asNumber(record.paid ?? record.paidAmount ?? record.amountPaid);
      return {
        id: record.id,
        party: String(record.party ?? record.customerName ?? record.supplierName ?? "غير محدد"),
        type,
        reference: String(record.reference ?? record.invoiceNumber ?? record.number ?? `#${record.id}`),
        dueDate: asDate(record.dueDate ?? record.issueDate ?? record.date ?? record.createdAt),
        amount,
        paid: Math.min(amount, paid),
        remaining: Math.max(0, amount - paid),
        status: amount <= paid ? "paid" : paid > 0 ? "partial" : "unpaid",
      };
    });
}

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function paymentStatus(amount: number, paid: number): "unpaid" | "partial" | "paid" {
  return paid >= amount - 0.005 ? "paid" : paid > 0 ? "partial" : "unpaid";
}

function supplierPaymentFingerprint(value: unknown): string {
  const stable = (item: unknown): string => Array.isArray(item)
    ? `[${item.map(stable).join(",")}]`
    : item && typeof item === "object"
      ? `{${Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
        .join(",")}}`
      : JSON.stringify(item) ?? "null";
  return createHash("sha256").update(stable(value)).digest("hex");
}

type SupplierPaymentAllocation = { payableId: number; amount: number };

function supplierPaymentAllocations(data: Record<string, unknown>): SupplierPaymentAllocation[] {
  if (!Array.isArray(data.allocations)) return [];
  return data.allocations
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ payableId: Number(item.payableId), amount: money(Number(item.amount)) }))
    .filter((item) => Number.isInteger(item.payableId) && item.payableId > 0 && Number.isFinite(item.amount) && item.amount > 0)
    .sort((left, right) => left.payableId - right.payableId);
}

function reversedJournalLines(journal: Record<string, unknown>): Array<{ accountId: string; debit: number; credit: number }> {
  return normalizeLines(journal.lines).map((line) => ({
    accountId: line.accountId,
    debit: line.credit,
    credit: line.debit,
  }));
}

async function paymentOrderScope(
  auth: AuthContext,
  payment: ErpRecord,
  executor: DatabaseExecutor,
  lock = false,
): Promise<{ orders: Map<number, unknown>; allocations: SupplierPaymentAllocation[]; payables: Map<number, unknown> } | null> {
  const allocations = supplierPaymentAllocations(payment.data);
  if (!allocations.length || new Set(allocations.map((allocation) => allocation.payableId)).size !== allocations.length) return null;
  const payables = new Map<number, unknown>();
  for (const allocation of allocations) {
    const query = executor.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.id, allocation.payableId),
      eq(erpRecordsTable.organizationId, auth.organizationId),
      eq(erpRecordsTable.tableName, "receivables"),
    ));
    const [payable] = lock ? await query.for("update") : await query;
    if (!payable || payable.data.type !== "payable" || !payable.data.purchaseOrderId) return null;
    payables.set(payable.id, payable);
  }
  const orderIds = [...new Set([...payables.values()].map((payable) => Number((payable as ErpRecord).data.purchaseOrderId)))].sort((left, right) => left - right);
  const orders = new Map<number, unknown>();
  for (const orderId of orderIds) {
    const query = executor.select().from(erpRecordsTable).where(and(
      eq(erpRecordsTable.id, orderId),
      eq(erpRecordsTable.organizationId, auth.organizationId),
      eq(erpRecordsTable.tableName, "purchaseOrders"),
    ));
    const [order] = lock ? await query.for("update") : await query;
    if (!order || !isLocationAllowed(auth, "purchaseOrders", order.data, order.id)) return null;
    orders.set(orderId, order);
  }
  return { orders, allocations, payables };
}

function supplierPaymentOutput(
  payment: Record<string, unknown>,
  scope: { orders: Map<number, unknown>; allocations: SupplierPaymentAllocation[]; payables: Map<number, unknown> },
): Record<string, unknown> {
  return {
    ...payment,
    id: payment.id,
    allocations: scope.allocations.map((allocation) => {
      const payable = scope.payables.get(allocation.payableId);
      const payableData = payable && typeof payable === "object" && "data" in payable
        ? (payable as { data: Record<string, unknown> }).data
        : payable as Record<string, unknown> | undefined;
      const orderId = Number(payableData?.purchaseOrderId);
      const order = scope.orders.get(orderId);
      const orderData = order && typeof order === "object" && "data" in order
        ? (order as { data: Record<string, unknown> }).data
        : order as Record<string, unknown> | undefined;
      return {
        ...allocation,
        purchaseOrderId: Number.isInteger(orderId) ? orderId : undefined,
        purchaseOrderNumber: orderData?.orderNumber ?? orderData?.number ?? undefined,
        payableAmount: payableData?.amount,
        payablePaid: payableData?.paid,
        payableStatus: payableData?.status,
      };
    }),
  };
}

function accountBalanceAt(accountId: number, account: AnyRecord, journals: AnyRecord[], to: string): number {
  const opening = asNumber(account.openingBalance ?? account.balance);
  return money(opening + journals
    .filter((journal) => journal.status === "posted" && asDate(journal.date) <= to)
    .reduce((total, journal) => total + normalizeLines(journal.lines)
      .filter((line) => line.accountId === String(accountId))
      .reduce((sum, line) => sum + line.debit - line.credit, 0), 0));
}

function agingBucket(dueDate: string, asOf: string): "notDue" | "1-30" | "31-60" | "61-90" | "over90" {
  if (!dueDate || dueDate >= asOf) return "notDue";
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "over90";
}

function reconciliationLines(journal: AnyRecord, accountId: number): number {
  return money(normalizeLines(journal.lines).filter((line) => line.accountId === String(accountId))
    .reduce((sum, line) => sum + line.debit - line.credit, 0));
}

router.get("/accounting/summary", requireAuth, requireSubscriptionAccess, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const now = new Date();
  const from = typeof request.query.from === "string" ? request.query.from : `${now.getFullYear()}-01-01`;
  const to = typeof request.query.to === "string" ? request.query.to : now.toISOString().slice(0, 10);
  const [accounts, journals, receivables, invoices, expenses, purchases] = await Promise.all([
    recordsFor(auth, "accounts"),
    recordsFor(auth, "journalEntries"),
    recordsFor(auth, "receivables"),
    recordsFor(auth, "invoices"),
    recordsFor(auth, "expenses"),
    recordsFor(auth, "purchaseOrders"),
  ]);
  const report = calculateReport(accounts, journals, from, to);
  const sourceReceivables = receivables.length ? receivables : invoices;
  const sourcePayables = receivables.filter((r) => r.type === "payable").length ? receivables : purchases;
  const items = [
    ...derivePartyBalances(sourceReceivables, "receivable", to),
    ...derivePartyBalances(sourcePayables, "payable", to),
  ];
  const totalReceivables = items.filter((item) => item.type === "receivable").reduce((sum, item) => sum + item.remaining, 0);
  const totalPayables = items.filter((item) => item.type === "payable").reduce((sum, item) => sum + item.remaining, 0);
  response.json({
    ...report,
    totals: { ...report.totals, receivables: totalReceivables, payables: totalPayables },
    receivables: items,
    sourceCounts: { invoices: invoices.length, expenses: expenses.length, purchases: purchases.length },
  });
});

router.get("/accounting/closures", requireAuth, requireSubscriptionAccess, requireAccounting, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const closures = await recordsFor(auth, "financialClosures");
  response.json({ closures: closures.sort((left, right) => String(right.to).localeCompare(String(left.to)) || right.id - left.id) });
});

router.get("/accounting/fiscal-year", requireAuth, requireSubscriptionAccess, requireAccounting, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const [organization] = await db.select({
    fiscalYearClosed: organizationsTable.fiscalYearClosed,
    closedYear: organizationsTable.closedYear,
    closedAt: organizationsTable.closedAt,
    closedBy: organizationsTable.closedBy,
  }).from(organizationsTable).where(eq(organizationsTable.id, auth.organizationId)).limit(1);
  if (!organization) {
    response.status(404).json({ error: "المنظمة غير موجودة." });
    return;
  }
  const currentYear = new Date().getUTCFullYear();
  response.json({
    fiscalYearClosed: organization.fiscalYearClosed,
    closedYear: organization.closedYear,
    closedAt: organization.closedAt?.toISOString() ?? null,
    closedBy: organization.closedBy,
    currentYear,
    fiscalYearEnd: `${currentYear}-12-31`,
  });
});

router.post("/accounting/supplier-payments", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const operationId = request.get("Idempotency-Key")?.trim() ?? "";
  const body = request.body;
  if (!operationId || operationId.length > 180) {
    response.status(400).json({ error: "معرّف عملية سداد المورد مطلوب." });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات سداد المورد غير صحيحة." });
    return;
  }
  const input = body as Record<string, unknown>;
  const supplierId = input.supplierId == null || input.supplierId === "" ? undefined : Number(input.supplierId);
  const supplierName = typeof input.supplierName === "string" ? input.supplierName.trim() : "";
  const paymentDate = typeof input.paymentDate === "string" ? input.paymentDate : "";
  const paymentMethod = input.paymentMethod === "bank" ? "bank" : input.paymentMethod === "cash" ? "cash" : "";
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  const rawAllocations = Array.isArray(input.allocations) ? input.allocations : [];
  if ((supplierId !== undefined && (!Number.isInteger(supplierId) || supplierId <= 0)) || !supplierName || supplierName.length > 160) {
    response.status(400).json({ error: "حدد مورداً صالحاً للسداد." });
    return;
  }
  if (!isValidIsoDate(paymentDate) || !paymentMethod || reference.length > 200 || rawAllocations.length === 0 || rawAllocations.length > 100) {
    response.status(400).json({ error: "تحقق من تاريخ السداد وحسابه والذمم المحددة." });
    return;
  }
  const allocations: Array<{ payableId: number; amount: number }> = [];
  for (const raw of rawAllocations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      response.status(400).json({ error: "أحد توزيعات السداد غير صحيح." });
      return;
    }
    const allocation = raw as Record<string, unknown>;
    const payableId = Number(allocation.payableId);
    const amount = money(Number(allocation.amount));
    if (!Number.isInteger(payableId) || payableId <= 0 || !Number.isFinite(amount) || amount <= 0) {
      response.status(400).json({ error: "كل توزيع يحتاج ذمة ومبلغاً موجباً." });
      return;
    }
    allocations.push({ payableId, amount });
  }
  allocations.sort((left, right) => left.payableId - right.payableId);
  if (new Set(allocations.map((allocation) => allocation.payableId)).size !== allocations.length) {
    response.status(400).json({ error: "لا تكرر الذمة نفسها في عملية السداد." });
    return;
  }
  const total = money(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const requestFingerprint = supplierPaymentFingerprint({
    supplierId,
    supplierName,
    paymentDate,
    paymentMethod,
    reference,
    allocations,
  });

  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw lockedAccountingMutationError(response);
      }
      const [claimedOperation] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "supplierPaymentOperations",
        clientOperationId: operationId,
        data: { requestFingerprint, state: "pending" },
      }).onConflictDoNothing({
        target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId],
      }).returning();
      if (!claimedOperation) {
        const [replayed] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "supplierPaymentOperations"),
          eq(erpRecordsTable.clientOperationId, operationId),
        )).limit(1);
        if (!replayed || replayed.data.requestFingerprint !== requestFingerprint || replayed.data.state !== "completed" || !replayed.data.result) {
          throw new AccountingMutationError(409, "معرّف عملية السداد مستخدم لطلب مختلف.");
        }
        return { ...(replayed.data.result as Record<string, unknown>), replayed: true };
      }
      const closures = await organizationRecordsFor(currentAuth, "financialClosures", tx);
      if (closures.some((closure) => closure.status === "closed"
        && paymentDate >= String(closure.from ?? "") && paymentDate <= String(closure.to ?? ""))) {
        throw new AccountingMutationError(409, "الفترة المالية لتاريخ السداد مقفلة.");
      }
      if (supplierId !== undefined) {
        const [supplier] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, supplierId),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "suppliers"),
        )).for("update");
        if (!supplier || String(supplier.data.name ?? "").trim() !== supplierName) {
          throw new AccountingMutationError(404, "المورد غير متاح في هذه المنشأة.");
        }
      }

      const candidatePayables: ErpRecord[] = [];
      for (const requestedAllocation of allocations) {
        const [candidate] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, requestedAllocation.payableId),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "receivables"),
        )).limit(1);
        if (!candidate || candidate.data.type !== "payable" || !candidate.data.purchaseOrderId) {
          throw new AccountingMutationError(404, "إحدى ذمم المورد غير متاحة.");
        }
        candidatePayables.push(candidate);
      }
      const orderIds = [...new Set(candidatePayables.map((payable) => Number(payable.data.purchaseOrderId)))].sort((left, right) => left - right);
      const payables: ErpRecord[] = [];
      for (const requestedAllocation of allocations) {
        const [payable] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, requestedAllocation.payableId),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "receivables"),
        )).for("update");
        if (!payable || payable.data.type !== "payable" || !payable.data.purchaseOrderId || !payable.data.purchaseReceiptOperationId
          || payable.data.status === "cancelled") {
          throw new AccountingMutationError(404, "إحدى ذمم المورد غير متاحة.");
        }
        const receiptOperationId = Number(payable.data.purchaseReceiptOperationId);
        const [receiptOperation] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, receiptOperationId),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "purchaseReceiptOperations"),
        )).for("update");
        const receiptOutput = receiptOperation?.data.receipt && typeof receiptOperation.data.receipt === "object"
          ? receiptOperation.data.receipt as Record<string, unknown>
          : undefined;
        if (!Number.isInteger(receiptOperationId) || !receiptOperation
          || receiptOperation.data.state !== "completed"
          || Number(receiptOperation.data.purchaseOrderId) !== Number(payable.data.purchaseOrderId)
          || Number(receiptOutput?.payableId) !== payable.id) {
          throw new AccountingMutationError(409, "تعذر إثبات ارتباط الذمة باستلام أمر الشراء.");
        }
        const payableSupplierId = payable.data.supplierId == null ? undefined : Number(payable.data.supplierId);
        const payableSupplierName = String(payable.data.supplierName ?? payable.data.party ?? "").trim();
        if ((supplierId !== undefined && payableSupplierId !== undefined && payableSupplierId !== supplierId)
          || payableSupplierName !== supplierName) {
          throw new AccountingMutationError(409, "يجب أن تخص كل الذمم المورد المحدد نفسه.");
        }
        const amount = money(asNumber(payable.data.amount));
        const paid = money(asNumber(payable.data.paid));
        if (amount <= 0 || paid < 0 || paid > amount + 0.005 || requestedAllocation.amount > money(amount - paid) + 0.005) {
          throw new AccountingMutationError(409, "قيمة السداد تتجاوز الرصيد المتبقي لإحدى الذمم.");
        }
        payables.push(payable);
      }
      const orders = new Map<number, ErpRecord>();
      for (const orderId of orderIds) {
        const [order] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, orderId),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "purchaseOrders"),
        )).for("update");
        if (!order || order.data.status === "cancelled" || !isLocationAllowed(currentAuth, "purchaseOrders", order.data, order.id)) {
          throw new AccountingMutationError(403, "أحد أوامر الشراء خارج نطاق المواقع المسموح.");
        }
        orders.set(orderId, order);
      }

      const updatedPayables: Array<Record<string, unknown>> = [];
      for (const payable of payables) {
        const allocation = allocations.find((item) => item.payableId === payable.id)!;
        const amount = money(asNumber(payable.data.amount));
        const paid = money(asNumber(payable.data.paid) + allocation.amount);
        const [updated] = await tx.update(erpRecordsTable).set({
          data: { ...payable.data, paid, status: paymentStatus(amount, paid), lastPaymentDate: paymentDate },
          updatedAt: new Date(),
        }).where(eq(erpRecordsTable.id, payable.id)).returning();
        updatedPayables.push({ ...updated.data, id: updated.id });
      }

      const updatedOrders: Array<Record<string, unknown>> = [];
      for (const orderId of orderIds) {
        const order = orders.get(orderId)!;
        const orderPayables = (await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "receivables"),
          sql`${erpRecordsTable.data}->>'purchaseOrderId' = ${String(orderId)}`,
        )).for("update")).filter((payable) =>
          payable.data.type === "payable" && payable.data.purchaseReceiptOperationId && payable.data.status !== "cancelled");
        const payableTotal = money(orderPayables.reduce((sum, payable) => sum + asNumber(payable.data.amount), 0));
        const paid = money(orderPayables.reduce((sum, payable) => sum + asNumber(payable.data.paid), 0));
        const remaining = money(Math.max(0, payableTotal - paid));
        const [updated] = await tx.update(erpRecordsTable).set({
          data: { ...order.data, payableTotal, paid, remaining, paymentStatus: paymentStatus(payableTotal, paid), lastPaymentDate: paymentDate },
          updatedAt: new Date(),
        }).where(eq(erpRecordsTable.id, orderId)).returning();
        updatedOrders.push({ ...updated.data, id: updated.id });
      }

      const accounts = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "accounts"),
      )).for("update");
      const payableAccount = accounts.find((account) => String(account.data.code) === "2000" && account.data.status !== "inactive");
      const settlementCode = paymentMethod === "bank" ? "1100" : "1000";
      const settlementAccount = accounts.find((account) => String(account.data.code) === settlementCode && account.data.status !== "inactive");
      if (!payableAccount || !settlementAccount) {
        throw new AccountingMutationError(409, "حساب الموردين أو حساب السداد الافتراضي غير متاح.");
      }
      const [payment] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "supplierPayments",
        clientOperationId: operationId,
        data: {
          supplierId,
          supplierName,
          paymentDate,
          date: paymentDate,
          paymentMethod,
          reference,
          amount: total,
          allocations,
          purchaseOrderIds: orderIds,
          createdBy: currentAuth.id,
          createdAt: new Date().toISOString(),
        },
      }).returning();
      const [journal] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        data: {
          date: paymentDate,
          description: `سداد للمورد ${supplierName}${reference ? ` — ${reference}` : ""}`,
          status: "posted",
          sourceType: "supplier_payment",
          sourceId: payment.id,
          lines: [
            { accountId: String(payableAccount.id), debit: total, credit: 0 },
            { accountId: String(settlementAccount.id), debit: 0, credit: total },
          ],
        },
      }).returning();
      const paymentOutput = { ...payment.data, id: payment.id, journalId: journal.id };
      await tx.update(erpRecordsTable).set({
        data: { ...payment.data, journalId: journal.id },
        updatedAt: new Date(),
      }).where(eq(erpRecordsTable.id, payment.id));
      const output = { payment: paymentOutput, payables: updatedPayables, orders: updatedOrders };
      await tx.update(erpRecordsTable).set({
        data: { requestFingerprint, state: "completed", result: output },
        updatedAt: new Date(),
      }).where(eq(erpRecordsTable.id, claimedOperation.id));
      await tx.insert(teamAuditLogsTable).values({
        organizationId: currentAuth.organizationId,
        actorId: currentAuth.id,
        actorName: currentAuth.name || currentAuth.email,
        action: "supplier_payment_recorded",
        entity: String(payment.id),
        details: JSON.stringify({ supplierId: supplierId ?? null, supplierName, amount: total, payableIds: allocations.map((item) => item.payableId), orderIds, journalId: journal.id }),
      });
      return { ...output, replayed: false };
    });
    response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof AccountingMutationError) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
});

router.get("/accounting/supplier-payments", requireAuth, requireSubscriptionAccess, requireAccounting, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const [payments, payables, orders] = await Promise.all([
    organizationRecordsFor(auth, "supplierPayments"),
    organizationRecordsFor(auth, "receivables"),
    organizationRecordsFor(auth, "purchaseOrders"),
  ]);
  const payableById = new Map(payables.filter((record) => record.type === "payable").map((record) => [record.id, record]));
  const orderById = new Map(orders.map((record) => [record.id, record]));
  const visiblePayments = payments
    .map((payment) => {
      const allocations = supplierPaymentAllocations(payment);
      const linkedPayables = allocations.map((allocation) => payableById.get(allocation.payableId));
      const orderIds = [...new Set(linkedPayables.map((payable) => Number(payable?.purchaseOrderId)))];
      if (!allocations.length || linkedPayables.some((payable) => !payable) || orderIds.some((id) => {
        const order = orderById.get(id);
        return !order || !isLocationAllowed(auth, "purchaseOrders", order, order.id);
      })) return null;
      const scope = {
        allocations,
        payables: new Map(linkedPayables.filter((payable): payable is AnyRecord => Boolean(payable)).map((payable) => [payable.id, payable])),
        orders: new Map(orderIds.map((id) => [id, orderById.get(id)!])),
      };
      return supplierPaymentOutput(payment, scope);
    })
    .filter((payment): payment is Record<string, unknown> => Boolean(payment))
    .sort((left, right) => String(right.paymentDate ?? right.date ?? "").localeCompare(String(left.paymentDate ?? left.date ?? "")));
  response.json({ payments: visiblePayments });
});

router.post("/accounting/supplier-payments/:id/reverse", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const paymentId = Number(request.params.id);
  const operationId = request.get("Idempotency-Key")?.trim() ?? "";
  const body = request.body;
  if (!Number.isInteger(paymentId) || paymentId <= 0 || !operationId || operationId.length > 180) {
    response.status(400).json({ error: "معرّف الدفعة ومعرّف عملية العكس مطلوبان." });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات عكس دفعة المورد غير صحيحة." });
    return;
  }
  const input = body as Record<string, unknown>;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const effectiveDate = typeof input.effectiveDate === "string"
    ? input.effectiveDate.trim()
    : typeof input.reversalDate === "string"
      ? input.reversalDate.trim()
      : typeof input.date === "string"
        ? input.date.trim()
        : new Date().toISOString().slice(0, 10);
  if (reason.length < 3 || reason.length > 1000) {
    response.status(400).json({ error: "أدخل سبباً واضحاً من 3 إلى 1000 حرف لعكس الدفعة." });
    return;
  }
  if (!isValidIsoDate(effectiveDate)) {
    response.status(400).json({ error: "تاريخ عكس الدفعة غير صحيح." });
    return;
  }
  const requestFingerprint = supplierPaymentFingerprint({ paymentId, reason, effectiveDate });

  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw lockedAccountingMutationError(response);
      }
      const [payment] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, paymentId),
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "supplierPayments"),
      )).for("update");
      if (!payment) throw new AccountingMutationError(404, "دفعة المورد غير متاحة.");
      const scope = await paymentOrderScope(currentAuth, payment, tx, true);
      if (!scope) throw new AccountingMutationError(404, "دفعة المورد خارج نطاق المواقع المسموح.");

      const [replayedOperation] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "supplierPaymentReversalOperations"),
        eq(erpRecordsTable.clientOperationId, operationId),
      )).limit(1);
      if (replayedOperation) {
        if (replayedOperation.data.requestFingerprint !== requestFingerprint) {
          throw new AccountingMutationError(409, "معرّف عملية العكس مستخدم لطلب مختلف.");
        }
        if (replayedOperation.data.state !== "completed"
          || !replayedOperation.data.result
          || typeof replayedOperation.data.result !== "object"
          || Array.isArray(replayedOperation.data.result)) {
          throw new AccountingMutationError(409, "عملية العكس السابقة غير مكتملة وتحتاج مراجعة.");
        }
        return { ...(replayedOperation.data.result as Record<string, unknown>), replayed: true };
      }

      if (payment.data.status === "reversed" || payment.data.reversedAt) {
        throw new AccountingMutationError(409, "سبق عكس دفعة المورد.");
      }
      const paymentDate = asDate(payment.data.paymentDate ?? payment.data.date);
      if (!isValidIsoDate(paymentDate)) throw new AccountingMutationError(409, "تاريخ دفعة المورد الأصلي غير صالح.");
      const closures = await organizationRecordsFor(currentAuth, "financialClosures", tx);
      if (closures.some((closure) => closure.status === "closed"
        && effectiveDate >= String(closure.from ?? "") && effectiveDate <= String(closure.to ?? ""))) {
        throw new AccountingMutationError(409, "الفترة المالية المحددة مقفلة. اختر تاريخاً ضمن فترة مفتوحة.");
      }

      const [originalJournal] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "journalEntries"),
        sql`${erpRecordsTable.data}->>'sourceType' = 'supplier_payment'`,
        sql`${erpRecordsTable.data}->>'sourceId' = ${String(payment.id)}`,
      )).for("update");
      if (!originalJournal || originalJournal.data.status !== "posted") {
        throw new AccountingMutationError(409, "لا يوجد قيد مرحّل صالح مرتبط بدفعة المورد.");
      }
      const originalLines = normalizeLines(originalJournal.data.lines);
      const debitTotal = money(originalLines.reduce((sum, line) => sum + line.debit, 0));
      const creditTotal = money(originalLines.reduce((sum, line) => sum + line.credit, 0));
      if (debitTotal <= 0 || debitTotal !== creditTotal) {
        throw new AccountingMutationError(409, "قيد دفعة المورد الأصلي غير متوازن ولا يمكن عكسه.");
      }

      const activePayments = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "supplierPayments"),
      ));
      const paymentCreatedAt = String(payment.data.createdAt ?? "");
      const hasLaterSettlement = activePayments.some((other) => {
        if (other.id === payment.id || other.data.status === "reversed" || other.data.reversedAt) return false;
        const otherAllocations = supplierPaymentAllocations(other.data);
        const sharesPayable = otherAllocations.some((otherAllocation) =>
          scope.allocations.some((allocation) => allocation.payableId === otherAllocation.payableId));
        if (!sharesPayable) return false;
        const otherDate = asDate(other.data.paymentDate ?? other.data.date);
        const otherCreatedAt = String(other.data.createdAt ?? "");
        return otherDate > paymentDate
          || (otherDate === paymentDate && Boolean(paymentCreatedAt) && otherCreatedAt > paymentCreatedAt)
          || (!paymentCreatedAt && otherDate >= paymentDate);
      });
      if (hasLaterSettlement) {
        throw new AccountingMutationError(409, "لا يمكن عكس الدفعة لوجود تسوية لاحقة مرتبطة بإحدى ذممها.");
      }

      const updatedPayables: Array<Record<string, unknown>> = [];
      for (const allocation of scope.allocations) {
        const payable = scope.payables.get(allocation.payableId)! as ErpRecord;
        const amount = money(asNumber(payable.data.amount));
        const paid = money(asNumber(payable.data.paid));
        if (paid + 0.005 < allocation.amount) {
          throw new AccountingMutationError(409, "الرصيد الحالي لإحدى الذمم أقل من مبلغ الدفعة المراد عكسها.");
        }
        const nextPaid = money(Math.max(0, paid - allocation.amount));
        const [updated] = await tx.update(erpRecordsTable).set({
          data: { ...payable.data, paid: nextPaid, status: paymentStatus(amount, nextPaid), lastPaymentDate: undefined },
          updatedAt: new Date(),
        }).where(eq(erpRecordsTable.id, payable.id)).returning();
        updatedPayables.push({ ...updated.data, id: updated.id });
      }

      const updatedOrders: Array<Record<string, unknown>> = [];
      for (const [orderId, rawOrder] of scope.orders) {
        const order = rawOrder as ErpRecord;
        const orderPayables = (await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "receivables"),
          sql`${erpRecordsTable.data}->>'purchaseOrderId' = ${String(orderId)}`,
        )).for("update")).filter((payable) =>
          payable.data.type === "payable" && payable.data.purchaseReceiptOperationId && payable.data.status !== "cancelled");
        const payableTotal = money(orderPayables.reduce((sum, payable) => sum + asNumber(payable.data.amount), 0));
        const paid = money(orderPayables.reduce((sum, payable) => sum + asNumber(payable.data.paid), 0));
        const remaining = money(Math.max(0, payableTotal - paid));
        const [updated] = await tx.update(erpRecordsTable).set({
          data: { ...order.data, payableTotal, paid, remaining, paymentStatus: paymentStatus(payableTotal, paid), lastPaymentDate: effectiveDate },
          updatedAt: new Date(),
        }).where(eq(erpRecordsTable.id, orderId)).returning();
        updatedOrders.push({ ...updated.data, id: updated.id });
      }

      const [reversal] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        data: {
          date: effectiveDate,
          description: `عكس سداد المورد ${String(payment.data.supplierName ?? "")}${payment.data.reference ? ` — ${String(payment.data.reference)}` : ""}`,
          status: "posted",
          sourceType: "supplier_payment_reversal",
          sourceId: payment.id,
          adjustsJournalId: originalJournal.id,
          adjustmentType: "reversal",
          adjustmentReason: reason,
          lines: reversedJournalLines({ ...originalJournal.data, lines: originalLines }),
        },
      }).returning();
      const paymentData = {
        ...payment.data,
        status: "reversed",
        reversedAt: new Date().toISOString(),
        reversedBy: currentAuth.id,
        reversalReason: reason,
        reversalDate: effectiveDate,
        reversalJournalId: reversal.id,
      };
      await tx.update(erpRecordsTable).set({ data: paymentData, updatedAt: new Date() }).where(eq(erpRecordsTable.id, payment.id));
      const output = {
          payment: { ...paymentData, id: payment.id },
        reversal: { ...reversal.data, id: reversal.id },
        payables: updatedPayables,
        orders: updatedOrders,
      };
      await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "supplierPaymentReversalOperations",
        clientOperationId: operationId,
        data: {
          requestFingerprint,
          state: "completed",
          paymentId: payment.id,
          originalJournalId: originalJournal.id,
          reversalJournalId: reversal.id,
          reason,
          effectiveDate,
          result: output,
          actorId: currentAuth.id,
          occurredAt: new Date().toISOString(),
        },
      });
      await tx.insert(teamAuditLogsTable).values({
        organizationId: currentAuth.organizationId,
        actorId: currentAuth.id,
        actorName: currentAuth.name || currentAuth.email,
        action: "supplier_payment_reversed",
        entity: String(payment.id),
        details: JSON.stringify({
          paymentId: payment.id,
          amount: payment.data.amount,
          payableIds: scope.allocations.map((allocation) => allocation.payableId),
          orderIds: [...scope.orders.keys()],
          originalJournalId: originalJournal.id,
          reversalJournalId: reversal.id,
          reason,
        }),
      });
      return { ...output, replayed: false };
    });
    response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof AccountingMutationError) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
});

router.get("/accounting/ledger", requireAuth, requireSubscriptionAccess, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const accountId = typeof request.query.accountId === "string" ? request.query.accountId.trim() : "";
  const from = typeof request.query.from === "string" ? request.query.from.trim() : "";
  const to = typeof request.query.to === "string" ? request.query.to.trim() : "";

  if (!/^\d+$/.test(accountId) || !isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    response.status(400).json({ error: "يجب تحديد حساب وفترة صحيحة." });
    return;
  }

  const auth = response.locals.auth as AuthContext;
  const [accounts, journals] = await Promise.all([
    recordsFor(auth, "accounts"),
    recordsFor(auth, "journalEntries"),
  ]);
  const selectedAccount = accounts.find((account) => String(account.id) === accountId);
  if (!selectedAccount || selectedAccount.status === "inactive") {
    response.status(404).json({ error: "الحساب غير موجود أو غير نشط." });
    return;
  }

  const report = buildLedgerReport(accounts, journals, accountId, from, to);
  if (!report) {
    response.status(404).json({ error: "تعذر العثور على الحساب المطلوب." });
    return;
  }
  response.json(report);
});

router.post("/accounting/opening-balances", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  if (auth.roleId !== "owner" && auth.locationScope !== "all") {
    response.status(403).json({ error: "الأرصدة الافتتاحية الشاملة متاحة للمالك أو للمحاسب المخوّل بجميع المواقع فقط." });
    return;
  }
  const body = request.body as Record<string, unknown>;
  const accountId = Number(body.accountId);
  const counterAccountId = Number(body.counterAccountId);
  const amount = asNumber(body.amount);
  const side = body.side === "credit" ? "credit" : body.side === "debit" ? "debit" : "";
  const date = typeof body.date === "string" ? body.date : "";
  const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
  const mode = body.mode === "correction" ? "correction" : "create";
  if (!Number.isInteger(accountId) || !Number.isInteger(counterAccountId) || accountId === counterAccountId || amount <= 0 || !side || !isValidIsoDate(date) || !operationId) {
    response.status(400).json({ error: "أدخل حساباً وحساباً مقابلاً ومبلغاً وتاريخاً صحيحاً." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) throw lockedAccountingMutationError(response);
      const accounts = await organizationRecordsFor(currentAuth, "accounts", tx);
      const target = accounts.find((item) => item.id === accountId);
      const counter = accounts.find((item) => item.id === counterAccountId);
      if (!target || !counter || target.status !== "active" || counter.status !== "active") {
        throw new AccountingMutationError(404, "الحساب أو الحساب المقابل غير موجود أو موقوف.");
      }
      if (accounts.some((item) => Number(item.parent) === accountId) || accounts.some((item) => Number(item.parent) === counterAccountId)) {
        throw new AccountingMutationError(409, "يجب تسجيل الرصيد الافتتاحي على حسابات تفصيلية بلا فروع.");
      }
      const closures = await organizationRecordsFor(currentAuth, "financialClosures", tx);
      if (closures.some((item) => item.status === "closed" && date >= String(item.from) && date <= String(item.to))) {
        throw new AccountingMutationError(409, "تاريخ الرصيد الافتتاحي يقع في فترة مقفلة.");
      }
      const journals = await organizationRecordsFor(currentAuth, "journalEntries", tx);
      const replay = journals.find((item) => ["opening_balance", "opening_balance_correction"].includes(String(item.sourceType)) && item.operationId === operationId);
      if (replay) return { journal: replay, replayed: true };
      const prior = journals.find((item) => item.sourceType === "opening_balance" && Number(item.sourceId) === accountId);
      if (prior && mode !== "correction") throw new AccountingMutationError(409, "سُجل رصيد افتتاحي لهذا الحساب مسبقاً. استخدم قيد تصحيح مستقل.");
      if (!prior && mode === "correction") throw new AccountingMutationError(409, "لا يوجد رصيد افتتاحي سابق لتصحيحه.");
      const desiredNet = side === "debit" ? amount : -amount;
      const currentNet = journals
        .filter((item) => ["opening_balance", "opening_balance_correction"].includes(String(item.sourceType)) && Number(item.sourceId) === accountId)
        .flatMap((item) => normalizeLines(item.lines))
        .filter((line) => line.accountId === String(accountId))
        .reduce((sum, line) => sum + line.debit - line.credit, 0);
      const movement = mode === "correction" ? money(desiredNet - currentNet) : desiredNet;
      if (movement === 0) throw new AccountingMutationError(409, "الرصيد المدخل يطابق الرصيد الافتتاحي الحالي ولا يحتاج تصحيحاً.");
      const number = `OPEN-${String(journals.length + 1).padStart(4, "0")}`;
      const [created] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        clientOperationId: operationId,
        data: {
          number, date, description: `${mode === "correction" ? "تصحيح رصيد افتتاحي" : "رصيد افتتاحي"} — ${String(target.name)}`, status: "posted",
          sourceType: mode === "correction" ? "opening_balance_correction" : "opening_balance", sourceId: String(accountId), operationId,
          lines: [
            { id: crypto.randomUUID(), accountId: String(accountId), debit: movement > 0 ? Math.abs(movement) : 0, credit: movement < 0 ? Math.abs(movement) : 0 },
            { id: crypto.randomUUID(), accountId: String(counterAccountId), debit: movement < 0 ? Math.abs(movement) : 0, credit: movement > 0 ? Math.abs(movement) : 0 },
          ],
        },
      }).returning();
      return { journal: { ...created.data, id: created.id }, replayed: false };
    });
    response.status(result.replayed ? 200 : 201).json({ journal: result.journal });
  } catch (error) {
    if (error instanceof AccountingMutationError) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
});

router.get("/accounting/aging", requireAuth, requireSubscriptionAccess, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const asOf = typeof request.query.asOf === "string" ? request.query.asOf : new Date().toISOString().slice(0, 10);
  const type = request.query.type === "payable" ? "payable" : request.query.type === "receivable" ? "receivable" : "all";
  if (!isValidIsoDate(asOf)) {
    response.status(400).json({ error: "تاريخ المرجع غير صحيح." });
    return;
  }
  const auth = response.locals.auth as AuthContext;
  const [receivables, invoices, purchases] = await Promise.all([
    recordsFor(auth, "receivables"), recordsFor(auth, "invoices"), recordsFor(auth, "purchaseOrders"),
  ]);
  // Only a receivable/payable of the matching kind suppresses its source document.
  // A supplier payable must never hide an unrelated customer invoice (and vice versa).
  const receivableInvoiceIds = new Set(receivables
    .filter((record) => record.type === "receivable")
    .map((record) => Number(record.invoiceId)).filter(Number.isInteger));
  const payablePurchaseIds = new Set(receivables
    .filter((record) => record.type === "payable")
    .map((record) => Number(record.purchaseId ?? record.purchaseOrderId)).filter(Number.isInteger));
  const sourceReceivables = [
    ...receivables.filter((record) => record.type === "receivable"),
    ...invoices.filter((record) => !receivableInvoiceIds.has(record.id)
      && record.paymentMethod !== "cash"
      && (Boolean(record.customerId) || sourceHasCredit(record, "invoices"))
      && asNumber(record.paid) < sourceAmount(record)),
  ];
  const sourcePayables = [
    ...receivables.filter((record) => record.type === "payable"),
    ...purchases.filter((record) => !payablePurchaseIds.has(record.id)
      && record.paymentMethod !== "cash"
      && (Boolean(record.supplierId) || record.paymentMethod === "credit")
      && asNumber(record.paid) < sourceAmount(record)),
  ];
  const items = [
    ...derivePartyBalances(sourceReceivables, "receivable", asOf),
    ...derivePartyBalances(sourcePayables, "payable", asOf),
  ].filter((item) => item.remaining > 0 && (type === "all" || item.type === type))
    .map((item) => ({ ...item, bucket: agingBucket(item.dueDate, asOf) }));
  const buckets = ["notDue", "1-30", "31-60", "61-90", "over90"] as const;
  const totals = Object.fromEntries(buckets.map((bucket) => [bucket, money(items
    .filter((item) => item.bucket === bucket).reduce((sum, item) => sum + item.remaining, 0))]));
  response.json({ asOf, type, items, totals, total: money(items.reduce((sum, item) => sum + item.remaining, 0)) });
});

router.get("/accounting/reconciliations", requireAuth, requireSubscriptionAccess, requireAccounting, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const sessions = await recordsFor(auth, "bankReconciliationSessions");
  response.json({ sessions: sessions.sort((left, right) => String(right.statementDate).localeCompare(String(left.statementDate)) || right.id - left.id) });
});

router.get("/accounting/reconciliations/:id", requireAuth, requireSubscriptionAccess, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const sessionId = Number(request.params.id);
  const from = typeof request.query.from === "string" ? request.query.from : "";
  if (!Number.isInteger(sessionId) || (from && !isValidIsoDate(from))) {
    response.status(400).json({ error: "معرّف الجلسة أو بداية الفترة غير صحيحة." }); return;
  }
  const auth = response.locals.auth as AuthContext;
  const sessions = await recordsFor(auth, "bankReconciliationSessions");
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) { response.status(404).json({ error: "جلسة التسوية غير متاحة." }); return; }
  const [lines, journals, accounts] = await Promise.all([
    organizationRecordsFor(auth, "bankStatementLines"),
    recordsFor(auth, "journalEntries"),
    recordsFor(auth, "accounts"),
  ]);
  const to = String(session.statementDate);
  const sessionLines = lines.filter((line) => Number(line.sessionId) === sessionId);
  const matchedStatementLineByJournal = new Map(sessionLines
    .filter((line) => line.status === "matched" && Number.isInteger(Number(line.journalId)))
    .map((line) => [Number(line.journalId), line.id]));
  const movements = journals.filter((journal) => journal.status === "posted" && asDate(journal.date) <= to
    && (!from || asDate(journal.date) >= from) && reconciliationLines(journal, Number(session.accountId)) !== 0)
    .map((journal) => ({ id: journal.id, date: asDate(journal.date), reference: String(journal.reference ?? journal.number ?? ""), description: String(journal.description ?? ""), amount: reconciliationLines(journal, Number(session.accountId)), matchedStatementLineId: matchedStatementLineByJournal.get(journal.id) ?? null }));
  const account = accounts.find((item) => item.id === Number(session.accountId));
  const bookBalance = account ? accountBalanceAt(account.id, account, journals, to) : null;
  response.json({ session, statementLines: sessionLines, ledgerMovements: movements, bookBalance, period: { from: from || null, to } });
});

router.post("/accounting/reconciliations", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const body = request.body as Record<string, unknown>;
  const accountId = Number(body?.accountId);
  const statementDate = typeof body?.statementDate === "string" ? body.statementDate : "";
  const statementBalance = Number(body?.statementBalance);
  const operationId = request.get("Idempotency-Key")?.trim() ?? "";
  const rawLines = Array.isArray(body?.lines) ? body.lines : [];
  if (!Number.isInteger(accountId) || !isValidIsoDate(statementDate) || !Number.isFinite(statementBalance)
    || !operationId || operationId.length > 180 || rawLines.some((line) => !line || typeof line !== "object" || !isValidIsoDate(String((line as Record<string, unknown>).date ?? "")) || !Number.isFinite(Number((line as Record<string, unknown>).amount)) || !String((line as Record<string, unknown>).description ?? "").trim())) {
    response.status(400).json({ error: "بيانات جلسة التسوية أو أسطر الكشف غير صحيحة." });
    return;
  }
  if (auth.roleId !== "owner" && auth.locationScope !== "all" && !Number.isInteger(Number(body.warehouseId))) {
    response.status(403).json({ error: "جلسة التسوية ضمن نطاق مواقع محددة تتطلب warehouseId." });
    return;
  }
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ accountId, statementDate, statementBalance, lines: rawLines, warehouseId: body.warehouseId })).digest("hex");
  try {
    const result = await db.transaction(async (tx) => {
      // This locks the organization row before any reconciliation write, so concurrent
      // idempotent creates serialize with subscription/data-generation changes.
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) throw lockedAccountingMutationError(response);
      const accounts = await recordsFor(currentAuth, "accounts", tx);
      const account = accounts.find((item) => item.id === accountId && ["1000", "1100"].includes(String(item.code)) && item.status !== "inactive");
      if (!account) throw new AccountingMutationError(400, "يلزم اختيار حساب الصندوق 1000 أو البنك 1100 النشط.");
      if ((currentAuth.roleId !== "owner" && currentAuth.locationScope !== "all" && !Number.isInteger(Number(body.warehouseId))) || !isLocationAllowed(currentAuth, "bankReconciliationSessions", body)) throw new AccountingMutationError(403, "ليس لديك صلاحية للمواقع المحددة.");
      const [existing] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "bankReconciliationSessions"), eq(erpRecordsTable.clientOperationId, operationId))).limit(1);
      if (existing) {
        if (existing.data.requestFingerprint !== requestFingerprint) throw new AccountingMutationError(409, "معرّف العملية مستخدم لطلب مختلف.");
        return { session: { ...existing.data, id: existing.id }, replayed: true };
      }
      const sessionData = { accountId, accountCode: String(account.code), statementDate, statementBalance: money(statementBalance), status: "open", createdBy: currentAuth.id, requestFingerprint, ...(body.warehouseId != null ? { warehouseId: body.warehouseId } : {}) };
      const [session] = await tx.insert(erpRecordsTable).values({ organizationId: currentAuth.organizationId, tableName: "bankReconciliationSessions", clientOperationId: operationId, data: sessionData }).returning();
      const insertedLines = rawLines.length ? await tx.insert(erpRecordsTable).values(rawLines.map((raw, index) => {
        const line = raw as Record<string, unknown>;
        return { organizationId: currentAuth.organizationId, tableName: "bankStatementLines", data: { sessionId: session.id, date: String(line.date), amount: money(Number(line.amount)), description: String(line.description).trim(), reference: typeof line.reference === "string" ? line.reference : "", sequence: index, status: "unmatched" } };
      })).returning() : [];
      await tx.insert(teamAuditLogsTable).values({ organizationId: currentAuth.organizationId, actorId: currentAuth.id, actorName: currentAuth.name || currentAuth.email, action: "reconciliation_created", entity: String(session.id), details: `حساب ${account.code}` });
      return { session: { ...sessionData, id: session.id }, lines: insertedLines.map((line) => ({ ...line.data, id: line.id })), replayed: false };
    });
    response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof AccountingMutationError) { response.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/accounting/reconciliations/:id/auto-match", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const sessionId = Number(request.params.id);
  if (!Number.isInteger(sessionId)) { response.status(400).json({ error: "معرّف جلسة التسوية غير صالح." }); return; }
  const auth = response.locals.auth as AuthContext;
  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) throw lockedAccountingMutationError(response);
      const [session] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, sessionId), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "bankReconciliationSessions"))).for("update");
      if (!session || !isLocationAllowed(currentAuth, session.tableName, session.data, session.id)) throw new AccountingMutationError(404, "جلسة التسوية غير متاحة.");
      if (session.data.status !== "open") throw new AccountingMutationError(409, "لا يمكن مطابقة جلسة معتمدة.");
      const accountId = Number(session.data.accountId);
      const lines = await organizationRecordsFor(currentAuth, "bankStatementLines", tx);
      const journals = await recordsFor(currentAuth, "journalEntries", tx);
      const sessionLines = lines.filter((item) => Number(item.sessionId) === sessionId);
      const usedJournalIds = new Set(lines.filter((item) => item.status === "matched").map((item) => Number(item.journalId)));
      let count = 0;
      const outcomes: Array<{ statementLineId: number; status: "matched" | "unmatched"; reason: string; journalId?: number }> = [];
      for (const line of sessionLines.filter((item) => item.status === "unmatched")) {
        const lineDate = asDate(line.date);
        const reference = typeof line.reference === "string" ? line.reference.trim() : "";
        const candidates = journals.filter((journal) => {
          const journalDate = asDate(journal.date);
          const dateDistance = Math.abs(Date.parse(`${journalDate}T00:00:00Z`) - Date.parse(`${lineDate}T00:00:00Z`)) / 86_400_000;
          const journalReference = String(journal.reference ?? journal.number ?? "").trim();
          return journal.status === "posted" && journalDate <= String(session.data.statementDate) && !usedJournalIds.has(journal.id)
            && dateDistance <= 3 && reconciliationLines(journal, accountId) === money(asNumber(line.amount))
            && (!reference || reference === journalReference);
        });
        if (candidates.length === 1) {
          await tx.update(erpRecordsTable).set({ data: { ...line, status: "matched", journalId: candidates[0].id, matchMethod: "automatic", matchReason: "تطابق المبلغ والتاريخ والمرجع عند توفره.", matchedBy: currentAuth.id, matchedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(erpRecordsTable.id, line.id));
          usedJournalIds.add(candidates[0].id);
          outcomes.push({ statementLineId: line.id, status: "matched", journalId: candidates[0].id, reason: "تطابق المبلغ والتاريخ والمرجع عند توفره." });
          count += 1;
        } else {
          const reason = candidates.length === 0
            ? "لا يوجد قيد مرحّل غير مستخدم يطابق المبلغ والتاريخ ضمن نافذة ثلاثة أيام والمرجع عند توفره."
            : "يوجد أكثر من قيد مطابق؛ يلزم اختيار يدوي.";
          await tx.update(erpRecordsTable).set({ data: { ...line, autoMatchReason: reason }, updatedAt: new Date() }).where(eq(erpRecordsTable.id, line.id));
          outcomes.push({ statementLineId: line.id, status: "unmatched", reason });
        }
      }
      return { matched: count, outcomes };
    });
    response.json(result);
  } catch (error) {
    if (error instanceof AccountingMutationError) { response.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/accounting/reconciliations/:id/matches", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const sessionId = Number(request.params.id);
  const body = request.body as Record<string, unknown>;
  const lineId = Number(body?.statementLineId);
  const journalId = Number(body?.journalId);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!Number.isInteger(sessionId) || !Number.isInteger(lineId) || !Number.isInteger(journalId) || !reason || reason.length > 500) {
    response.status(400).json({ error: "تتطلب المطابقة اليدوية سطر كشف وقيداً وسبباً واضحاً." }); return;
  }
  const auth = response.locals.auth as AuthContext;
  try {
    await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) throw lockedAccountingMutationError(response);
      const [session, line, journal] = await Promise.all([
        tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, sessionId), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "bankReconciliationSessions"))).for("update").then((rows) => rows[0]),
        tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, lineId), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "bankStatementLines"))).for("update").then((rows) => rows[0]),
        tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, journalId), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "journalEntries"))).for("update").then((rows) => rows[0]),
      ]);
      const journalDate = journal ? asDate(journal.data.date) : "";
      const journalAmount = journal ? reconciliationLines({ ...journal.data, id: journal.id }, Number(session?.data.accountId)) : 0;
      if (!session || !line || !journal || Number(line.data.sessionId) !== sessionId || session.data.status !== "open" || journal.data.status !== "posted" || !isValidIsoDate(journalDate) || journalDate > String(session.data.statementDate) || money(journalAmount) !== money(asNumber(line.data.amount)) || !isLocationAllowed(currentAuth, session.tableName, session.data, session.id)) throw new AccountingMutationError(409, "يجب أن يطابق القيد المرحّل مبلغ وإشارة سطر الكشف وألا يتجاوز تاريخ الكشف.");
      const [allLines, visibleJournals] = await Promise.all([
        organizationRecordsFor(currentAuth, "bankStatementLines", tx),
        recordsFor(currentAuth, "journalEntries", tx),
      ]);
      if (!visibleJournals.some((candidate) => candidate.id === journalId)) throw new AccountingMutationError(404, "القيد غير متاح ضمن نطاق المواقع.");
      if (line.data.status === "matched") throw new AccountingMutationError(409, "سطر الكشف مطابق مسبقاً ولا يمكن مطابقته مرة أخرى.");
      if (allLines.some((candidate) => candidate.id !== lineId && candidate.status === "matched" && Number(candidate.journalId) === journalId)) {
        throw new AccountingMutationError(409, "القيد مستخدم بالفعل في سطر كشف آخر.");
      }
      await tx.update(erpRecordsTable).set({ data: { ...line.data, status: "matched", journalId, matchMethod: "manual", manualReason: reason, matchedBy: currentAuth.id, matchedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(erpRecordsTable.id, lineId));
      await tx.insert(teamAuditLogsTable).values({ organizationId: currentAuth.organizationId, actorId: currentAuth.id, actorName: currentAuth.name || currentAuth.email, action: "reconciliation_manual_match", entity: String(sessionId), details: reason });
    });
    response.status(201).json({ sessionId, statementLineId: lineId, journalId, matchMethod: "manual", reason });
  } catch (error) {
    if (error instanceof AccountingMutationError) { response.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/accounting/reconciliations/:id/approve", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const sessionId = Number(request.params.id);
  if (!Number.isInteger(sessionId)) { response.status(400).json({ error: "معرّف جلسة التسوية غير صالح." }); return; }
  const auth = response.locals.auth as AuthContext;
  try {
    const approved = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) throw lockedAccountingMutationError(response);
      const [session] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, sessionId), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "bankReconciliationSessions"))).for("update");
      if (!session || !isLocationAllowed(currentAuth, session.tableName, session.data, session.id)) throw new AccountingMutationError(404, "جلسة التسوية غير متاحة.");
      if (session.data.status === "approved") return { ...session.data, id: session.id };
      const accountId = Number(session.data.accountId);
      const [accounts, journals, lines] = await Promise.all([recordsFor(currentAuth, "accounts", tx), recordsFor(currentAuth, "journalEntries", tx), organizationRecordsFor(currentAuth, "bankStatementLines", tx)]);
      const account = accounts.find((item) => item.id === accountId);
      if (!account) throw new AccountingMutationError(409, "حساب التسوية لم يعد متاحاً.");
      const unmatchedLines = lines.filter((line) => Number(line.sessionId) === sessionId && line.status !== "matched");
      if (unmatchedLines.length > 0) throw new AccountingMutationError(409, "لا يمكن اعتماد جلسة تسوية تحتوي أسطر كشف غير مطابقة.");
      const statementBalance = money(asNumber(session.data.statementBalance));
      const bookBalance = accountBalanceAt(accountId, account, journals, String(session.data.statementDate));
      const outstandingStatementAmount = money(unmatchedLines.reduce((sum, line) => sum + asNumber(line.amount), 0));
      const difference = money(statementBalance - bookBalance);
      if (Math.abs(difference) > 0.005) {
        throw new AccountingMutationError(409, "لا يمكن اعتماد الجلسة مع فرق غير مسوّى؛ سجّل قيد تسوية صريحاً ثم طابق سطر الكشف الخاص به.");
      }
      const data = { ...session.data, status: "approved", approvedAt: new Date().toISOString(), approvedBy: currentAuth.id, statementBalance, bookBalance, difference, outstandingStatementAmount };
      await tx.update(erpRecordsTable).set({ data, updatedAt: new Date() }).where(eq(erpRecordsTable.id, sessionId));
      await tx.insert(teamAuditLogsTable).values({ organizationId: currentAuth.organizationId, actorId: currentAuth.id, actorName: currentAuth.name || currentAuth.email, action: "reconciliation_approved", entity: String(sessionId), details: `كشف ${statementBalance}، دفاتر ${bookBalance}، فرق ${difference}` });
      return { ...data, id: sessionId };
    });
    response.json({ session: approved });
  } catch (error) {
    if (error instanceof AccountingMutationError) { response.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/accounting/reconciliations/:id/adjustments", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const sessionId = Number(request.params.id);
  const body = request.body as Record<string, unknown>;
  const type = body?.type;
  const amount = Number(body?.amount);
  const date = typeof body?.date === "string" ? body.date : "";
  const offsetAccountId = Number(body?.offsetAccountId);
  const operationId = request.get("Idempotency-Key")?.trim() ?? "";
  if (!Number.isInteger(sessionId) || !["bankFee", "interest", "cashVariance"].includes(String(type)) || !Number.isFinite(amount) || amount === 0 || !Number.isInteger(offsetAccountId) || !isValidIsoDate(date) || !operationId || operationId.length > 180) {
    response.status(400).json({ error: "بيانات قيد التسوية غير صحيحة." }); return;
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ sessionId, type, amount, date, offsetAccountId })).digest("hex");
  const auth = response.locals.auth as AuthContext;
  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) throw lockedAccountingMutationError(response);
      const [event] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "reconciliationAdjustmentEvents"), eq(erpRecordsTable.clientOperationId, operationId))).limit(1);
      if (event) {
        if (event.data.fingerprint !== fingerprint) throw new AccountingMutationError(409, "معرّف العملية مستخدم لطلب مختلف.");
        return { journalId: Number(event.data.journalId), replayed: true };
      }
      const [session] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, sessionId), eq(erpRecordsTable.organizationId, currentAuth.organizationId), eq(erpRecordsTable.tableName, "bankReconciliationSessions"))).for("update");
      if (!session || !isLocationAllowed(currentAuth, session.tableName, session.data, session.id)) throw new AccountingMutationError(404, "جلسة التسوية غير متاحة.");
      if (session.data.status !== "open") throw new AccountingMutationError(409, "لا يمكن إضافة قيد إلى جلسة معتمدة.");
      const closures = await organizationRecordsFor(currentAuth, "financialClosures", tx);
      if (closures.some((closure) => closure.status === "closed" && date >= String(closure.from) && date <= String(closure.to))) throw new AccountingMutationError(409, "الفترة المالية مقفلة ولا يمكن إنشاء قيد تسوية فيها.");
      const accounts = await recordsFor(currentAuth, "accounts", tx);
      const settlement = accounts.find((account) => account.id === Number(session.data.accountId));
      const offset = accounts.find((account) => account.id === offsetAccountId && account.status !== "inactive");
      if (!settlement || !offset || settlement.id === offset.id) throw new AccountingMutationError(409, "حساب التسوية أو الحساب المقابل غير صالح.");
      const absolute = money(Math.abs(amount));
      const debitSettlement = type === "interest" || (type === "cashVariance" && amount > 0);
      const lines = debitSettlement
        ? [{ accountId: String(settlement.id), debit: absolute, credit: 0 }, { accountId: String(offset.id), debit: 0, credit: absolute }]
        : [{ accountId: String(offset.id), debit: absolute, credit: 0 }, { accountId: String(settlement.id), debit: 0, credit: absolute }];
      const labels: Record<string, string> = { bankFee: "رسوم بنكية", interest: "فائدة بنكية", cashVariance: "فرق جرد الصندوق" };
      const [journal] = await tx.insert(erpRecordsTable).values({ organizationId: currentAuth.organizationId, tableName: "journalEntries", clientOperationId: `RECON-ADJ-${operationId}`, data: { number: `RECON-${sessionId}-${operationId.slice(0, 16)}`, date, description: labels[String(type)], status: "posted", reconciliationSessionId: sessionId, adjustmentType: type, lines, ...(session.data.warehouseId != null ? { warehouseId: session.data.warehouseId } : {}) } }).returning();
      await tx.insert(erpRecordsTable).values({ organizationId: currentAuth.organizationId, tableName: "reconciliationAdjustmentEvents", clientOperationId: operationId, data: { sessionId, journalId: journal.id, fingerprint, type, amount, actorId: currentAuth.id } });
      await tx.insert(teamAuditLogsTable).values({ organizationId: currentAuth.organizationId, actorId: currentAuth.id, actorName: currentAuth.name || currentAuth.email, action: "reconciliation_adjustment_created", entity: String(sessionId), details: `${String(type)}: ${amount}` });
      return { journalId: journal.id, journal: { ...journal.data, id: journal.id }, replayed: false };
    });
    response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof AccountingMutationError) { response.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/accounting/journals/:id/:action", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const journalId = Number(request.params.id);
  const action = String(request.params.action ?? "") as JournalAdjustmentAction;
  const operationId = request.get("Idempotency-Key")?.trim() ?? "";
  const body = request.body;
  if (!Number.isInteger(journalId) || journalId <= 0 || (action !== "reverse" && action !== "correct")) {
    response.status(400).json({ error: "طلب عكس أو تصحيح القيد غير صالح." });
    return;
  }
  if (!operationId || operationId.length > 180) {
    response.status(400).json({ error: "معرّف عملية العكس أو التصحيح مطلوب." });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات العكس أو التصحيح غير صحيحة." });
    return;
  }
  const requestBody = body as Record<string, unknown>;
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify({ action, journalId, body: requestBody }))
    .digest("hex");

  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw lockedAccountingMutationError(response);
      }

      const visibleJournals = await recordsFor(currentAuth, "journalEntries", tx);
      const visibleOriginal = visibleJournals.find((journal) => journal.id === journalId);
      if (!visibleOriginal) throw new AccountingMutationError(404, "القيد غير متاح ضمن نطاقك.");
      const [lockedOriginal] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, journalId),
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "journalEntries"),
      )).for("update");
      if (!lockedOriginal) throw new AccountingMutationError(404, "القيد غير متاح.");
      const original: JournalRecord = { ...lockedOriginal.data, id: lockedOriginal.id };

      const [replayedEvent] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "journalAdjustmentEvents"),
        eq(erpRecordsTable.clientOperationId, operationId),
      )).limit(1);
      if (replayedEvent) {
        if (
          replayedEvent.data.requestFingerprint !== requestFingerprint
          || Number(replayedEvent.data.originalJournalId) !== journalId
        ) {
          throw new AccountingMutationError(409, "معرّف العملية مستخدم لطلب مختلف.");
        }
        const createdJournalIds = Array.isArray(replayedEvent.data.createdJournalIds)
          ? replayedEvent.data.createdJournalIds.map(Number)
          : [];
        const replayedJournals = visibleJournals.filter((journal) => createdJournalIds.includes(journal.id));
        const replayedReversal = replayedJournals.find((journal) => journal.adjustmentType === "reversal");
        const replayedCorrection = replayedJournals.find((journal) => journal.adjustmentType === "correction");
        if (!replayedReversal || (action === "correct" && !replayedCorrection)) {
          throw new AccountingMutationError(409, "عملية التصحيح السابقة غير مكتملة وتحتاج مراجعة.");
        }
        return {
          replayed: true,
          reversal: replayedReversal,
          correction: replayedCorrection,
        };
      }

      const [priorAdjustment] = await tx.select({ id: erpRecordsTable.id }).from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "journalAdjustmentEvents"),
        sql`${erpRecordsTable.data}->>'originalJournalId' = ${String(journalId)}`,
      )).limit(1);
      if (priorAdjustment) throw new AccountingMutationError(409, "سبق عكس أو تصحيح هذا القيد.");
      const prepared = prepareJournalAdjustment(original, action, requestBody);
      const adjustmentDate = String(prepared.reversal.date);
      const closures = await organizationRecordsFor(currentAuth, "financialClosures", tx);
      if (closures.some((closure) => closure.status === "closed" && adjustmentDate >= String(closure.from) && adjustmentDate <= String(closure.to))) {
        throw new AccountingMutationError(409, "الفترة المالية المحددة مقفلة. اختر تاريخاً ضمن فترة مفتوحة.");
      }

      if (prepared.correction) {
        const accountIds = new Set((prepared.correction.lines as Array<Record<string, unknown>>).map((line) => String(line.accountId)));
        const accounts = await recordsFor(currentAuth, "accounts", tx);
        const activeAccountIds = new Set(accounts.filter((account) => account.status !== "inactive").map((account) => String(account.id)));
        if ([...accountIds].some((accountId) => !activeAccountIds.has(accountId))) {
          throw new AccountingMutationError(400, "القيد المصحح يحتوي حساباً غير موجود أو غير نشط.");
        }
      }

      const reversalOperationId = `${operationId}:reversal`;
      const correctionOperationId = `${operationId}:correction`;
      const [createdReversal] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        clientOperationId: reversalOperationId,
        data: { ...prepared.reversal, adjustmentRequestFingerprint: requestFingerprint },
      }).returning();
      const [createdCorrection] = prepared.correction
        ? await tx.insert(erpRecordsTable).values({
          organizationId: currentAuth.organizationId,
          tableName: "journalEntries",
          clientOperationId: correctionOperationId,
          data: { ...prepared.correction, adjustmentRequestFingerprint: requestFingerprint },
        }).returning()
        : [];
      const createdIds = [createdReversal.id, ...(createdCorrection ? [createdCorrection.id] : [])];
      const details = auditDetails(original, prepared, createdIds);
      await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalAdjustmentEvents",
        clientOperationId: operationId,
        data: {
          action,
          originalJournalId: journalId,
          createdJournalIds: createdIds,
          reason: String(prepared.reversal.adjustmentReason),
          requestFingerprint,
          auditSnapshot: JSON.parse(details),
          actorId: currentAuth.id,
          occurredAt: new Date().toISOString(),
        },
      });
      await tx.insert(teamAuditLogsTable).values({
        organizationId: currentAuth.organizationId,
        actorId: currentAuth.id,
        actorName: currentAuth.name || currentAuth.email,
        action: action === "reverse" ? "journal_reversed" : "journal_corrected",
        entity: String(original.number ?? journalId),
        details,
      });
      return {
        replayed: false,
        reversal: { ...createdReversal.data, id: createdReversal.id },
        correction: createdCorrection ? { ...createdCorrection.data, id: createdCorrection.id } : undefined,
      };
    });
    response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof JournalAdjustmentError || error instanceof AccountingMutationError) {
      response.status(error.status).json({ error: error.message, ...("code" in error && error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
});

router.post("/accounting/sources/:table/:id/:action", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const tableName = sourceTable(request.params.table);
  const sourceId = Number(request.params.id);
  const action = request.params.action as SourceAction;
  const operationId = request.get("Idempotency-Key")?.trim() ?? "";
  const body = request.body;
  if (!tableName || !Number.isInteger(sourceId) || sourceId <= 0 || (action !== "cancel" && action !== "correct")) {
    response.status(400).json({ error: "طلب إلغاء أو تصحيح المستند غير صالح." });
    return;
  }
  if (!operationId || operationId.length > 180) {
    response.status(400).json({ error: "معرّف عملية الإلغاء أو التصحيح مطلوب." });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات إلغاء أو تصحيح المستند غير صحيحة." });
    return;
  }
  const requestBody = body as Record<string, unknown>;
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify({ tableName, sourceId, action, body: requestBody }))
    .digest("hex");
  const reason = typeof requestBody.reason === "string" ? requestBody.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) {
    response.status(400).json({ error: "أدخل سبباً واضحاً من 3 إلى 1000 حرف." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !sourceCorrectionAccess(currentAuth, tableName)) {
        response.locals.writeAccessFailure = "authorization_changed";
        throw new SourceCorrectionError(403, "ليس لديك صلاحية لتصحيح هذا المستند.");
      }

      const [source] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, sourceId),
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, tableName),
      )).for("update");
      if (!source || !isLocationAllowed(currentAuth, tableName, source.data, source.id)) {
        throw new SourceCorrectionError(404, "المستند غير متاح ضمن نطاقك.");
      }

      const [replayedEvent] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "sourceCorrectionEvents"),
        eq(erpRecordsTable.clientOperationId, operationId),
      )).limit(1);
      if (replayedEvent) {
        if (
          replayedEvent.data.requestFingerprint !== requestFingerprint
          || replayedEvent.data.sourceTable !== tableName
          || Number(replayedEvent.data.sourceId) !== sourceId
        ) {
          throw new SourceCorrectionError(409, "معرّف العملية مستخدم لطلب مختلف.");
        }
        const createdJournalIds = Array.isArray(replayedEvent.data.createdJournalIds)
          ? replayedEvent.data.createdJournalIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
          : [];
        const replayedJournals = createdJournalIds.length
          ? await tx.select().from(erpRecordsTable).where(and(
            eq(erpRecordsTable.organizationId, currentAuth.organizationId),
            eq(erpRecordsTable.tableName, "journalEntries"),
            inArray(erpRecordsTable.id, createdJournalIds),
          ))
          : [];
        const reversal = replayedJournals.find((journal) => journal.data.adjustmentType === "reversal");
        const correction = replayedJournals.find((journal) => journal.data.adjustmentType === "correction");
        const eInvoiceDocumentId = Number(replayedEvent.data.eInvoiceDocumentId);
        const [eInvoiceAdjustment] = Number.isInteger(eInvoiceDocumentId) && eInvoiceDocumentId > 0
          ? await tx.select().from(eInvoiceDocumentsTable).where(and(
            eq(eInvoiceDocumentsTable.id, eInvoiceDocumentId),
            eq(eInvoiceDocumentsTable.organizationId, currentAuth.organizationId),
          )).limit(1)
          : [];
        if (!reversal || (action === "correct" && !correction)) {
          throw new SourceCorrectionError(409, "عملية التصحيح السابقة غير مكتملة وتحتاج مراجعة.");
        }
        return {
          replayed: true,
          source: { ...source.data, id: source.id },
          reversal: { ...reversal.data, id: reversal.id },
          correction: correction ? { ...correction.data, id: correction.id } : undefined,
          eInvoiceAdjustment: eInvoiceAdjustment ? {
            id: eInvoiceAdjustment.id,
            documentType: eInvoiceAdjustment.documentType,
            status: eInvoiceAdjustment.status,
            invoiceNumber: eInvoiceAdjustment.invoiceNumber,
          } : undefined,
        };
      }
      if (source.data.status === "cancelled" || source.data.status === "canceled") {
        throw new SourceCorrectionError(409, "لا يمكن تعديل مستند ملغى.");
      }
      if (source.data.status === "corrected" && action !== "cancel") {
        throw new SourceCorrectionError(409, "سبق تصحيح هذا المستند.");
      }

      const replacementInput = requestBody.replacement ?? requestBody.document ?? requestBody.changes;
      const replacement = action === "correct"
        ? sourceReplacement(tableName, source.data, replacementInput)
        : source.data;
      const effectiveDate = typeof requestBody.effectiveDate === "string"
        ? requestBody.effectiveDate
        : action === "correct"
          ? sourceDate(replacement)
          : sourceDate(source.data);
      if (!validSourceCorrectionDate(effectiveDate)) {
        throw new SourceCorrectionError(400, "تاريخ العملية غير صحيح.");
      }
      const closures = await organizationRecordsFor(currentAuth, "financialClosures", tx);
      if (closures.some((closure) => closure.status === "closed" && (
        effectiveDate >= String(closure.from ?? "") && effectiveDate <= String(closure.to ?? "")
      ))) {
        throw new SourceCorrectionError(409, "الفترة المالية المحددة مقفلة. اختر تاريخاً ضمن فترة مفتوحة.");
      }
      if (action === "correct" && closures.some((closure) => closure.status === "closed" && (
        sourceDate(source.data) >= String(closure.from ?? "") && sourceDate(source.data) <= String(closure.to ?? "")
      ))) {
        throw new SourceCorrectionError(409, "لا يمكن تصحيح مستند يعود إلى فترة مالية مقفلة.");
      }

      const beforeData = { ...source.data };
      const effectData = action === "correct" ? { ...replacement } : {};
      if (tableName === "purchaseOrders" && action === "correct" && requestBody.replacement && typeof requestBody.replacement === "object" && !Array.isArray(requestBody.replacement) && Object.hasOwn(requestBody.replacement, "items")) {
        throw new SourceCorrectionError(409, "تصحيح كميات استلام الشراء يتطلب عكس الاستلام ثم استلاماً جديداً للحفاظ على طبقات FIFO.");
      }
      let afterData: Record<string, unknown> = action === "cancel"
        ? {
          ...source.data, status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: reason,
        }
        : {
          ...replacement,
          status: "corrected",
          correctedAt: new Date().toISOString(),
          correctionReason: reason,
          correctionOfId: sourceId,
        };

      const oldMovements = movementMap(tableName, source.data);
      const newMovements = movementMap(tableName, effectData);
      const movementKeys = [...new Set([...oldMovements.keys(), ...newMovements.keys()])].sort();
      const productIds = [...new Set(movementKeys.map((key) => Number(key.split(":")[0])))].sort((a, b) => a - b);
      const warehouseIds = [...new Set(movementKeys.map((key) => Number(key.split(":")[1])))].sort((a, b) => a - b);
      for (const warehouseId of warehouseIds) {
        const [warehouse] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, warehouseId),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "warehouses"),
        )).for("update");
        if (!warehouse || warehouse.data.status === "inactive") {
          throw new SourceCorrectionError(409, "لا يمكن تنفيذ التصحيح على موقع تشغيل غير موجود أو غير نشط.");
        }
      }
      const productRows = new Map<number, AnyRecord>();
      for (const productId of productIds) {
        const [product] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, productId),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "products"),
        )).for("update");
        if (!product) throw new SourceCorrectionError(409, "أحد المنتجات المرتبطة بالمستند غير موجود.");
        productRows.set(productId, { ...product.data, id: product.id });
      }
      // A receipt reversal may only remove stock that is still wholly present
      // in its own FIFO layers.  Never silently pull units from newer layers.
      if (tableName === "purchaseOrders" && action === "cancel") {
        const receiptLayers = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "inventoryLayers"),
          sql`${erpRecordsTable.data}->>'purchaseOrderId' = ${String(sourceId)}`,
        )).for("update");
        if (!receiptLayers.length) throw new SourceCorrectionError(409, "لا يمكن عكس استلام شراء قديم بلا طبقات FIFO قابلة للتتبع.");
        for (const layer of receiptLayers) {
          const original = asNumber(layer.data.originalQuantity);
          const remaining = asNumber(layer.data.remainingQuantity);
          if (original <= 0 || Math.abs(remaining - original) > 0.000001) {
            throw new SourceCorrectionError(409, "لا يمكن عكس استلام شراء لأن بعض وحدات الدفعة استهلكت.");
          }
          await tx.update(erpRecordsTable).set({
            data: { ...layer.data, remainingQuantity: 0, reversalOfPurchaseId: sourceId, sourceCorrectionOperationId: operationId, reversedAt: new Date().toISOString() },
            updatedAt: new Date(),
          }).where(eq(erpRecordsTable.id, layer.id));
        }
      }
      for (const key of movementKeys) {
        const oldMovement = oldMovements.get(key);
        const newMovement = newMovements.get(key);
        const delta = tableName === "purchaseOrders"
          ? (newMovement?.quantity ?? 0) - (oldMovement?.quantity ?? 0)
          : (oldMovement?.quantity ?? 0) - (newMovement?.quantity ?? 0);
        if (Math.abs(delta) < 0.000001) continue;
        const productId = Number(key.split(":")[0]);
        const warehouseId = Number(key.split(":")[1]);
        const [balance] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "inventoryBalances"),
          sql`${erpRecordsTable.data}->>'productId' = ${String(productId)}`,
          sql`${erpRecordsTable.data}->>'warehouseId' = ${String(warehouseId)}`,
        )).for("update");
        const currentQuantity = balance ? asNumber(balance.data.quantity) : 0;
        const nextQuantity = currentQuantity + delta;
        if (nextQuantity < 0) {
          throw new SourceCorrectionError(409, "لا يمكن تصحيح المستند لأن الرصيد الحالي لا يكفي لعكس أثره.");
        }
        if (balance) {
          await tx.update(erpRecordsTable).set({
            data: { ...balance.data, quantity: nextQuantity },
            updatedAt: new Date(),
          }).where(eq(erpRecordsTable.id, balance.id));
        } else {
          await tx.insert(erpRecordsTable).values({
            organizationId: currentAuth.organizationId,
            tableName: "inventoryBalances",
            data: { productId, warehouseId, quantity: nextQuantity },
          });
        }
      }
      for (const [productId, product] of productRows) {
        const balances = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "inventoryBalances"),
          sql`${erpRecordsTable.data}->>'productId' = ${String(productId)}`,
        )).for("update");
        const stock = balances.reduce((sum, balance) => sum + asNumber(balance.data.quantity), 0);
        const [currentProduct] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.id, product.id),
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "products"),
        )).for("update");
        if (currentProduct) {
          await tx.update(erpRecordsTable).set({
            data: { ...currentProduct.data, stock },
            updatedAt: new Date(),
          }).where(eq(erpRecordsTable.id, currentProduct.id));
        }
      }

      if (tableName === "invoices") {
        const sales = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "sales"),
          sql`${erpRecordsTable.data}->>'invoiceId' = ${String(sourceId)}`,
        )).for("update");
        if (action === "cancel" || Object.hasOwn(requestBody.replacement && typeof requestBody.replacement === "object" ? requestBody.replacement : {}, "items")) {
          for (const sale of sales.filter((record) => !record.data.voidedAt)) {
            const allocations = Array.isArray(sale.data.fifoAllocations) ? sale.data.fifoAllocations : [];
            if (!allocations.length) throw new SourceCorrectionError(409, "لا يمكن عكس البيع لأن تخصيصات FIFO الأصلية غير متاحة.");
            for (const rawAllocation of allocations) {
              if (!rawAllocation || typeof rawAllocation !== "object" || Array.isArray(rawAllocation)) throw new SourceCorrectionError(409, "تخصيصات FIFO الأصلية غير صالحة.");
              const allocation = rawAllocation as Record<string, unknown>;
              const quantity = asNumber(allocation.quantity);
              const unitCostExVat = asNumber(allocation.unitCostExVat);
              if (quantity <= 0 || unitCostExVat < 0) throw new SourceCorrectionError(409, "تخصيصات FIFO الأصلية غير صالحة.");
              await tx.insert(erpRecordsTable).values({
                organizationId: currentAuth.organizationId,
                tableName: "inventoryLayers",
                data: {
                  productId: sale.data.productId, warehouseId: sale.data.warehouseId, originalQuantity: quantity,
                  remainingQuantity: quantity, unitCostExVat, restorationOfSaleId: sale.id,
                  sourceCorrectionOperationId: operationId, restoredAt: new Date().toISOString(),
                },
              });
            }
            await tx.update(erpRecordsTable).set({
              data: { ...sale.data, voidedAt: new Date().toISOString(), voidReason: reason, sourceCorrectionOperationId: operationId },
              updatedAt: new Date(),
            }).where(eq(erpRecordsTable.id, sale.id));
          }
          if (action === "correct" && Array.isArray(effectData.items)) {
            const grouped = new Map<string, { productId: number; warehouseId: number; quantity: number; unitPriceExVat: number; vatRate: number }>();
            const sourceItems = Array.isArray(source.data.items)
              ? source.data.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
              : [];
            for (const rawItem of effectData.items) {
              if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) throw new SourceCorrectionError(400, "أحد أصناف الفاتورة المصححة غير صالح.");
              const item = rawItem as Record<string, unknown>;
              const productId = Number(item.productId);
              const warehouseId = Number(item.warehouseId ?? effectData.warehouseId);
              const quantity = Number(item.quantity);
              const unitPriceExVat = asNumber(item.unitPriceExVat ?? item.unitPrice);
              const sourceItem = sourceItems.find((candidate) =>
                Number(candidate.productId) === productId
                && Number(candidate.warehouseId ?? source.data.warehouseId) === warehouseId
              );
              const product = productRows.get(productId);
              const vatRate = asNumber(sourceItem?.vatRate ?? product?.vatRate ?? 15);
              const requestedVatRate = item.vatRate == null ? vatRate : Number(item.vatRate);
              if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(warehouseId) || warehouseId <= 0 || !Number.isFinite(quantity) || quantity <= 0 || unitPriceExVat < 0 || ![0, 5, 15].includes(vatRate) || requestedVatRate !== vatRate) {
                throw new SourceCorrectionError(400, "أحد أصناف الفاتورة المصححة غير صالح.");
              }
              const key = `${productId}:${warehouseId}:${unitPriceExVat}:${vatRate}`;
              const prior = grouped.get(key);
              grouped.set(key, { productId, warehouseId, quantity: (prior?.quantity ?? 0) + quantity, unitPriceExVat, vatRate });
            }
            const correctedItems: Array<Record<string, unknown>> = [];
            for (const item of grouped.values()) {
              const fifoAllocations = await consumeCorrectionFifo(tx, currentAuth.organizationId, item.productId, item.warehouseId, item.quantity);
              const costAmount = Math.round(fifoAllocations.reduce((sum, allocation) => sum + asNumber(allocation.costAmount), 0) * 100) / 100;
              const lineNet = Math.round(item.quantity * item.unitPriceExVat * 100) / 100;
              const vatAmount = Math.round(lineNet * item.vatRate) / 100;
              const lineGross = Math.round((lineNet + vatAmount) * 100) / 100;
              const product = productRows.get(item.productId);
              const snapshot = {
                productId: item.productId, warehouseId: item.warehouseId, name: String(product?.name ?? `صنف #${item.productId}`),
                quantity: item.quantity, unitPriceExVat: item.unitPriceExVat, vatRate: item.vatRate, vatAmount,
                lineNet, lineGross, total: lineNet, unitCost: Math.round(costAmount / item.quantity * 100) / 100,
                costAmount, fifoAllocations,
              };
              correctedItems.push(snapshot);
              await tx.insert(erpRecordsTable).values({
                organizationId: currentAuth.organizationId,
                tableName: "sales",
                data: {
                  ...snapshot, invoiceId: sourceId,
                  issueDate: sourceDate(effectData),
                  correctionOfInvoiceId: sourceId,
                  sourceCorrectionOperationId: operationId,
                  createdAt: new Date().toISOString(),
                },
              });
            }
            const subtotal = Math.round(correctedItems.reduce((sum, item) => sum + asNumber(item.lineNet), 0) * 100) / 100;
            const tax = Math.round(correctedItems.reduce((sum, item) => sum + asNumber(item.vatAmount), 0) * 100) / 100;
            const total = Math.round((subtotal + tax) * 100) / 100;
            const cogsTotal = Math.round(correctedItems.reduce((sum, item) => sum + asNumber(item.costAmount), 0) * 100) / 100;
            Object.assign(effectData, { items: correctedItems, subtotal, tax, total, cogsTotal, paid: effectData.paymentMethod === "credit" ? 0 : total });
            afterData = { ...effectData, status: "corrected", correctedAt: new Date().toISOString(), correctionReason: reason, correctionOfId: sourceId };
          }
        }
      }

      const receivableKey = tableName === "invoices" ? "invoiceId" : tableName === "purchaseOrders" ? "purchaseId" : null;
      const receivables = receivableKey
        ? await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "receivables"),
          tableName === "purchaseOrders"
            ? sql`coalesce(${erpRecordsTable.data}->>'purchaseId', ${erpRecordsTable.data}->>'purchaseOrderId') = ${String(sourceId)}`
            : sql`${erpRecordsTable.data}->>'invoiceId' = ${String(sourceId)}`,
        )).for("update")
        : [];
      if (tableName === "purchaseOrders" && action === "cancel"
        && receivables.some((item) => asNumber(item.data.paid) > 0.005)) {
        throw new SourceCorrectionError(409, "لا يمكن إلغاء أمر شراء سُددت إحدى ذممه. اعكس السداد أولاً.");
      }
      const replacementAmount = sourceAmount(effectData);
      const replacementPaid = Math.min(replacementAmount, Math.max(0, asNumber(effectData.paid)));
      if (action === "correct" && receivables.some((item) => asNumber(item.data.paid) > replacementAmount)) {
        throw new SourceCorrectionError(409, "لا يمكن تخفيض المستند إلى أقل من المبلغ المسدد.");
      }
      for (const receivable of receivables) {
        const nextData = action === "cancel"
          ? { ...receivable.data, status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: reason }
          : sourceHasCredit(effectData, tableName)
            ? {
              ...receivable.data,
              party: sourceParty(effectData, tableName),
              customerName: tableName === "invoices" ? sourceParty(effectData, tableName) : receivable.data.customerName,
              supplierName: tableName === "purchaseOrders" ? sourceParty(effectData, tableName) : receivable.data.supplierName,
              reference: sourceReference(effectData, tableName, sourceId),
              issueDate: sourceDate(effectData),
              dueDate: effectData.dueDate ?? receivable.data.dueDate,
              amount: replacementAmount,
              paid: replacementPaid,
              status: replacementPaid >= replacementAmount ? "paid" : replacementPaid > 0 ? "partial" : "unpaid",
            }
            : { ...receivable.data, status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: reason };
        await tx.update(erpRecordsTable).set({ data: nextData, updatedAt: new Date() }).where(eq(erpRecordsTable.id, receivable.id));
      }
      if (action === "correct" && receivableKey && sourceHasCredit(effectData, tableName) && receivables.length === 0) {
        await tx.insert(erpRecordsTable).values({
          organizationId: currentAuth.organizationId,
          tableName: "receivables",
          data: {
            [receivableKey]: sourceId,
            party: sourceParty(effectData, tableName),
            ...(tableName === "invoices" ? { customerName: sourceParty(effectData, tableName) } : {}),
            ...(tableName === "purchaseOrders" ? { supplierName: sourceParty(effectData, tableName), type: "payable" } : {}),
            type: tableName === "purchaseOrders" ? "payable" : "receivable",
            reference: sourceReference(effectData, tableName, sourceId),
            issueDate: sourceDate(effectData),
            dueDate: effectData.dueDate ?? sourceDate(effectData),
            amount: replacementAmount,
            paid: replacementPaid,
            status: replacementPaid >= replacementAmount ? "paid" : replacementPaid > 0 ? "partial" : "unpaid",
          },
        });
      }

      const accounts = await organizationRecordsFor(currentAuth, "accounts", tx);
      const sourceType = sourceTypeFor(tableName);
      const baseJournals = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "journalEntries"),
        sql`${erpRecordsTable.data}->>'sourceType' = ${sourceType}`,
        sql`${erpRecordsTable.data}->>'sourceId' = ${String(sourceId)}`,
        sql`coalesce(${erpRecordsTable.data}->>'adjustmentType', '') = ''`,
      )).for("update");
      let correctedJournal: ErpRecord | undefined;
      if (source.data.status === "corrected" && action === "cancel") {
        const [latestCorrectionEvent] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "sourceCorrectionEvents"),
          sql`${erpRecordsTable.data}->>'sourceTable' = ${tableName}`,
          sql`${erpRecordsTable.data}->>'sourceId' = ${String(sourceId)}`,
          sql`${erpRecordsTable.data}->>'action' = 'correct'`,
        )).orderBy(sql`${erpRecordsTable.id} desc`).limit(1).for("update");
        const correctionIds = Array.isArray(latestCorrectionEvent?.data.createdJournalIds)
          ? latestCorrectionEvent.data.createdJournalIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
          : [];
        if (!latestCorrectionEvent || !latestCorrectionEvent.clientOperationId || !correctionIds.length) {
          throw new SourceCorrectionError(409, "تعذر تحديد آخر قيد تصحيح فعّال للمستند.");
        }
        const [linkedCorrection] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "journalEntries"),
          inArray(erpRecordsTable.id, correctionIds),
          sql`${erpRecordsTable.data}->>'sourceType' = ${sourceType}`,
          sql`${erpRecordsTable.data}->>'sourceId' = ${String(sourceId)}`,
          sql`${erpRecordsTable.data}->>'adjustmentType' = 'correction'`,
          sql`${erpRecordsTable.data}->>'sourceCorrectionOperationId' = ${latestCorrectionEvent.clientOperationId}`,
        )).limit(1).for("update");
        if (!linkedCorrection) throw new SourceCorrectionError(409, "قيد التصحيح الفعّال المرتبط بالحدث غير متاح.");
        correctedJournal = linkedCorrection;
      }
      let originalJournal = correctedJournal ?? baseJournals[0];
      if (!originalJournal) {
        const [createdSourceJournal] = await tx.insert(erpRecordsTable).values({
          organizationId: currentAuth.organizationId,
          tableName: "journalEntries",
          clientOperationId: `AUTO-${sourceType.toUpperCase()}-${sourceId}`,
          data: {
            number: `AUTO-${sourceType.toUpperCase()}-${sourceId}`,
            date: sourceDate(source.data),
            description: `${sourceLabel(tableName)} ${sourceReference(source.data, tableName, sourceId)}`,
            status: "posted",
            sourceType,
            sourceId,
            ...(source.data.warehouseId != null ? { warehouseId: source.data.warehouseId } : {}),
            lines: journalLinesForSource(tableName, source.data, accounts),
          },
        }).onConflictDoNothing({
          target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId],
        }).returning();
        originalJournal = createdSourceJournal;
      }
      if (!originalJournal || originalJournal.data.status !== "posted") {
        throw new SourceCorrectionError(409, "لا يوجد قيد مرحّل صالح مرتبط بالمستند.");
      }
      const journalsToReverse = tableName === "purchaseOrders" && !correctedJournal ? baseJournals : [originalJournal];
      const originalLines = journalsToReverse.flatMap((journal) => normalizeLines(journal.data.lines));
      const reversalData = {
        number: `REV-${String(originalJournal.data.number ?? `#${originalJournal.id}`)}`,
        date: effectiveDate,
        description: `عكس ${sourceLabel(tableName)} ${sourceReference(source.data, tableName, sourceId)}: ${reason}`,
        status: "posted",
        sourceType,
        sourceId,
        sourceDocumentTable: tableName,
        sourceDocumentId: sourceId,
        adjustmentType: "reversal",
        adjustsJournalId: originalJournal.id,
        ...(journalsToReverse.length > 1 ? { adjustsJournalIds: journalsToReverse.map((journal) => journal.id) } : {}),
        adjustmentReason: reason,
        sourceCorrectionOperationId: operationId,
        lines: originalLines.map((line, index) => ({ ...line, id: `source-reversal-${index + 1}`, debit: line.credit, credit: line.debit })),
      };
      const [createdReversal] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        clientOperationId: `${operationId}:reversal`,
        data: reversalData,
      }).returning();
      let createdCorrection;
      if (action === "correct") {
        const correctedLines = journalLinesForSource(tableName, effectData, accounts);
        [createdCorrection] = await tx.insert(erpRecordsTable).values({
          organizationId: currentAuth.organizationId,
          tableName: "journalEntries",
          clientOperationId: `${operationId}:correction`,
          data: {
            number: `COR-${String(originalJournal.data.number ?? `#${originalJournal.id}`)}`,
            date: effectiveDate,
            description: `${sourceLabel(tableName)} مصحح ${sourceReference(effectData, tableName, sourceId)}: ${reason}`,
            status: "posted",
            sourceType,
            sourceId,
            sourceDocumentTable: tableName,
            sourceDocumentId: sourceId,
            adjustmentType: "correction",
            adjustsJournalId: originalJournal.id,
            adjustmentReason: reason,
            sourceCorrectionOperationId: operationId,
            lines: correctedLines.map((line, index) => ({ ...line, id: `source-correction-${index + 1}` })),
          },
        }).returning();
      }
      let eInvoiceAdjustment: Awaited<ReturnType<typeof issueEInvoiceAdjustment>> = null;
      if (tableName === "invoices") {
        const originalNet = sourceTaxExclusiveAmount(source.data);
        const correctedNet = action === "correct" ? sourceTaxExclusiveAmount(effectData) : 0;
        const originalTax = asNumber(source.data.tax ?? source.data.vatAmount);
        const correctedTax = action === "correct" ? asNumber(effectData.tax ?? effectData.vatAmount) : 0;
        const originalTotal = Math.round((originalNet + originalTax) * 100) / 100;
        const correctedTotal = Math.round((correctedNet + correctedTax) * 100) / 100;
        const netDelta = Math.round((correctedNet - originalNet) * 100) / 100;
        const taxDelta = Math.round((correctedTax - originalTax) * 100) / 100;
        if (netDelta === 0 && taxDelta !== 0) {
          throw new SourceCorrectionError(
            400,
            "لا يمكن إصدار إشعار إلكتروني لفرق ضريبة فقط دون أساس خاضع. صحح بنود الفاتورة ومعدلاتها معاً.",
          );
        }
        if (netDelta !== 0 && taxDelta !== 0 && Math.sign(netDelta) !== Math.sign(taxDelta)) {
          throw new SourceCorrectionError(
            400,
            "لا يمكن إصدار إشعار إلكتروني واحد عندما يتحرك صافي الفاتورة والضريبة في اتجاهين متعاكسين. افصل التصحيح إلى عمليتين.",
          );
        }
        const totalDifference = Math.round(Math.abs(correctedTotal - originalTotal) * 100) / 100;
        const taxDifference = Math.round(Math.abs(correctedTax - originalTax) * 100) / 100;
        const netDifference = Math.round(Math.abs(correctedNet - originalNet) * 100) / 100;
        const vatGroups = (data: Record<string, unknown>) => {
          const groups = new Map<number, { net: number; tax: number }>();
          const items = Array.isArray(data.items) ? data.items : [];
          for (const rawItem of items) {
            const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
            const rate = asNumber(item.vatRate);
            const current = groups.get(rate) ?? { net: 0, tax: 0 };
            groups.set(rate, {
              net: Math.round((current.net + asNumber(item.lineNet)) * 100) / 100,
              tax: Math.round((current.tax + asNumber(item.vatAmount)) * 100) / 100,
            });
          }
          return groups;
        };
        const originalGroups = vatGroups(source.data);
        const correctedGroups = action === "correct" ? vatGroups(effectData) : new Map<number, { net: number; tax: number }>();
        const expectedDirection = correctedTotal > originalTotal ? 1 : -1;
        const adjustmentLines = [...new Set([...originalGroups.keys(), ...correctedGroups.keys()])].map((vatRate) => {
          const originalGroup = originalGroups.get(vatRate) ?? { net: 0, tax: 0 };
          const correctedGroup = correctedGroups.get(vatRate) ?? { net: 0, tax: 0 };
          const groupNetDelta = Math.round((correctedGroup.net - originalGroup.net) * 100) / 100;
          const groupTaxDelta = Math.round((correctedGroup.tax - originalGroup.tax) * 100) / 100;
          if (
            (groupNetDelta !== 0 && Math.sign(groupNetDelta) !== expectedDirection)
            || (groupTaxDelta !== 0 && Math.sign(groupTaxDelta) !== expectedDirection)
          ) {
            throw new SourceCorrectionError(
              400,
              "لا يمكن إصدار إشعار واحد عندما تتحرك مجموعة ضريبية بعكس اتجاه إجمالي التصحيح. افصل التصحيح إلى عمليتين.",
            );
          }
          return {
            vatRate,
            taxExclusiveAmount: Math.round(Math.abs(groupNetDelta) * 100) / 100,
            taxAmount: Math.round(Math.abs(groupTaxDelta) * 100) / 100,
          };
        }).filter((line) => line.taxExclusiveAmount > 0 || line.taxAmount > 0);
        if (totalDifference > 0) {
          eInvoiceAdjustment = await issueEInvoiceAdjustment(tx, {
            organizationId: currentAuth.organizationId,
            invoiceRecordId: sourceId,
            operationId: `${operationId}:einvoice`,
            documentType: action === "cancel" || correctedTotal < originalTotal ? "credit_note" : "debit_note",
            reason,
            taxExclusiveAmount: netDifference,
            taxAmount: taxDifference,
            adjustmentLines,
            issueAt: new Date(`${effectiveDate}T12:00:00.000Z`),
          });
          if (eInvoiceAdjustment) {
            afterData = {
              ...afterData,
              eInvoiceAdjustmentDocumentId: eInvoiceAdjustment.document.id,
              eInvoiceAdjustmentType: eInvoiceAdjustment.document.documentType,
              eInvoiceAdjustmentStatus: eInvoiceAdjustment.document.status,
            };
          }
        }
      }
      const createdJournalIds = [createdReversal.id, ...(createdCorrection ? [createdCorrection.id] : [])];
      const auditSnapshot = JSON.stringify({
        sourceTable: tableName,
        sourceId,
        action,
        reason,
        before: beforeData,
        after: afterData,
        originalJournalId: originalJournal.id,
        createdJournalIds,
        eInvoiceDocumentId: eInvoiceAdjustment?.document.id ?? null,
        eInvoiceDocumentType: eInvoiceAdjustment?.document.documentType ?? null,
        eInvoiceDocumentStatus: eInvoiceAdjustment?.document.status ?? null,
        inventory: {
          before: [...oldMovements.values()],
          after: [...newMovements.values()],
        },
        originalRemainsUnchanged: true,
      });
      const [event] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "sourceCorrectionEvents",
        clientOperationId: operationId,
        data: {
          sourceTable: tableName,
          sourceId,
          action,
          reason,
          requestFingerprint,
          createdJournalIds,
          originalJournalId: originalJournal.id,
          eInvoiceDocumentId: eInvoiceAdjustment?.document.id ?? null,
          eInvoiceDocumentType: eInvoiceAdjustment?.document.documentType ?? null,
          eInvoiceDocumentStatus: eInvoiceAdjustment?.document.status ?? null,
          auditSnapshot: JSON.parse(auditSnapshot),
          actorId: currentAuth.id,
          occurredAt: new Date().toISOString(),
        },
      }).returning();
      await tx.update(erpRecordsTable).set({ data: afterData, updatedAt: new Date() }).where(eq(erpRecordsTable.id, source.id));
      await tx.insert(teamAuditLogsTable).values({
        organizationId: currentAuth.organizationId,
        actorId: currentAuth.id,
        actorName: currentAuth.name || currentAuth.email,
        action: action === "cancel" ? `${tableName}_cancelled` : `${tableName}_corrected`,
        entity: String(sourceId),
        details: auditSnapshot,
      });
      return {
        replayed: false,
        source: { ...afterData, id: source.id },
        reversal: { ...createdReversal.data, id: createdReversal.id },
        correction: createdCorrection ? { ...createdCorrection.data, id: createdCorrection.id } : undefined,
        eInvoiceAdjustment: eInvoiceAdjustment ? {
          id: eInvoiceAdjustment.document.id,
          documentType: eInvoiceAdjustment.document.documentType,
          status: eInvoiceAdjustment.document.status,
          invoiceNumber: eInvoiceAdjustment.document.invoiceNumber,
        } : undefined,
        eventId: event.id,
      };
    });
    response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof SourceCorrectionError || error instanceof AccountingMutationError || error instanceof EInvoiceAdjustmentError) {
      const code = "code" in error ? error.code : undefined;
      response.status(error.status).json({ error: error.message, ...(code ? { code } : {}) });
      return;
    }
    throw error;
  }
});

router.post("/accounting/sync-source-journals", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const [invoices, purchases, expenses, existingJournals] = await Promise.all([
    recordsFor(auth, "invoices"),
    recordsFor(auth, "purchaseOrders"),
    recordsFor(auth, "expenses"),
    recordsFor(auth, "journalEntries"),
  ]);
  const existingSources = new Set(existingJournals.map((journal) => `${journal.sourceType}:${journal.sourceId}`));
  const sources = [
    ...invoices.map((record) => ({ record, tableName: "invoices", type: "sale", label: "فاتورة بيع" })),
    ...purchases
      .filter((record) => !Array.isArray(record.receipts) && (record.received === true || record.status === "completed"))
      .map((record) => ({ record, tableName: "purchaseOrders", type: "purchase", label: "أمر شراء" })),
    ...expenses.map((record) => ({ record, tableName: "expenses", type: "expense", label: "مصروف" })),
  ];
  let created = 0;
  const skipped: Array<{ sourceId: number; reason: string }> = [];

  for (const source of sources) {
    const sourceKey = `${source.type}:${source.record.id}`;
    if (existingSources.has(sourceKey)) continue;
    const inserted = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) return false;
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasAccountingAccess(currentAuth)) {
        response.locals.writeAccessFailure = "authorization_changed";
        return false;
      }
      const [currentSource] = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.id, source.record.id),
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, source.tableName),
      )).for("update");
      if (!currentSource || !isLocationAllowed(currentAuth, currentSource.tableName, currentSource.data, currentSource.id)) {
        return "out_of_scope" as const;
      }
      const sourceDate = asDate(currentSource.data.date ?? currentSource.data.issueDate) || new Date().toISOString().slice(0, 10);
      const closed = await organizationRecordsFor(currentAuth, "financialClosures", tx);
      const isClosed = closed.some((closure) => closure.status === "closed"
        && sourceDate >= String(closure.from ?? "") && sourceDate <= String(closure.to ?? ""));
      if (isClosed) return "closed" as const;
      const currentJournals = await organizationRecordsFor(currentAuth, "journalEntries", tx);
      if (currentJournals.some((journal) => journal.sourceType === source.type && journal.sourceId === source.record.id)) {
        return "exists" as const;
      }
      const accounts = await organizationRecordsFor(currentAuth, "accounts", tx);
      const debitCode = source.type === "sale"
        ? (currentSource.data.paymentMethod === "credit" || currentSource.data.customerId ? "1200" : "1000")
        : source.type === "purchase" ? "5000" : "5100";
      const creditCode = source.type === "sale" ? "4000" : source.type === "purchase" ? "2000" : "1000";
      const debitAccount = accounts.find((account) => String(account.code) === debitCode);
      const creditAccount = accounts.find((account) => String(account.code) === creditCode);
      const amount = asNumber(currentSource.data.total ?? currentSource.data.amount ?? currentSource.data.totalAmount);
      if (amount <= 0 || !debitAccount || !creditAccount) return "invalid" as const;
      const [createdJournal] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        clientOperationId: `AUTO-${source.type.toUpperCase()}-${source.record.id}`,
        data: {
          number: `AUTO-${source.type.toUpperCase()}-${source.record.id}`,
          date: sourceDate,
          description: `${source.label} ${String(currentSource.data.number ?? currentSource.data.invoiceNumber ?? `#${currentSource.id}`)}`,
          status: "posted",
          sourceType: source.type,
          sourceId: source.record.id,
          ...(currentSource.data.warehouseId != null ? { warehouseId: currentSource.data.warehouseId } : {}),
          lines: [
            { accountId: String(debitAccount.id), debit: amount, credit: 0 },
            { accountId: String(creditAccount.id), debit: 0, credit: amount },
          ],
        },
      }).onConflictDoNothing({
        target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId],
      }).returning();
      return createdJournal ? "inserted" as const : "exists" as const;
    });
    if (!inserted) {
      const rejection = lockedWriteRejection(response);
      response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
      return;
    }
    if (inserted === "out_of_scope") {
      skipped.push({ sourceId: source.record.id, reason: "لم يعد مصدر العملية ضمن نطاق المواقع المسموح." });
      continue;
    }
    if (inserted === "closed") {
      skipped.push({ sourceId: source.record.id, reason: "تاريخ العملية يقع في فترة مالية مقفلة." });
      continue;
    }
    if (inserted === "invalid") {
      skipped.push({ sourceId: source.record.id, reason: "يلزم مبلغ موجب وحسابات افتراضية مطابقة في دليل الحسابات." });
      continue;
    }
    if (inserted === "exists") continue;
    created += 1;
  }
  if (created > 0) {
    if (!await guardedAudit(response, auth, "source_journals_synced", "journalEntries", `تم إنشاء ${created} قيداً من مصادر العمليات.`)) {
      const rejection = lockedWriteRejection(response);
      response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
      return;
    }
  }
  response.json({ created, skipped });
});

router.post("/accounting/close", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireAccounting, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  if (auth.roleId !== "owner" && auth.locationScope !== "all") {
    response.status(403).json({ error: "الإقفال المالي الشامل متاح للمالك أو للمحاسب المخوّل بجميع المواقع فقط." });
    return;
  }
  const body = request.body as Record<string, unknown>;
  const from = typeof body.from === "string" ? body.from : "";
  const to = typeof body.to === "string" ? body.to : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    response.status(400).json({ error: "يجب تحديد فترة مالية صحيحة." });
    return;
  }
  if (confirmation !== "CLOSE_PERIOD") {
    response.status(400).json({
      error: "الإقفال المالي إجراء نهائي. راجع الملخص وأرسل تأكيد الإقفال الصريح.",
      code: "closure_confirmation_required",
    });
    return;
  }
  const closure = await db.transaction(async (tx) => {
    if (!await lockAndValidateDataGeneration(tx, response)) return null;
    const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
    if (!currentAuth || !hasAccountingAccess(currentAuth) || (currentAuth.roleId !== "owner" && currentAuth.locationScope !== "all")) {
      response.locals.writeAccessFailure = "authorization_changed";
      return null;
    }
    const accounts = await recordsFor(currentAuth, "accounts", tx);
    const journals = await recordsFor(currentAuth, "journalEntries", tx);
    const receivables = await recordsFor(currentAuth, "receivables", tx);
    const invoices = await recordsFor(currentAuth, "invoices", tx);
    const purchases = await recordsFor(currentAuth, "purchaseOrders", tx);
    const priorClosures = await recordsFor(currentAuth, "financialClosures", tx);
    const overlap = priorClosures.find((item) => item.status === "closed" && from <= String(item.to) && to >= String(item.from));
    if (overlap) return "overlap" as const;
    const report = calculateReport(accounts, journals, from, to);
    const [created] = await tx.insert(erpRecordsTable).values({
      organizationId: auth.organizationId,
      tableName: "financialClosures",
      data: {
        from,
        to,
        closedAt: new Date().toISOString(),
        closedBy: currentAuth.id,
        status: "closed",
        policy: "snapshot_locked",
        netIncome: report.totals.netIncome,
        totals: report.totals,
        trialBalance: report.trialBalance,
        receivables: derivePartyBalances(receivables.length ? receivables : invoices, "receivable", to),
        payables: derivePartyBalances(receivables.filter((record) => record.type === "payable").length ? receivables : purchases, "payable", to),
      },
    }).returning();
    return created;
  });
  if (!closure) {
    const rejection = lockedWriteRejection(response);
    response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
    return;
  }
  if (closure === "overlap") {
    response.status(409).json({ error: "تتداخل الفترة المحددة مع إقفال مالي معتمد." });
    return;
  }
  if (!await guardedAudit(response, auth, "financial_period_closed", "financialClosures", `إقفال الفترة من ${from} إلى ${to}.`)) {
    const rejection = lockedWriteRejection(response);
    response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
    return;
  }
  response.status(201).json({ closure: { ...closure.data, id: closure.id } });
});

router.post("/accounting/fiscal-year/close", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
  const requestedDate = typeof body.date === "string" ? body.date.trim() : "";
  const requestedYear = Number(body.year);
  const year = Number.isInteger(requestedYear) ? requestedYear : Number(requestedDate.slice(0, 4));
  const fiscalYearEnd = Number.isInteger(year) && year >= 1900 && year <= 9999 ? `${year}-12-31` : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";

  if (!Number.isInteger(year) || !fiscalYearEnd || requestedDate !== fiscalYearEnd || !isValidIsoDate(requestedDate)) {
    response.status(400).json({ error: "يجب أن يكون التاريخ المحدد هو 31 ديسمبر من سنة مالية صحيحة." });
    return;
  }
  if (confirmation !== "CLOSE_FISCAL_YEAR") {
    response.status(400).json({
      error: "إقفال السنة المالية إجراء نهائي. أرسل تأكيد الإقفال الصريح.",
      code: "fiscal_year_close_confirmation_required",
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) throw lockedAccountingMutationError(response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || currentAuth.roleId !== "owner") {
        response.locals.writeAccessFailure = "authorization_changed";
        throw new AccountingMutationError(403, "إقفال السنة المالية متاح لمالك المنشأة فقط.");
      }
      const [organization] = await tx.select({
        fiscalYearClosed: organizationsTable.fiscalYearClosed,
        closedYear: organizationsTable.closedYear,
      }).from(organizationsTable).where(eq(organizationsTable.id, currentAuth.organizationId)).for("update");
      if (!organization) throw new AccountingMutationError(404, "المنظمة غير موجودة.");
      if (organization.fiscalYearClosed === true) {
        throw new AccountingMutationError(409, `السنة المالية ${organization.closedYear ?? year} مقفلة مسبقاً.`);
      }

      const accounts = await organizationRecordsFor(currentAuth, "accounts", tx);
      const journals = await organizationRecordsFor(currentAuth, "journalEntries", tx);
      const report = calculateReport(accounts, journals, `${year}-01-01`, fiscalYearEnd);
      if (Math.abs(report.totals.trialDebit - report.totals.trialCredit) > 0.005) {
        throw new AccountingMutationError(409, "لا يمكن إقفال السنة لأن ميزان المراجعة غير متوازن.");
      }

      const retainedEarnings = accounts.find((account) => String(account.code) === "3100" && account.status !== "inactive");
      if (!retainedEarnings) {
        throw new AccountingMutationError(409, "حساب الأرباح المحتجزة 3100 غير موجود أو غير نشط.");
      }
      const revenueLines = report.incomeStatement.revenue
        .filter((account) => account.amount > 0.005)
        .map((account) => ({
          id: crypto.randomUUID(),
          accountId: String(account.id),
          debit: money(account.amount),
          credit: 0,
        }));
      const expenseLines = report.incomeStatement.expense
        .filter((account) => account.amount > 0.005)
        .map((account) => ({
          id: crypto.randomUUID(),
          accountId: String(account.id),
          debit: 0,
          credit: money(account.amount),
        }));
      const netIncome = money(report.totals.netIncome);
      const closingLines = [...revenueLines, ...expenseLines];
      if (netIncome > 0.005) {
        closingLines.push({ id: crypto.randomUUID(), accountId: String(retainedEarnings.id), debit: 0, credit: netIncome });
      } else if (netIncome < -0.005) {
        closingLines.push({ id: crypto.randomUUID(), accountId: String(retainedEarnings.id), debit: money(Math.abs(netIncome)), credit: 0 });
      }
      if (closingLines.length < 2) {
        throw new AccountingMutationError(409, "لا توجد أرصدة إيرادات أو مصاريف قابلة للإقفال في السنة المحددة.");
      }
      const closingDebitTotal = closingLines.reduce((sum, line) => sum + line.debit, 0);
      const closingCreditTotal = closingLines.reduce((sum, line) => sum + line.credit, 0);
      if (Math.abs(closingDebitTotal - closingCreditTotal) > 0.005) {
        throw new AccountingMutationError(409, "تعذر إنشاء قيد إقفال متوازن للسنة المالية.");
      }

      const closedAt = new Date();
      const [closingJournal] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        clientOperationId: `FISCAL-YEAR-CLOSE-${year}`,
        data: {
          number: `FY-CLOSE-${year}`,
          date: fiscalYearEnd,
          description: `إقفال السنة المالية ${year}`,
          status: "posted",
          sourceType: "fiscal_year_close",
          fiscalYear: year,
          lines: closingLines,
        },
      }).returning();
      if (!closingJournal) throw new AccountingMutationError(500, "تعذر إنشاء قيد إقفال السنة المالية.");

      const closureData = {
        from: `${year}-01-01`,
        to: fiscalYearEnd,
        closedAt: closedAt.toISOString(),
        closedBy: currentAuth.id,
        status: "closed",
        kind: "fiscal_year",
        fiscalYear: year,
        closingJournalId: closingJournal.id,
        netIncome,
        totals: report.totals,
        trialBalance: report.trialBalance,
      };
      const [closure] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "financialClosures",
        data: closureData,
      }).returning();
      if (!closure) throw new AccountingMutationError(500, "تعذر حفظ إقفال السنة المالية.");

      const [updatedOrganization] = await tx.update(organizationsTable).set({
        fiscalYearClosed: true,
        closedYear: year,
        closedAt,
        closedBy: currentAuth.id,
      }).where(eq(organizationsTable.id, currentAuth.organizationId)).returning({
        fiscalYearClosed: organizationsTable.fiscalYearClosed,
        closedYear: organizationsTable.closedYear,
        closedAt: organizationsTable.closedAt,
        closedBy: organizationsTable.closedBy,
      });
      if (!updatedOrganization) throw new AccountingMutationError(500, "تعذر تحديث حالة السنة المالية.");

      await tx.insert(teamAuditLogsTable).values({
        organizationId: currentAuth.organizationId,
        actorId: currentAuth.id,
        actorName: currentAuth.name || currentAuth.email,
        action: "fiscal_year_closed",
        entity: `fiscal-year:${year}`,
        details: `إقفال السنة المالية ${year}`,
      });
      return { closingJournal, closure, organization: updatedOrganization, netIncome };
    });

    response.status(201).json({
      fiscalYearClosed: result.organization.fiscalYearClosed,
      closedYear: result.organization.closedYear,
      closedAt: result.organization.closedAt?.toISOString() ?? null,
      closedBy: result.organization.closedBy,
      netIncome: result.netIncome,
      journal: { ...result.closingJournal.data, id: result.closingJournal.id },
      closure: { ...result.closure.data, id: result.closure.id },
    });
  } catch (error) {
    if (error instanceof AccountingMutationError) {
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
});

export default router;