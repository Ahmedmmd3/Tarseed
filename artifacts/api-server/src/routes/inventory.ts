import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, erpRecordsTable, teamAuditLogsTable } from "@workspace/db";
import { requireAuth, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();

type RecordData = Record<string, unknown>;
type ErpRecord = typeof erpRecordsTable.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class InventoryRouteError extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
  }
}

function requireInventory(_request: Request, response: Response, next: NextFunction): void {
  const auth = response.locals.auth as AuthContext | undefined;
  if (!auth || (auth.roleId !== "owner" && auth.permissions.inventory !== true)) {
    response.status(403).json({ error: "ليس لديك صلاحية لوحدة المخزون." });
    return;
  }
  next();
}

function requireSalesOrInventory(_request: Request, response: Response, next: NextFunction): void {
  const auth = response.locals.auth as AuthContext | undefined;
  if (!auth || (auth.roleId !== "owner" && auth.permissions.inventory !== true && auth.permissions.sales !== true)) {
    response.status(403).json({ error: "ليس لديك صلاحية لتسجيل المبيعات." });
    return;
  }
  next();
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new InventoryRouteError(`${label} غير صالح.`, 400);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new InventoryRouteError(`${label} غير صالح.`, 400);
  return parsed;
}

function bodyOf(request: Request): RecordData {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    throw new InventoryRouteError("بيانات الطلب غير صحيحة.", 400);
  }
  return request.body as RecordData;
}

function canAccessLocations(auth: AuthContext, locationIds: number[]): boolean {
  if (auth.roleId === "owner" || auth.locationScope === "all") return true;
  if (auth.locationScope === "none") return locationIds.length === 0;
  const allowed = new Set(auth.warehouseIds.map(Number));
  return locationIds.every((locationId) => allowed.has(locationId));
}

function requireLocations(auth: AuthContext, locationIds: number[]): void {
  if (!canAccessLocations(auth, locationIds)) throw new InventoryRouteError("ليس لديك صلاحية للمواقع المحددة.", 403);
}

function output(record: ErpRecord, organizationId: number): RecordData {
  return { ...record.data, id: record.id, userId: organizationId };
}

async function lockRecord(tx: Transaction, organizationId: number, tableName: string, id: number): Promise<ErpRecord> {
  const [record] = await tx.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, id),
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, tableName),
  )).for("update");
  if (!record) throw new InventoryRouteError("السجل غير متاح.", 404);
  return record;
}

async function lockBalancesForProduct(tx: Transaction, organizationId: number, productId: number): Promise<ErpRecord[]> {
  return tx.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "inventoryBalances"),
    sql`${erpRecordsTable.data}->>'productId' = ${String(productId)}`,
  )).for("update");
}

async function lockWarehouses(tx: Transaction, organizationId: number, locationIds: number[]): Promise<void> {
  const uniqueLocationIds = [...new Set(locationIds)].sort((left, right) => left - right);
  for (const locationId of uniqueLocationIds) {
    const warehouse = await lockRecord(tx, organizationId, "warehouses", locationId);
    if (warehouse.data.status !== "active") {
      throw new InventoryRouteError("لا يمكن تنفيذ حركة على موقع تشغيل غير نشط.");
    }
  }
}

function balanceFor(rows: ErpRecord[], warehouseId: number): ErpRecord | undefined {
  return rows.find((row) => Number(row.data.warehouseId) === warehouseId);
}

function quantityOf(record: ErpRecord | undefined): number {
  return record ? Number(record.data.quantity) || 0 : 0;
}

async function updateData(tx: Transaction, record: ErpRecord, data: RecordData): Promise<ErpRecord> {
  const [updated] = await tx.update(erpRecordsTable)
    .set({ data, updatedAt: new Date() })
    .where(eq(erpRecordsTable.id, record.id))
    .returning();
  return updated;
}

async function reconcileProductTotal(tx: Transaction, organizationId: number, product: ErpRecord): Promise<ErpRecord> {
  const balances = await lockBalancesForProduct(tx, organizationId, product.id);
  const stock = balances.reduce((sum, balance) => sum + quantityOf(balance), 0);
  return updateData(tx, product, { ...product.data, stock });
}

async function audit(tx: Transaction, auth: AuthContext, action: string, entity: string): Promise<void> {
  await tx.insert(teamAuditLogsTable).values({
    organizationId: auth.organizationId,
    actorId: auth.id,
    actorName: auth.name || auth.email,
    action,
    entity,
    details: "",
  });
}

async function runAction(response: Response, action: () => Promise<RecordData>): Promise<void> {
  try {
    response.json(await action());
  } catch (error) {
    if (error instanceof InventoryRouteError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
}

router.post("/inventory/transfers", requireAuth, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const productId = integer(body.productId, "المنتج");
    const fromWarehouseId = integer(body.fromWarehouseId, "موقع المصدر");
    const toWarehouseId = integer(body.toWarehouseId, "موقع الوجهة");
    const quantity = integer(body.quantity, "كمية التحويل");
    if (fromWarehouseId === toWarehouseId) throw new InventoryRouteError("يجب أن يختلف موقع الوجهة عن المصدر.", 400);
    requireLocations(auth, [fromWarehouseId, toWarehouseId]);

    const transfer = await db.transaction(async (tx) => {
      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [fromWarehouseId, toWarehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      if (quantityOf(balanceFor(balances, fromWarehouseId)) < quantity) {
        throw new InventoryRouteError("الرصيد في الموقع المصدر غير كافٍ.");
      }
      const [created] = await tx.insert(erpRecordsTable).values({
        organizationId: auth.organizationId,
        tableName: "stockTransfers",
        data: { productId, fromWarehouseId, toWarehouseId, quantity, status: "pending", date: String(body.date ?? ""), note: String(body.note ?? "") },
      }).returning();
      await audit(tx, auth, "stock_transfer_created", String(created.id));
      return created;
    });
    return { transfer: output(transfer, auth.organizationId) };
  });
});

router.post("/inventory/transfers/:id/approve", requireAuth, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const transferId = integer(request.params.id, "معرّف التحويل");
    const transfer = await db.transaction(async (tx) => {
      const current = await lockRecord(tx, auth.organizationId, "stockTransfers", transferId);
      const productId = integer(current.data.productId, "المنتج");
      const fromWarehouseId = integer(current.data.fromWarehouseId, "موقع المصدر");
      const toWarehouseId = integer(current.data.toWarehouseId, "موقع الوجهة");
      const quantity = integer(current.data.quantity, "كمية التحويل");
      requireLocations(auth, [fromWarehouseId, toWarehouseId]);
      if (current.data.status !== "pending") throw new InventoryRouteError("لم يعد التحويل معلقاً للموافقة.");

      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [fromWarehouseId, toWarehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      const source = balanceFor(balances, fromWarehouseId);
      if (!source || quantityOf(source) < quantity) throw new InventoryRouteError("الرصيد في المصدر لم يعد كافياً للموافقة.");
      await updateData(tx, source, { ...source.data, quantity: quantityOf(source) - quantity });
      const updated = await updateData(tx, current, { ...current.data, status: "approved", approvedAt: new Date().toISOString() });
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "stock_transfer_approved", String(updated.id));
      return updated;
    });
    return { transfer: output(transfer, auth.organizationId) };
  });
});

router.post("/inventory/transfers/:id/cancel", requireAuth, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const transferId = integer(request.params.id, "معرّف التحويل");
    const transfer = await db.transaction(async (tx) => {
      const current = await lockRecord(tx, auth.organizationId, "stockTransfers", transferId);
      const fromWarehouseId = integer(current.data.fromWarehouseId, "موقع المصدر");
      const toWarehouseId = integer(current.data.toWarehouseId, "موقع الوجهة");
      requireLocations(auth, [fromWarehouseId, toWarehouseId]);
      await lockWarehouses(tx, auth.organizationId, [fromWarehouseId, toWarehouseId]);
      if (current.data.status !== "pending") throw new InventoryRouteError("لم يعد التحويل معلقاً للإلغاء.");
      const updated = await updateData(tx, current, { ...current.data, status: "cancelled", cancelledAt: new Date().toISOString() });
      await audit(tx, auth, "stock_transfer_cancelled", String(updated.id));
      return updated;
    });
    return { transfer: output(transfer, auth.organizationId) };
  });
});

router.post("/inventory/transfers/:id/receive", requireAuth, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const transferId = integer(request.params.id, "معرّف التحويل");
    const transfer = await db.transaction(async (tx) => {
      const current = await lockRecord(tx, auth.organizationId, "stockTransfers", transferId);
      const productId = integer(current.data.productId, "المنتج");
      const fromWarehouseId = integer(current.data.fromWarehouseId, "موقع المصدر");
      const toWarehouseId = integer(current.data.toWarehouseId, "موقع الوجهة");
      const quantity = integer(current.data.quantity, "كمية التحويل");
      requireLocations(auth, [fromWarehouseId, toWarehouseId]);
      if (current.data.status !== "approved") throw new InventoryRouteError("لا يمكن استلام تحويل غير معتمد.");

      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [fromWarehouseId, toWarehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      const destination = balanceFor(balances, toWarehouseId);
      if (destination) {
        await updateData(tx, destination, { ...destination.data, quantity: quantityOf(destination) + quantity });
      } else {
        await tx.insert(erpRecordsTable).values({
          organizationId: auth.organizationId,
          tableName: "inventoryBalances",
          data: { productId, warehouseId: toWarehouseId, quantity },
        });
      }
      const updated = await updateData(tx, current, { ...current.data, status: "received", receivedAt: new Date().toISOString() });
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "stock_transfer_received", String(updated.id));
      return updated;
    });
    return { transfer: output(transfer, auth.organizationId) };
  });
});

router.post("/inventory/sales", requireAuth, requireSalesOrInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const productId = integer(body.productId, "المنتج");
    const warehouseId = integer(body.warehouseId, "موقع البيع");
    const quantity = integer(body.quantity, "كمية البيع");
    requireLocations(auth, [warehouseId]);
    const sale = await db.transaction(async (tx) => {
      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [warehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      const balance = balanceFor(balances, warehouseId);
      if (!balance || quantityOf(balance) < quantity) throw new InventoryRouteError("الرصيد في موقع البيع لم يعد كافياً.");
      await updateData(tx, balance, { ...balance.data, quantity: quantityOf(balance) - quantity });
      const [created] = await tx.insert(erpRecordsTable).values({
        organizationId: auth.organizationId,
        tableName: "sales",
        data: { productId, warehouseId, quantity, createdAt: new Date().toISOString() },
      }).returning();
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "inventory_sale_recorded", String(created.id));
      return created;
    });
    return { sale: output(sale, auth.organizationId) };
  });
});

router.post("/inventory/adjustments", requireAuth, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const productId = integer(body.productId, "المنتج");
    const warehouseId = integer(body.warehouseId, "الموقع");
    const actualQuantity = nonNegativeInteger(body.actualQuantity, "الكمية الفعلية");
    requireLocations(auth, [warehouseId]);
    const adjustment = await db.transaction(async (tx) => {
      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [warehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      const balance = balanceFor(balances, warehouseId);
      const previousQuantity = quantityOf(balance);
      if (balance) {
        await updateData(tx, balance, { ...balance.data, quantity: actualQuantity });
      } else {
        await tx.insert(erpRecordsTable).values({
          organizationId: auth.organizationId,
          tableName: "inventoryBalances",
          data: { productId, warehouseId, quantity: actualQuantity },
        });
      }
      const [created] = await tx.insert(erpRecordsTable).values({
        organizationId: auth.organizationId,
        tableName: "stockAdjustments",
        data: { productId, warehouseId, previousQuantity, actualQuantity, delta: actualQuantity - previousQuantity, reason: String(body.reason ?? ""), date: String(body.date ?? "") },
      }).returning();
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "stock_adjustment_recorded", String(created.id));
      return created;
    });
    return { adjustment: output(adjustment, auth.organizationId) };
  });
});

export default router;