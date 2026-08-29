import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const authHeaders = { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 1}` };
  const registration = await request("/auth/register", {
    method: "POST",
    headers: authHeaders,
    body: { projectName: unique("منشأة اختبار"), name: "مالك الاختبار", email, phone, password },
  });
  assert.equal(registration.response.status, 202, JSON.stringify(registration.payload));
  const emailVerification = await request("/auth/email-verification/verify", {
    method: "POST",
    headers: authHeaders,
    body: { email, code: process.env.EMAIL_VERIFICATION_TEST_CODE },
  });
  assert.equal(emailVerification.response.status, 200, JSON.stringify(emailVerification.payload));
  const cookie = cookieFrom(emailVerification.response);
  generationByCookie.set(cookie, emailVerification.payload.user.dataGeneration);
  return { email, password, cookie };
}

async function login(email, password) {
  const { response, payload } = await request("/auth/login", {
    method: "POST",
    headers: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
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

async function previewProductImport(cookie, records) {
  const form = new FormData();
  form.set("tableName", "products");
  form.set("format", "json");
  form.set("file", new Blob([JSON.stringify({ records })], { type: "application/json" }), "products.json");
  const response = await fetch(`${apiBase}/data-transfer/preview`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
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
    unitCostExVat: 5,
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
      unitCostExVat: 5,
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
    unitCostExVat: 10,
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
  assert.equal(cancel.payload.eInvoiceAdjustment.documentType, "credit_note");
  assert.equal(cancel.payload.source.eInvoiceAdjustmentDocumentId, cancel.payload.eInvoiceAdjustment.id);

  const replay = await request(`/accounting/sources/invoices/${invoiceId}/cancel`, {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": operationId },
    body: cancellationBody,
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.replayed, true);
  assert.equal(replay.payload.reversal.id, cancel.payload.reversal.id);
  assert.equal(replay.payload.eInvoiceAdjustment.id, cancel.payload.eInvoiceAdjustment.id);

  const eInvoiceDocuments = await request("/e-invoicing/documents", { cookie: owner.cookie });
  assert.equal(eInvoiceDocuments.response.status, 200, JSON.stringify(eInvoiceDocuments.payload));
  const creditNote = eInvoiceDocuments.payload.documents.find((document) => document.id === cancel.payload.eInvoiceAdjustment.id);
  assert.equal(creditNote.documentType, "credit_note");
  assert.equal(creditNote.parentDocumentId, checkout.payload.invoice.eInvoiceDocumentId);
  assert.equal(creditNote.parentInvoiceNumber, checkout.payload.invoice.number);
  assert.equal(creditNote.taxExclusiveAmount, checkout.payload.invoice.subtotal);
  assert.equal(creditNote.taxAmount, checkout.payload.invoice.tax);
  assert.equal(creditNote.taxInclusiveAmount, checkout.payload.invoice.total);

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
  const resale = await post(owner.cookie, "/inventory/checkout", {
    warehouseId: warehouse.id, issueDate: "2026-08-30", paymentMethod: "cash", clientOperationId: crypto.randomUUID(),
    items: [{ productId: product.payload.record.id, quantity: 1 }],
  });
  assert.equal(resale.response.status, 200, JSON.stringify(resale.payload));
  const increaseCorrection = await request(`/accounting/sources/invoices/${resale.payload.invoice.id}/correct`, {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      reason: "زيادة الكمية الصحيحة",
      effectiveDate: "2026-08-30",
      replacement: {
        items: [{
          productId: product.payload.record.id,
          warehouseId: warehouse.id,
          quantity: 2,
          unitPriceExVat: 25,
          vatRate: 15,
        }],
      },
    },
  });
  assert.equal(increaseCorrection.response.status, 201, JSON.stringify(increaseCorrection.payload));
  assert.equal(increaseCorrection.payload.eInvoiceAdjustment.documentType, "debit_note");

  const setup = await request("/e-invoicing/setup", {
    method: "PUT",
    cookie: owner.cookie,
    body: {
      unitName: "وحدة اختبار الإشعارات المؤجلة",
      deviceSerialNumber: unique("DEVICE"),
      sellerName: "منشأة اختبار الإشعارات",
      vatNumber: "310122393500003",
      commercialRegistrationNumber: "1010123456",
      street: "شارع الاختبار",
      buildingNumber: "1234",
      city: "الرياض",
      postalCode: "12345",
      countryCode: "SA",
      vatRate: 15,
      pricesIncludeVat: false,
    },
  });
  assert.equal(setup.response.status, 200, JSON.stringify(setup.payload));
  const csr = await request("/e-invoicing/setup/csr", { method: "POST", cookie: owner.cookie });
  assert.equal(csr.response.status, 200, JSON.stringify(csr.payload));
  const certificateDirectory = mkdtempSync(join(tmpdir(), "einvoice-adjustment-certificate-"));
  try {
    const csrPath = join(certificateDirectory, "device.csr");
    const caKeyPath = join(certificateDirectory, "ca.key");
    const caCertificatePath = join(certificateDirectory, "ca.crt");
    const certificatePath = join(certificateDirectory, "device.crt");
    writeFileSync(csrPath, csr.payload.csrPem);
    execFileSync("openssl", ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", caKeyPath], {
      stdio: "ignore",
    });
    execFileSync("openssl", [
      "req", "-x509", "-new", "-key", caKeyPath, "-days", "1",
      "-subj", "/CN=Inventory Test CA/O=Tarseed/C=SA",
      "-out", caCertificatePath,
    ], { stdio: "ignore" });
    execFileSync("openssl", [
      "x509", "-req", "-in", csrPath, "-CA", caCertificatePath, "-CAkey", caKeyPath,
      "-CAcreateserial", "-days", "1", "-out", certificatePath,
    ], { stdio: "ignore" });
    const credentials = await request("/e-invoicing/credentials", {
      method: "PUT",
      cookie: owner.cookie,
      body: {
        certificatePem: readFileSync(certificatePath, "utf8"),
        csid: "sandbox-test-csid",
        secret: "sandbox-test-secret",
      },
    });
    assert.equal(credentials.response.status, 200, JSON.stringify(credentials.payload));
  } finally {
    rmSync(certificateDirectory, { recursive: true, force: true });
  }

  const materializedDocuments = await request("/e-invoicing/documents", { cookie: owner.cookie });
  const materializedOriginal = materializedDocuments.payload.documents.find(
    (document) => document.id === checkout.payload.invoice.eInvoiceDocumentId,
  );
  const materializedCreditNote = materializedDocuments.payload.documents.find(
    (document) => document.id === cancel.payload.eInvoiceAdjustment.id,
  );
  assert.equal(materializedOriginal.xmlAvailable, true);
  assert.equal(materializedCreditNote.xmlAvailable, true);
  assert.equal(materializedCreditNote.parentDocumentId, materializedOriginal.id);
  const generation = generationByCookie.get(owner.cookie);
  const noteXmlResponse = await fetch(`${apiBase}/e-invoicing/documents/${materializedCreditNote.id}/xml`, {
    headers: {
      Cookie: owner.cookie,
      "X-Wudooh-Data-Generation": String(generation),
    },
  });
  assert.equal(noteXmlResponse.status, 200);
  assert.match(await noteXmlResponse.text(), new RegExp(materializedOriginal.uuid));
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

test("لا يسمح بتسجيل الباركود نفسه لمنتجين داخل المنشأة", async () => {
  const owner = await registerOwner();
  const barcode = `BC-${crypto.randomUUID()}`;
  const first = await post(owner.cookie, "/data/products", {
    name: unique("منتج باركود أول"), barcode, stock: 0, sellPrice: 10,
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  const duplicate = await post(owner.cookie, "/data/products", {
    name: unique("منتج باركود ثان"), barcode: ` ${barcode.toLowerCase()} `, stock: 0, sellPrice: 12,
  });
  assert.equal(duplicate.response.status, 409, JSON.stringify(duplicate.payload));
  assert.equal(duplicate.payload.code, "duplicate_product_barcode");
  const other = await post(owner.cookie, "/data/products", {
    name: unique("منتج باركود ثالث"), barcode: `${barcode}-other`, stock: 0, sellPrice: 14,
  });
  assert.equal(other.response.status, 201, JSON.stringify(other.payload));
  const updateDuplicate = await patch(owner.cookie, `/data/products/${other.payload.record.id}`, { barcode });
  assert.equal(updateDuplicate.response.status, 409, JSON.stringify(updateDuplicate.payload));
});

test("يرفض الخادم المواقع غير الموجودة أو التابعة لمنشأة أخرى", async () => {
  const scenario = await createScenario({ initialQuantity: 10, transferQuantity: 3 });
  const nonexistent = await post(scenario.firstCookie, "/inventory/adjustments", {
    productId: scenario.productId,
    warehouseId: 999999999,
    actualQuantity: 1,
    unitCostExVat: 5,
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
    unitCostExVat: 5,
    reason: "موقع تابع لمنشأة أخرى",
  });
  assert.equal(foreign.response.status, 404, JSON.stringify(foreign.payload));
});

test("يحفظ ضريبة المنتج ويحسب سلة مختلطة من 0 و5 و15 بالمئة", async () => {
  const owner = await registerOwner();
  const locations = await request("/data/warehouses", { cookie: owner.cookie });
  assert.equal(locations.response.status, 200, JSON.stringify(locations.payload));
  const warehouse = locations.payload.records[0];

  const invalid = await post(owner.cookie, "/data/products", {
    name: unique("ضريبة غير صالحة"), stock: 0, sellPrice: 100, vatRate: 7.5,
  });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.payload));

  const importedName = unique("منتج مستورد بضريبة افتراضية");
  const importPreview = await previewProductImport(owner.cookie, [{ name: importedName, stock: 0, sellPrice: 100, vatRate: null }]);
  assert.equal(importPreview.response.status, 200, JSON.stringify(importPreview.payload));
  assert.equal(importPreview.payload.valid, true, JSON.stringify(importPreview.payload));
  const importCommit = await post(owner.cookie, "/data-transfer/commit", {
    previewId: importPreview.payload.previewId,
    clientOperationId: crypto.randomUUID(),
  });
  assert.equal(importCommit.response.status, 201, JSON.stringify(importCommit.payload));
  const importedProducts = await request("/data/products", { cookie: owner.cookie });
  assert.equal(importedProducts.payload.records.find((product) => product.name === importedName)?.vatRate, 15);

  const invalidImportPreview = await previewProductImport(owner.cookie, [{ name: unique("منتج مستورد غير صالح"), stock: 0, sellPrice: 100, vatRate: -5 }]);
  assert.equal(invalidImportPreview.response.status, 200, JSON.stringify(invalidImportPreview.payload));
  assert.equal(invalidImportPreview.payload.valid, false);
  assert.match(invalidImportPreview.payload.errors.join(" "), /ضريبة المنتج/);

  const products = [];
  for (const vatRate of [0, 5, 15]) {
    const created = await post(owner.cookie, "/data/products", {
      name: unique(`منتج ضريبة ${vatRate}`), stock: 0, sellPrice: 100, vatRate,
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.record.vatRate, vatRate);
    products.push(created.payload.record);
  }

  const purchase = await post(owner.cookie, "/inventory/purchase-receipts", {
    orderNumber: unique("PO-mixed-tax"),
    supplierName: "مورد الضرائب المختلطة",
    date: "2027-01-10",
    warehouseId: warehouse.id,
    paymentMethod: "cash",
    clientOperationId: crypto.randomUUID(),
    items: products.map((product) => ({ productId: product.id, quantity: 3, unitCostExVat: 100 })),
  });
  assert.equal(purchase.response.status, 200, JSON.stringify(purchase.payload));
  assert.equal(purchase.payload.purchase.subtotal, 900);
  assert.equal(purchase.payload.purchase.tax, 60);
  assert.equal(purchase.payload.purchase.total, 960);
  assert.deepEqual(purchase.payload.purchase.items.map((item) => item.vatRate).sort((a, b) => a - b), [0, 5, 15]);

  const checkout = await post(owner.cookie, "/inventory/checkout", {
    warehouseId: warehouse.id,
    issueDate: "2027-01-11",
    paymentMethod: "cash",
    clientOperationId: crypto.randomUUID(),
    items: products.map((product) => ({ productId: product.id, quantity: 1 })),
  });
  assert.equal(checkout.response.status, 200, JSON.stringify(checkout.payload));
  assert.equal(checkout.payload.invoice.subtotal, 300);
  assert.equal(checkout.payload.invoice.tax, 20);
  assert.equal(checkout.payload.invoice.total, 320);
  assert.deepEqual(checkout.payload.invoice.items.map((item) => item.vatRate).sort((a, b) => a - b), [0, 5, 15]);

  const fivePercentProduct = products.find((product) => product.vatRate === 5);
  const updated = await patch(owner.cookie, `/data/products/${fivePercentProduct.id}`, { vatRate: 0 });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.payload));
  const invoices = await request("/data/invoices", { cookie: owner.cookie });
  const persistedInvoice = invoices.payload.records.find((invoice) => invoice.id === checkout.payload.invoice.id);
  assert.equal(persistedInvoice.tax, 20, "تغيير المنتج لا يعيد حساب ضريبة الفاتورة التاريخية");
  assert.deepEqual(persistedInvoice.items.map((item) => item.vatRate).sort((a, b) => a - b), [0, 5, 15]);

  const invalidCorrection = await request(`/accounting/sources/invoices/${checkout.payload.invoice.id}/correct`, {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      reason: "رفض ضريبة غير مطابقة",
      effectiveDate: "2027-01-12",
      replacement: {
        items: [{ productId: fivePercentProduct.id, warehouseId: warehouse.id, quantity: 1, unitPriceExVat: 100, vatRate: 7.5 }],
      },
    },
  });
  assert.equal(invalidCorrection.response.status, 400, JSON.stringify(invalidCorrection.payload));

  const correction = await request(`/accounting/sources/invoices/${checkout.payload.invoice.id}/correct`, {
    method: "POST",
    cookie: owner.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      reason: "تصحيح يحفظ لقطة ضريبة المنتج الأصلية",
      effectiveDate: "2027-01-12",
      replacement: {
        items: [{ productId: fivePercentProduct.id, warehouseId: warehouse.id, quantity: 1, unitPriceExVat: 100 }],
      },
    },
  });
  assert.equal(correction.response.status, 201, JSON.stringify(correction.payload));
  assert.equal(correction.payload.source.items[0].vatRate, 5);
  assert.equal(correction.payload.source.tax, 5);
  assert.equal(correction.payload.source.total, 105);
});

test("استلام دفعتين يحسب VAT ويستهلك FIFO ويؤرشف القيود وإعادة الطلب", async () => {
  const owner = await registerOwner();
  const { payload: locationPayload } = await request("/data/warehouses", { cookie: owner.cookie });
  const warehouse = locationPayload.records[0];
  const product = await post(owner.cookie, "/data/products", { name: unique("FIFO VAT"), stock: 0, sellPrice: 10 });
  assert.equal(product.response.status, 201, JSON.stringify(product.payload));
  const firstOperation = crypto.randomUUID();
  const firstBody = {
    orderNumber: unique("PO-1"), supplierName: "مورد الاختبار", date: "2026-10-01", warehouseId: warehouse.id,
    paymentMethod: "cash", clientOperationId: firstOperation,
    items: [{ productId: product.payload.record.id, quantity: 2, unitCostExVat: 3 }],
  };
  const first = await post(owner.cookie, "/inventory/purchase-receipts", firstBody);
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.purchase.tax, 0.9);
  assert.equal(first.payload.purchase.items[0].lineGross, 6.9);
  const replay = await post(owner.cookie, "/inventory/purchase-receipts", firstBody);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.purchase.id, first.payload.purchase.id);
  const mismatch = await post(owner.cookie, "/inventory/purchase-receipts", { ...firstBody, supplierName: "مورد آخر" });
  assert.equal(mismatch.response.status, 409, JSON.stringify(mismatch.payload));
  const second = await post(owner.cookie, "/inventory/purchase-receipts", {
    orderNumber: unique("PO-2"), supplierName: "مورد الاختبار", date: "2026-10-02", warehouseId: warehouse.id,
    paymentMethod: "credit", dueDate: "2026-11-02", clientOperationId: crypto.randomUUID(),
    items: [{ productId: product.payload.record.id, quantity: 2, unitCostExVat: 7 }],
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.payload));
  const checkout = await post(owner.cookie, "/inventory/checkout", {
    warehouseId: warehouse.id, issueDate: "2026-10-03", paymentMethod: "cash", clientOperationId: crypto.randomUUID(),
    items: [{ productId: product.payload.record.id, quantity: 3 }],
  });
  assert.equal(checkout.response.status, 200, JSON.stringify(checkout.payload));
  const line = checkout.payload.invoice.items[0];
  assert.equal(line.lineNet, 30);
  assert.equal(line.vatAmount, 4.5);
  assert.equal(line.lineGross, 34.5);
  assert.deepEqual(line.fifoAllocations.map((allocation) => allocation.unitCostExVat), [3, 7]);
  assert.equal(line.costAmount, 13);
  const correction = await request(`/accounting/sources/invoices/${checkout.payload.invoice.id}/correct`, {
    method: "POST", cookie: owner.cookie, headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      reason: "تصحيح كمية وطريقة دفع",
      effectiveDate: "2026-10-03",
      replacement: {
        paymentMethod: "card",
        items: [{ productId: product.payload.record.id, warehouseId: warehouse.id, quantity: 1, unitPriceExVat: 10, vatRate: 15 }],
      },
    },
  });
  assert.equal(correction.response.status, 201, JSON.stringify(correction.payload));
  assert.equal(correction.payload.source.cogsTotal, 7);
  assert.equal(correction.payload.source.items[0].fifoAllocations[0].unitCostExVat, 7);
  assert.equal(correction.payload.eInvoiceAdjustment.documentType, "credit_note");
  assert.equal(correction.payload.eInvoiceAdjustment.status, "pending_configuration");
  const correctionDocuments = await request("/e-invoicing/documents", { cookie: owner.cookie });
  const correctionNote = correctionDocuments.payload.documents.find(
    (document) => document.id === correction.payload.eInvoiceAdjustment.id,
  );
  assert.equal(correctionNote.taxExclusiveAmount, 20);
  assert.equal(correctionNote.taxAmount, 3);
  assert.equal(correctionNote.taxInclusiveAmount, 23);
  const accounts = await request("/data/accounts", { cookie: owner.cookie });
  const bank = accounts.payload.records.find((account) => account.code === "1100");
  assert.ok(correction.payload.correction.lines.some((journalLine) => journalLine.accountId === String(bank.id) && journalLine.debit === 11.5));
  const cancelCorrected = await request(`/accounting/sources/invoices/${checkout.payload.invoice.id}/cancel`, {
    method: "POST", cookie: owner.cookie, headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { reason: "اختبار إلغاء الفاتورة المصححة", effectiveDate: "2026-10-03" },
  });
  assert.equal(cancelCorrected.response.status, 201, JSON.stringify(cancelCorrected.payload));
  const adjustment = await post(owner.cookie, "/inventory/adjustments", {
    productId: product.payload.record.id, warehouseId: warehouse.id, actualQuantity: 0, reason: "اختبار نقص FIFO",
  });
  assert.equal(adjustment.response.status, 200, JSON.stringify(adjustment.payload));
  // طبقة الـ3 ر.س التي أعادها التصحيح أقدم من طبقة الـ7 ر.س التي أعادها
  // الإلغاء اللاحق، لذلك تبدأ التسوية منها وفق ترتيب FIFO append-only.
  assert.equal(adjustment.payload.adjustment.fifoAllocations[0].unitCostExVat, 3);
  const journals = await request("/data/journalEntries", { cookie: owner.cookie });
  const correctedSaleJournals = journals.payload.records.filter((journal) => journal.sourceType === "sale" && journal.sourceId === checkout.payload.invoice.id);
  const netByAccount = new Map();
  for (const journal of correctedSaleJournals) {
    for (const journalLine of journal.lines) {
      netByAccount.set(journalLine.accountId, (netByAccount.get(journalLine.accountId) ?? 0) + Number(journalLine.debit) - Number(journalLine.credit));
    }
  }
  for (const code of ["1100", "4000", "2100", "5500", "1300"]) {
    const account = accounts.payload.records.find((candidate) => candidate.code === code);
    assert.ok(account, `الحساب ${code} مطلوب`);
    assert.ok(Math.abs(netByAccount.get(String(account.id)) ?? 0) < 0.000001, `يجب أن يكون صافي O,-O,C,-C صفراً للحساب ${code}`);
  }
  const sourceJournals = journals.payload.records.filter((journal) =>
    [first.payload.purchase.id, second.payload.purchase.id, checkout.payload.invoice.id].includes(journal.sourceId) && !journal.adjustmentType);
  assert.equal(sourceJournals.length, 3);
  for (const journal of sourceJournals) {
    const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const credit = journal.lines.reduce((sum, line) => sum + Number(line.credit), 0);
    assert.equal(debit, credit);
  }
  const cancellable = await post(owner.cookie, "/inventory/purchase-receipts", {
    orderNumber: unique("PO-cancel"), supplierName: "مورد آجل", date: "2026-10-04", warehouseId: warehouse.id,
    paymentMethod: "credit", dueDate: "2026-11-04", clientOperationId: crypto.randomUUID(),
    items: [{ productId: product.payload.record.id, quantity: 1, unitCostExVat: 9 }],
  });
  assert.equal(cancellable.response.status, 200, JSON.stringify(cancellable.payload));
  const cancelPurchase = await request(`/accounting/sources/purchaseOrders/${cancellable.payload.purchase.id}/cancel`, {
    method: "POST", cookie: owner.cookie, headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { reason: "إلغاء استلام غير مستهلك", effectiveDate: "2026-10-04" },
  });
  assert.equal(cancelPurchase.response.status, 201, JSON.stringify(cancelPurchase.payload));
  const payables = await request("/data/receivables", { cookie: owner.cookie });
  assert.equal(payables.payload.records.find((record) => record.purchaseId === cancellable.payload.purchase.id).status, "cancelled");
  const consumedCancellation = await request(`/accounting/sources/purchaseOrders/${first.payload.purchase.id}/cancel`, {
    method: "POST", cookie: owner.cookie, headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { reason: "يجب رفض دفعة مستهلكة", effectiveDate: "2026-10-04" },
  });
  assert.equal(consumedCancellation.response.status, 409, JSON.stringify(consumedCancellation.payload));
  const unconfirmedClosure = await post(owner.cookie, "/accounting/close", { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(unconfirmedClosure.response.status, 400, JSON.stringify(unconfirmedClosure.payload));
  assert.equal(unconfirmedClosure.payload.code, "closure_confirmation_required");
  const closure = await post(owner.cookie, "/accounting/close", { from: "2026-10-01", to: "2026-10-31", confirmation: "CLOSE_PERIOD" });
  assert.equal(closure.response.status, 201, JSON.stringify(closure.payload));
  const closedPurchase = await post(owner.cookie, "/inventory/purchase-receipts", {
    orderNumber: unique("PO-closed"), supplierName: "مورد الاختبار", date: "2026-10-10", warehouseId: warehouse.id,
    paymentMethod: "cash", clientOperationId: crypto.randomUUID(),
    items: [{ productId: product.payload.record.id, quantity: 1, unitCostExVat: 2 }],
  });
  assert.equal(closedPurchase.response.status, 409, JSON.stringify(closedPurchase.payload));
});

test("يرحّل الرصيد القديم المختلط قبل طبقات الشراء الأحدث", async () => {
  const owner = await registerOwner();
  const locations = await request("/data/warehouses", { cookie: owner.cookie });
  const warehouse = locations.payload.records[0];
  const product = await post(owner.cookie, "/data/products", {
    name: unique("مخزون قديم مختلط"), stock: 0, sellPrice: 20, costPrice: 2,
  });
  const opening = await post(owner.cookie, "/inventory/adjustments", {
    productId: product.payload.record.id, warehouseId: warehouse.id, actualQuantity: 5,
    unitCostExVat: 2, reason: "رصيد قديم سيحاكي النسخة السابقة", date: "2026-12-01",
  });
  assert.equal(opening.response.status, 200, JSON.stringify(opening.payload));
  const receipt = await post(owner.cookie, "/inventory/purchase-receipts", {
    orderNumber: unique("PO-mixed"), supplierName: "مورد الدفعة الجديدة", date: "2026-12-02",
    warehouseId: warehouse.id, paymentMethod: "cash", clientOperationId: crypto.randomUUID(),
    items: [{ productId: product.payload.record.id, quantity: 2, unitCostExVat: 9 }],
  });
  assert.equal(receipt.response.status, 200, JSON.stringify(receipt.payload));

  const exported = await request("/backup/export", { cookie: owner.cookie });
  assert.equal(exported.response.status, 200, JSON.stringify(exported.payload));
  const legacyBackup = {
    ...exported.payload,
    records: exported.payload.records.filter((record) =>
      !["journalEntries", "purchaseOrders", "receivables", "invoices", "sales"].includes(record.tableName)
      && !(record.tableName === "inventoryLayers"
        && record.data?.productId === product.payload.record.id
        && record.data?.adjustmentReason === "رصيد قديم سيحاكي النسخة السابقة"),
    ),
  };
  const restored = await request("/backup/restore", { method: "POST", cookie: owner.cookie, body: legacyBackup });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.payload));
  generationByCookie.set(owner.cookie, restored.payload.dataGeneration);

  const sale = await post(owner.cookie, "/inventory/checkout", {
    warehouseId: warehouse.id, issueDate: "2026-12-03", paymentMethod: "cash",
    clientOperationId: crypto.randomUUID(), items: [{ productId: product.payload.record.id, quantity: 6 }],
  });
  assert.equal(sale.response.status, 200, JSON.stringify(sale.payload));
  const allocations = sale.payload.invoice.items[0].fifoAllocations;
  assert.deepEqual(allocations.map((allocation) => allocation.unitCostExVat), [2, 9]);
  assert.deepEqual(allocations.map((allocation) => allocation.quantity), [5, 1]);
});