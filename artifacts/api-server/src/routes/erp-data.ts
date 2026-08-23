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
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات السجل غير صحيحة." });
    return;
  }
  if (!isLocationAllowed(access.auth, access.tableName, body as Record<string, unknown>)) {
    response.status(403).json({ error: "ليس لديك صلاحية للمواقع المحددة." });
    return;
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
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "بيانات السجل غير صحيحة." });
    return;
  }
  const data = { ...existing.data, ...(body as Record<string, unknown>) };
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
  await db.delete(erpRecordsTable).where(eq(erpRecordsTable.id, id));
  await audit(access.auth, `${access.tableName}_deleted`, String(id));
  response.sendStatus(204);
});

export default router;