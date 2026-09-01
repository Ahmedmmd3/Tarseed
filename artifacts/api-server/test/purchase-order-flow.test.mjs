import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.PURCHASE_ORDER_TEST_ORIGIN ?? "http://127.0.0.1:80";
const generations = new Map();

async function request(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(cookie && generations.has(cookie) ? { "X-Wudooh-Data-Generation": String(generations.get(cookie)) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function owner(label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `${label}-${suffix}@example.test`;
  const password = "Safe-test-password-123";
  const authHeaders = { "X-Forwarded-For": `192.0.2.${Math.floor(Math.random() * 200) + 1}` };
  const registration = await request("/auth/register", {
    method: "POST",
    headers: authHeaders,
    body: {
      projectName: `منشأة مشتريات ${suffix}`,
      name: "مالك اختبار المشتريات",
      email,
      phone: `05${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`,
      password,
    },
  });
  assert.equal(registration.response.status, 202, JSON.stringify(registration.payload));
  const verification = await request("/auth/email-verification/verify", {
    method: "POST",
    headers: authHeaders,
    body: { email, code: process.env.EMAIL_VERIFICATION_TEST_CODE },
  });
  assert.equal(verification.response.status, 200, JSON.stringify(verification.payload));
  const cookie = verification.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  generations.set(cookie, verification.payload.user.dataGeneration);
  return { cookie, email, password };
}

async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    headers: { "X-Forwarded-For": `192.0.2.${Math.floor(Math.random() * 200) + 1}` },
    body: { email, password },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  generations.set(cookie, result.payload.user.dataGeneration);
  return cookie;
}

async function fixture(label) {
  const account = await owner(label);
  const warehouses = await request("/data/warehouses", { cookie: account.cookie });
  assert.equal(warehouses.response.status, 200, JSON.stringify(warehouses.payload));
  const supplier = await request("/data/suppliers", {
    method: "POST",
    cookie: account.cookie,
    body: { name: `مورد ${label}` },
  });
  assert.equal(supplier.response.status, 201, JSON.stringify(supplier.payload));
  const product = await request("/data/products", {
    method: "POST",
    cookie: account.cookie,
    body: { name: `منتج ${label}`, stock: 0, sellPrice: 40, vatRate: 15 },
  });
  assert.equal(product.response.status, 201, JSON.stringify(product.payload));
  return {
    account,
    warehouses: warehouses.payload.records,
    supplier: supplier.payload.record,
    product: product.payload.record,
  };
}

function orderBody(scenario, overrides = {}) {
  return {
    orderNumber: "CLIENT-NUMBER-IGNORED",
    supplierId: scenario.supplier.id,
    supplierName: scenario.supplier.name,
    issueDate: "2026-09-01",
    expectedDate: "2026-09-15",
    warehouseId: scenario.warehouses[0].id,
    status: "draft",
    paymentMethod: "credit",
    paymentStatus: "unpaid",
    dueDate: "2026-10-01",
    items: [{
      productId: scenario.product.id,
      productName: "اسم غير موثوق",
      quantity: 5,
      receivedQuantity: 0,
      unitCost: 10,
      vatRate: 0,
      lineNet: 1,
      vatAmount: 1,
      total: 1,
    }],
    subtotal: 1,
    vat: 1,
    total: 1,
    ...overrides,
  };
}

test("يرقم أوامر الشراء ويحسب أصنافها وإجمالياتها في الخادم", async () => {
  const scenario = await fixture("ترقيم");
  const first = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario),
  });
  const second = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, { status: "sent" }),
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  assert.equal(second.response.status, 201, JSON.stringify(second.payload));
  assert.equal(first.payload.record.orderNumber, "PO-0001");
  assert.equal(second.payload.record.orderNumber, "PO-0002");
  assert.equal(first.payload.record.items[0].productName, scenario.product.name);
  assert.deepEqual(
    {
      subtotal: first.payload.record.subtotal,
      vat: first.payload.record.vat,
      total: first.payload.record.total,
    },
    { subtotal: 50, vat: 7.5, total: 57.5 },
  );
  assert.equal(first.payload.record.received, false);
  assert.equal(first.payload.record.items[0].receivedQuantity, 0);
});

test("يعيد مستند الطباعة حقول المورد فقط دون بيانات الدفع والاستلام الداخلية", async () => {
  const scenario = await fixture("طباعة");
  const created = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, { status: "sent", notes: "التسليم في الموقع المحدد" }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));

  const printed = await request(`/data/purchaseOrders/${created.payload.record.id}/print`, {
    cookie: scenario.account.cookie,
  });
  assert.equal(printed.response.status, 200, JSON.stringify(printed.payload));
  assert.deepEqual(
    Object.keys(printed.payload.document).sort(),
    [
      "expectedDate",
      "issueDate",
      "items",
      "notes",
      "orderNumber",
      "status",
      "subtotal",
      "supplierName",
      "total",
      "vat",
      "warehouseName",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(printed.payload.document.items[0]).sort(),
    [
      "lineNet",
      "productName",
      "quantity",
      "total",
      "unitCost",
      "vatAmount",
      "vatRate",
    ].sort(),
  );
  assert.equal(printed.payload.document.supplierName, scenario.supplier.name);
  assert.equal(printed.payload.document.warehouseName, scenario.warehouses[0].name);
  assert.equal(printed.payload.document.items[0].productName, scenario.product.name);
  assert.equal(printed.payload.document.total, 57.5);
  assert.equal(JSON.stringify(printed.payload).includes("paymentMethod"), false);
  assert.equal(JSON.stringify(printed.payload).includes("receivedQuantity"), false);
});

test("يسجل الاستلام الجزئي والكامل ذرياً ويعيد الطلب نفسه بلا تكرار", async () => {
  const scenario = await fixture("استلام");
  const created = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, { status: "sent" }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const orderId = created.payload.record.id;
  const operationId = crypto.randomUUID();
  const partialBody = {
    receiptDate: "2026-09-05",
    items: [{ productId: scenario.product.id, quantity: 2 }],
  };
  const partial = await request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": operationId },
    body: partialBody,
  });
  assert.equal(partial.response.status, 200, JSON.stringify(partial.payload));
  assert.equal(partial.payload.order.status, "partial");
  assert.equal(partial.payload.order.items[0].receivedQuantity, 2);
  assert.equal(partial.payload.receipt.total, 23);

  const replay = await request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": operationId },
    body: partialBody,
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.replayed, true);
  assert.equal(replay.payload.receipt.operationId, partial.payload.receipt.operationId);

  const completed = await request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      receiptDate: "2026-09-06",
      items: [{ productId: scenario.product.id, quantity: 3 }],
    },
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.payload));
  assert.equal(completed.payload.order.status, "received");
  assert.equal(completed.payload.order.items[0].receivedQuantity, 5);
  assert.equal(completed.payload.order.receivedTotal, 57.5);

  const [balances, layers, journals, payables] = await Promise.all([
    request("/data/inventoryBalances", { cookie: scenario.account.cookie }),
    request("/data/products", { cookie: scenario.account.cookie }),
    request("/data/journalEntries", { cookie: scenario.account.cookie }),
    request("/data/receivables", { cookie: scenario.account.cookie }),
  ]);
  const balance = balances.payload.records.find((record) =>
    record.productId === scenario.product.id && record.warehouseId === scenario.warehouses[0].id);
  assert.equal(balance.quantity, 5);
  assert.equal(layers.payload.records.find((record) => record.id === scenario.product.id).stock, 5);
  const purchaseJournals = journals.payload.records.filter((record) => record.sourceType === "purchase" && record.sourceId === orderId);
  assert.equal(purchaseJournals.length, 2);
  assert.ok(purchaseJournals.every((journal) =>
    journal.lines.reduce((sum, line) => sum + Number(line.debit), 0)
      === journal.lines.reduce((sum, line) => sum + Number(line.credit), 0)));
  assert.equal(payables.payload.records.filter((record) => record.purchaseOrderId === orderId).length, 2);
  assert.equal((await request(`/data/purchaseOrders/${orderId}`, {
    method: "PATCH",
    cookie: scenario.account.cookie,
    body: { notes: "تعديل غير مسموح" },
  })).response.status, 409);
  assert.equal((await request(`/data/purchaseOrders/${orderId}`, {
    method: "DELETE",
    cookie: scenario.account.cookie,
  })).response.status, 409);
  const cancelled = await request(`/accounting/sources/purchaseOrders/${orderId}/cancel`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { reason: "اختبار عكس الاستلام الكامل", effectiveDate: "2026-09-07" },
  });
  assert.equal(cancelled.response.status, 201, JSON.stringify(cancelled.payload));
  const balanceAfterCancel = await request("/data/inventoryBalances", { cookie: scenario.account.cookie });
  assert.equal(balanceAfterCancel.payload.records.find((record) =>
    record.productId === scenario.product.id && record.warehouseId === scenario.warehouses[0].id).quantity, 0);
  const cancelledPayables = await request("/data/receivables", { cookie: scenario.account.cookie });
  assert.ok(cancelledPayables.payload.records
    .filter((record) => record.purchaseOrderId === orderId)
    .every((record) => record.status === "cancelled"));
});

test("يمنع الاستلام المتزامن الزائد ويعزل المنشآت ونطاق المواقع", async () => {
  const scenario = await fixture("تزامن");
  const created = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, {
      status: "sent",
      items: [{ productId: scenario.product.id, quantity: 2, unitCost: 5 }],
    }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const orderId = created.payload.record.id;
  const receive = () => request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { receiptDate: "2026-09-07", items: [{ productId: scenario.product.id, quantity: 2 }] },
  });
  const concurrent = await Promise.all([receive(), receive()]);
  assert.equal(concurrent.filter((result) => result.response.status === 200).length, 1);
  assert.equal(concurrent.filter((result) => result.response.status === 409).length, 1);

  const other = await owner("منشأة-أخرى");
  const isolated = await request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: other.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { receiptDate: "2026-09-08", items: [{ productId: scenario.product.id, quantity: 1 }] },
  });
  assert.equal(isolated.response.status, 404, JSON.stringify(isolated.payload));

  const scopedOrder = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, {
      status: "sent",
      warehouseId: scenario.warehouses[1].id,
      items: [{ productId: scenario.product.id, quantity: 1, unitCost: 5 }],
    }),
  });
  assert.equal(scopedOrder.response.status, 201, JSON.stringify(scopedOrder.payload));
  const memberEmail = `inventory-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const memberPassword = "Safe-test-password-123";
  const member = await request("/team/members", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: {
      name: "مستلم موقع محدود",
      email: memberEmail,
      password: memberPassword,
      roleId: "inventory",
      permissions: { dashboard: true, inventory: true },
      locationScope: "selected",
      warehouseIds: [scenario.warehouses[0].id],
    },
  });
  assert.equal(member.response.status, 201, JSON.stringify(member.payload));
  const memberCookie = await login(memberEmail, memberPassword);
  const forbidden = await request(`/data/purchaseOrders/${scopedOrder.payload.record.id}/receive`, {
    method: "POST",
    cookie: memberCookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { receiptDate: "2026-09-09", items: [{ productId: scenario.product.id, quantity: 1 }] },
  });
  assert.equal(forbidden.response.status, 403, JSON.stringify(forbidden.payload));
});

test("يرحل الاستلام النقدي للصندوق دون إنشاء ذمة ولا يزامن أمراً غير مستلم", async () => {
  const scenario = await fixture("نقدي");
  const created = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, {
      paymentMethod: "cash",
      dueDate: "",
      status: "draft",
      items: [{ productId: scenario.product.id, quantity: 1, unitCost: 20 }],
    }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const synced = await request("/accounting/sync-source-journals", {
    method: "POST",
    cookie: scenario.account.cookie,
  });
  assert.equal(synced.response.status, 200, JSON.stringify(synced.payload));
  const beforeReceiptJournals = await request("/data/journalEntries", { cookie: scenario.account.cookie });
  assert.equal(beforeReceiptJournals.payload.records.some((record) =>
    record.sourceType === "purchase" && record.sourceId === created.payload.record.id), false);
  const receipt = await request(`/data/purchaseOrders/${created.payload.record.id}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { receiptDate: "2026-09-10", items: [{ productId: scenario.product.id, quantity: 1 }] },
  });
  assert.equal(receipt.response.status, 200, JSON.stringify(receipt.payload));
  assert.equal(receipt.payload.order.paymentStatus, "paid");
  assert.equal(receipt.payload.receipt.payableId, undefined);
  const [accounts, journals, payables] = await Promise.all([
    request("/data/accounts", { cookie: scenario.account.cookie }),
    request("/data/journalEntries", { cookie: scenario.account.cookie }),
    request("/data/receivables", { cookie: scenario.account.cookie }),
  ]);
  const cashAccount = accounts.payload.records.find((record) => record.code === "1000");
  const journal = journals.payload.records.find((record) =>
    record.sourceType === "purchase" && record.sourceId === created.payload.record.id);
  assert.ok(journal.lines.some((line) => line.accountId === String(cashAccount.id) && line.credit === 23));
  assert.equal(payables.payload.records.some((record) => record.purchaseOrderId === created.payload.record.id), false);
});

test("يوزع سداد المورد على ذمم أوامر متعددة ويحدّث الأرصدة بقيد واحد دون تكرار", async () => {
  const scenario = await fixture("سداد-مورد");
  const createReceivedOrder = async (quantity, date) => {
    const created = await request("/data/purchaseOrders", {
      method: "POST",
      cookie: scenario.account.cookie,
      body: orderBody(scenario, {
        status: "sent",
        items: [{ productId: scenario.product.id, quantity, unitCost: 10 }],
      }),
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    const receipt = await request(`/data/purchaseOrders/${created.payload.record.id}/receive`, {
      method: "POST",
      cookie: scenario.account.cookie,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { receiptDate: date, items: [{ productId: scenario.product.id, quantity }] },
    });
    assert.equal(receipt.response.status, 200, JSON.stringify(receipt.payload));
    return { orderId: created.payload.record.id, payableId: receipt.payload.receipt.payableId, total: receipt.payload.receipt.total };
  };
  const first = await createReceivedOrder(2, "2026-09-11");
  const second = await createReceivedOrder(3, "2026-09-12");
  const scopedEmail = `accountant-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const scopedPassword = "Safe-test-password-123";
  const scopedMember = await request("/team/members", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: {
      name: "محاسب موقع محدود",
      email: scopedEmail,
      password: scopedPassword,
      roleId: "accountant",
      permissions: { dashboard: true, accounting: true },
      locationScope: "selected",
      warehouseIds: [scenario.warehouses[1].id],
    },
  });
  assert.equal(scopedMember.response.status, 201, JSON.stringify(scopedMember.payload));
  const scopedCookie = await login(scopedEmail, scopedPassword);
  const scopedPayment = await request("/accounting/supplier-payments", {
    method: "POST",
    cookie: scopedCookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      supplierId: scenario.supplier.id,
      supplierName: scenario.supplier.name,
      paymentDate: "2026-09-13",
      paymentMethod: "cash",
      allocations: [{ payableId: first.payableId, amount: 1 }],
    },
  });
  assert.equal(scopedPayment.response.status, 403, JSON.stringify(scopedPayment.payload));
  const operationId = crypto.randomUUID();
  const body = {
    supplierId: scenario.supplier.id,
    supplierName: scenario.supplier.name,
    paymentDate: "2026-09-13",
    paymentMethod: "bank",
    reference: "TRX-100",
    allocations: [
      { payableId: first.payableId, amount: first.total },
      { payableId: second.payableId, amount: 10 },
    ],
  };
  const payment = await request("/accounting/supplier-payments", {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": operationId },
    body,
  });
  assert.equal(payment.response.status, 201, JSON.stringify(payment.payload));
  assert.equal(payment.payload.replayed, false);
  assert.equal(payment.payload.payables.find((item) => item.id === first.payableId).status, "paid");
  assert.equal(payment.payload.payables.find((item) => item.id === second.payableId).status, "partial");
  assert.equal(payment.payload.orders.find((item) => item.id === first.orderId).remaining, 0);
  assert.equal(payment.payload.orders.find((item) => item.id === second.orderId).remaining, second.total - 10);

  const replay = await request("/accounting/supplier-payments", {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": operationId },
    body,
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.replayed, true);
  assert.equal(replay.payload.payment.id, payment.payload.payment.id);

  const conflict = await request("/accounting/supplier-payments", {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": operationId },
    body: { ...body, reference: "TRX-DIFFERENT" },
  });
  assert.equal(conflict.response.status, 409, JSON.stringify(conflict.payload));

  const [journals, payables, orders] = await Promise.all([
    request("/data/journalEntries", { cookie: scenario.account.cookie }),
    request("/data/receivables", { cookie: scenario.account.cookie }),
    request("/data/purchaseOrders", { cookie: scenario.account.cookie }),
  ]);
  const paymentJournals = journals.payload.records.filter((record) =>
    record.sourceType === "supplier_payment" && record.sourceId === payment.payload.payment.id);
  assert.equal(paymentJournals.length, 1);
  assert.equal(paymentJournals[0].lines.reduce((sum, line) => sum + Number(line.debit), 0), first.total + 10);
  assert.equal(paymentJournals[0].lines.reduce((sum, line) => sum + Number(line.credit), 0), first.total + 10);
  assert.equal(payables.payload.records.find((item) => item.id === first.payableId).paid, first.total);
  assert.equal(orders.payload.records.find((item) => item.id === second.orderId).paymentStatus, "partial");

  const genericUpdate = await request(`/data/receivables/${second.payableId}`, {
    method: "PATCH",
    cookie: scenario.account.cookie,
    body: { paid: second.total, status: "paid" },
  });
  assert.equal(genericUpdate.response.status, 409, JSON.stringify(genericUpdate.payload));
  const forgedPayable = await request("/data/receivables", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: {
      type: "payable",
      purchaseOrderId: second.orderId,
      purchaseReceiptOperationId: 999999,
      supplierId: scenario.supplier.id,
      supplierName: scenario.supplier.name,
      party: scenario.supplier.name,
      amount: 500,
      paid: 0,
      status: "unpaid",
      dueDate: "2026-09-30",
    },
  });
  assert.equal(forgedPayable.response.status, 409, JSON.stringify(forgedPayable.payload));
  const staged = await request("/data/receivables", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: {
      type: "receivable",
      party: "عميل اختبار",
      amount: 25,
      paid: 0,
      status: "unpaid",
      dueDate: "2026-09-30",
    },
  });
  assert.equal(staged.response.status, 201, JSON.stringify(staged.payload));
  const stagedForgery = await request(`/data/receivables/${staged.payload.record.id}`, {
    method: "PATCH",
    cookie: scenario.account.cookie,
    body: {
      type: "payable",
      purchaseOrderId: second.orderId,
      purchaseReceiptOperationId: 999999,
      supplierId: scenario.supplier.id,
      supplierName: scenario.supplier.name,
    },
  });
  assert.equal(stagedForgery.response.status, 409, JSON.stringify(stagedForgery.payload));
  const cancelPaid = await request(`/accounting/sources/purchaseOrders/${first.orderId}/cancel`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { reason: "محاولة إلغاء أمر مدفوع", effectiveDate: "2026-09-14" },
  });
  assert.equal(cancelPaid.response.status, 409, JSON.stringify(cancelPaid.payload));

  const other = await fixture("سداد-معزول");
  const isolated = await request("/accounting/supplier-payments", {
    method: "POST",
    cookie: other.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      supplierId: other.supplier.id,
      supplierName: other.supplier.name,
      paymentDate: "2026-09-13",
      paymentMethod: "cash",
      allocations: [{ payableId: second.payableId, amount: 1 }],
    },
  });
  assert.equal(isolated.response.status, 404, JSON.stringify(isolated.payload));
});

test("يعيد حساب رصيد الأمر عند استلام دفعة جديدة بعد سداد الدفعة السابقة", async () => {
  const scenario = await fixture("سداد-ثم-استلام");
  const created = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, {
      status: "sent",
      items: [{ productId: scenario.product.id, quantity: 4, unitCost: 10 }],
    }),
  });
  const orderId = created.payload.record.id;
  const firstReceipt = await request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { receiptDate: "2026-09-15", items: [{ productId: scenario.product.id, quantity: 2 }] },
  });
  assert.equal(firstReceipt.response.status, 200, JSON.stringify(firstReceipt.payload));
  const firstPayableId = firstReceipt.payload.receipt.payableId;
  const paid = await request("/accounting/supplier-payments", {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      supplierId: scenario.supplier.id,
      supplierName: scenario.supplier.name,
      paymentDate: "2026-09-16",
      paymentMethod: "cash",
      allocations: [{ payableId: firstPayableId, amount: firstReceipt.payload.receipt.total }],
    },
  });
  assert.equal(paid.response.status, 201, JSON.stringify(paid.payload));
  assert.equal(paid.payload.orders[0].remaining, 0);
  const secondReceipt = await request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { receiptDate: "2026-09-17", items: [{ productId: scenario.product.id, quantity: 2 }] },
  });
  assert.equal(secondReceipt.response.status, 200, JSON.stringify(secondReceipt.payload));
  assert.equal(secondReceipt.payload.order.payableTotal, 46);
  assert.equal(secondReceipt.payload.order.paid, 23);
  assert.equal(secondReceipt.payload.order.remaining, 23);
  assert.equal(secondReceipt.payload.order.paymentStatus, "partial");
});

test("يسلسل السداد والاستلام المتزامنين دون تعارض أقفال أو رصيد قديم", async () => {
  const scenario = await fixture("سداد-واستلام-متزامن");
  const created = await request("/data/purchaseOrders", {
    method: "POST",
    cookie: scenario.account.cookie,
    body: orderBody(scenario, {
      status: "sent",
      items: [{ productId: scenario.product.id, quantity: 4, unitCost: 10 }],
    }),
  });
  const orderId = created.payload.record.id;
  const firstReceipt = await request(`/data/purchaseOrders/${orderId}/receive`, {
    method: "POST",
    cookie: scenario.account.cookie,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: { receiptDate: "2026-09-18", items: [{ productId: scenario.product.id, quantity: 2 }] },
  });
  assert.equal(firstReceipt.response.status, 200, JSON.stringify(firstReceipt.payload));
  const [payment, secondReceipt] = await Promise.all([
    request("/accounting/supplier-payments", {
      method: "POST",
      cookie: scenario.account.cookie,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: {
        supplierId: scenario.supplier.id,
        supplierName: scenario.supplier.name,
        paymentDate: "2026-09-19",
        paymentMethod: "bank",
        allocations: [{ payableId: firstReceipt.payload.receipt.payableId, amount: firstReceipt.payload.receipt.total }],
      },
    }),
    request(`/data/purchaseOrders/${orderId}/receive`, {
      method: "POST",
      cookie: scenario.account.cookie,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { receiptDate: "2026-09-19", items: [{ productId: scenario.product.id, quantity: 2 }] },
    }),
  ]);
  assert.equal(payment.response.status, 201, JSON.stringify(payment.payload));
  assert.equal(secondReceipt.response.status, 200, JSON.stringify(secondReceipt.payload));
  const orders = await request("/data/purchaseOrders", { cookie: scenario.account.cookie });
  const order = orders.payload.records.find((item) => item.id === orderId);
  assert.equal(order.payableTotal, 46);
  assert.equal(order.paid, 23);
  assert.equal(order.remaining, 23);
  assert.equal(order.paymentStatus, "partial");
});