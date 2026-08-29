import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, erpRecordsTable } from "@workspace/db";
import { isLocationAllowed } from "../lib/location-scope";
import { lockAndValidateDataGeneration, lockedWriteRejection, refreshAuthAfterOrganizationLock, requireAuth, requireCurrentDataGeneration, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseExecutor = typeof db | DatabaseTransaction;
const SPECIALIZED_MUTATION_TABLES = new Set(["inventoryBalances", "stockTransfers", "stockAdjustments", "sales", "invoices"]);
const TABLE_MODULES: Record<string, string | string[]> = {
  products: ["inventory", "sales"], invoices: "sales", expenses: "accounting", customers: "sales", sales: "sales",
  returns_: "sales", suppliers: "inventory", purchaseOrders: "inventory", warehouses: ["inventory", "sales"],
  employees: "hr", projects: "operations", inventoryBalances: ["inventory", "sales"], stockTransfers: "inventory",
  stockAdjustments: "inventory",
  accounts: "accounting", journalEntries: "accounting", receivables: "accounting",
  financialClosures: "accounting",
};

const DEFAULT_ACCOUNT_DEFINITIONS = [
  { code: "1000", name: "الصندوق", type: "asset", parent: null, openingBalance: 0, balance: 0, status: "active" },
  { code: "1100", name: "البنك", type: "asset", parent: null, openingBalance: 0, balance: 0, status: "active" },
  { code: "1200", name: "العملاء", type: "asset", parent: null, openingBalance: 0, balance: 0, status: "active" },
  { code: "2000", name: "الموردين", type: "liability", parent: null, openingBalance: 0, balance: 0, status: "active" },
  { code: "3000", name: "رأس المال", type: "equity", parent: null, openingBalance: 0, balance: 0, status: "active" },
  { code: "4000", name: "المبيعات", type: "revenue", parent: null, openingBalance: 0, balance: 0, status: "active" },
  { code: "5000", name: "المشتريات", type: "expense", parent: null, openingBalance: 0, balance: 0, status: "active" },
  { code: "5100", name: "مصروفات الرواتب", type: "expense", parent: null, openingBalance: 0, balance: 0, status: "active" },
] as const;

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
  const clientOperationId = typeof data.clientOperationId === "string" ? data.clientOperationId : "";
  const { clientOperationId: _clientOperationId, ...recordData } = data;
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
  if (isAccountingSource(access.tableName)) {
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
      const data = { ...current.data, ...(body as Record<string, unknown>), stock: current.data.stock };
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
      const currentData = { ...current.data, ...(body as Record<string, unknown>) };
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
  if (isAccountingSource(access.tableName)) {
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