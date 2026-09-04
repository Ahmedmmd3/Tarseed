import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, eInvoiceDocumentsTable, eInvoiceUnitsTable, erpRecordsTable, teamAuditLogsTable } from "@workspace/db";
import { configurationIsComplete, decryptEInvoiceSecret, generateInvoiceDocument, type SellerProfile } from "../lib/e-invoicing";
import { savePrivateInvoiceXml } from "../lib/private-object-store";
import { lockAndValidateDataGeneration, lockedWriteRejection, refreshAuthAfterOrganizationLock, requireAuth, requireCurrentDataGeneration, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();

type RecordData = Record<string, unknown>;
type ErpRecord = typeof erpRecordsTable.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class InventoryRouteError extends Error {
  constructor(message: string, readonly status: number = 409, readonly code?: string) {
    super(message);
  }
}

async function requireLockedDataGeneration(tx: Transaction, response: Response): Promise<void> {
  if (!await lockAndValidateDataGeneration(tx, response)) {
    const rejection = lockedWriteRejection(response);
    throw new InventoryRouteError(rejection.error, rejection.status, rejection.code);
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

function productVatRate(product: ErpRecord, fallbackRate: number): number {
  const rawRate = product.data.vatRate;
  if (rawRate == null || rawRate === "") return fallbackRate;
  const rate = Number(rawRate);
  if (![0, 5, 15].includes(rate)) {
    throw new InventoryRouteError(`ضريبة الصنف «${String(product.data.name ?? product.id)}» غير صالحة.`, 409);
  }
  return rate;
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

function priceOf(product: ErpRecord): number {
  const raw = product.data.sellPrice ?? product.data.salePrice ?? product.data.price ?? 0;
  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    throw new InventoryRouteError(`سعر بيع المنتج «${String(product.data.name ?? product.id)}» غير صالح.`, 409);
  }
  return price;
}

function costOf(product: ErpRecord): number {
  const cost = Number(product.data.costPrice ?? product.data.purchasePrice ?? product.data.cost ?? 0);
  if (!Number.isFinite(cost) || cost < 0) throw new InventoryRouteError(`تكلفة المنتج «${String(product.data.name ?? product.id)}» غير صالحة.`, 409);
  return cost;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function positiveMoney(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new InventoryRouteError(`${label} غير صالح.`, 400);
  return money(number);
}

function fingerprint(value: unknown): string {
  const stable = (item: unknown): string => Array.isArray(item) ? `[${item.map(stable).join(",")}]`
    : item && typeof item === "object" ? `{${Object.entries(item as RecordData).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`
      : JSON.stringify(item) ?? "null";
  return createHash("sha256").update(stable(value)).digest("hex");
}

const DEFAULT_ACCOUNTS = [
  ["1000", "الصندوق", "asset"], ["1100", "البنك", "asset"], ["1200", "العملاء", "asset"],
  ["1300", "المخزون", "asset"], ["1400", "ضريبة مدخلات", "asset"], ["2000", "الموردين", "liability"],
  ["2100", "ضريبة مخرجات", "liability"], ["4000", "المبيعات", "revenue"], ["5500", "تكلفة المبيعات", "expense"],
] as const;

async function accountsByCode(tx: Transaction, organizationId: number): Promise<Map<string, ErpRecord>> {
  await tx.insert(erpRecordsTable).values(DEFAULT_ACCOUNTS.map(([code, name, type]) => ({
    organizationId, tableName: "accounts", data: { code, name, type, parent: null, openingBalance: 0, status: "active" },
  }))).onConflictDoNothing();
  const rows = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, organizationId), eq(erpRecordsTable.tableName, "accounts"))).for("update");
  const result = new Map(rows.map((row) => [String(row.data.code), row]));
  if (DEFAULT_ACCOUNTS.some(([code]) => !result.get(code) || result.get(code)?.data.status === "inactive")) {
    throw new InventoryRouteError("تعذر العثور على الحسابات الافتراضية النشطة.", 409);
  }
  return result;
}

async function postJournal(tx: Transaction, organizationId: number, sourceType: "sale" | "purchase", sourceId: number, date: string, description: string, lines: Array<{ accountId: string; debit: number; credit: number }>): Promise<ErpRecord> {
  const debit = money(lines.reduce((sum, line) => sum + line.debit, 0));
  const credit = money(lines.reduce((sum, line) => sum + line.credit, 0));
  if (debit !== credit) throw new InventoryRouteError("القيد المحاسبي غير متزن.", 500);
  const [journal] = await tx.insert(erpRecordsTable).values({ organizationId, tableName: "journalEntries", data: { date, description, status: "posted", sourceType, sourceId, lines } }).returning();
  return journal;
}

async function consumeFifo(tx: Transaction, organizationId: number, product: ErpRecord, warehouseId: number, quantity: number): Promise<Array<RecordData>> {
  let remaining = quantity;
  // Global lock order for every consumer is product -> all product balances ->
  // product/location layers. Callers already lock the product; re-locking the
  // balances here is harmless and prevents layers/balance deadlocks.
  const balances = await lockBalancesForProduct(tx, organizationId, product.id);
  const balanceQuantity = quantityOf(balanceFor(balances, warehouseId));
  const layers = await tx.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId), eq(erpRecordsTable.tableName, "inventoryLayers"),
    sql`${erpRecordsTable.data}->>'productId' = ${String(product.id)}`, sql`${erpRecordsTable.data}->>'warehouseId' = ${String(warehouseId)}`,
  )).for("update");
  const layerQuantity = layers.reduce((sum, layer) => {
    const value = Number(layer.data.remainingQuantity);
    if (!Number.isFinite(value) || value < 0) throw new InventoryRouteError("تلف في بيانات طبقات تكلفة المخزون.", 409);
    return sum + value;
  }, 0);
  if (layerQuantity > balanceQuantity + 0.000001) {
    throw new InventoryRouteError("تلف في اتساق المخزون: مجموع طبقات FIFO أكبر من رصيد الموقع.", 409);
  }
  // A tenant may have legacy stock and later receipt layers. Migrate exactly
  // the uncovered balance and explicitly prioritize it ahead of all receipts.
  const legacyQuantity = balanceQuantity - layerQuantity;
  if (legacyQuantity > 0.000001) {
    const unitCost = costOf(product);
    const [layer] = await tx.insert(erpRecordsTable).values({ organizationId, tableName: "inventoryLayers", data: { productId: product.id, warehouseId, originalQuantity: legacyQuantity, remainingQuantity: legacyQuantity, unitCostExVat: unitCost, fifoPriority: 0, layerType: "opening_migration", migratedAt: new Date().toISOString() } }).returning();
    layers.push(layer);
  }
  layers.sort((left, right) => {
    const leftPriority = left.data.fifoPriority === 0 || left.data.layerType === "opening_migration" || left.data.migratedAt ? 0 : 1;
    const rightPriority = right.data.fifoPriority === 0 || right.data.layerType === "opening_migration" || right.data.migratedAt ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftDate = String(left.data.receivedDate ?? left.createdAt.toISOString());
    const rightDate = String(right.data.receivedDate ?? right.createdAt.toISOString());
    return leftDate.localeCompare(rightDate) || left.id - right.id;
  });
  const allocations: Array<RecordData> = [];
  for (const layer of layers) {
    const available = Number(layer.data.remainingQuantity);
    if (!Number.isFinite(available) || available <= 0) continue;
    const taken = Math.min(remaining, available);
    const unitCost = positiveMoney(layer.data.unitCostExVat, "تكلفة طبقة المخزون");
    await updateData(tx, layer, { ...layer.data, remainingQuantity: available - taken });
    allocations.push({ layerId: layer.id, quantity: taken, unitCostExVat: unitCost, costAmount: money(taken * unitCost) });
    remaining -= taken;
    if (!remaining) break;
  }
  if (remaining) throw new InventoryRouteError("طبقات تكلفة المخزون لا تكفي للكمية المطلوبة.");
  return allocations;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new InventoryRouteError(`${label} طويل جداً.`, 400);
  return normalized;
}

function saleDate(value: unknown): string {
  const date = requiredText(value, "تاريخ البيع", 32) || new Date().toISOString().slice(0, 10);
  const normalized = date.slice(0, 10);
  if (!isValidDateKey(normalized)) {
    throw new InventoryRouteError("تاريخ البيع غير صالح.", 400);
  }
  return normalized;
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

async function requireOpenFinancialDate(tx: Transaction, organizationId: number, date: string): Promise<void> {
  const closures = await tx.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId), eq(erpRecordsTable.tableName, "financialClosures"),
  ));
  if (closures.some((closure) => closure.data.status === "closed" && date >= String(closure.data.from ?? "") && date <= String(closure.data.to ?? ""))) {
    throw new InventoryRouteError("الفترة المالية مقفلة ولا يمكن تسجيل حركة مخزون فيها.");
  }
}

function creditDueDate(value: unknown, issueDate: string): string {
  const dueDate = requiredText(value, "تاريخ استحقاق البيع الآجل", 32);
  if (!dueDate) throw new InventoryRouteError("يجب تحديد تاريخ استحقاق البيع الآجل قبل إتمام العملية.", 400);
  const normalized = dueDate.slice(0, 10);
  if (!isValidDateKey(normalized)) {
    throw new InventoryRouteError("تاريخ استحقاق البيع الآجل غير صالح.", 400);
  }
  if (normalized < issueDate) {
    throw new InventoryRouteError("لا يمكن أن يسبق تاريخ الاستحقاق تاريخ البيع.", 400);
  }
  return normalized;
}

function sellerProfile(unit: typeof eInvoiceUnitsTable.$inferSelect): SellerProfile {
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
      response.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
      return;
    }
    throw error;
  }
}

router.get("/inventory/settings", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireSalesOrInventory, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const unit = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || (currentAuth.roleId !== "owner" && currentAuth.permissions.inventory !== true && currentAuth.permissions.sales !== true)) {
        throw new InventoryRouteError("ليس لديك صلاحية لتسجيل المبيعات.", 403);
      }
      await tx.insert(eInvoiceUnitsTable).values({ organizationId: currentAuth.organizationId }).onConflictDoNothing();
      const [record] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.organizationId, currentAuth.organizationId)).for("update");
      if (!record) throw new InventoryRouteError("تعذر تجهيز إعدادات الضريبة.", 500);
      return record;
    });
    const vatRate = Number(unit.vatRate);
    if (!Number.isFinite(vatRate) || vatRate < 0) throw new InventoryRouteError("نسبة ضريبة القيمة المضافة غير صالحة.", 409);
    return { vatRate, pricesIncludeVat: unit.pricesIncludeVat };
  });
});

router.post("/inventory/transfers", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const productId = integer(body.productId, "المنتج");
    const fromWarehouseId = integer(body.fromWarehouseId, "موقع المصدر");
    const toWarehouseId = integer(body.toWarehouseId, "موقع الوجهة");
    const quantity = integer(body.quantity, "كمية التحويل");
    const date = saleDate(body.date);
    if (fromWarehouseId === toWarehouseId) throw new InventoryRouteError("يجب أن يختلف موقع الوجهة عن المصدر.", 400);
    requireLocations(auth, [fromWarehouseId, toWarehouseId]);

    const transfer = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [fromWarehouseId, toWarehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      if (quantityOf(balanceFor(balances, fromWarehouseId)) < quantity) {
        throw new InventoryRouteError("الرصيد في الموقع المصدر غير كافٍ.");
      }
      const [created] = await tx.insert(erpRecordsTable).values({
        organizationId: auth.organizationId,
        tableName: "stockTransfers",
        data: { productId, fromWarehouseId, toWarehouseId, quantity, status: "pending", date, note: String(body.note ?? "") },
      }).returning();
      await audit(tx, auth, "stock_transfer_created", String(created.id));
      return created;
    });
    return { transfer: output(transfer, auth.organizationId) };
  });
});

router.post("/inventory/transfers/:id/approve", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const transferId = integer(request.params.id, "معرّف التحويل");
    const approvalDate = saleDate(request.body && typeof request.body === "object" && !Array.isArray(request.body) ? (request.body as RecordData).date : undefined);
    const transfer = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      await requireOpenFinancialDate(tx, auth.organizationId, approvalDate);
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
      const fifoAllocations = await consumeFifo(tx, auth.organizationId, product, fromWarehouseId, quantity);
      await updateData(tx, source, { ...source.data, quantity: quantityOf(source) - quantity });
      const updated = await updateData(tx, current, { ...current.data, status: "approved", fifoAllocations, approvalDate, approvedAt: new Date().toISOString() });
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "stock_transfer_approved", String(updated.id));
      return updated;
    });
    return { transfer: output(transfer, auth.organizationId) };
  });
});

router.post("/inventory/transfers/:id/cancel", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const transferId = integer(request.params.id, "معرّف التحويل");
    const transfer = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
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

router.post("/inventory/transfers/:id/receive", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const transferId = integer(request.params.id, "معرّف التحويل");
    const receiptDate = saleDate(request.body && typeof request.body === "object" && !Array.isArray(request.body) ? (request.body as RecordData).date : undefined);
    const transfer = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      await requireOpenFinancialDate(tx, auth.organizationId, receiptDate);
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
      const allocations = Array.isArray(current.data.fifoAllocations) ? current.data.fifoAllocations : [];
      if (!allocations.length) {
        throw new InventoryRouteError("تحويل المخزون لا يحتوي على طبقات تكلفة صالحة.");
      }
      for (const allocation of allocations) {
        if (!allocation || typeof allocation !== "object" || Array.isArray(allocation)) throw new InventoryRouteError("تخصيصات تكلفة التحويل غير صالحة.");
        const item = allocation as RecordData;
        const movedQuantity = integer(item.quantity, "كمية طبقة التحويل");
        const unitCostExVat = positiveMoney(item.unitCostExVat, "تكلفة طبقة التحويل");
        await tx.insert(erpRecordsTable).values({ organizationId: auth.organizationId, tableName: "inventoryLayers", data: { productId, warehouseId: toWarehouseId, originalQuantity: movedQuantity, remainingQuantity: movedQuantity, unitCostExVat, transferId: current.id, receivedDate: new Date().toISOString() } });
      }
      const updated = await updateData(tx, current, { ...current.data, status: "received", receiptDate, receivedAt: new Date().toISOString() });
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "stock_transfer_received", String(updated.id));
      return updated;
    });
    return { transfer: output(transfer, auth.organizationId) };
  });
});

router.post("/inventory/sales", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireSalesOrInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const productId = integer(body.productId, "المنتج");
    const warehouseId = integer(body.warehouseId, "موقع البيع");
    const quantity = integer(body.quantity, "كمية البيع");
    requireLocations(auth, [warehouseId]);
    const sale = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [warehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      const balance = balanceFor(balances, warehouseId);
      if (!balance || quantityOf(balance) < quantity) throw new InventoryRouteError("الرصيد في موقع البيع لم يعد كافياً.");
      const fifoAllocations = await consumeFifo(tx, auth.organizationId, product, warehouseId, quantity);
      await updateData(tx, balance, { ...balance.data, quantity: quantityOf(balance) - quantity });
      const [created] = await tx.insert(erpRecordsTable).values({
        organizationId: auth.organizationId,
        tableName: "sales",
        data: { productId, warehouseId, quantity, fifoAllocations, createdAt: new Date().toISOString() },
      }).returning();
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "inventory_sale_recorded", String(created.id));
      return created;
    });
    return { sale: output(sale, auth.organizationId) };
  });
});

router.post("/inventory/checkout", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireSalesOrInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const warehouseId = integer(body.warehouseId, "موقع البيع");
    requireLocations(auth, [warehouseId]);
    const issueDate = saleDate(body.issueDate);
    const paymentMethod = ["cash", "card", "credit"].includes(String(body.paymentMethod))
      ? String(body.paymentMethod)
      : "cash";
    const dueDate = paymentMethod === "credit" ? creditDueDate(body.dueDate, issueDate) : undefined;
    const customerName = requiredText(body.customerName, "اسم العميل", 160);
    const customerVatNumber = requiredText(body.customerVatNumber, "الرقم الضريبي للعميل", 15);
    if (customerVatNumber && !/^\d{15}$/.test(customerVatNumber)) {
      throw new InventoryRouteError("الرقم الضريبي للعميل يجب أن يتكون من 15 رقماً.", 400);
    }
    const customerAddress = requiredText(body.customerAddress, "عنوان العميل", 400);
    if (customerVatNumber && (!customerName || !customerAddress)) {
      throw new InventoryRouteError("الفاتورة الضريبية تتطلب اسم العميل وعنوانه مع رقمه الضريبي.", 400);
    }
    const clientOperationId = requiredText(body.clientOperationId, "معرّف العملية", 200);
    if (!clientOperationId) throw new InventoryRouteError("معرّف العملية مطلوب.", 400);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 100) {
      throw new InventoryRouteError("أضف صنفاً واحداً على الأقل إلى السلة.", 400);
    }

    const quantities = new Map<number, number>();
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new InventoryRouteError("أحد أصناف السلة غير صحيح.", 400);
      }
      const item = rawItem as RecordData;
      const productId = integer(item.productId, "المنتج");
      const quantity = integer(item.quantity, "كمية البيع");
      quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
    }

    const result = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || (currentAuth.roleId !== "owner" && currentAuth.permissions.inventory !== true && currentAuth.permissions.sales !== true)) {
        throw new InventoryRouteError("تغيرت صلاحيات المستخدم أثناء تنفيذ البيع.", 403);
      }
      const requestFingerprint = fingerprint({ warehouseId, issueDate, paymentMethod, dueDate, customerName, customerVatNumber, customerAddress, items: rawItems });
      if (clientOperationId) {
        const [existing] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, auth.organizationId),
          eq(erpRecordsTable.tableName, "invoices"),
          eq(erpRecordsTable.clientOperationId, clientOperationId),
        )).limit(1);
        if (existing) {
          if (existing.data.requestFingerprint !== requestFingerprint) {
            throw new InventoryRouteError("معرّف العملية مستخدم لطلب مختلف.");
          }
          return { invoice: existing, created: false };
        }
      }

      const closures = await tx.select().from(erpRecordsTable).where(and(
        eq(erpRecordsTable.organizationId, auth.organizationId),
        eq(erpRecordsTable.tableName, "financialClosures"),
      ));
      if (closures.some((closure) => closure.data.status === "closed"
        && issueDate >= String(closure.data.from ?? "")
        && issueDate <= String(closure.data.to ?? ""))) {
        throw new InventoryRouteError("الفترة المالية مقفلة ولا يمكن تسجيل بيع فيها.");
      }

      await tx.insert(eInvoiceUnitsTable).values({ organizationId: auth.organizationId }).onConflictDoNothing();
      const [unit] = await tx.select().from(eInvoiceUnitsTable).where(
        eq(eInvoiceUnitsTable.organizationId, auth.organizationId),
      ).for("update");
      if (!unit) throw new InventoryRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
      const vatRate = Number(unit.vatRate);
      if (!Number.isFinite(vatRate) || vatRate < 0) throw new InventoryRouteError("نسبة ضريبة القيمة المضافة غير صالحة.", 409);
      const pricesIncludeVat = unit.pricesIncludeVat;
      await lockWarehouses(tx, auth.organizationId, [warehouseId]);
      const lines: Array<RecordData> = [];
      for (const [productId, quantity] of [...quantities.entries()].sort(([left], [right]) => left - right)) {
        const product = await lockRecord(tx, auth.organizationId, "products", productId);
        const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
        const balance = balanceFor(balances, warehouseId);
        if (!balance || quantityOf(balance) < quantity) {
          throw new InventoryRouteError(`الرصيد المتاح للصنف «${String(product.data.name ?? product.id)}» لم يعد كافياً.`);
        }
        const unitPrice = priceOf(product);
        const lineVatRate = productVatRate(product, vatRate);
        const grossPrice = money(unitPrice * quantity);
        const lineNet = pricesIncludeVat ? money(grossPrice / (1 + lineVatRate / 100)) : grossPrice;
        const vatAmount = pricesIncludeVat ? money(grossPrice - lineNet) : money(lineNet * lineVatRate / 100);
        const lineGross = money(lineNet + vatAmount);
        const allocations = await consumeFifo(tx, auth.organizationId, product, warehouseId, quantity);
        const costAmount = money(allocations.reduce((sum, allocation) => sum + Number(allocation.costAmount), 0));
        lines.push({
          productId,
          name: String(product.data.name ?? `صنف #${productId}`),
          sku: String(product.data.sku ?? product.data.code ?? ""),
          quantity,
          unitPrice,
          unitPriceExVat: money(lineNet / quantity),
          vatRate: lineVatRate,
          vatAmount,
          lineNet,
          lineGross,
          total: pricesIncludeVat ? grossPrice : lineNet,
          unitCost: money(costAmount / quantity),
          costAmount,
          fifoAllocations: allocations,
          product,
          balance,
        });
      }

      const subtotal = money(lines.reduce((sum, line) => sum + Number(line.lineNet), 0));
      const tax = money(lines.reduce((sum, line) => sum + Number(line.vatAmount), 0));
      const total = money(subtotal + tax);
      const cogsTotal = money(lines.reduce((sum, line) => sum + Number(line.costAmount), 0));
      const [draftInvoice] = await tx.insert(erpRecordsTable).values({
        organizationId: auth.organizationId,
        tableName: "invoices",
        clientOperationId: clientOperationId || null,
        data: {
          number: "",
          issueDate,
          warehouseId,
          customerName: customerName || "عميل نقدي",
          customerVatNumber: customerVatNumber || undefined,
          customerAddress: customerAddress || undefined,
          paymentMethod,
          status: paymentMethod === "credit" ? "unpaid" : "paid",
          dueDate,
          items: lines.map(({ product, balance, ...line }) => line),
          subtotal,
          tax,
          total,
          cogsTotal,
          requestFingerprint,
          paid: paymentMethod === "credit" ? 0 : total,
          createdAt: new Date().toISOString(),
        },
      }).onConflictDoNothing({
        target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId],
      }).returning();

      if (!draftInvoice) {
        const [existing] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, auth.organizationId),
          eq(erpRecordsTable.tableName, "invoices"),
          eq(erpRecordsTable.clientOperationId, clientOperationId),
        )).limit(1);
        if (!existing) throw new InventoryRouteError("تعذر حفظ الفاتورة.", 500);
        if (existing.data.requestFingerprint !== requestFingerprint) {
          throw new InventoryRouteError("معرّف العملية مستخدم لطلب مختلف.");
        }
        return { invoice: existing, created: false };
      }

      const seller = sellerProfile(unit);
      const documentType = customerVatNumber ? "standard" : "simplified";
      const invoiceNumber = `POS-${draftInvoice.id}`;
      const isConfigured = configurationIsComplete(seller);
      const generated = isConfigured
        ? await generateInvoiceDocument({
          invoiceNumber,
          invoiceCounter: unit.nextInvoiceCounter,
          previousInvoiceHash: unit.previousInvoiceHash,
          documentType,
          issueAt: new Date(),
          customerName: customerName || "عميل نقدي",
          customerVatNumber: customerVatNumber || undefined,
          customerAddress: customerAddress || undefined,
          paymentMethod,
          lines: lines.map((line) => ({
            name: String(line.name),
            sku: String(line.sku),
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            total: Number(line.total),
          })),
          seller,
          privateKeyPem: decryptEInvoiceSecret(unit.privateKeyCiphertext),
          certificatePem: decryptEInvoiceSecret(unit.certificateCiphertext),
        })
        : null;
      const [eInvoice] = await tx.insert(eInvoiceDocumentsTable).values({
        organizationId: auth.organizationId,
        unitId: unit.id,
        invoiceRecordId: draftInvoice.id,
        documentType,
        status: generated ? (generated.signatureValid ? "pending_compliance" : "pending_credentials") : "pending_configuration",
        invoiceNumber,
        uuid: generated?.uuid ?? randomUUID(),
        invoiceCounter: generated ? unit.nextInvoiceCounter : null,
        previousInvoiceHash: unit.previousInvoiceHash,
        invoiceHash: generated?.invoiceHash ?? unit.previousInvoiceHash,
        qrPayload: generated?.qrPayload ?? "",
        xmlDigest: generated?.invoiceHash ?? unit.previousInvoiceHash,
        localValidationError: generated?.localValidationError ?? null,
        issuedAt: new Date(),
      }).returning();
      if (generated) {
        const xmlObjectPath = await savePrivateInvoiceXml(auth.organizationId, eInvoice.id, generated.xml);
        await tx.update(eInvoiceDocumentsTable).set({ xmlObjectPath, updatedAt: new Date() })
          .where(eq(eInvoiceDocumentsTable.id, eInvoice.id));
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
      const invoice = await updateData(tx, draftInvoice, {
        ...draftInvoice.data,
        number: invoiceNumber,
        tax,
        total,
        paid: paymentMethod === "credit" ? 0 : total,
        eInvoiceDocumentId: eInvoice.id,
        eInvoiceStatus: generated ? (generated.signatureValid ? "pending_compliance" : "pending_credentials") : "pending_configuration",
        eInvoiceType: documentType,
        eInvoiceUuid: eInvoice.uuid,
        qrPayload: generated?.qrPayload ?? "",
      });
      if (paymentMethod === "credit" && dueDate) {
        await tx.insert(erpRecordsTable).values({
          organizationId: auth.organizationId,
          tableName: "receivables",
          data: {
            invoiceId: invoice.id,
            party: customerName || "عميل نقدي",
            customerName: customerName || "عميل نقدي",
            type: "receivable",
            reference: invoiceNumber,
            issueDate,
            warehouseId,
            dueDate,
            amount: total,
            paid: 0,
            status: "unpaid",
            createdAt: new Date().toISOString(),
          },
        });
      }
      for (const line of lines) {
        const product = line.product as ErpRecord;
        const balance = line.balance as ErpRecord;
        await updateData(tx, balance, { ...balance.data, quantity: quantityOf(balance) - Number(line.quantity) });
        await tx.insert(erpRecordsTable).values({
          organizationId: auth.organizationId,
          tableName: "sales",
          data: {
            invoiceId: invoice.id,
            productId: line.productId,
            warehouseId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitPriceExVat: line.unitPriceExVat,
            vatRate: line.vatRate,
            vatAmount: line.vatAmount,
            lineNet: line.lineNet,
            lineGross: line.lineGross,
            unitCost: line.unitCost,
            costAmount: line.costAmount,
            fifoAllocations: line.fifoAllocations,
            total: line.lineGross,
            issueDate,
            createdAt: new Date().toISOString(),
          },
        });
        await reconcileProductTotal(tx, auth.organizationId, product);
      }
      const accounts = await accountsByCode(tx, auth.organizationId);
      const cashAccount = paymentMethod === "card" ? accounts.get("1100")! : paymentMethod === "credit" ? accounts.get("1200")! : accounts.get("1000")!;
      const journal = await postJournal(tx, auth.organizationId, "sale", invoice.id, issueDate, `فاتورة بيع ${invoiceNumber}`, [
        { accountId: String(cashAccount.id), debit: total, credit: 0 },
        { accountId: String(accounts.get("4000")!.id), debit: 0, credit: subtotal },
        { accountId: String(accounts.get("2100")!.id), debit: 0, credit: tax },
        { accountId: String(accounts.get("5500")!.id), debit: cogsTotal, credit: 0 },
        { accountId: String(accounts.get("1300")!.id), debit: 0, credit: cogsTotal },
      ]);
      await audit(tx, auth, "automatic_accounting", `${invoice.id}:${journal.id}`);
      await audit(tx, auth, "pos_checkout_completed", String(invoice.id));
      await audit(tx, auth, "einvoice_issued", String(eInvoice.id));
      return { invoice, created: true };
    });

    return {
      invoice: output(result.invoice, auth.organizationId),
      created: result.created,
    };
  });
});

router.post("/inventory/purchase-receipts", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const orderNumber = requiredText(body.orderNumber, "رقم أمر الشراء", 100);
    const supplierName = requiredText(body.supplierName, "اسم المورد", 160);
    const date = saleDate(body.date);
    const warehouseId = integer(body.warehouseId, "الموقع");
    const paymentMethod = body.paymentMethod === "cash" || body.paymentMethod === "credit" ? body.paymentMethod : "";
    const clientOperationId = requiredText(body.clientOperationId, "معرّف العملية", 200);
    if (!orderNumber || !supplierName || !paymentMethod || !clientOperationId) throw new InventoryRouteError("بيانات استلام الشراء غير مكتملة.", 400);
    const dueDate = paymentMethod === "credit" ? creditDueDate(body.dueDate, date) : undefined;
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 100) throw new InventoryRouteError("أضف صنفاً واحداً على الأقل.", 400);
    const items = rawItems.map((raw): RecordData => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InventoryRouteError("أحد أصناف الاستلام غير صحيح.", 400);
      const item = raw as RecordData;
      return { productId: integer(item.productId, "المنتج"), quantity: integer(item.quantity, "الكمية"), unitCostExVat: positiveMoney(item.unitCostExVat, "تكلفة الوحدة") };
    });
    requireLocations(auth, [warehouseId]);
    const purchase = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || (currentAuth.roleId !== "owner" && currentAuth.permissions.inventory !== true)) {
        throw new InventoryRouteError("تغيرت صلاحيات المستخدم أثناء تنفيذ الاستلام.", 403);
      }
      const requestFingerprint = fingerprint({ orderNumber, supplierName, date, warehouseId, paymentMethod, dueDate, items });
      const [replay] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, "purchaseOrders"), eq(erpRecordsTable.clientOperationId, clientOperationId))).limit(1);
      if (replay) {
        if (replay.data.requestFingerprint !== requestFingerprint) throw new InventoryRouteError("معرّف العملية مستخدم لطلب مختلف.");
        return replay;
      }
      const closures = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, "financialClosures")));
      if (closures.some((closure) => closure.data.status === "closed" && date >= String(closure.data.from ?? "") && date <= String(closure.data.to ?? ""))) throw new InventoryRouteError("الفترة المالية مقفلة ولا يمكن تسجيل شراء فيها.");
      await lockWarehouses(tx, auth.organizationId, [warehouseId]);
      await tx.insert(eInvoiceUnitsTable).values({ organizationId: auth.organizationId }).onConflictDoNothing();
      const [unit] = await tx.select().from(eInvoiceUnitsTable).where(eq(eInvoiceUnitsTable.organizationId, auth.organizationId)).for("update");
      const vatRate = Number(unit?.vatRate);
      if (!Number.isFinite(vatRate) || vatRate < 0) throw new InventoryRouteError("نسبة ضريبة القيمة المضافة غير صالحة.", 409);
      const snapshots: RecordData[] = [];
      for (const item of items.sort((a, b) => Number(a.productId) - Number(b.productId))) {
        const product = await lockRecord(tx, auth.organizationId, "products", Number(item.productId));
        const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
        const balance = balanceFor(balances, warehouseId);
        const quantity = Number(item.quantity);
        const unitCostExVat = Number(item.unitCostExVat);
        if (balance) await updateData(tx, balance, { ...balance.data, quantity: quantityOf(balance) + quantity });
        else await tx.insert(erpRecordsTable).values({ organizationId: auth.organizationId, tableName: "inventoryBalances", data: { productId: product.id, warehouseId, quantity } });
        const [layer] = await tx.insert(erpRecordsTable).values({ organizationId: auth.organizationId, tableName: "inventoryLayers", data: { productId: product.id, warehouseId, originalQuantity: quantity, remainingQuantity: quantity, unitCostExVat, receivedDate: date } }).returning();
        const lineVatRate = productVatRate(product, vatRate);
        const lineNet = money(quantity * unitCostExVat);
        const vatAmount = money(lineNet * lineVatRate / 100);
        snapshots.push({ productId: product.id, name: String(product.data.name ?? `صنف #${product.id}`), quantity, unitCostExVat, vatRate: lineVatRate, lineNet, vatAmount, lineGross: money(lineNet + vatAmount), fifoLayerId: layer.id });
        await reconcileProductTotal(tx, auth.organizationId, product);
      }
      const subtotal = money(snapshots.reduce((sum, item) => sum + Number(item.lineNet), 0));
      const tax = money(snapshots.reduce((sum, item) => sum + Number(item.vatAmount), 0));
      const total = money(snapshots.reduce((sum, item) => sum + Number(item.lineGross), 0));
      const [created] = await tx.insert(erpRecordsTable).values({ organizationId: auth.organizationId, tableName: "purchaseOrders", clientOperationId, data: { orderNumber, supplierName, date, warehouseId, paymentMethod, dueDate, status: "received", received: true, items: snapshots, subtotal, tax, total, paid: paymentMethod === "cash" ? total : 0, requestFingerprint, createdAt: new Date().toISOString() } }).returning();
      for (const snapshot of snapshots) {
        const layerId = Number(snapshot.fifoLayerId);
        const [layer] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, layerId), eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, "inventoryLayers"))).for("update");
        if (layer) await updateData(tx, layer, { ...layer.data, purchaseOrderId: created.id });
      }
      const accounts = await accountsByCode(tx, auth.organizationId);
      const journal = await postJournal(tx, auth.organizationId, "purchase", created.id, date, `استلام شراء ${orderNumber}`, [
        { accountId: String(accounts.get("1300")!.id), debit: subtotal, credit: 0 },
        { accountId: String(accounts.get("1400")!.id), debit: tax, credit: 0 },
        { accountId: String((paymentMethod === "cash" ? accounts.get("1000") : accounts.get("2000"))!.id), debit: 0, credit: total },
      ]);
      await audit(tx, auth, "automatic_accounting", `${created.id}:${journal.id}`);
      if (paymentMethod === "credit") await tx.insert(erpRecordsTable).values({ organizationId: auth.organizationId, tableName: "receivables", data: { purchaseId: created.id, party: supplierName, supplierName, type: "payable", reference: orderNumber, date, dueDate, amount: total, paid: 0, status: "unpaid" } });
      await audit(tx, auth, "purchase_receipt_recorded", String(created.id));
      return created;
    });
    return { purchase: output(purchase, auth.organizationId) };
  });
});

router.post("/data/purchaseOrders/:id/receive", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const purchaseOrderId = integer(request.params.id, "معرّف أمر الشراء");
    const body = bodyOf(request);
    const receiptDate = saleDate(body.receiptDate);
    const clientOperationId = requiredText(request.get("Idempotency-Key") ?? body.clientOperationId, "معرّف عملية الاستلام", 200);
    if (!clientOperationId) throw new InventoryRouteError("معرّف عملية الاستلام مطلوب.", 400);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length || rawItems.length > 100) throw new InventoryRouteError("أدخل كمية مستلمة لصنف واحد على الأقل.", 400);
    const requestedQuantities = new Map<number, number>();
    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        throw new InventoryRouteError("أحد أصناف الاستلام غير صحيح.", 400);
      }
      const item = rawItem as RecordData;
      const productId = integer(item.productId, "المنتج");
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
        throw new InventoryRouteError("كمية الاستلام غير صالحة.", 400);
      }
      requestedQuantities.set(productId, (requestedQuantities.get(productId) ?? 0) + quantity);
    }
    const requestItems = [...requestedQuantities.entries()]
      .sort(([left], [right]) => left - right)
      .map(([productId, quantity]) => ({ productId, quantity }));
    const requestFingerprint = fingerprint({ purchaseOrderId, receiptDate, items: requestItems });

    const result = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      const currentAuth = await refreshAuthAfterOrganizationLock(tx, response);
      if (!currentAuth || (currentAuth.roleId !== "owner" && currentAuth.permissions.inventory !== true)) {
        throw new InventoryRouteError("تغيرت صلاحيات المستخدم أثناء تنفيذ الاستلام.", 403);
      }

      const [claimedOperation] = await tx.insert(erpRecordsTable).values({
        organizationId: currentAuth.organizationId,
        tableName: "purchaseReceiptOperations",
        clientOperationId,
        data: {
          purchaseOrderId,
          requestFingerprint,
          state: "pending",
        },
      }).onConflictDoNothing({
        target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId],
      }).returning();
      if (!claimedOperation) {
        const [replay] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "purchaseReceiptOperations"),
          eq(erpRecordsTable.clientOperationId, clientOperationId),
        )).for("update");
        if (!replay || replay.data.requestFingerprint !== requestFingerprint || Number(replay.data.purchaseOrderId) !== purchaseOrderId) {
          throw new InventoryRouteError("معرّف عملية الاستلام مستخدم لطلب مختلف.");
        }
        if (!replay.data.order || !replay.data.receipt) {
          throw new InventoryRouteError("عملية الاستلام السابقة غير مكتملة وتحتاج مراجعة.");
        }
        return {
          order: replay.data.order as RecordData,
          receipt: replay.data.receipt as RecordData,
          replayed: true,
        };
      }

      await requireOpenFinancialDate(tx, currentAuth.organizationId, receiptDate);
      const order = await lockRecord(tx, currentAuth.organizationId, "purchaseOrders", purchaseOrderId);
      if (order.data.accountingOnlyDraft === true || order.data.requiresCompletion === true) {
        throw new InventoryRouteError("أكمل بيانات مستند القيد اليدوي أولاً قبل الاستلام.", 409, "accounting_only_draft_incomplete");
      }
      const warehouseId = integer(order.data.warehouseId, "موقع الاستلام");
      requireLocations(currentAuth, [warehouseId]);
      if (!["draft", "sent", "partial"].includes(String(order.data.status))) {
        throw new InventoryRouteError(
          order.data.status === "received"
            ? "تم استلام أمر الشراء بالكامل مسبقاً."
            : "لا يمكن تسجيل استلام على أمر شراء ملغى.",
          409,
          order.data.status === "received" ? "purchase_order_already_received" : undefined,
        );
      }
      await lockWarehouses(tx, currentAuth.organizationId, [warehouseId]);
      const orderItems = Array.isArray(order.data.items) ? order.data.items : [];
      if (!orderItems.length) throw new InventoryRouteError("أمر الشراء لا يحتوي على أصناف قابلة للاستلام.");
      const orderItemsByProduct = new Map<number, RecordData>();
      for (const rawItem of orderItems) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
          throw new InventoryRouteError("بيانات أصناف أمر الشراء تالفة.");
        }
        const item = rawItem as RecordData;
        const productId = integer(item.productId, "منتج أمر الشراء");
        orderItemsByProduct.set(productId, item);
      }
      for (const [productId, quantity] of requestedQuantities) {
        const orderItem = orderItemsByProduct.get(productId);
        if (!orderItem) throw new InventoryRouteError("أحد المنتجات ليس ضمن أمر الشراء.", 400);
        const ordered = Number(orderItem.quantity);
        const received = Number(orderItem.receivedQuantity ?? 0);
        if (!Number.isFinite(ordered) || ordered <= 0 || !Number.isFinite(received) || received < 0 || received > ordered) {
          throw new InventoryRouteError("بيانات الكميات السابقة في أمر الشراء غير صالحة.");
        }
        if (quantity > ordered - received + 0.000001) {
          throw new InventoryRouteError(`كمية استلام «${String(orderItem.productName ?? productId)}» تتجاوز المتبقي.`);
        }
      }

      const receiptItems: RecordData[] = [];
      for (const { productId, quantity } of requestItems) {
        const orderItem = orderItemsByProduct.get(productId)!;
        const product = await lockRecord(tx, currentAuth.organizationId, "products", productId);
        const balances = await lockBalancesForProduct(tx, currentAuth.organizationId, productId);
        const balance = balanceFor(balances, warehouseId);
        if (balance) {
          await updateData(tx, balance, { ...balance.data, quantity: quantityOf(balance) + quantity });
        } else {
          await tx.insert(erpRecordsTable).values({
            organizationId: currentAuth.organizationId,
            tableName: "inventoryBalances",
            data: { productId, warehouseId, quantity },
          });
        }
        const unitCost = positiveMoney(orderItem.unitCost ?? orderItem.unitCostExVat, "تكلفة وحدة أمر الشراء");
        const vatRate = Number(orderItem.vatRate ?? product.data.vatRate ?? 15);
        if (![0, 5, 15].includes(vatRate)) throw new InventoryRouteError("نسبة ضريبة أحد أصناف أمر الشراء غير صالحة.");
        const lineNet = money(quantity * unitCost);
        const vatAmount = money(lineNet * vatRate / 100);
        const [layer] = await tx.insert(erpRecordsTable).values({
          organizationId: currentAuth.organizationId,
          tableName: "inventoryLayers",
          data: {
            productId,
            warehouseId,
            originalQuantity: quantity,
            remainingQuantity: quantity,
            unitCostExVat: unitCost,
            receivedDate: receiptDate,
            purchaseOrderId,
            purchaseReceiptOperationId: claimedOperation.id,
          },
        }).returning();
        receiptItems.push({
          productId,
          productName: String(product.data.name ?? orderItem.productName ?? `صنف #${productId}`),
          quantity,
          unitCost,
          unitCostExVat: unitCost,
          vatRate,
          lineNet,
          vatAmount,
          total: money(lineNet + vatAmount),
          fifoLayerId: layer.id,
        });
        await reconcileProductTotal(tx, currentAuth.organizationId, product);
      }

      const receiptSubtotal = money(receiptItems.reduce((sum, item) => sum + Number(item.lineNet), 0));
      const receiptVat = money(receiptItems.reduce((sum, item) => sum + Number(item.vatAmount), 0));
      const receiptTotal = money(receiptSubtotal + receiptVat);
      const isCreditPurchase = order.data.paymentMethod === "credit";
      const updatedItems: RecordData[] = orderItems.map((rawItem): RecordData => {
        const item = rawItem as RecordData;
        const productId = Number(item.productId);
        const receivedNow = requestedQuantities.get(productId) ?? 0;
        return {
          ...item,
          receivedQuantity: Number(item.receivedQuantity ?? 0) + receivedNow,
        };
      });
      const fullyReceived = updatedItems.every((item) => Number(item.receivedQuantity) >= Number(item.quantity) - 0.000001);
      const receivedSubtotal = money(Number(order.data.receivedSubtotal ?? 0) + receiptSubtotal);
      const receivedVat = money(Number(order.data.receivedVat ?? 0) + receiptVat);
      const paid = isCreditPurchase ? money(Number(order.data.paid ?? 0)) : money(Number(order.data.paid ?? 0) + receiptTotal);
      const orderTotal = money(Number(order.data.total ?? 0));
      const receiptRecord: RecordData = {
        operationId: claimedOperation.id,
        clientOperationId,
        receiptDate,
        warehouseId,
        items: receiptItems,
        subtotal: receiptSubtotal,
        vat: receiptVat,
        tax: receiptVat,
        total: receiptTotal,
        createdAt: new Date().toISOString(),
      };
      const receipts = Array.isArray(order.data.receipts) ? order.data.receipts : [];
      const [updatedOrder] = await tx.update(erpRecordsTable).set({
        data: {
          ...order.data,
          items: updatedItems,
          status: fullyReceived ? "received" : "partial",
          received: true,
          receivedSubtotal,
          receivedVat,
          receivedTotal: money(receivedSubtotal + receivedVat),
          receipts: [...receipts, receiptRecord],
          lastReceiptDate: receiptDate,
          paid,
          paymentStatus: paid >= orderTotal - 0.005 ? "paid" : paid > 0 ? "partial" : "unpaid",
          ...(fullyReceived ? { receivedAt: new Date().toISOString() } : {}),
        },
        updatedAt: new Date(),
      }).where(eq(erpRecordsTable.id, order.id)).returning();

      const accounts = await accountsByCode(tx, currentAuth.organizationId);
      const settlementAccountId = isCreditPurchase ? accounts.get("2000")!.id : accounts.get("1000")!.id;
      const journal = await postJournal(
        tx,
        currentAuth.organizationId,
        "purchase",
        order.id,
        receiptDate,
        `استلام أمر شراء ${String(order.data.orderNumber ?? order.id)}`,
        [
          { accountId: String(accounts.get("1300")!.id), debit: receiptSubtotal, credit: 0 },
          { accountId: String(accounts.get("1400")!.id), debit: receiptVat, credit: 0 },
          { accountId: String(settlementAccountId), debit: 0, credit: receiptTotal },
        ],
      );
      const [payable] = isCreditPurchase
        ? await tx.insert(erpRecordsTable).values({
          organizationId: currentAuth.organizationId,
          tableName: "receivables",
          data: {
            purchaseId: order.id,
            purchaseOrderId: order.id,
            purchaseReceiptOperationId: claimedOperation.id,
            ...(order.data.supplierId == null ? {} : { supplierId: order.data.supplierId }),
            party: String(order.data.supplierName ?? "مورد غير محدد"),
            supplierName: String(order.data.supplierName ?? "مورد غير محدد"),
            type: "payable",
            reference: `${String(order.data.orderNumber ?? order.id)} / ${receiptDate}`,
            date: receiptDate,
            dueDate: String(order.data.dueDate ?? receiptDate),
            amount: receiptTotal,
            paid: 0,
            status: "unpaid",
          },
        }).returning()
        : [undefined];
      let orderForOutput = updatedOrder;
      if (isCreditPurchase) {
        const orderPayables = (await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, currentAuth.organizationId),
          eq(erpRecordsTable.tableName, "receivables"),
          sql`${erpRecordsTable.data}->>'purchaseOrderId' = ${String(order.id)}`,
        )).for("update")).filter((item) =>
          item.data.type === "payable" && item.data.purchaseReceiptOperationId && item.data.status !== "cancelled");
        const payableTotal = money(orderPayables.reduce((sum, item) => sum + Number(item.data.amount ?? 0), 0));
        const aggregatePaid = money(orderPayables.reduce((sum, item) => sum + Number(item.data.paid ?? 0), 0));
        const remaining = money(Math.max(0, payableTotal - aggregatePaid));
        [orderForOutput] = await tx.update(erpRecordsTable).set({
          data: {
            ...updatedOrder.data,
            payableTotal,
            paid: aggregatePaid,
            remaining,
            paymentStatus: aggregatePaid >= payableTotal - 0.005 ? "paid" : aggregatePaid > 0 ? "partial" : "unpaid",
          },
          updatedAt: new Date(),
        }).where(eq(erpRecordsTable.id, order.id)).returning();
      }
      await audit(tx, currentAuth, "automatic_accounting", `${order.id}:${journal.id}`);
      await audit(tx, currentAuth, "purchase_order_received", `${order.id}:${claimedOperation.id}`);
      const orderOutput = output(orderForOutput, currentAuth.organizationId);
      const receiptOutput = { ...receiptRecord, journalId: journal.id, ...(payable ? { payableId: payable.id } : {}) };
      await tx.update(erpRecordsTable).set({
        data: {
          purchaseOrderId,
          requestFingerprint,
          state: "completed",
          order: orderOutput,
          receipt: receiptOutput,
        },
        updatedAt: new Date(),
      }).where(eq(erpRecordsTable.id, claimedOperation.id));
      return { order: orderOutput, receipt: receiptOutput, replayed: false };
    });
    return result;
  });
});

router.post("/inventory/adjustments", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const productId = integer(body.productId, "المنتج");
    const warehouseId = integer(body.warehouseId, "الموقع");
    const actualQuantity = nonNegativeInteger(body.actualQuantity, "الكمية الفعلية");
    const adjustmentDate = saleDate(body.date);
    requireLocations(auth, [warehouseId]);
    const adjustment = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
      await requireOpenFinancialDate(tx, auth.organizationId, adjustmentDate);
      const product = await lockRecord(tx, auth.organizationId, "products", productId);
      await lockWarehouses(tx, auth.organizationId, [warehouseId]);
      const balances = await lockBalancesForProduct(tx, auth.organizationId, product.id);
      const balance = balanceFor(balances, warehouseId);
      const previousQuantity = quantityOf(balance);
      const delta = actualQuantity - previousQuantity;
      let fifoAllocations: Array<RecordData> = [];
      let addedLayerId: number | undefined;
      if (delta > 0) {
        if (!Object.hasOwn(body, "unitCostExVat")) {
          throw new InventoryRouteError("تسوية الزيادة تتطلب تكلفة الوحدة قبل الضريبة.", 400);
        }
        const unitCostExVat = positiveMoney(body.unitCostExVat, "تكلفة الوحدة قبل الضريبة");
        const [layer] = await tx.insert(erpRecordsTable).values({
          organizationId: auth.organizationId,
          tableName: "inventoryLayers",
          data: { productId, warehouseId, originalQuantity: delta, remainingQuantity: delta, unitCostExVat, adjustmentDate, adjustmentReason: String(body.reason ?? "") },
        }).returning();
        addedLayerId = layer.id;
      } else if (delta < 0) {
        fifoAllocations = await consumeFifo(tx, auth.organizationId, product, warehouseId, -delta);
      }
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
        data: { productId, warehouseId, previousQuantity, actualQuantity, delta, reason: String(body.reason ?? ""), date: adjustmentDate, ...(addedLayerId ? { addedLayerId } : {}), ...(fifoAllocations.length ? { fifoAllocations } : {}) },
      }).returning();
      await reconcileProductTotal(tx, auth.organizationId, product);
      await audit(tx, auth, "stock_adjustment_recorded", String(created.id));
      return created;
    });
    return { adjustment: output(adjustment, auth.organizationId) };
  });
});

export default router;