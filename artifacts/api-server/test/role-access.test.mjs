import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  authSessionsTable,
  db,
  erpRecordsTable,
  organizationsTable,
  pool,
  teamUsersTable,
} from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import app from "../src/app.ts";
import { hashPassword } from "../src/lib/team-auth.ts";

let server;
let origin;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = {
  organizationIds: [],
  users: {},
  records: {},
  warehouses: {},
};
const passwords = {
  owner: "Owner-role-test-123",
  financialanalyst: "Financial-analyst-role-test-123",
  accountant: "Accountant-role-test-123",
  cashier: "Cashier-role-test-123",
  warehouse: "Warehouse-role-test-123",
  hr: "Hr-role-test-123",
};
const roles = {
  owner: {
    roleId: "owner",
    permissions: {},
  },
  accountant: {
    roleId: "accountant",
    permissions: { dashboard: true, accounting: true, reports: true },
  },
  financialanalyst: {
    roleId: "financial_analyst",
    permissions: { dashboard: true, sales: true, accounting: true },
  },
  cashier: {
    roleId: "sales",
    permissions: { dashboard: true, sales: true },
  },
  warehouse: {
    roleId: "inventory",
    permissions: { dashboard: true, inventory: true },
  },
  hr: {
    roleId: "hr",
    permissions: { dashboard: true, hr: true },
  },
};
const assistantRequests = [];
const loginSessions = new Map();
const originalAnthropicCreate = anthropic.messages.create;

async function request(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(?:^|,\s*)wudooh_session=([^;]+)/);
  return match ? `wudooh_session=${match[1]}` : null;
}

async function createOrganization(name) {
  const now = new Date();
  const [organization] = await db.insert(organizationsTable).values({
    name: `${name} ${suffix}`,
    dataGeneration: 1,
    planId: "pro",
    subscriptionStatus: "active",
    trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    subscriptionStartedAt: now,
    subscriptionEndsAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    isTestWorkspace: true,
  }).returning();
  fixture.organizationIds.push(organization.id);
  return organization;
}

async function createUser(organizationId, key, password, { roleId, permissions }) {
  const [user] = await db.insert(teamUsersTable).values({
    organizationId,
    email: `${key}-${suffix}@example.test`,
    name: `اختبار صلاحيات ${key}`,
    passwordHash: await hashPassword(password),
    roleId,
    permissions,
    locationScope: "selected",
    warehouseIds: [fixture.warehouses.allowed.id],
    status: "active",
    emailVerifiedAt: new Date(),
  }).returning();
  fixture.users[key] = user;
  return user;
}

async function createRecord(organizationId, tableName, data) {
  const [record] = await db.insert(erpRecordsTable).values({
    organizationId,
    tableName,
    data,
  }).returning();
  fixture.records[`${tableName}:${data.name ?? data.number ?? data.invoiceNumber}`] = record;
  return record;
}

function riyadhDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function login(key) {
  const cached = loginSessions.get(key);
  if (cached) return cached;
  const result = await request("/auth/login", {
    method: "POST",
    body: { email: fixture.users[key].email, password: passwords[key] },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const cookie = cookieFrom(result.response);
  assert.ok(cookie);
  const session = { ...result, cookie };
  loginSessions.set(key, session);
  return session;
}

async function assertList(cookie, tableName, expectedStatus, expectedIds = null) {
  const result = await request(`/data/${tableName}`, { cookie });
  assert.equal(result.response.status, expectedStatus, `${tableName}: ${JSON.stringify(result.payload)}`);
  if (expectedIds) {
    assert.deepEqual(
      result.payload.records.map((record) => record.id),
      expectedIds,
      `${tableName} يجب أن يعرض السجلات الواقعة ضمن نطاق الدور فقط`,
    );
  }
  return result;
}

before(async () => {
  anthropic.messages.create = async (request) => {
    assistantRequests.push(request);
    return {
      id: "role-access-assistant-test",
      type: "message",
      role: "assistant",
      model: request.model,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "إجابة اختبارية" }],
    };
  };
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  const organization = await createOrganization("منشأة اختبار الأدوار");
  const foreignOrganization = await createOrganization("منشأة أخرى لاختبار العزل");

  fixture.warehouses.allowed = await createRecord(organization.id, "warehouses", {
    name: "مستودع الدور المسموح",
    type: "warehouse",
    status: "active",
  });
  fixture.warehouses.restricted = await createRecord(organization.id, "warehouses", {
    name: "مستودع الدور المحجوب",
    type: "branch",
    status: "active",
  });
  fixture.records.allowedProduct = await createRecord(organization.id, "products", {
    name: "منتج الموقع المسموح",
    warehouseId: fixture.warehouses.allowed.id,
    stock: 0,
    sellPrice: 25,
  });
  fixture.records.restrictedProduct = await createRecord(organization.id, "products", {
    name: "منتج الموقع المحجوب",
    warehouseId: fixture.warehouses.restricted.id,
    stock: 0,
    sellPrice: 50,
  });
  fixture.records.foreignProduct = await createRecord(foreignOrganization.id, "products", {
    name: "منتج المنشأة الأخرى",
    stock: 0,
    sellPrice: 75,
  });
  fixture.records.account = await createRecord(organization.id, "accounts", {
    code: "9900",
    name: "حساب اختبار الصلاحيات",
    type: "asset",
    openingBalance: 0,
    status: "active",
  });
  fixture.records.revenueAccount = await createRecord(organization.id, "accounts", {
    code: "4900",
    name: "إيراد اختبار الصلاحيات",
    type: "revenue",
    status: "active",
  });
  fixture.records.expenseAccount = await createRecord(organization.id, "accounts", {
    code: "5900",
    name: "مصروف اختبار الصلاحيات",
    type: "expense",
    status: "active",
  });
  fixture.records.invoice = await createRecord(organization.id, "invoices", {
    invoiceNumber: `ROLE-${suffix}`,
    warehouseId: fixture.warehouses.allowed.id,
    date: "2026-08-20",
    total: 25,
  });
  fixture.records.restrictedInvoice = await createRecord(organization.id, "invoices", {
    invoiceNumber: `ROLE-RESTRICTED-${suffix}`,
    warehouseId: fixture.warehouses.restricted.id,
    date: "2026-08-20",
    total: 1000,
  });
  const currentBusinessDate = riyadhDate();
  fixture.records.allowedCurrentInvoice = await createRecord(organization.id, "invoices", {
    invoiceNumber: `WEEKLY-ALLOWED-${suffix}`,
    warehouseId: fixture.warehouses.allowed.id,
    issueDate: currentBusinessDate,
    dueDate: currentBusinessDate,
    total: 111,
    paid: 111,
  });
  fixture.records.restrictedCurrentInvoice = await createRecord(organization.id, "invoices", {
    invoiceNumber: `WEEKLY-RESTRICTED-${suffix}`,
    warehouseId: fixture.warehouses.restricted.id,
    issueDate: currentBusinessDate,
    dueDate: currentBusinessDate,
    total: 7777,
    paid: 7777,
  });
  fixture.records.allowedCurrentExpense = await createRecord(organization.id, "expenses", {
    description: `WEEKLY-EXPENSE-ALLOWED-${suffix}`,
    warehouseId: fixture.warehouses.allowed.id,
    date: currentBusinessDate,
    amount: 222,
    status: "posted",
  });
  fixture.records.restrictedCurrentExpense = await createRecord(organization.id, "expenses", {
    description: `WEEKLY-EXPENSE-RESTRICTED-${suffix}`,
    warehouseId: fixture.warehouses.restricted.id,
    date: currentBusinessDate,
    amount: 8888,
    status: "posted",
  });
  fixture.records.allowedCurrentSale = await createRecord(organization.id, "sales", {
    productId: fixture.records.allowedProduct.id,
    warehouseId: fixture.warehouses.allowed.id,
    createdAt: `${currentBusinessDate}T10:00:00.000Z`,
    quantity: 3,
    total: 111,
  });
  fixture.records.restrictedCurrentSale = await createRecord(organization.id, "sales", {
    productId: fixture.records.restrictedProduct.id,
    warehouseId: fixture.warehouses.restricted.id,
    createdAt: `${currentBusinessDate}T11:00:00.000Z`,
    quantity: 99,
    total: 7777,
  });
  fixture.records.employee = await createRecord(organization.id, "employees", {
    name: "موظف اختبار الموارد البشرية",
    status: "active",
    profile: {
      notes: "س".repeat(250_000),
      nested: { privateNotes: "ص".repeat(250_000) },
    },
  });
  fixture.records.supplier = await createRecord(organization.id, "suppliers", {
    name: "مورد اختبار النطاق",
    creditLimit: 100,
    status: "active",
  });
  fixture.records.allowedPurchaseOrder = await createRecord(organization.id, "purchaseOrders", {
    orderNumber: `PO-ALLOWED-${suffix}`,
    supplierId: fixture.records.supplier.id,
    supplierName: "مورد اختبار النطاق",
    warehouseId: fixture.warehouses.allowed.id,
    total: 70,
    status: "received",
  });
  fixture.records.restrictedPurchaseOrder = await createRecord(organization.id, "purchaseOrders", {
    orderNumber: `PO-RESTRICTED-${suffix}`,
    supplierId: fixture.records.supplier.id,
    supplierName: "مورد اختبار النطاق",
    warehouseId: fixture.warehouses.restricted.id,
    total: 900,
    status: "received",
  });
  fixture.records.restrictedReceiptOperation = await createRecord(organization.id, "purchaseReceiptOperations", {
    purchaseOrderId: fixture.records.restrictedPurchaseOrder.id,
    warehouseId: fixture.warehouses.restricted.id,
    status: "completed",
  });
  fixture.records.allowedPayable = await createRecord(organization.id, "receivables", {
    party: "مورد اختبار النطاق",
    type: "payable",
    purchaseOrderId: fixture.records.allowedPurchaseOrder.id,
    amount: 70,
    paid: 0,
    status: "unpaid",
  });
  fixture.records.restrictedPayable = await createRecord(organization.id, "receivables", {
    party: "مورد اختبار النطاق",
    type: "payable",
    purchaseOrderId: fixture.records.restrictedPurchaseOrder.id,
    amount: 900,
    paid: 0,
    status: "unpaid",
  });
  fixture.records.legacyRestrictedPayable = await createRecord(organization.id, "receivables", {
    party: "مورد اختبار النطاق",
    type: "payable",
    purchaseReceiptOperationId: fixture.records.restrictedReceiptOperation.id,
    amount: 800,
    paid: 0,
    status: "unpaid",
  });
  fixture.records.allowedSaleJournal = await createRecord(organization.id, "journalEntries", {
    number: `J-SALE-ALLOWED-${suffix}`,
    date: "2026-08-20",
    description: "قيد بيع الموقع المسموح",
    status: "posted",
    sourceType: "sale",
    sourceId: fixture.records.invoice.id,
    lines: [{ accountId: fixture.records.revenueAccount.id, debit: 0, credit: 100 }],
  });
  fixture.records.restrictedSaleJournal = await createRecord(organization.id, "journalEntries", {
    number: `J-SALE-RESTRICTED-${suffix}`,
    date: "2026-08-20",
    description: "قيد بيع الموقع المحجوب",
    status: "posted",
    sourceType: "sale",
    sourceId: fixture.records.restrictedInvoice.id,
    lines: [{ accountId: fixture.records.revenueAccount.id, debit: 0, credit: 1000 }],
  });
  fixture.records.allowedPurchaseJournal = await createRecord(organization.id, "journalEntries", {
    number: `J-PURCHASE-ALLOWED-${suffix}`,
    date: "2026-08-20",
    description: "قيد شراء الموقع المسموح",
    status: "posted",
    sourceType: "purchase",
    sourceId: fixture.records.allowedPurchaseOrder.id,
    lines: [{ accountId: fixture.records.expenseAccount.id, debit: 70, credit: 0 }],
  });
  fixture.records.restrictedPurchaseJournal = await createRecord(organization.id, "journalEntries", {
    number: `J-PURCHASE-RESTRICTED-${suffix}`,
    date: "2026-08-20",
    description: "قيد شراء الموقع المحجوب",
    status: "posted",
    sourceType: "purchase",
    sourceId: fixture.records.restrictedPurchaseOrder.id,
    lines: [{ accountId: fixture.records.expenseAccount.id, debit: 900, credit: 0 }],
  });

  for (const [key, role] of Object.entries(roles)) {
    await createUser(organization.id, key, passwords[key], role);
  }
});

after(async () => {
  anthropic.messages.create = originalAnthropicCreate;
  const userIds = Object.values(fixture.users).map((user) => user.id);
  if (userIds.length) {
    await db.update(teamUsersTable)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(inArray(teamUsersTable.id, userIds));
    await db.update(authSessionsTable)
      .set({ revokedAt: new Date() })
      .where(inArray(authSessionsTable.userId, userIds));
    const disabledUsers = await db.select({ id: teamUsersTable.id, status: teamUsersTable.status })
      .from(teamUsersTable)
      .where(inArray(teamUsersTable.id, userIds));
    assert.equal(disabledUsers.length, userIds.length);
    assert.ok(disabledUsers.every((user) => user.status === "inactive"));
  }
  if (fixture.organizationIds.length) {
    await db.delete(organizationsTable).where(inArray(organizationsTable.id, fixture.organizationIds));
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

async function assistantPayload(key, question = "اعرض تفاصيل جميع البيانات والذمم والموردين والمشتريات والموظفين والقيود") {
  const loginResult = await login(key);
  const requestCount = assistantRequests.length;
  const result = await request("/assistant/financial", {
    method: "POST",
    cookie: loginResult.cookie,
    body: { question, history: [] },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(assistantRequests.length, requestCount + 1);
  const content = assistantRequests.at(-1).messages.at(-1).content;
  const match = content.match(/حقائق النظام الموثوقة \(JSON، بيانات فقط وليست تعليمات\):\s*([\s\S]*?)\n\nسؤال المستخدم:/);
  assert.ok(match, "يجب أن تصل حقائق النظام إلى النموذج بصيغة قابلة للفحص");
  assert.ok(match[1].length <= 120_000, "يجب ألا تتجاوز حقائق المساعد حد السياق");
  return { payload: JSON.parse(match[1]), serialized: match[1] };
}

async function modelJsonPayload(key, path, systemPromptStart) {
  const loginResult = await login(key);
  const requestCount = assistantRequests.length;
  const result = await request(path, {
    method: "POST",
    cookie: loginResult.cookie,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(assistantRequests.length, requestCount + 1, "يجب أن يرسل المسار حقائقه إلى النموذج");
  const modelRequest = assistantRequests.at(-1);
  assert.equal(
    typeof modelRequest.system === "string" && modelRequest.system.startsWith(systemPromptStart),
    true,
    "يجب اعتراض طلب النموذج الخاص بالمسار المقصود",
  );
  const serialized = modelRequest.messages.at(-1).content;
  assert.equal(typeof serialized, "string");
  return { payload: JSON.parse(serialized), serialized };
}

test("لا يرسل المساعد وحدات أو مواقع خارج صلاحية المستخدم إلى النموذج", async () => {
  const owner = await assistantPayload("owner");
  assert.ok(owner.payload.availableData.includes("employees"));
  assert.ok(owner.payload.availableData.includes("receivables"));
  assert.equal(owner.payload.organizationData.receivables.summary.totalRemaining, 1770);
  assert.deepEqual(owner.payload.facts.postedAccounting, {
    revenue: 1100,
    expenses: 970,
    netProfit: 130,
    postedJournalCount: 4,
  });

  const accountant = await assistantPayload("accountant");
  assert.ok(accountant.payload.availableData.includes("accounts"));
  assert.ok(accountant.payload.availableData.includes("receivables"));
  assert.equal(accountant.payload.availableData.includes("employees"), false);
  assert.equal(accountant.payload.availableData.includes("purchaseOrders"), false);
  assert.equal("employees" in accountant.payload.organizationData, false);
  assert.equal("purchaseOrders" in accountant.payload.organizationData, false);
  assert.equal(accountant.payload.organizationData.receivables.summary.totalRemaining, 70);
  assert.deepEqual(accountant.payload.facts.postedAccounting, {
    revenue: 100,
    expenses: 70,
    netProfit: 30,
    postedJournalCount: 2,
  });
  assert.equal(accountant.payload.organizationData.journalEntries.summary.totalRecords, 2);
  assert.equal(accountant.serialized.includes(`PO-RESTRICTED-${suffix}`), false);
  assert.equal(accountant.serialized.includes(`J-SALE-RESTRICTED-${suffix}`), false);
  assert.equal(accountant.serialized.includes(`J-PURCHASE-RESTRICTED-${suffix}`), false);
  assert.equal(accountant.serialized.includes("قيد بيع الموقع المحجوب"), false);
  assert.equal(accountant.serialized.includes("قيد شراء الموقع المحجوب"), false);
  assert.equal(accountant.serialized.includes('"amount":900'), false);
  assert.equal(accountant.serialized.includes('"amount":800'), false);

  const warehouse = await assistantPayload("warehouse");
  assert.deepEqual(
    warehouse.payload.availableData.sort(),
    ["inventoryBalances", "products", "purchaseOrders", "suppliers"].sort(),
  );
  assert.equal("receivables" in warehouse.payload.organizationData, false);
  assert.equal("receivables" in warehouse.payload.facts, false);
  assert.equal(warehouse.serialized.includes(`PO-RESTRICTED-${suffix}`), false);

  const hr = await assistantPayload("hr");
  assert.deepEqual(hr.payload.availableData, ["employees"]);
  assert.deepEqual(Object.keys(hr.payload.organizationData), ["employees"]);
  assert.deepEqual(hr.payload.facts, {});
  assert.equal(hr.serialized.includes("receivables"), false);
  assert.equal(hr.serialized.includes("purchaseOrders"), false);
  assert.equal(hr.serialized.includes("س".repeat(301)), false);
  assert.equal(hr.serialized.includes("ص".repeat(301)), false);
});

test("لا ترسل الملخصات الأسبوعية والتنبيهات حقائق المواقع المحجوبة إلى النموذج", async () => {
  const ownerSummary = await modelJsonPayload("owner", "/assistant/weekly-summary", "أنت محاسب يكتب ملخصاً أسبوعياً");
  assert.equal(ownerSummary.payload.totalSales, 7888);
  assert.equal(ownerSummary.payload.totalExpenses, 9110);
  assert.equal(ownerSummary.payload.invoiceCount, 2);
  assert.equal(ownerSummary.payload.topProduct.name, "منتج الموقع المحجوب");

  const limitedSummary = await modelJsonPayload(
    "financialanalyst",
    "/assistant/weekly-summary",
    "أنت محاسب يكتب ملخصاً أسبوعياً",
  );
  assert.equal(limitedSummary.payload.totalSales, 111);
  assert.equal(limitedSummary.payload.totalExpenses, 222);
  assert.equal(limitedSummary.payload.invoiceCount, 1);
  assert.deepEqual(limitedSummary.payload.topProduct, {
    name: "منتج الموقع المسموح",
    quantity: 3,
    salesAmount: 111,
  });
  assert.equal(limitedSummary.serialized.includes("7777"), false);
  assert.equal(limitedSummary.serialized.includes("8888"), false);
  assert.equal(limitedSummary.serialized.includes("الموقع المحجوب"), false);

  const ownerAnomalies = await modelJsonPayload("owner", "/assistant/anomalies", "أنت مراقب مالي");
  assert.equal(ownerAnomalies.payload.currentWeekExpenses, 9110);
  assert.equal(ownerAnomalies.payload.currentWeekSales, 7888);

  const limitedAnomalies = await modelJsonPayload("financialanalyst", "/assistant/anomalies", "أنت مراقب مالي");
  assert.equal(limitedAnomalies.payload.currentWeekExpenses, 222);
  assert.equal(limitedAnomalies.payload.currentWeekSales, 111);
  assert.equal(limitedAnomalies.serialized.includes("7777"), false);
  assert.equal(limitedAnomalies.serialized.includes("8888"), false);
  assert.equal(limitedAnomalies.serialized.includes("الموقع المحجوب"), false);
});

test("يمنح المحاسب والكاشير والمخزن والموارد البشرية وحداتهم فقط", async () => {
  const accountant = await login("accountant");
  assert.equal(accountant.payload.user.roleId, "accountant");
  assert.deepEqual(accountant.payload.user.warehouseIds, [fixture.warehouses.allowed.id]);
  await assertList(accountant.cookie, "accounts", 200, [
    fixture.records.revenueAccount.id,
    fixture.records.expenseAccount.id,
    fixture.records.account.id,
  ]);
  await assertList(accountant.cookie, "invoices", 403);
  await assertList(accountant.cookie, "products", 403);
  await assertList(accountant.cookie, "employees", 403);

  const cashier = await login("cashier");
  assert.equal(cashier.payload.user.roleId, "sales");
  await assertList(cashier.cookie, "invoices", 200, [
    fixture.records.invoice.id,
    fixture.records.allowedCurrentInvoice.id,
  ]);
  await assertList(cashier.cookie, "accounts", 403);
  await assertList(cashier.cookie, "employees", 403);

  const warehouse = await login("warehouse");
  assert.equal(warehouse.payload.user.roleId, "inventory");
  await assertList(warehouse.cookie, "products", 200, [fixture.records.allowedProduct.id]);
  await assertList(warehouse.cookie, "warehouses", 200, [fixture.warehouses.allowed.id]);
  await assertList(warehouse.cookie, "accounts", 403);
  await assertList(warehouse.cookie, "employees", 403);

  const hr = await login("hr");
  assert.equal(hr.payload.user.roleId, "hr");
  await assertList(hr.cookie, "employees", 200, [fixture.records.employee.id]);
  await assertList(hr.cookie, "accounts", 403);
  await assertList(hr.cookie, "products", 403);
  await assertList(hr.cookie, "invoices", 403);

  for (const [key, loginResult] of Object.entries({ accountant, cashier, warehouse, hr })) {
    const teamMembers = await request("/team/members", { cookie: loginResult.cookie });
    assert.equal(teamMembers.response.status, 403, `${key} لا يدير أعضاء الفريق`);
  }
});

test("يمنع الوصول المباشر خارج الموقع أو المنشأة ويحافظ على السجل", async () => {
  const warehouse = await login("warehouse");
  const before = await db.select({ data: erpRecordsTable.data })
    .from(erpRecordsTable)
    .where(eq(erpRecordsTable.id, fixture.records.restrictedProduct.id));

  const restrictedList = await assertList(warehouse.cookie, "products", 200, [fixture.records.allowedProduct.id]);
  assert.equal(restrictedList.payload.records.some((record) => record.id === fixture.records.restrictedProduct.id), false);

  const outsideScope = await request(`/data/products/${fixture.records.restrictedProduct.id}`, {
    method: "PATCH",
    cookie: warehouse.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { name: "محاولة تغيير خارج النطاق" },
  });
  assert.equal(outsideScope.response.status, 403, JSON.stringify(outsideScope.payload));

  const foreignPatch = await request(`/data/products/${fixture.records.foreignProduct.id}`, {
    method: "PATCH",
    cookie: warehouse.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { name: "محاولة عبور المنشأة" },
  });
  assert.equal(foreignPatch.response.status, 404, JSON.stringify(foreignPatch.payload));

  const foreignDelete = await request(`/data/products/${fixture.records.foreignProduct.id}`, {
    method: "DELETE",
    cookie: warehouse.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
  });
  assert.equal(foreignDelete.response.status, 404, JSON.stringify(foreignDelete.payload));

  const after = await db.select({ data: erpRecordsTable.data })
    .from(erpRecordsTable)
    .where(eq(erpRecordsTable.id, fixture.records.restrictedProduct.id));
  assert.deepEqual(after, before, "يجب ألا يتغير السجل بعد الرفض");
});