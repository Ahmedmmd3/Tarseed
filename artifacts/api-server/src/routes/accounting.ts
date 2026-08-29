import { createHash } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, erpRecordsTable, teamAuditLogsTable } from "@workspace/db";
import { lockAndValidateDataGeneration, lockedWriteRejection, refreshAuthAfterOrganizationLock, requireAuth, requireCurrentDataGeneration, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";
import { isLocationAllowed } from "../lib/location-scope";
import { buildLedgerReport } from "../lib/accounting-ledger";
import { auditDetails, JournalAdjustmentError, prepareJournalAdjustment, type JournalAdjustmentAction, type JournalRecord } from "../lib/journal-adjustments";

const router: IRouter = Router();

type AnyRecord = Record<string, unknown> & { id: number };
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseExecutor = typeof db | DatabaseTransaction;

class AccountingMutationError extends Error {
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

function calculateReport(accounts: AnyRecord[], journals: AnyRecord[], from: string, to: string) {
  const balances = new Map<string, number>();
  for (const account of accounts) balances.set(String(account.id), asNumber(account.openingBalance ?? account.balance));

  const postedToDate = journals.filter((journal) => journal.status === "posted" && asDate(journal.date) <= to);
  const postedInPeriod = postedToDate.filter((journal) => inPeriod(journal, from, to));
  for (const journal of postedToDate) {
    for (const line of normalizeLines(journal.lines)) {
      const account = accounts.find((item) => String(item.id) === line.accountId);
      if (!account) continue;
      const current = balances.get(line.accountId) ?? 0;
      const debitNormal = account.type === "asset" || account.type === "expense";
      balances.set(line.accountId, current + (debitNormal ? line.debit - line.credit : line.credit - line.debit));
    }
  }

  const withBalances: Array<AnyRecord & { calculatedBalance: number }> = accounts.map((account) => {
    const balance = balances.get(String(account.id)) ?? 0;
    return { ...account, calculatedBalance: balance };
  });
  const total = (type: string) => withBalances
    .filter((account) => account.type === type && account.status !== "inactive")
    .reduce((sum, account) => sum + Math.abs(asNumber(account.calculatedBalance)), 0);
  const movementFor = (type: string) => postedInPeriod.reduce((sum, journal) => sum + normalizeLines(journal.lines).reduce((lineSum, line) => {
    const account = accounts.find((item) => String(item.id) === line.accountId);
    if (!account || account.type !== type) return lineSum;
    return lineSum + (type === "revenue" ? line.credit - line.debit : line.debit - line.credit);
  }, 0), 0);
  const revenue = movementFor("revenue");
  const expense = movementFor("expense");
  const netIncome = revenue - expense;
  const assets = total("asset");
  const liabilities = total("liability");
  const equity = total("equity") + netIncome;
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
      revenue: withBalances.filter((a) => a.type === "revenue" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: Math.abs(asNumber(a.calculatedBalance)) })),
      expense: withBalances.filter((a) => a.type === "expense" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: Math.abs(asNumber(a.calculatedBalance)) })),
      netIncome,
    },
    balanceSheet: {
      assets: withBalances.filter((a) => a.type === "asset" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: Math.abs(asNumber(a.calculatedBalance)) })),
      liabilities: withBalances.filter((a) => a.type === "liability" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: Math.abs(asNumber(a.calculatedBalance)) })),
      equity: withBalances.filter((a) => a.type === "equity" && a.status !== "inactive").map((a) => ({ id: a.id, name: a.name, amount: Math.abs(asNumber(a.calculatedBalance)) })),
      totalAssets: assets,
      totalLiabilitiesAndEquity: liabilities + equity,
    },
    journals: postedInPeriod.length,
  };
}

function derivePartyBalances(records: AnyRecord[], type: "receivable" | "payable", to: string) {
  return records
    .filter((record) => {
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
    ...purchases.map((record) => ({ record, tableName: "purchaseOrders", type: "purchase", label: "أمر شراء" })),
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
      await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
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
      });
      return "inserted" as const;
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
  if (!from || !to || from > to) {
    response.status(400).json({ error: "يجب تحديد فترة مالية صحيحة." });
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

export default router;