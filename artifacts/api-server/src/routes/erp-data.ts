import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, erpRecordsTable } from "@workspace/db";
import { requireAuth, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
const TABLE_MODULES: Record<string, string> = {
  products: "inventory", invoices: "sales", expenses: "accounting", customers: "sales", sales: "sales",
  returns_: "sales", suppliers: "inventory", purchaseOrders: "inventory", warehouses: "inventory",
  employees: "hr", projects: "operations", inventoryBalances: "inventory", stockTransfers: "inventory",
  stockAdjustments: "inventory",
  accounts: "accounting", journalEntries: "accounting", receivables: "accounting",
  financialClosures: "accounting",
};

function requireTableAccess(request: Request, response: Response): { auth: AuthContext; tableName: string } | null {
  const auth = response.locals.auth as AuthContext;
  const raw = Array.isArray(request.params.table) ? request.params.table[0] : request.params.table;
  const tableName = String(raw || "");
  const module = TABLE_MODULES[tableName];
  if (!module) {
    response.status(404).json({ error: "نوع البيانات غير متاح." });
    return null;
  }
  if (auth.roleId !== "owner" && auth.permissions[module] !== true) {
    response.status(403).json({ error: "ليس لديك صلاحية لهذه الوحدة." });
    return null;
  }
  return { auth, tableName };
}

function locationIds(tableName: string, data: Record<string, unknown>, recordId?: number): number[] {
  if (tableName === "warehouses") return recordId ? [recordId] : [];
  return ["warehouseId", "fromWarehouseId", "toWarehouseId"]
    .map(key => Number(data[key]))
    .filter(id => Number.isInteger(id) && id > 0);
}

function isLocationAllowed(auth: AuthContext, tableName: string, data: Record<string, unknown>, recordId?: number): boolean {
  if (auth.roleId === "owner" || auth.locationScope === "all") return true;
  const ids = locationIds(tableName, data, recordId);
  if (auth.locationScope === "none") return ids.length === 0;
  if (!ids.length) return true;
  const allowed = new Set(auth.warehouseIds.map(Number));
  return ids.every(id => allowed.has(id));
}

function isAccountingSource(tableName: string): boolean {
  return tableName === "invoices" || tableName === "purchaseOrders" || tableName === "expenses";
}

async function audit(auth: AuthContext, action: string, entity: string): Promise<void> {
  const { teamAuditLogsTable } = await import("@workspace/db");
  await db.insert(teamAuditLogsTable).values({
    organizationId: auth.organizationId,
    actorId: auth.id,
    actorName: auth.name || auth.email,
    action,
    entity,
    details: "",
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

async function isClosedDate(auth: AuthContext, date: string): Promise<boolean> {
  const closures = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, auth.organizationId),
    eq(erpRecordsTable.tableName, "financialClosures"),
  ));
  return closures.some((closure) => {
    const from = String(closure.data.from || "");
    const to = String(closure.data.to || "");
    return closure.data.status === "closed" && date >= from && date <= to;
  });
}

router.get("/data/:table", requireAuth, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  if (!access) return;
  const records = await db.select().from(erpRecordsTable)
    .where(and(eq(erpRecordsTable.organizationId, access.auth.organizationId), eq(erpRecordsTable.tableName, access.tableName)));
  const data = records
    .filter(record => isLocationAllowed(access.auth, access.tableName, record.data, record.id))
    .map(record => ({ ...record.data, id: record.id, userId: access.auth.organizationId }));
  response.json({ records: data });
});

router.post("/data/:table", requireAuth, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  if (!access) return;
  if (access.tableName === "warehouses" && access.auth.roleId !== "owner") {
    response.status(403).json({ error: "إنشاء مواقع التشغيل متاح لمالك المنشأة فقط." });
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
  const [record] = await db.insert(erpRecordsTable).values({
    organizationId: access.auth.organizationId,
    tableName: access.tableName,
    data: body as Record<string, unknown>,
  }).returning();
  await audit(access.auth, `${access.tableName}_created`, String(record.id));
  response.status(201).json({ record: { ...record.data, id: record.id, userId: access.auth.organizationId } });
});

router.patch("/data/:table/:id", requireAuth, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  const id = Number(request.params.id);
  if (!access || !Number.isInteger(id)) {
    if (access) response.status(400).json({ error: "معرّف السجل غير صالح." });
    return;
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
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات السجل غير صحيحة." });
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
  const [updated] = await db.update(erpRecordsTable).set({ data, updatedAt: new Date() }).where(eq(erpRecordsTable.id, id)).returning();
  await audit(access.auth, `${access.tableName}_updated`, String(id));
  response.json({ record: { ...updated.data, id: updated.id, userId: access.auth.organizationId } });
});

router.delete("/data/:table/:id", requireAuth, async (request: Request, response: Response): Promise<void> => {
  const access = requireTableAccess(request, response);
  const id = Number(request.params.id);
  if (!access || !Number.isInteger(id)) {
    if (access) response.status(400).json({ error: "معرّف السجل غير صالح." });
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
  await db.delete(erpRecordsTable).where(eq(erpRecordsTable.id, id));
  await audit(access.auth, `${access.tableName}_deleted`, String(id));
  response.sendStatus(204);
});

export default router;