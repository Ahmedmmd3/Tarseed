import { randomUUID } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, eInvoiceDocumentsTable, eInvoiceUnitsTable, erpRecordsTable, teamAuditLogsTable } from "@workspace/db";
import { configurationIsComplete, decryptEInvoiceSecret, generateInvoiceDocument, type SellerProfile } from "../lib/e-invoicing";
import { savePrivateInvoiceXml } from "../lib/private-object-store";
import { lockAndValidateDataGeneration, requireAuth, requireCurrentDataGeneration, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();

type RecordData = Record<string, unknown>;
type ErpRecord = typeof erpRecordsTable.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class InventoryRouteError extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
  }
}

async function requireLockedDataGeneration(tx: Transaction, response: Response): Promise<void> {
  if (!await lockAndValidateDataGeneration(tx, response)) {
    throw new InventoryRouteError("تغيّرت بيانات المنشأة منذ تحميلها. حدّث الصفحة قبل متابعة التعديل.");
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

function priceOf(product: ErpRecord): number {
  const raw = product.data.sellPrice ?? product.data.salePrice ?? product.data.price ?? 0;
  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    throw new InventoryRouteError(`سعر بيع المنتج «${String(product.data.name ?? product.id)}» غير صالح.`, 409);
  }
  return price;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new InventoryRouteError("تاريخ البيع غير صالح.", 400);
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
      response.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
}

router.post("/inventory/transfers", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
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
        data: { productId, fromWarehouseId, toWarehouseId, quantity, status: "pending", date: String(body.date ?? ""), note: String(body.note ?? "") },
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
    const transfer = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
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
    const transfer = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
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
      if (clientOperationId) {
        const [existing] = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, auth.organizationId),
          eq(erpRecordsTable.tableName, "invoices"),
          eq(erpRecordsTable.clientOperationId, clientOperationId),
        )).limit(1);
        if (existing) return { invoice: existing, created: false };
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
        lines.push({
          productId,
          name: String(product.data.name ?? `صنف #${productId}`),
          sku: String(product.data.sku ?? product.data.code ?? ""),
          quantity,
          unitPrice,
          total: unitPrice * quantity,
          product,
          balance,
        });
      }

      const subtotal = lines.reduce((sum, line) => sum + Number(line.total), 0);
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
          status: "paid",
          items: lines.map(({ product, balance, ...line }) => line),
          subtotal,
          tax: 0,
          total: subtotal,
          paid: paymentMethod === "credit" ? 0 : subtotal,
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
        return { invoice: existing, created: false };
      }

      await tx.insert(eInvoiceUnitsTable).values({ organizationId: auth.organizationId }).onConflictDoNothing();
      const [unit] = await tx.select().from(eInvoiceUnitsTable).where(
        eq(eInvoiceUnitsTable.organizationId, auth.organizationId),
      ).for("update");
      if (!unit) throw new InventoryRouteError("تعذر تجهيز وحدة الفوترة الإلكترونية.", 500);
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
          updatedAt: new Date(),
        }).where(eq(eInvoiceUnitsTable.id, unit.id));
      }
      const invoice = await updateData(tx, draftInvoice, {
        ...draftInvoice.data,
        number: invoiceNumber,
        tax: generated?.taxAmount ?? 0,
        total: generated?.taxInclusiveAmount ?? subtotal,
        paid: paymentMethod === "credit" ? 0 : (generated?.taxInclusiveAmount ?? subtotal),
        eInvoiceDocumentId: eInvoice.id,
        eInvoiceStatus: generated ? (generated.signatureValid ? "pending_compliance" : "pending_credentials") : "pending_configuration",
        eInvoiceType: documentType,
        eInvoiceUuid: eInvoice.uuid,
        qrPayload: generated?.qrPayload ?? "",
      });
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
            total: line.total,
            issueDate,
            createdAt: new Date().toISOString(),
          },
        });
        await reconcileProductTotal(tx, auth.organizationId, product);
      }
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

router.post("/inventory/adjustments", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, requireInventory, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  await runAction(response, async () => {
    const body = bodyOf(request);
    const productId = integer(body.productId, "المنتج");
    const warehouseId = integer(body.warehouseId, "الموقع");
    const actualQuantity = nonNegativeInteger(body.actualQuantity, "الكمية الفعلية");
    requireLocations(auth, [warehouseId]);
    const adjustment = await db.transaction(async (tx) => {
      await requireLockedDataGeneration(tx, response);
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