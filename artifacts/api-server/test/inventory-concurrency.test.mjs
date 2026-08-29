import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.INVENTORY_TEST_ORIGIN ?? "http://127.0.0.1:80";
const apiBase = `${origin}/api`;
const generationByCookie = new Map();

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

async function request(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const generation = generationByCookie.get(cookie);
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(Number.isSafeInteger(generation) ? { "X-Wudooh-Data-Generation": String(generation) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function registerOwner() {
  const email = `${unique("inventory") }@example.test`;
  const password = "Safe-test-password-123";
  const phone = `05${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`;
  const { response, payload } = await request("/auth/register", {
    method: "POST",
    body: { projectName: unique("منشأة اختبار"), name: "مالك الاختبار", email, phone, password },
  });
  assert.equal(response.status, 201, JSON.stringify(payload));
  const cookie = cookieFrom(response);
  generationByCookie.set(cookie, payload.user.dataGeneration);
  return { email, password, cookie };
}

async function login(email, password) {
  const { response, payload } = await request("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, JSON.stringify(payload));
  const cookie = cookieFrom(response);
  generationByCookie.set(cookie, payload.user.dataGeneration);
  return cookie;
}

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "يجب أن ينشئ الخادم جلسة مستقلة للعميل");
  return cookie.split(";")[0];
}

async function post(cookie, path, body) {
  return request(path, { method: "POST", cookie, body });
}

async function patch(cookie, path, body) {
  return request(path, { method: "PATCH", cookie, body });
}

async function remove(cookie, path) {
  return request(path, { method: "DELETE", cookie });
}

async function createScenario({ initialQuantity, transferQuantity }) {
  const owner = await registerOwner();
  const secondCookie = await login(owner.email, owner.password);

  const { payload: locationsPayload, response: locationsResponse } = await request("/data/warehouses", { cookie: owner.cookie });
  assert.equal(locationsResponse.status, 200, JSON.stringify(locationsPayload));
  const [source, destination] = locationsPayload.records;
  assert.ok(source?.id && destination?.id, "التسجيل يجب أن ينشئ موقعي تشغيل");

  const { response: productResponse, payload: productPayload } = await post(owner.cookie, "/data/products", {
    name: unique("منتج التزامن"),
    stock: 0,
    sellPrice: 10,
  });
  assert.equal(productResponse.status, 201, JSON.stringify(productPayload));

  const seed = await post(owner.cookie, "/inventory/adjustments", {
    productId: productPayload.record.id,
    warehouseId: source.id,
    actualQuantity: initialQuantity,
    reason: "رصيد افتتاحي للاختبار",
  });
  assert.equal(seed.response.status, 200, JSON.stringify(seed.payload));

  const transfer = await post(owner.cookie, "/inventory/transfers", {
    productId: productPayload.record.id,
    fromWarehouseId: source.id,
    toWarehouseId: destination.id,
    quantity: transferQuantity,
  });
  assert.equal(transfer.response.status, 200, JSON.stringify(transfer.payload));

  return {
    firstCookie: owner.cookie,
    secondCookie,
    productId: productPayload.record.id,
    sourceId: source.id,
    transferId: transfer.payload.transfer.id,
  };
}

async function assertProductMatchesBalances(cookie, productId) {
  const [products, balances] = await Promise.all([
    request("/data/products", { cookie }),
    request("/data/inventoryBalances", { cookie }),
  ]);
  assert.equal(products.response.status, 200, JSON.stringify(products.payload));
  assert.equal(balances.response.status, 200, JSON.stringify(balances.payload));
  const product = products.payload.records.find((record) => record.id === productId);
  const productBalances = balances.payload.records.filter((record) => record.productId === productId);
  const total = productBalances.reduce((sum, record) => sum + Number(record.quantity), 0);
  assert.equal(Number(product.stock), total, "إجمالي المنتج يجب أن يساوي مجموع أرصدة المواقع");
  assert.ok(productBalances.every((record) => Number(record.quantity) >= 0), "لا يجوز أن يصبح رصيد أي موقع سالباً");
}

test("عميلان لا يعتمدان ويلغيان التحويل المعلق معاً", async () => {
  const scenario = await createScenario({ initialQuantity: 20, transferQuantity: 6 });
  const [approval, cancellation] = await Promise.all([
    post(scenario.firstCookie, `/inventory/transfers/${scenario.transferId}/approve`),
    post(scenario.secondCookie, `/inventory/transfers/${scenario.transferId}/cancel`),
  ]);

  assert.equal([approval.response.status, cancellation.response.status].filter((status) => status === 200).length, 1);
  assert.equal([approval.response.status, cancellation.response.status].filter((status) => status === 409).length, 1);
  await assertProductMatchesBalances(scenario.firstCookie, scenario.productId);
});

test("البيع والتحويل المتزامنان من الموقع نفسه لا يخصمان كمية مرتين", async () => {
  const scenario = await createScenario({ initialQuantity: 10, transferQuantity: 7 });
  const [sale, approval] = await Promise.all([
    post(scenario.firstCookie, "/inventory/sales", {
      productId: scenario.productId,
      warehouseId: scenario.sourceId,
      quantity: 5,
    }),
    post(scenario.secondCookie, `/inventory/transfers/${scenario.transferId}/approve`),
  ]);

  assert.equal([sale.response.status, approval.response.status].filter((status) => status === 200).length, 1);
  assert.equal([sale.response.status, approval.response.status].filter((status) => status === 409).length, 1);
  await assertProductMatchesBalances(scenario.firstCookie, scenario.productId);
});

test("التسوية والتحويل المتزامنان يعيدان اشتقاق إجمالي المنتج", async () => {
  const scenario = await createScenario({ initialQuantity: 10, transferQuantity: 5 });
  const [adjustment, approval] = await Promise.all([
    post(scenario.firstCookie, "/inventory/adjustments", {
      productId: scenario.productId,
      warehouseId: scenario.sourceId,
      actualQuantity: 12,
      reason: "جرد نهاية الوردية",
    }),
    post(scenario.secondCookie, `/inventory/transfers/${scenario.transferId}/approve`),
  ]);

  assert.equal(adjustment.response.status, 200, JSON.stringify(adjustment.payload));
  assert.equal(approval.response.status, 200, JSON.stringify(approval.payload));
  await assertProductMatchesBalances(scenario.firstCookie, scenario.productId);
});

test("موظف المبيعات المخوّل يستطيع تسجيل البيع الذري من موقعه", async () => {
  const scenario = await createScenario({ initialQuantity: 10, transferQuantity: 3 });
  const email = `${unique("sales-user")}@example.test`;
  const password = "Safe-test-password-123";
  const member = await post(scenario.firstCookie, "/team/members", {
    name: "موظف مبيعات الاختبار",
    email,
    password,
    roleId: "sales",
    permissions: { sales: true },
    locationScope: "selected",
    warehouseIds: [scenario.sourceId],
  });
  assert.equal(member.response.status, 201, JSON.stringify(member.payload));
  const salesCookie = await login(email, password);

  const sale = await post(salesCookie, "/inventory/sales", {
    productId: scenario.productId,
    warehouseId: scenario.sourceId,
    quantity: 2,
  });
  assert.equal(sale.response.status, 200, JSON.stringify(sale.payload));
  await assertProductMatchesBalances(scenario.firstCookie, scenario.productId);
});

test("إلغاء الفاتورة يعيد المخزون والذمم وينشئ قيد عكس واحداً مع إعادة المحاولة", async () => {
  const owner = await registerOwner();
  const accounts = await post(owner.cookie, "/accounting/initialize");
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload));

  const { payload: locationsPayload } = await request("/data/warehouses", { cookie: owner.cookie });
  const warehouse = locationsPayload.records[0];
  const product = await post(owner.cookie, "/data/products", {
    name: unique("منتج إلغاء فاتورة"),
    stock: 0,
    sellPrice: 25,
  });
  assert.equal(product.response.status, 201, JSON.stringify(product.payload));
  const seed = await post(owner.cookie, "/inventory/adjustments", {
    productId: product.payload.record.id,
    warehouseId: warehouse.id,
    actualQuantity: 8,
    reason: "رصيد اختبار الإلغاء",
  });
  assert.equal(seed.response.status, 200, JSON.stringify(seed.payload));

  const checkout = await post(owner.cookie, "/inventory/checkout", {
    warehouseId: warehouse.id,
    issueDate: "2026-08-29",
    paymentMethod: "credit",
    dueDate: "2026-09-29",
    customerName: "عميل اختبار الإلغاء",
    clientOperationId: crypto.randomUUID(),
    items: [{ productId: product.payload.record.id, quantity: 3 }],
  });
  assert.equal(checkout.response.status, 200, JSON.stringify(checkout.payload));
  const invoiceId = checkout.payload.invoice.id;
  const operationId = crypto.randomUUID();
  const cancellationBody = {
    reason: "إلغاء فاتورة اختبارية",
    effectiveDate: "2026-08-29",
  };
  const cancel = await request(`/accounting/sources/invoices/${invoiceId}/cancel`, {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": operationId },
    body: cancellationBody,
  });
  assert.equal(cancel.response.status, 201, JSON.stringify(cancel.payload));
  assert.equal(cancel.payload.source.status, "cancelled");
  assert.equal(cancel.payload.reversal.adjustmentType, "reversal");
  assert.equal(cancel.payload.reversal.sourceId, invoiceId);

  const replay = await request(`/accounting/sources/invoices/${invoiceId}/cancel`, {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": operationId },
    body: cancellationBody,
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.replayed, true);
  assert.equal(replay.payload.reversal.id, cancel.payload.reversal.id);

  const [balances, receivables, journals] = await Promise.all([
    request("/data/inventoryBalances", { cookie: owner.cookie }),
    request("/data/receivables", { cookie: owner.cookie }),
    request("/data/journalEntries", { cookie: owner.cookie }),
  ]);
  const balance = balances.payload.records.find((record) =>
    record.productId === product.payload.record.id && record.warehouseId === warehouse.id);
  assert.equal(Number(balance.quantity), 8, "يجب إعادة كمية الفاتورة كاملة إلى الموقع");
  const receivable = receivables.payload.records.find((record) => record.invoiceId === invoiceId);
  assert.equal(receivable.status, "cancelled");
  const sourceJournals = journals.payload.records.filter((record) => record.sourceType === "sale" && record.sourceId === invoiceId);
  assert.equal(sourceJournals.filter((record) => record.adjustmentType === "reversal").length, 1);
  assert.equal(sourceJournals.filter((record) => !record.adjustmentType).length, 1);
});

test("تمنع مسارات CRUD العامة تجاوز البيع الذري وفواتيره", async () => {
  const scenario = await createScenario({ initialQuantity: 10, transferQuantity: 3 });
  const [created, updated, deleted, invoiceCreated, invoiceUpdated, invoiceDeleted] = await Promise.all([
    post(scenario.firstCookie, "/data/sales", {
      productId: scenario.productId,
      warehouseId: scenario.sourceId,
      quantity: 1,
    }),
    patch(scenario.firstCookie, "/data/sales/999999", { quantity: 1 }),
    remove(scenario.firstCookie, "/data/sales/999999"),
    post(scenario.firstCookie, "/data/invoices", { number: "غير مسموح", issueDate: "2026-01-01", total: 1 }),
    patch(scenario.firstCookie, "/data/invoices/999999", { total: 1 }),
    remove(scenario.firstCookie, "/data/invoices/999999"),
  ]);
  assert.equal(created.response.status, 405, JSON.stringify(created.payload));
  assert.equal(updated.response.status, 405, JSON.stringify(updated.payload));
  assert.equal(deleted.response.status, 405, JSON.stringify(deleted.payload));
  assert.equal(invoiceCreated.response.status, 405, JSON.stringify(invoiceCreated.payload));
  assert.equal(invoiceUpdated.response.status, 405, JSON.stringify(invoiceUpdated.payload));
  assert.equal(invoiceDeleted.response.status, 405, JSON.stringify(invoiceDeleted.payload));
  await assertProductMatchesBalances(scenario.firstCookie, scenario.productId);
});

test("تعديل بيانات المنتج المتزامن مع تحويل لا يعيد رصيداً قديماً", async () => {
  const scenario = await createScenario({ initialQuantity: 10, transferQuantity: 5 });
  const operations = [
    patch(scenario.firstCookie, `/data/products/${scenario.productId}`, { name: unique("اسم محدث") }),
    post(scenario.secondCookie, `/inventory/transfers/${scenario.transferId}/approve`),
  ];
  const results = await Promise.all(operations);
  assert.equal(results[0].response.status, 200, JSON.stringify(results[0].payload));
  assert.equal(results[1].response.status, 200, JSON.stringify(results[1].payload));
  await assertProductMatchesBalances(scenario.firstCookie, scenario.productId);
});

test("يرفض الخادم المواقع غير الموجودة أو التابعة لمنشأة أخرى", async () => {
  const scenario = await createScenario({ initialQuantity: 10, transferQuantity: 3 });
  const nonexistent = await post(scenario.firstCookie, "/inventory/adjustments", {
    productId: scenario.productId,
    warehouseId: 999999999,
    actualQuantity: 1,
    reason: "موقع غير موجود",
  });
  assert.equal(nonexistent.response.status, 404, JSON.stringify(nonexistent.payload));

  const outsider = await registerOwner();
  const locations = await request("/data/warehouses", { cookie: outsider.cookie });
  assert.equal(locations.response.status, 200, JSON.stringify(locations.payload));
  const foreignWarehouseId = locations.payload.records[0].id;
  const foreign = await post(scenario.firstCookie, "/inventory/adjustments", {
    productId: scenario.productId,
    warehouseId: foreignWarehouseId,
    actualQuantity: 1,
    reason: "موقع تابع لمنشأة أخرى",
  });
  assert.equal(foreign.response.status, 404, JSON.stringify(foreign.payload));
});