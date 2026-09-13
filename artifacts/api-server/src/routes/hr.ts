import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, erpRecordsTable, organizationsTable, teamAuditLogsTable } from "@workspace/db";
import {
  lockAndValidateDataGeneration,
  lockedWriteRejection,
  refreshAuthAfterOrganizationLock,
  requireAuth,
  requireCurrentDataGeneration,
  requireSubscriptionAccess,
  type AuthContext,
} from "../middleware/team-auth";
import { resolveTransactionDimensions, TransactionDimensionError } from "../lib/transaction-dimensions";

const router: IRouter = Router();
const PAYROLL_LOCK_NAMESPACE = 0x48525052;
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function hasHrAccess(auth: AuthContext): boolean {
  return auth.roleId === "owner" || auth.permissions.hr === true;
}

function hasPayrollAccess(auth: AuthContext): boolean {
  return auth.roleId === "owner" || (auth.permissions.hr === true && auth.permissions.accounting === true);
}

function money(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function isActiveEmployee(data: Record<string, unknown>): boolean {
  return data.status !== "suspended" && data.status !== "terminated" && data.status !== "inactive";
}

function salaryPart(primary: unknown, legacy?: unknown): number {
  return money(primary === "" || primary == null ? legacy : primary);
}

function validMonthYear(month: unknown, year: unknown): boolean {
  return Number.isInteger(Number(month)) && Number(month) >= 1 && Number(month) <= 12
    && Number.isInteger(Number(year)) && Number(year) >= 1900 && Number(year) <= 9999;
}

function payrollDate(month: number, year: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

function monthEnd(month: number, year: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

async function isClosedPayrollPeriod(
  tx: DatabaseTransaction,
  organizationId: number,
  month: number,
  year: number,
): Promise<boolean> {
  const from = payrollDate(month, year);
  const to = monthEnd(month, year);
  const [organization] = await tx.select({
    fiscalYearClosed: organizationsTable.fiscalYearClosed,
    closedYear: organizationsTable.closedYear,
  }).from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  if (organization?.fiscalYearClosed && Number(organization.closedYear) === year) return true;
  const closures = await tx.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "financialClosures"),
  ));
  return closures.some((closure) => closure.data.status === "closed"
    && from <= String(closure.data.to ?? "") && to >= String(closure.data.from ?? ""));
}

function outputRun(row: typeof erpRecordsTable.$inferSelect): Record<string, unknown> {
  return { ...(row.data as Record<string, unknown>), id: row.id };
}

router.get("/hr/summary", requireAuth, requireSubscriptionAccess, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  if (!hasHrAccess(auth)) {
    response.status(403).json({ error: "ليس لديك صلاحية لوحدة الموارد البشرية." });
    return;
  }
  const rows = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, auth.organizationId),
    sql`${erpRecordsTable.tableName} in ('employees', 'leaveRequests')`,
  ));
  const employees = rows.filter((row) => row.tableName === "employees").map((row) => row.data);
  const leaves = rows.filter((row) => row.tableName === "leaveRequests").map((row) => row.data);
  const active = employees.filter(isActiveEmployee);
  const monthlySalary = active.reduce((sum, employee) => sum
    + salaryPart(employee.basicSalary, employee.salary)
    + money(employee.housingAllowance)
    + money(employee.transportAllowance)
    + money(employee.otherAllowances), 0);
  response.json({
    activeEmployeeCount: active.length,
    monthlySalaryTotal: Math.round(monthlySalary * 100) / 100,
    pendingLeaves: leaves.filter((leave) => leave.status === "pending").length,
  });
});

router.post("/hr/payroll-runs", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  if (!hasPayrollAccess(auth)) {
    response.status(403).json({ error: "إنشاء مسير الرواتب يتطلب صلاحية الموارد البشرية والمحاسبة." });
    return;
  }
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
  const month = Number(body.month);
  const year = Number(body.year);
  if (!validMonthYear(month, year)) {
    response.status(400).json({ error: "الشهر أو السنة غير صالحين." });
    return;
  }
  const explicitBranchId = Object.hasOwn(body, "branchId")
    ? (body.branchId === "" || body.branchId == null ? null : Number(body.branchId))
    : undefined;
  if (explicitBranchId !== undefined && explicitBranchId !== null
    && (!Number.isInteger(explicitBranchId) || explicitBranchId <= 0)) {
    response.status(400).json({ error: "الفرع غير صالح." });
    return;
  }
  const operationId = request.get("Idempotency-Key")?.trim() || `PAYROLL-${year}-${month}`;
  if (operationId.length > 200) {
    response.status(400).json({ error: "معرّف العملية طويل جداً." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) return null;
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || !hasPayrollAccess(currentAuth)) {
        response.locals.writeAccessFailure = "authorization_changed";
        return null;
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${PAYROLL_LOCK_NAMESPACE}, ${currentAuth.organizationId})`);

      const existingRows = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "payrollRuns"),
      )).for("update");
      const requestedBranchId = explicitBranchId === undefined ? currentAuth.defaultBranchId : explicitBranchId;
      const sameRequest = (row: typeof erpRecordsTable.$inferSelect): boolean =>
        Number(row.data.month) === month
        && Number(row.data.year) === year
        && (row.data.branchId == null ? null : Number(row.data.branchId)) === requestedBranchId;
      const existingOperation = existingRows.find((row) => row.clientOperationId === operationId);
      if (existingOperation) {
        if (!sameRequest(existingOperation)) {
          throw Object.assign(new Error("معرّف العملية مستخدم لمسير شهر أو فرع مختلف."), { status: 409 });
        }
        return { run: existingOperation, replayed: true };
      }
      const existingMonth = existingRows.find((row) =>
        Number(row.data.month) === month && Number(row.data.year) === year,
      );
      if (existingMonth) {
        if (!sameRequest(existingMonth)) {
          throw Object.assign(new Error("تم إنشاء مسير هذا الشهر لفرع مختلف بالفعل."), { status: 409 });
        }
        return { run: existingMonth, replayed: true };
      }

      if (await isClosedPayrollPeriod(tx, currentAuth.organizationId, month, year)) {
        throw Object.assign(new Error("الفترة المالية المحددة مقفلة ولا يمكن إنشاء مسير فيها."), { status: 409 });
      }

      const accountRows = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "accounts"),
      )).for("update");
      const byCode = new Map(accountRows.map((row) => [String(row.data.code), row]));
      const salaryAccount = byCode.get("5200");
      const cashAccount = byCode.get("1000");
      const bankAccount = byCode.get("1100");
      if (!salaryAccount || salaryAccount.data.status === "inactive") {
        throw Object.assign(new Error("حساب مصروف الرواتب 5200 غير موجود أو موقوف."), { status: 409 });
      }
      if (salaryAccount.data.type !== "expense") {
        throw Object.assign(new Error("الحساب 5200 يجب أن يكون حساب مصروف قابل للترحيل."), { status: 409 });
      }
      const settlementAccounts = [cashAccount, bankAccount].filter((account) => account != null);
      if (settlementAccounts.some((account) => account.data.type !== "asset")) {
        throw Object.assign(new Error("حسابا الصندوق والبنك يجب أن يكونا من نوع الأصول."), { status: 409 });
      }
      const postingAccountIds = new Set(
        [salaryAccount, ...settlementAccounts].map((account) => account.id),
      );
      if (accountRows.some((row) => {
        const parentId = Number(row.data.parent);
        return Number.isInteger(parentId) && postingAccountIds.has(parentId);
      })) {
        throw Object.assign(new Error("حسابات مسير الرواتب يجب أن تكون حسابات فرعية قابلة للترحيل وليست حسابات تجميعية."), { status: 409 });
      }

      const employeeRows = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, currentAuth.organizationId),
        eq(erpRecordsTable.tableName, "employees"),
      )).for("update");
      const employees = employeeRows.filter((row) => isActiveEmployee(row.data));
      if (!employees.length) throw Object.assign(new Error("لا يوجد موظفون نشطون لإنشاء المسير."), { status: 409 });
      const credits = new Map<number, number>();
      const employeeLines: Array<Record<string, unknown>> = [];
      let totalAmount = 0;
      for (const employee of employees) {
        const data = employee.data;
        const salaryParts = [
          salaryPart(data.basicSalary, data.salary),
          money(data.housingAllowance),
          money(data.transportAllowance),
          money(data.otherAllowances),
        ];
        if (salaryParts.some((part) => part < 0)) {
          throw Object.assign(new Error("يوجد راتب أو بدل سالب في بيانات موظف نشط."), { status: 400 });
        }
        const amount = money(salaryParts.reduce((sum, part) => sum + part, 0));
        totalAmount += amount;
        const paysCash = data.paymentMethod === "cash";
        const account = paysCash ? cashAccount : bankAccount;
        if (!account || account.data.status === "inactive") {
          throw Object.assign(
            new Error(paysCash ? "حساب الصندوق 1000 غير موجود أو موقوف." : "حساب البنك 1100 غير موجود أو موقوف."),
            { status: 409 },
          );
        }
        credits.set(account.id, money((credits.get(account.id) ?? 0) + amount));
        employeeLines.push({
          employeeId: employee.id,
          employeeCode: data.employeeCode ?? "",
          name: String(data.name ?? ""),
          basicSalary: salaryParts[0],
          housingAllowance: salaryParts[1],
          transportAllowance: salaryParts[2],
          otherAllowances: salaryParts[3],
          totalAmount: amount,
          paymentMethod: paysCash ? "cash" : "bank",
          bankName: paysCash ? "" : String(data.bankName ?? ""),
          iban: paysCash ? "" : String(data.iban ?? ""),
        });
      }
      totalAmount = money(totalAmount);
      if (totalAmount <= 0) throw Object.assign(new Error("إجمالي رواتب الموظفين النشطين يجب أن يكون أكبر من صفر."), { status: 400 });
      const dimensionInput = explicitBranchId === undefined ? {} : { branchId: explicitBranchId };
      const dimensions = await resolveTransactionDimensions(tx, currentAuth, dimensionInput, true);
      const lines = [
        { accountId: String(salaryAccount.id), debit: totalAmount, credit: 0, description: "مصروف الرواتب", ...dimensions },
        ...[...credits.entries()].filter(([, amount]) => amount > 0).map(([accountId, amount]) => ({
          accountId: String(accountId), debit: 0, credit: amount,
          description: accountId === cashAccount?.id ? "صرف نقدي" : "تحويل بنكي",
          ...dimensions,
        })),
      ];
      const [run] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "payrollRuns",
        clientOperationId: operationId,
        data: {
          month, year, totalAmount, status: "paid",
          branchId: dimensions.branchId,
          employeeCount: employees.length,
          employeeLines,
          bankAmount: bankAccount ? credits.get(bankAccount.id) ?? 0 : 0,
          cashAmount: cashAccount ? credits.get(cashAccount.id) ?? 0 : 0,
          journalId: null,
        },
      }).returning();
      if (!run) throw new Error("تعذر حفظ مسير الرواتب.");
      const [journal] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "journalEntries",
        clientOperationId: `${operationId}:journal`,
        data: {
          number: `PAY-${year}-${String(month).padStart(2, "0")}-${run.id}`,
          date: monthEnd(month, year),
          description: `مسير رواتب ${String(month).padStart(2, "0")}/${year}`,
          status: "posted",
          sourceType: "payroll",
          sourceId: run.id,
          operationId,
          ...dimensions,
          lines,
        },
      }).returning();
      if (!journal) throw new Error("تعذر إنشاء قيد مسير الرواتب.");
      const [updated] = await tx.update(erpRecordsTable).set({
        data: { ...run.data, journalId: journal.id },
        updatedAt: new Date(),
      }).where(eq(erpRecordsTable.id, run.id)).returning();
      await tx.insert(teamAuditLogsTable).values({
        organizationId: currentAuth.organizationId,
        actorId: currentAuth.id,
        actorName: currentAuth.name || currentAuth.email,
        action: "payroll_run_created",
        entity: String(run.id),
        details: JSON.stringify({ month, year, totalAmount, journalId: journal.id }),
      });
      return { run: updated, replayed: false };
    });
    if (!result) {
      const rejection = lockedWriteRejection(response);
      response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
      return;
    }
    response.status(result.replayed ? 200 : 201).json({ run: outputRun(result.run), replayed: result.replayed });
  } catch (error) {
    const status = error instanceof TransactionDimensionError
      ? error.status
      : typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : 500;
    if (status !== 500) {
      response.status(status).json({ error: error instanceof Error ? error.message : "تعذر إنشاء مسير الرواتب." });
      return;
    }
    throw error;
  }
});

export default router;