import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, erpRecordsTable, organizationsTable, teamAuditLogsTable } from "@workspace/db";
import { requireAuth, requireOwner, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
const BACKUP_VERSION = 1;
const MAX_RECORDS = 25_000;
const BACKUP_TABLE_NAMES = [
  "products", "invoices", "expenses", "customers", "sales", "returns_", "suppliers",
  "purchaseOrders", "warehouses", "employees", "projects", "inventoryBalances",
  "stockTransfers", "stockAdjustments", "accounts", "journalEntries", "receivables",
  "financialClosures",
] as const;
const TABLE_NAMES = new Set<string>(BACKUP_TABLE_NAMES);

type BackupRecord = {
  id: number;
  tableName: string;
  clientOperationId: string | null;
  data: Record<string, unknown>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 20 || value === null || typeof value === "string" || typeof value === "boolean") return depth <= 20;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isPlainRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function accountReferenceId(value: unknown): number | null {
  if (isPositiveId(value)) return value;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isOptionalDateOrTimestamp(value: unknown): boolean {
  if (value === "") return true;
  if (isDate(value)) return true;
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  return Boolean(match && isDate(match[1]) && !Number.isNaN(Date.parse(value)));
}

function hasName(data: Record<string, unknown>): boolean {
  return isNonEmptyString(data.name) || isNonEmptyString(data.companyName) || isNonEmptyString(data.fullName);
}

function hasPositiveOrZeroAmount(data: Record<string, unknown>): boolean {
  return ["amount", "total", "totalAmount", "balance", "openingBalance"]
    .some((key) => data[key] !== undefined && isNonNegativeNumber(data[key]));
}

function validateJournal(data: Record<string, unknown>, accountIds: Set<number>): string | null {
  if (!isDate(data.date) || !isNonEmptyString(data.description)) return "يحتوي الملف على قيد بلا تاريخ أو بيان.";
  if (data.status !== "draft" && data.status !== "posted") return "يحتوي الملف على حالة قيد غير صحيحة.";
  if (!Array.isArray(data.lines) || data.lines.length < 2) return "يحتوي الملف على قيد غير مكتمل.";
  let debit = 0;
  let credit = 0;
  for (const rawLine of data.lines) {
    const accountId = isPlainRecord(rawLine) ? accountReferenceId(rawLine.accountId) : null;
    if (!isPlainRecord(rawLine) || accountId === null || !accountIds.has(accountId)) {
      return "يشير القيد إلى حساب غير موجود في النسخة.";
    }
    const lineDebit = rawLine.debit;
    const lineCredit = rawLine.credit;
    if (!isNonNegativeNumber(lineDebit) || !isNonNegativeNumber(lineCredit)) {
      return "يحتوي الملف على مبالغ قيد غير صحيحة.";
    }
    if ((lineDebit === 0 && lineCredit === 0) || (lineDebit > 0 && lineCredit > 0)) {
      return "يحتوي الملف على مبالغ قيد غير صحيحة.";
    }
    debit += lineDebit;
    credit += lineCredit;
  }
  return Math.abs(debit - credit) > 0.005 ? "إجمالي المدين والدائن غير متساوٍ في النسخة." : null;
}

type ClosureTotals = Record<"revenue" | "expense" | "netIncome" | "assets" | "liabilities" | "equity" | "trialDebit" | "trialCredit", number>;
type ClosureSnapshot = {
  totals: ClosureTotals;
  trialBalance: Array<{ id: number; code: string; name: string; type: string; debit: number; credit: number }>;
  receivables: Array<Record<string, unknown>>;
  payables: Array<Record<string, unknown>>;
};

function closureRecordDate(data: Record<string, unknown>): string {
  const value = data.date ?? data.issueDate ?? data.createdAt;
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function calculateClosureSnapshot(records: BackupRecord[], from: string, to: string): ClosureSnapshot {
  const accounts: Array<Record<string, unknown> & { id: number }> = records
    .filter((record) => record.tableName === "accounts")
    .map((record) => ({ ...record.data, id: record.id }));
  const journals = records.filter((record) => record.tableName === "journalEntries").map((record) => record.data);
  const balances = new Map(accounts.map((account) => [
    String(account.id),
    isFiniteNumber(account.openingBalance) ? account.openingBalance : isFiniteNumber(account.balance) ? account.balance : 0,
  ]));
  const postedToDate = journals.filter((journal) => journal.status === "posted" && closureRecordDate(journal) <= to);
  const postedInPeriod = postedToDate.filter((journal) => {
    const date = closureRecordDate(journal);
    return date >= from && date <= to;
  });
  const journalLines = (journal: Record<string, unknown>) => Array.isArray(journal.lines)
    ? journal.lines.filter(isPlainRecord).map((line) => ({
      accountId: String(line.accountId),
      debit: line.debit as number,
      credit: line.credit as number,
    })) : [];
  for (const journal of postedToDate) {
    for (const line of journalLines(journal)) {
      const account = accounts.find((candidate) => String(candidate.id) === line.accountId);
      if (!account) continue;
      const debitNormal = account.type === "asset" || account.type === "expense";
      balances.set(line.accountId, (balances.get(line.accountId) ?? 0) + (debitNormal ? line.debit - line.credit : line.credit - line.debit));
    }
  }
  const activeAccounts = accounts.filter((account) => account.status !== "inactive");
  const total = (type: string) => activeAccounts
    .filter((account) => account.type === type)
    .reduce((sum, account) => sum + Math.abs(balances.get(String(account.id)) ?? 0), 0);
  const movementFor = (type: string) => postedInPeriod.reduce((sum, journal) => sum + journalLines(journal).reduce((lineSum, line) => {
    const account = accounts.find((candidate) => String(candidate.id) === line.accountId);
    if (!account || account.type !== type) return lineSum;
    return lineSum + (type === "revenue" ? line.credit - line.debit : line.debit - line.credit);
  }, 0), 0);
  const revenue = movementFor("revenue");
  const expense = movementFor("expense");
  const netIncome = revenue - expense;
  const trialBalance = activeAccounts.map((account) => {
    const balance = balances.get(String(account.id)) ?? 0;
    const debitNormal = account.type === "asset" || account.type === "expense";
    const debit = debitNormal ? balance : -balance;
    const credit = debitNormal ? -balance : balance;
    return { id: account.id as number, code: String(account.code), name: String(account.name), type: String(account.type), debit: Math.max(0, debit), credit: Math.max(0, credit) };
  });
  const derivePartyBalances = (source: BackupRecord[], type: "receivable" | "payable") => source
    .filter((record) => {
      const data = record.data;
      const date = closureRecordDate(data);
      return (data.type === type || (type === "receivable" && data.customerId) || (type === "payable" && data.supplierId)) && (!date || date <= to);
    })
    .map((record) => {
      const data = record.data;
      const amount = (data.amount ?? data.total ?? data.totalAmount) as number;
      const paid = (data.paid ?? data.paidAmount ?? data.amountPaid ?? 0) as number;
      const normalizedPaid = Math.min(amount, paid);
      return {
        id: record.id,
        party: String(data.party ?? data.customerName ?? data.supplierName ?? "غير محدد"),
        type,
        reference: String(data.reference ?? data.invoiceNumber ?? data.number ?? `#${record.id}`),
        dueDate: closureRecordDate({ date: data.dueDate ?? data.date }),
        amount,
        paid: normalizedPaid,
        remaining: Math.max(0, amount - paid),
        status: amount <= paid ? "paid" : paid > 0 ? "partial" : "unpaid",
      };
    });
  const receivables = records.filter((record) => record.tableName === "receivables");
  const invoices = records.filter((record) => record.tableName === "invoices");
  const purchases = records.filter((record) => record.tableName === "purchaseOrders");
  const sourceReceivables = receivables.length ? receivables : invoices;
  const sourcePayables = receivables.some((record) => record.data.type === "payable") ? receivables : purchases;
  const totals: ClosureTotals = {
    revenue, expense, netIncome, assets: total("asset"), liabilities: total("liability"),
    equity: total("equity") + netIncome,
    trialDebit: trialBalance.reduce((sum, account) => sum + account.debit, 0),
    trialCredit: trialBalance.reduce((sum, account) => sum + account.credit, 0),
  };
  return { totals, trialBalance, receivables: derivePartyBalances(sourceReceivables, "receivable"), payables: derivePartyBalances(sourcePayables, "payable") };
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (isFiniteNumber(left) && isFiniteNumber(right)) return Math.abs(left - right) < 0.00001;
  return left === right;
}

function validateFinancialClosure(data: Record<string, unknown>, accountIds: Set<number>, expected: ClosureSnapshot): boolean {
  const totalKeys = ["revenue", "expense", "netIncome", "assets", "liabilities", "equity", "trialDebit", "trialCredit"];
  const totals = data.totals;
  if (!isFiniteNumber(data.netIncome) || !isPlainRecord(totals)
    || !totalKeys.every((key) => isFiniteNumber(totals[key])) || !Array.isArray(data.trialBalance)
    || !Array.isArray(data.receivables) || !Array.isArray(data.payables)) {
    return false;
  }
  const numericTotals = totals as Record<string, number>;
  if (!data.trialBalance.every((line) => isPlainRecord(line)
    && isPositiveId(line.id) && accountIds.has(line.id)
    && isNonEmptyString(line.code) && isNonEmptyString(line.name)
    && ["asset", "liability", "equity", "revenue", "expense"].includes(String(line.type))
    && isNonNegativeNumber(line.debit) && isNonNegativeNumber(line.credit))) {
    return false;
  }
  const hasValidPartyBalance = (value: unknown): boolean => isPlainRecord(value)
    && isPositiveId(value.id) && isNonEmptyString(value.party)
    && ["receivable", "payable"].includes(String(value.type))
    && isNonNegativeNumber(value.amount) && isNonNegativeNumber(value.paid)
    && isNonNegativeNumber(value.remaining) && value.paid <= value.amount
    && Math.abs(value.remaining - (value.amount - value.paid)) < 0.00001;
  const trialDebit = data.trialBalance.reduce((sum, line) => sum + Number((line as Record<string, unknown>).debit), 0);
  const trialCredit = data.trialBalance.reduce((sum, line) => sum + Number((line as Record<string, unknown>).credit), 0);
  const expectedTrialBalance = expected.trialBalance;
  const matchesExpectedTrialBalance = data.trialBalance.length === expectedTrialBalance.length
    && data.trialBalance.every((line, index) => {
      const actual = line as Record<string, unknown>;
      const target = expectedTrialBalance[index];
      return Object.entries(target).every(([key, value]) => sameJsonValue(actual[key], value));
    });
  const matchesExpectedParties = (actual: unknown[], target: Array<Record<string, unknown>>) => actual.length === target.length
    && actual.every((item, index) => isPlainRecord(item)
      && Object.entries(target[index]).every(([key, value]) => sameJsonValue(item[key], value)));
  return data.netIncome === numericTotals.netIncome
    && numericTotals.netIncome === numericTotals.revenue - numericTotals.expense
    && Math.abs(numericTotals.trialDebit - trialDebit) < 0.00001
    && Math.abs(numericTotals.trialCredit - trialCredit) < 0.00001
    && Math.abs(numericTotals.trialDebit - numericTotals.trialCredit) < 0.00001
    && totalKeys.every((key) => Math.abs(numericTotals[key as keyof ClosureTotals] - expected.totals[key as keyof ClosureTotals]) < 0.00001)
    && matchesExpectedTrialBalance
    && data.receivables.every(hasValidPartyBalance) && data.payables.every(hasValidPartyBalance)
    && matchesExpectedParties(data.receivables, expected.receivables)
    && matchesExpectedParties(data.payables, expected.payables);
}

function validateBackupRecords(records: BackupRecord[]): string | null {
  const idsByTable = new Map<string, Set<number>>();
  for (const record of records) {
    const ids = idsByTable.get(record.tableName) ?? new Set<number>();
    ids.add(record.id);
    idsByTable.set(record.tableName, ids);
    if (Object.keys(record.data).length === 0 || !isJsonValue(record.data)) {
      return "يحتوي الملف على بيانات سجل فارغة أو غير قابلة للقراءة.";
    }
  }
  const hasReference = (tableName: string, value: unknown): boolean =>
    isPositiveId(value) && (idsByTable.get(tableName)?.has(Number(value)) ?? false);
  const productBalances = new Map<number, number>();

  for (const record of records) {
    const data = record.data;
    for (const key of ["date", "issueDate", "dueDate", "createdAt", "updatedAt", "closedAt", "approvedAt", "cancelledAt", "receivedAt"]) {
      if (data[key] !== undefined && !isOptionalDateOrTimestamp(data[key])) {
        return "يحتوي الملف على تاريخ أو وقت غير صالح.";
      }
    }
    if (record.tableName === "accounts" && (!isNonEmptyString(data.code) || !isNonEmptyString(data.name)
      || !["asset", "liability", "equity", "revenue", "expense"].includes(String(data.type))
      || (data.balance !== undefined && !isNonNegativeNumber(data.balance))
      || (data.openingBalance !== undefined && !isNonNegativeNumber(data.openingBalance)))) {
      return "يحتوي الملف على حساب محاسبي بلا رمز أو اسم.";
    }
    if (record.tableName === "journalEntries") {
      const error = validateJournal(data, idsByTable.get("accounts") ?? new Set<number>());
      if (error) return error;
    }
    if (record.tableName === "products" && (!isNonEmptyString(data.name)
      || (data.stock !== undefined && !isNonNegativeNumber(data.stock))
      || ["sellPrice", "purchasePrice", "cost", "price"].some((key) => data[key] !== undefined && !isNonNegativeNumber(data[key])))) {
      return "يحتوي الملف على منتج غير صالح.";
    }
    if (record.tableName === "warehouses"
      && (!isNonEmptyString(data.name) || (data.status !== undefined && !["active", "inactive"].includes(String(data.status))))) {
      return "يحتوي الملف على موقع تشغيل بلا اسم.";
    }
    if (record.tableName === "customers" || record.tableName === "suppliers") {
      if (!hasName(data)) return "يحتوي الملف على عميل أو مورد بلا اسم.";
    }
    if (record.tableName === "employees" && !hasName(data)) {
      return "يحتوي الملف على موظف بلا اسم.";
    }
    if (record.tableName === "projects" && !isNonEmptyString(data.name)) {
      return "يحتوي الملف على مشروع بلا اسم.";
    }
    if (record.tableName === "invoices" || record.tableName === "expenses" || record.tableName === "purchaseOrders") {
      const counterpartyTable = record.tableName === "invoices" ? "customers" : record.tableName === "purchaseOrders" ? "suppliers" : "";
      const counterpartyId = record.tableName === "invoices" ? data.customerId : record.tableName === "purchaseOrders" ? data.supplierId : undefined;
      if (!hasPositiveOrZeroAmount(data)
        || (counterpartyId !== undefined && !hasReference(counterpartyTable, counterpartyId))
        || ![data.number, data.invoiceNumber, data.reference, data.description, data.name].some(isNonEmptyString)) {
        return "يحتوي الملف على مستند مالي بلا مبلغ أو مرجع صالح.";
      }
    }
    if (record.tableName === "receivables") {
      const amount = data.amount;
      const paid = data.paid === undefined ? 0 : data.paid;
      if (!isNonEmptyString(data.party) || !["receivable", "payable"].includes(String(data.type))
        || !isNonNegativeNumber(amount) || !isNonNegativeNumber(paid)) {
        return "يحتوي الملف على ذمة مدينة أو دائنة غير صالحة.";
      }
      if (paid > amount) return "يحتوي الملف على ذمة مدينة أو دائنة غير صالحة.";
    }
    if (record.tableName === "returns_" && (!isNonEmptyString(data.reason) || !hasPositiveOrZeroAmount(data))) {
      return "يحتوي الملف على مرتجع بلا سبب أو مبلغ صالح.";
    }
    if (record.tableName === "inventoryBalances") {
      if (!hasReference("products", data.productId) || !hasReference("warehouses", data.warehouseId) || !isNonNegativeNumber(data.quantity)) {
        return "يحتوي الملف على رصيد مخزون غير صالح أو يشير إلى منتج أو موقع مفقود.";
      }
      const productId = Number(data.productId);
      productBalances.set(productId, (productBalances.get(productId) ?? 0) + Number(data.quantity));
    }
    if (record.tableName === "stockTransfers") {
      if (!hasReference("products", data.productId) || !hasReference("warehouses", data.fromWarehouseId)
        || !hasReference("warehouses", data.toWarehouseId) || data.fromWarehouseId === data.toWarehouseId
        || !isPositiveNumber(data.quantity) || !["pending", "approved", "cancelled", "received"].includes(String(data.status))) {
        return "يحتوي الملف على تحويل مخزون غير صالح.";
      }
    }
    if (record.tableName === "stockAdjustments" || record.tableName === "sales") {
      const quantity = record.tableName === "stockAdjustments" ? data.actualQuantity : data.quantity;
      if (!hasReference("products", data.productId) || !hasReference("warehouses", data.warehouseId)
        || !(record.tableName === "sales" ? isPositiveNumber(quantity) : isNonNegativeNumber(quantity))
        || (record.tableName === "stockAdjustments" && data.previousQuantity !== undefined && !isNonNegativeNumber(data.previousQuantity))
        || (record.tableName === "stockAdjustments" && data.delta !== undefined
          && (typeof data.delta !== "number" || !Number.isFinite(data.delta) || typeof data.actualQuantity !== "number"
            || typeof data.previousQuantity !== "number"
            || Math.abs(data.delta - (data.actualQuantity - data.previousQuantity)) > 0.00001))) {
        return "يحتوي الملف على حركة مخزون غير صالحة.";
      }
    }
    if (record.tableName === "financialClosures"
      && (!isDate(data.from) || !isDate(data.to) || String(data.from) > String(data.to) || data.status !== "closed"
        || !validateFinancialClosure(
          data,
          idsByTable.get("accounts") ?? new Set<number>(),
          calculateClosureSnapshot(records, String(data.from), String(data.to)),
        ))) {
      return "يحتوي الملف على إقفال مالي غير صالح.";
    }
  }

  for (const record of records.filter((item) => item.tableName === "products")) {
    if (record.data.stock !== undefined && Math.abs(Number(record.data.stock) - (productBalances.get(record.id) ?? 0)) > 0.00001) {
      return "إجمالي أحد المنتجات لا يطابق مجموع أرصدة المواقع في النسخة.";
    }
  }
  return null;
}

function parseBackup(value: unknown): { records?: BackupRecord[]; organizationId?: number; error?: string } {
  if (!isPlainRecord(value) || value.version !== BACKUP_VERSION || !Array.isArray(value.records)) {
    return { error: "ملف النسخة الاحتياطية غير مدعوم أو تالف." };
  }
  if (!Number.isSafeInteger(value.organizationId) || Number(value.organizationId) <= 0) {
    return { error: "لا يمكن التحقق من مالك هذه النسخة الاحتياطية." };
  }
  if (value.records.length > MAX_RECORDS) {
    return { error: "حجم النسخة الاحتياطية أكبر من الحد المسموح." };
  }

  const ids = new Set<number>();
  const clientOperationIds = new Set<string>();
  const records: BackupRecord[] = [];
  for (const rawRecord of value.records) {
    if (!isPlainRecord(rawRecord)) return { error: "يحتوي الملف على سجل غير صحيح." };
    const id = rawRecord.id;
    const tableName = rawRecord.tableName;
    const clientOperationId = rawRecord.clientOperationId;
    if (!Number.isSafeInteger(id) || Number(id) <= 0 || typeof tableName !== "string" || !TABLE_NAMES.has(tableName) || !isPlainRecord(rawRecord.data)) {
      return { error: "يحتوي الملف على بيانات غير صحيحة." };
    }
    if (ids.has(Number(id))) return { error: "يحتوي الملف على معرّفات سجلات مكررة." };
    if (clientOperationId !== null && clientOperationId !== undefined && (typeof clientOperationId !== "string" || clientOperationId.length > 200)) {
      return { error: "معرّف العملية في الملف غير صحيح." };
    }
    const normalizedClientOperationId = clientOperationId ?? null;
    if (normalizedClientOperationId !== null) {
      const operationKey = `${tableName}\u0000${normalizedClientOperationId}`;
      if (clientOperationIds.has(operationKey)) return { error: "يحتوي الملف على معرّفات عمليات مكررة." };
      clientOperationIds.add(operationKey);
    }
    ids.add(Number(id));
    records.push({
      id: Number(id),
      tableName,
      clientOperationId: normalizedClientOperationId,
      data: rawRecord.data,
    });
  }

  const semanticError = validateBackupRecords(records);
  return semanticError ? { error: semanticError } : { records, organizationId: Number(value.organizationId) };
}

router.get("/backup/export", requireAuth, requireOwner, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const records = await db.select({
    id: erpRecordsTable.id,
    tableName: erpRecordsTable.tableName,
    clientOperationId: erpRecordsTable.clientOperationId,
    data: erpRecordsTable.data,
  }).from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, auth.organizationId),
    inArray(erpRecordsTable.tableName, BACKUP_TABLE_NAMES),
  ));

  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="tarseed-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  response.json({
    version: BACKUP_VERSION,
    organizationId: auth.organizationId,
    projectName: auth.projectName,
    exportedAt: new Date().toISOString(),
    records,
  });
});

router.post("/backup/restore", requireAuth, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const parsed = parseBackup(request.body);
  if (parsed.error || !parsed.records) {
    response.status(400).json({ error: parsed.error ?? "ملف النسخة الاحتياطية غير صالح." });
    return;
  }
  if (parsed.organizationId !== undefined && parsed.organizationId !== auth.organizationId) {
    response.status(409).json({ error: "هذه النسخة الاحتياطية تخص منشأة أخرى." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const ids = parsed.records!.map((record) => record.id);
    if (ids.length > 0) {
      const [foreignRecord] = await tx.select({ id: erpRecordsTable.id })
        .from(erpRecordsTable)
        .where(and(inArray(erpRecordsTable.id, ids), sql`${erpRecordsTable.organizationId} <> ${auth.organizationId}`))
        .limit(1);
      if (foreignRecord) return { kind: "conflict" as const };
    }

    const [organization] = await tx.update(organizationsTable)
      .set({ dataGeneration: sql`${organizationsTable.dataGeneration} + 1` })
      .where(eq(organizationsTable.id, auth.organizationId))
      .returning({ dataGeneration: organizationsTable.dataGeneration });
    if (!organization) return { kind: "missing_organization" as const };

    await tx.delete(erpRecordsTable).where(eq(erpRecordsTable.organizationId, auth.organizationId));
    if (parsed.records!.length > 0) {
      await tx.insert(erpRecordsTable).values(parsed.records!.map((record) => ({
        id: record.id,
        organizationId: auth.organizationId,
        tableName: record.tableName,
        clientOperationId: record.clientOperationId,
        data: record.data,
      })));
    }
    await tx.execute(sql`
      SELECT setval(
        pg_get_serial_sequence('erp_records', 'id'),
        COALESCE((SELECT MAX(id) FROM erp_records), 1),
        (SELECT MAX(id) IS NOT NULL FROM erp_records)
      )
    `);
    return { kind: "restored" as const, dataGeneration: organization.dataGeneration };
  });

  if (result.kind === "conflict") {
    response.status(409).json({ error: "لا يمكن استعادة ملف يتعارض مع سجلات منشأة أخرى." });
    return;
  }
  if (result.kind === "missing_organization") {
    response.status(404).json({ error: "المنشأة غير متاحة." });
    return;
  }

  await db.insert(teamAuditLogsTable).values({
    organizationId: auth.organizationId,
    actorId: auth.id,
    actorName: auth.name || auth.email,
    action: "erp_backup_restored",
    entity: "erp_records",
    details: `${parsed.records.length} records`,
  });
  response.json({
    message: "تمت استعادة النسخة الاحتياطية بنجاح.",
    recordCount: parsed.records.length,
    dataGeneration: result.dataGeneration,
  });
});

export default router;