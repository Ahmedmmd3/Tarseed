import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import test, { after, before } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  authSessionsTable,
  db,
  eInvoiceDocumentsTable,
  eInvoiceUnitsTable,
  erpRecordsTable,
  organizationsTable,
  platformAdminsTable,
  pool,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { hashPassword, hashSessionToken } from "../src/lib/team-auth.ts";

let server;
let origin;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const ids = {
  organizations: [],
  users: {},
  warehouses: {},
  products: {},
  accountingRecords: {},
  eInvoiceDocuments: {},
};
const passwords = {
  owner: "Owner-security-test-123",
  member: "Member-security-test-123",
  inventoryMember: "Inventory-security-test-123",
  accountingMember: "Accounting-security-test-123",
  expired: "Expired-security-test-123",
  admin: "Admin-security-test-123",
};
let platformAdminId;

async function request(path, {
  method = "GET",
  body,
  cookie,
  headers = {},
  forwardedFor = "198.51.100.210",
  noOrigin = false,
  originHeader = origin,
} = {}) {
  const requestHeaders = {
    "X-Forwarded-For": forwardedFor,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...headers,
  };
  if (!noOrigin) requestHeaders.Origin = originHeader;

  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function requestFromDirectPeer(path, {
  method = "GET",
  body,
  forwardedFor = "198.51.100.210",
} = {}) {
  const url = new URL(`${origin}/api${path}`);
  const response = await new Promise((resolve, reject) => {
    const clientRequest = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      localAddress: "127.0.0.2",
      headers: {
        Origin: origin,
        "X-Forwarded-For": forwardedFor,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
    }, (clientResponse) => {
      const chunks = [];
      clientResponse.on("data", (chunk) => chunks.push(chunk));
      clientResponse.on("end", () => resolve({
        response: new Response(Buffer.concat(chunks), {
          status: clientResponse.statusCode,
          headers: clientResponse.headers,
        }),
      }));
    });
    clientRequest.on("error", reject);
    if (body !== undefined) clientRequest.write(JSON.stringify(body));
    clientRequest.end();
  });
  const payload = await response.response.json().catch(() => ({}));
  return { response: response.response, payload };
}

function cookieFrom(response, name = "wudooh_session") {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

function tokenFrom(cookie) {
  return cookie?.split("=", 2)[1] ?? "";
}

async function createSessionCookie(userId) {
  const token = randomUUID();
  await db.insert(authSessionsTable).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return `wudooh_session=${token}`;
}

async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: { email, password },
    forwardedFor: `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const cookie = cookieFrom(result.response);
  assert.ok(cookie);
  return { ...result, cookie };
}

async function createOrganization({ name, subscriptionStatus = "active", subscriptionEndsAt, suspended = false }) {
  const now = new Date();
  const [organization] = await db.insert(organizationsTable).values({
    name: `${name} ${suffix}`,
    planId: subscriptionStatus === "active" ? "pro" : "trial",
    subscriptionStatus,
    trialStartedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
    trialEndsAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
    subscriptionStartedAt: subscriptionStatus === "active" ? new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) : null,
    subscriptionEndsAt: subscriptionEndsAt ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    platformAccessSuspendedAt: suspended ? now : null,
  }).returning();
  ids.organizations.push(organization.id);
  return organization;
}

async function createUser(organizationId, { key, roleId = "owner", permissions = {}, locationScope = "all", warehouseIds = [], password }) {
  const [user] = await db.insert(teamUsersTable).values({
    organizationId,
    email: `${key}-${suffix}@example.test`,
    name: `اختبار أمني ${key}`,
    passwordHash: await hashPassword(password),
    roleId,
    permissions,
    locationScope,
    warehouseIds,
  }).returning();
  ids.users[key] = user;
  return user;
}

async function createRecord(organizationId, tableName, data) {
  const [record] = await db.insert(erpRecordsTable).values({
    organizationId,
    tableName,
    data,
  }).returning();
  return record;
}

async function waitForOrganizationLockWaiter() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query(`
      select count(*)::int as count
      from pg_locks
      where not granted
        and locktype = 'transactionid'
    `);
    if (result.rows[0]?.count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("لم يصل الطلب إلى انتظار قفل المنشأة ضمن المهلة.");
}

before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  const activeOrganization = await createOrganization({ name: "منشأة الأمان الأساسية" });
  const foreignOrganization = await createOrganization({ name: "منشأة الأمان الأخرى" });
  const expiredOrganization = await createOrganization({
    name: "منشأة الاشتراك المنتهي",
    subscriptionEndsAt: new Date(Date.now() - 60 * 60 * 1000),
  });

  const owner = await createUser(activeOrganization.id, {
    key: "owner",
    password: passwords.owner,
  });
  const foreignOwner = await createUser(foreignOrganization.id, {
    key: "foreign-owner",
    password: passwords.owner,
  });
  await createUser(expiredOrganization.id, {
    key: "expired-owner",
    password: passwords.expired,
  });
  const firstWarehouse = await createRecord(activeOrganization.id, "warehouses", {
    name: "الموقع المسموح",
    type: "warehouse",
    status: "active",
  });
  const secondWarehouse = await createRecord(activeOrganization.id, "warehouses", {
    name: "الموقع المحجوب",
    type: "branch",
    status: "active",
  });
  ids.warehouses.allowed = firstWarehouse.id;
  ids.warehouses.restricted = secondWarehouse.id;
  ids.products.allowed = (await createRecord(activeOrganization.id, "products", {
    name: "منتج ضمن النطاق",
    warehouseId: firstWarehouse.id,
    stock: 0,
    sellPrice: 10,
  })).id;
  ids.products.restricted = (await createRecord(activeOrganization.id, "products", {
    name: "منتج خارج النطاق",
    warehouseId: secondWarehouse.id,
    stock: 0,
    sellPrice: 20,
  })).id;
  ids.products.foreign = (await createRecord(foreignOrganization.id, "products", {
    name: "منتج منشأة أخرى",
    stock: 0,
    sellPrice: 30,
  })).id;
  await createUser(activeOrganization.id, {
    key: "member",
    roleId: "sales",
    permissions: { sales: true },
    locationScope: "selected",
    warehouseIds: [firstWarehouse.id],
    password: passwords.member,
  });
  await createUser(activeOrganization.id, {
    key: "inventory-member",
    roleId: "inventory",
    permissions: { inventory: true },
    locationScope: "selected",
    warehouseIds: [firstWarehouse.id],
    password: passwords.inventoryMember,
  });
  await createUser(activeOrganization.id, {
    key: "accounting-member",
    roleId: "custom",
    permissions: { sales: true, accounting: true },
    locationScope: "selected",
    warehouseIds: [firstWarehouse.id],
    password: passwords.accountingMember,
  });
  const accounts = {};
  for (const account of [
    { code: "1000", name: "النقدية", type: "asset" },
    { code: "1200", name: "العملاء", type: "asset" },
    { code: "2000", name: "الدائنون", type: "liability" },
    { code: "4000", name: "المبيعات", type: "revenue" },
    { code: "5000", name: "المشتريات", type: "expense" },
    { code: "5100", name: "المصروفات", type: "expense" },
  ]) {
    accounts[account.code] = await createRecord(activeOrganization.id, "accounts", {
      ...account,
      openingBalance: 0,
      status: "active",
    });
  }
  ids.accountingRecords.accounts = accounts;
  ids.accountingRecords.allowedInvoice = await createRecord(activeOrganization.id, "invoices", {
    warehouseId: firstWarehouse.id,
    invoiceNumber: "INV-ALLOWED",
    date: "2026-08-10",
    dueDate: "2026-09-10",
    paymentMethod: "credit",
    total: 100,
  });
  ids.accountingRecords.restrictedInvoice = await createRecord(activeOrganization.id, "invoices", {
    warehouseId: secondWarehouse.id,
    invoiceNumber: "INV-RESTRICTED",
    date: "2026-08-10",
    total: 900,
  });
  ids.accountingRecords.allowedPurchase = await createRecord(activeOrganization.id, "purchaseOrders", {
    warehouseId: firstWarehouse.id,
    number: "PO-ALLOWED",
    date: "2026-08-11",
    total: 50,
  });
  ids.accountingRecords.restrictedPurchase = await createRecord(activeOrganization.id, "purchaseOrders", {
    warehouseId: secondWarehouse.id,
    number: "PO-RESTRICTED",
    date: "2026-08-11",
    total: 500,
  });
  ids.accountingRecords.allowedExpense = await createRecord(activeOrganization.id, "expenses", {
    warehouseId: firstWarehouse.id,
    number: "EXP-ALLOWED",
    date: "2026-08-12",
    amount: 20,
  });
  ids.accountingRecords.restrictedExpense = await createRecord(activeOrganization.id, "expenses", {
    warehouseId: secondWarehouse.id,
    number: "EXP-RESTRICTED",
    date: "2026-08-12",
    amount: 200,
  });
  ids.accountingRecords.allowedReceivable = await createRecord(activeOrganization.id, "receivables", {
    warehouseId: firstWarehouse.id,
    type: "receivable",
    party: "عميل الموقع المسموح",
    date: "2026-08-10",
    amount: 100,
  });
  ids.accountingRecords.restrictedReceivable = await createRecord(activeOrganization.id, "receivables", {
    warehouseId: secondWarehouse.id,
    type: "receivable",
    party: "عميل الموقع المحجوب",
    date: "2026-08-10",
    amount: 900,
  });
  ids.accountingRecords.organizationClosure = await createRecord(activeOrganization.id, "financialClosures", {
    from: "2025-01-01",
    to: "2025-12-31",
    status: "closed",
    netIncome: 9999,
  });
  ids.accountingRecords.restrictedLegacyJournal = await createRecord(activeOrganization.id, "journalEntries", {
    warehouseId: firstWarehouse.id,
    number: "LEGACY-RESTRICTED",
    date: "2026-08-10",
    description: "قيد قديم مرتبط بمصدر خارج النطاق",
    status: "posted",
    sourceType: "sale",
    sourceId: ids.accountingRecords.restrictedInvoice.id,
    lines: [
      { accountId: String(accounts["1000"].id), debit: 900, credit: 0 },
      { accountId: String(accounts["4000"].id), debit: 0, credit: 900 },
    ],
  });
  const [eInvoiceUnit] = await db.insert(eInvoiceUnitsTable).values({
    organizationId: activeOrganization.id,
  }).returning();
  for (const [key, invoiceRecord, counter] of [
    ["allowed", ids.accountingRecords.allowedInvoice, 1],
    ["restricted", ids.accountingRecords.restrictedInvoice, 2],
  ]) {
    const [document] = await db.insert(eInvoiceDocumentsTable).values({
      organizationId: activeOrganization.id,
      unitId: eInvoiceUnit.id,
      invoiceRecordId: invoiceRecord.id,
      documentType: "simplified",
      status: "pending_submission",
      invoiceNumber: invoiceRecord.data.invoiceNumber,
      uuid: randomUUID(),
      invoiceCounter: counter,
      previousInvoiceHash: `previous-${key}`,
      invoiceHash: `hash-${key}`,
      qrPayload: `qr-${key}`,
      xmlDigest: `digest-${key}`,
      xmlObjectPath: `/private/${key}.xml`,
      authorityXmlObjectPath: `/private/${key}-authority.xml`,
      issuedAt: new Date("2026-08-10T10:00:00.000Z"),
    }).returning();
    ids.eInvoiceDocuments[key] = document;
  }
  const [platformAdmin] = await db.insert(platformAdminsTable).values({
    username: `security-admin-${suffix}`,
    displayName: "مدير اختبار الأمان",
    passwordHash: await hashPassword(passwords.admin),
  }).returning({ id: platformAdminsTable.id });
  platformAdminId = platformAdmin.id;

  assert.equal(owner.organizationId, activeOrganization.id);
  assert.equal(foreignOwner.organizationId, foreignOrganization.id);
});

after(async () => {
  if (platformAdminId) {
    await db.delete(platformAdminsTable).where(eq(platformAdminsTable.id, platformAdminId));
  }
  if (ids.organizations.length) {
    await db.delete(organizationsTable).where(inArray(organizationsTable.id, ids.organizations));
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("يعزل بيانات المنشآت ويمنع تعديل أو حذف سجل تابع لمنشأة أخرى", async () => {
  const ownerLogin = await login(ids.users.owner.email, passwords.owner);
  const ownRecords = await request("/data/products", { cookie: ownerLogin.cookie });
  assert.equal(ownRecords.response.status, 200, JSON.stringify(ownRecords.payload));
  assert.deepEqual(
    new Set(ownRecords.payload.records.map((record) => record.id)),
    new Set([ids.products.allowed, ids.products.restricted]),
  );
  assert.equal(ownRecords.payload.records.some((record) => record.id === ids.products.foreign), false);

  const foreignPatch = await request(`/data/products/${ids.products.foreign}`, {
    method: "PATCH",
    cookie: ownerLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { name: "محاولة عبور المنشأة" },
  });
  const foreignDelete = await request(`/data/products/${ids.products.foreign}`, {
    method: "DELETE",
    cookie: ownerLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
  });
  assert.equal(foreignPatch.response.status, 404, JSON.stringify(foreignPatch.payload));
  assert.equal(foreignDelete.response.status, 404, JSON.stringify(foreignDelete.payload));

  const [foreignProduct] = await db.select({ data: erpRecordsTable.data })
    .from(erpRecordsTable)
    .where(eq(erpRecordsTable.id, ids.products.foreign));
  assert.equal(foreignProduct.data.name, "منتج منشأة أخرى");
});

test("يطبّق الدور والصلاحية ونطاق المواقع على القراءة والكتابة وإدارة الفريق", async () => {
  const memberLogin = await login(ids.users.member.email, passwords.member);
  const visibleProducts = await request("/data/products", { cookie: memberLogin.cookie });
  assert.equal(visibleProducts.response.status, 200, JSON.stringify(visibleProducts.payload));
  assert.deepEqual(visibleProducts.payload.records.map((record) => record.id), [ids.products.allowed]);

  const accounting = await request("/data/accounts", { cookie: memberLogin.cookie });
  assert.equal(accounting.response.status, 403, JSON.stringify(accounting.payload));

  const productMutation = await request("/data/products", {
    method: "POST",
    cookie: memberLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { name: "محاولة تعديل الكتالوج", stock: 0 },
  });
  assert.equal(productMutation.response.status, 403, JSON.stringify(productMutation.payload));

  const inventoryMemberLogin = await login(ids.users["inventory-member"].email, passwords.inventoryMember);
  const outsideLocationMutation = await request(`/data/products/${ids.products.restricted}`, {
    method: "PATCH",
    cookie: inventoryMemberLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { name: "محاولة موقع محجوب" },
  });
  assert.equal(outsideLocationMutation.response.status, 403, JSON.stringify(outsideLocationMutation.payload));
  const [restrictedProduct] = await db.select({ data: erpRecordsTable.data })
    .from(erpRecordsTable)
    .where(eq(erpRecordsTable.id, ids.products.restricted));
  assert.equal(restrictedProduct.data.name, "منتج خارج النطاق");

  const teamMembers = await request("/team/members", { cookie: memberLogin.cookie });
  assert.equal(teamMembers.response.status, 403, JSON.stringify(teamMembers.payload));
});

test("يعزل الفوترة الإلكترونية وعمليات المحاسبة حسب نطاق الموقع", async () => {
  const memberLogin = await login(ids.users["accounting-member"].email, passwords.accountingMember);
  const allowedDocument = ids.eInvoiceDocuments.allowed;
  const restrictedDocument = ids.eInvoiceDocuments.restricted;

  const documents = await request("/e-invoicing/documents", { cookie: memberLogin.cookie });
  assert.equal(documents.response.status, 200, JSON.stringify(documents.payload));
  assert.deepEqual(documents.payload.documents.map((document) => document.id), [allowedDocument.id]);

  const documentCountBefore = await db.$count(eInvoiceDocumentsTable, eq(
    eInvoiceDocumentsTable.organizationId,
    ids.users["accounting-member"].organizationId,
  ));
  const restrictedBefore = await db.select({
    status: eInvoiceDocumentsTable.status,
    submissionAttempts: eInvoiceDocumentsTable.submissionAttempts,
  }).from(eInvoiceDocumentsTable).where(eq(eInvoiceDocumentsTable.id, restrictedDocument.id));
  for (const [path, method, body] of [
    [`/e-invoicing/documents/${restrictedDocument.id}/xml`, "GET", undefined],
    [`/e-invoicing/documents/${restrictedDocument.id}/authority-xml`, "GET", undefined],
    [`/e-invoicing/documents/${restrictedDocument.id}/submit`, "POST", undefined],
    [`/e-invoicing/documents/${restrictedDocument.id}/notes`, "POST", { type: "credit_note", amount: 10, reason: "اختبار العزل" }],
  ]) {
    const result = await request(path, {
      method,
      cookie: memberLogin.cookie,
      headers: method === "POST" ? { "X-Wudooh-Data-Generation": "1" } : {},
      ...(body ? { body } : {}),
    });
    assert.equal(result.response.status, 404, `${path}: ${JSON.stringify(result.payload)}`);
  }
  const documentCountAfter = await db.$count(eInvoiceDocumentsTable, eq(
    eInvoiceDocumentsTable.organizationId,
    ids.users["accounting-member"].organizationId,
  ));
  const restrictedAfter = await db.select({
    status: eInvoiceDocumentsTable.status,
    submissionAttempts: eInvoiceDocumentsTable.submissionAttempts,
  }).from(eInvoiceDocumentsTable).where(eq(eInvoiceDocumentsTable.id, restrictedDocument.id));
  assert.equal(documentCountAfter, documentCountBefore, "يجب ألا ينشئ الرفض إشعاراً ضريبياً");
  assert.deepEqual(restrictedAfter, restrictedBefore, "يجب ألا يغيّر الرفض حالة المستند أو محاولات إرساله");

  const synced = await request("/accounting/sync-source-journals", {
    method: "POST",
    cookie: memberLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
  });
  assert.equal(synced.response.status, 200, JSON.stringify(synced.payload));
  assert.equal(synced.payload.created, 3);
  const sourceJournals = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, ids.users["accounting-member"].organizationId),
    eq(erpRecordsTable.tableName, "journalEntries"),
  ));
  const createdSourceJournals = sourceJournals.filter(
    (journal) => journal.id !== ids.accountingRecords.restrictedLegacyJournal.id,
  );
  assert.deepEqual(
    new Set(createdSourceJournals.map((journal) => journal.data.sourceId)),
    new Set([
      ids.accountingRecords.allowedInvoice.id,
      ids.accountingRecords.allowedPurchase.id,
      ids.accountingRecords.allowedExpense.id,
    ]),
  );
  assert.equal(createdSourceJournals.every((journal) => journal.data.warehouseId === ids.warehouses.allowed), true);
  const saleJournal = createdSourceJournals.find(
    (journal) => journal.data.sourceType === "sale" && journal.data.sourceId === ids.accountingRecords.allowedInvoice.id,
  );
  assert.ok(saleJournal, "يجب إنشاء قيد لفاتورة البيع الآجل");
  assert.equal(
    saleJournal.data.lines.some((line) =>
      line.accountId === String(ids.accountingRecords.accounts["1200"].id)
      && line.debit === 100
      && line.credit === 0),
    true,
    "يجب ترحيل البيع الآجل إلى حساب العملاء لا الصندوق",
  );
  assert.equal(sourceJournals.some(
    (journal) => journal.id === ids.accountingRecords.restrictedLegacyJournal.id,
  ), true, "يجب أن يثبت الاختبار أن القيد القديم خارج النطاق موجود فعلاً");

  const summary = await request("/accounting/summary?from=2026-01-01&to=2026-12-31", {
    cookie: memberLogin.cookie,
  });
  assert.equal(summary.response.status, 200, JSON.stringify(summary.payload));
  assert.deepEqual(summary.payload.sourceCounts, { invoices: 1, expenses: 1, purchases: 1 });
  assert.equal(summary.payload.totals.revenue, 100);
  assert.equal(summary.payload.totals.expense, 70);
  assert.equal(summary.payload.totals.netIncome, 30);
  assert.equal(summary.payload.totals.receivables, 100);
  assert.deepEqual(summary.payload.receivables.map((item) => item.party), ["عميل الموقع المسموح"]);

  const visibleClosures = await request("/data/financialClosures", {
    cookie: memberLogin.cookie,
  });
  assert.equal(visibleClosures.response.status, 200, JSON.stringify(visibleClosures.payload));
  assert.deepEqual(visibleClosures.payload.records, []);

  const closureCountBefore = await db.$count(erpRecordsTable, and(
    eq(erpRecordsTable.organizationId, ids.users["accounting-member"].organizationId),
    eq(erpRecordsTable.tableName, "financialClosures"),
  ));
  const closure = await request("/accounting/close", {
    method: "POST",
    cookie: memberLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { from: "2026-01-01", to: "2026-12-31" },
  });
  assert.equal(closure.response.status, 403, JSON.stringify(closure.payload));
  const closureCountAfter = await db.$count(erpRecordsTable, and(
    eq(erpRecordsTable.organizationId, ids.users["accounting-member"].organizationId),
    eq(erpRecordsTable.tableName, "financialClosures"),
  ));
  assert.equal(closureCountAfter, closureCountBefore, "يجب ألا ينشئ الرفض إقفالاً مالياً");
});

test("يسلسل الإقفال المالي مع ترحيل المصادر وكتابتها تحت قفل المنشأة", async () => {
  const ownerCookie = await createSessionCookie(ids.users.owner.id);
  const accountingCookie = await createSessionCookie(ids.users["accounting-member"].id);
  const organizationId = ids.users.owner.organizationId;
  const source = await createRecord(organizationId, "expenses", {
    warehouseId: ids.warehouses.allowed,
    number: `EXP-RACE-${suffix}`,
    date: "2031-06-15",
    amount: 75,
  });

  let closeRequest;
  let syncRequest;
  await db.transaction(async (tx) => {
    await tx.select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .for("update");
    closeRequest = request("/accounting/close", {
      method: "POST",
      cookie: ownerCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
      body: { from: "2031-01-01", to: "2031-12-31" },
    });
    await waitForOrganizationLockWaiter();
    syncRequest = request("/accounting/sync-source-journals", {
      method: "POST",
      cookie: accountingCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  const [closed, synced] = await Promise.all([closeRequest, syncRequest]);
  assert.equal(closed.response.status, 201, JSON.stringify(closed.payload));
  assert.equal(synced.response.status, 200, JSON.stringify(synced.payload));
  assert.equal(
    synced.payload.skipped.some((item) => item.sourceId === source.id && item.reason.includes("مقفلة")),
    true,
    JSON.stringify(synced.payload),
  );
  const sourceJournals = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "journalEntries"),
  ));
  assert.equal(
    sourceJournals.some((journal) => journal.data.sourceType === "expense" && journal.data.sourceId === source.id),
    false,
    "لا يجوز ترحيل مصدر بعد أن يلتزم الإقفال المالي السابق له",
  );

  const syncFirstSource = await createRecord(organizationId, "expenses", {
    warehouseId: ids.warehouses.allowed,
    number: `EXP-SYNC-FIRST-${suffix}`,
    date: "2033-06-15",
    amount: 60,
  });
  let syncFirstRequest;
  let closeAfterSyncRequest;
  await db.transaction(async (tx) => {
    await tx.select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .for("update");
    syncFirstRequest = request("/accounting/sync-source-journals", {
      method: "POST",
      cookie: accountingCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
    });
    await waitForOrganizationLockWaiter();
    closeAfterSyncRequest = request("/accounting/close", {
      method: "POST",
      cookie: ownerCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
      body: { from: "2033-01-01", to: "2033-12-31" },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  const [syncFirst, closeAfterSync] = await Promise.all([syncFirstRequest, closeAfterSyncRequest]);
  assert.equal(syncFirst.response.status, 200, JSON.stringify(syncFirst.payload));
  assert.equal(syncFirst.payload.created, 1, JSON.stringify(syncFirst.payload));
  assert.equal(closeAfterSync.response.status, 201, JSON.stringify(closeAfterSync.payload));
  assert.equal(closeAfterSync.payload.closure.totals.expense, 60);
  assert.equal(closeAfterSync.payload.closure.journals, undefined);
  const syncFirstJournals = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "journalEntries"),
  ));
  assert.equal(
    syncFirstJournals.filter((journal) => journal.data.sourceType === "expense" && journal.data.sourceId === syncFirstSource.id).length,
    1,
  );

  const duplicateSource = await createRecord(organizationId, "expenses", {
    warehouseId: ids.warehouses.allowed,
    number: `EXP-DUPLICATE-${suffix}`,
    date: "2034-06-15",
    amount: 40,
  });
  let firstSyncRequest;
  let secondSyncRequest;
  await db.transaction(async (tx) => {
    await tx.select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .for("update");
    firstSyncRequest = request("/accounting/sync-source-journals", {
      method: "POST",
      cookie: accountingCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
    });
    await waitForOrganizationLockWaiter();
    secondSyncRequest = request("/accounting/sync-source-journals", {
      method: "POST",
      cookie: accountingCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  const duplicateSyncResults = await Promise.all([firstSyncRequest, secondSyncRequest]);
  assert.deepEqual(
    duplicateSyncResults.map((result) => result.response.status),
    [200, 200],
  );
  assert.equal(duplicateSyncResults.reduce((sum, result) => sum + result.payload.created, 0), 1);
  const duplicateJournals = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, "journalEntries"),
  ));
  assert.equal(
    duplicateJournals.filter((journal) => journal.data.sourceType === "expense" && journal.data.sourceId === duplicateSource.id).length,
    1,
    "يجب أن ينتج عن طلبي المزامنة المتزامنين قيد مصدر واحد فقط",
  );

  let secondCloseRequest;
  let sourceCreateRequest;
  await db.transaction(async (tx) => {
    await tx.select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .for("update");
    secondCloseRequest = request("/accounting/close", {
      method: "POST",
      cookie: ownerCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
      body: { from: "2032-01-01", to: "2032-12-31" },
    });
    await waitForOrganizationLockWaiter();
    sourceCreateRequest = request("/data/expenses", {
      method: "POST",
      cookie: accountingCookie,
      headers: { "X-Wudooh-Data-Generation": "1" },
      body: {
        warehouseId: ids.warehouses.allowed,
        number: `EXP-CREATE-RACE-${suffix}`,
        date: "2032-06-15",
        amount: 25,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  const [secondClosed, sourceCreated] = await Promise.all([secondCloseRequest, sourceCreateRequest]);
  assert.equal(secondClosed.response.status, 201, JSON.stringify(secondClosed.payload));
  assert.equal(sourceCreated.response.status, 409, JSON.stringify(sourceCreated.payload));
  assert.match(sourceCreated.payload.error, /مقفلة/);
});

test("يبطل جلسات عضو الفريق عند تغيير كلمة مروره", async () => {
  const ownerCookie = await createSessionCookie(ids.users.owner.id);
  const memberLogin = await login(ids.users.member.email, passwords.member);
  const newPassword = "Member-security-recovered-456";

  const passwordChange = await request(`/team/members/${ids.users.member.id}`, {
    method: "PATCH",
    cookie: ownerCookie,
    body: {
      name: ids.users.member.name,
      email: ids.users.member.email,
      password: newPassword,
      roleId: ids.users.member.roleId,
      status: "active",
      permissions: ids.users.member.permissions,
      locationScope: ids.users.member.locationScope,
      warehouseIds: ids.users.member.warehouseIds,
    },
  });
  assert.equal(passwordChange.response.status, 200, JSON.stringify(passwordChange.payload));

  const oldSession = await request("/auth/me", { cookie: memberLogin.cookie });
  assert.equal(oldSession.response.status, 200, JSON.stringify(oldSession.payload));
  assert.equal(oldSession.payload.user, null);

  const oldPassword = await request("/auth/login", {
    method: "POST",
    body: { email: ids.users.member.email, password: passwords.member },
  });
  assert.equal(oldPassword.response.status, 401, JSON.stringify(oldPassword.payload));

  const recoveredLogin = await login(ids.users.member.email, newPassword);
  assert.equal(recoveredLogin.payload.user.id, ids.users.member.id);
});

test("يرفض الجلسات المنتهية والملغاة ويفصل كوكيز الإدارة العليا عن جلسة المنشأة", async () => {
  const firstLogin = await login(ids.users.owner.email, passwords.owner);
  const cookieHeader = firstLogin.response.headers.get("set-cookie") ?? "";
  assert.match(cookieHeader, /wudooh_session=[^;]+/);
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Lax/);
  assert.equal(firstLogin.payload.user.passwordHash, undefined);

  await db.update(authSessionsTable)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(authSessionsTable.tokenHash, hashSessionToken(tokenFrom(firstLogin.cookie))));
  const expiredSession = await request("/auth/me", { cookie: firstLogin.cookie });
  assert.equal(expiredSession.response.status, 200);
  assert.equal(expiredSession.payload.user, null);
  const expiredProtectedRequest = await request("/data/products", { cookie: firstLogin.cookie });
  assert.equal(expiredProtectedRequest.response.status, 401, JSON.stringify(expiredProtectedRequest.payload));

  const secondLogin = await login(ids.users.owner.email, passwords.owner);
  await db.update(authSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(authSessionsTable.tokenHash, hashSessionToken(tokenFrom(secondLogin.cookie))));
  const revokedSession = await request("/data/products", { cookie: secondLogin.cookie });
  assert.equal(revokedSession.response.status, 401, JSON.stringify(revokedSession.payload));

  const validTenantLogin = await login(ids.users.owner.email, passwords.owner);
  const adminLogin = await request("/platform-auth/login", {
    method: "POST",
    body: {
      username: `security-admin-${suffix}`,
      password: passwords.admin,
    },
  });
  assert.equal(adminLogin.response.status, 200, JSON.stringify(adminLogin.payload));
  const adminCookie = cookieFrom(adminLogin.response, "wudooh_super_admin_session");
  assert.ok(adminCookie);
  const adminCookieHeader = adminLogin.response.headers.get("set-cookie") ?? "";
  assert.match(adminCookieHeader, /wudooh_super_admin_session=[^;]+/);
  assert.match(adminCookieHeader, /HttpOnly/);
  assert.match(adminCookieHeader, /SameSite=Strict/);

  const adminCookieOnTenant = await request("/auth/me", { cookie: adminCookie });
  assert.equal(adminCookieOnTenant.response.status, 200);
  assert.equal(adminCookieOnTenant.payload.user, null);
  const tenantCookieOnAdmin = await request("/super-admin/overview", {
    cookie: validTenantLogin.cookie,
  });
  assert.equal(tenantCookieOnAdmin.response.status, 401, JSON.stringify(tenantCookieOnAdmin.payload));
});

test("يرفض الطلبات الحساسة من Origin مفقود أو غير صالح مع إبقاء المسارات العامة متاحة", async () => {
  const loginWithoutOrigin = await request("/auth/login", {
    method: "POST",
    noOrigin: true,
    body: { email: ids.users.owner.email, password: passwords.owner },
  });
  assert.equal(loginWithoutOrigin.response.status, 403, JSON.stringify(loginWithoutOrigin.payload));
  assert.equal(cookieFrom(loginWithoutOrigin.response), null);

  const crossSiteLogin = await request("/auth/login", {
    method: "POST",
    originHeader: "https://evil.example",
    body: { email: ids.users.owner.email, password: passwords.owner },
  });
  assert.equal(crossSiteLogin.response.status, 403, JSON.stringify(crossSiteLogin.payload));
  assert.equal(cookieFrom(crossSiteLogin.response), null);

  const crossSiteRegistration = await request("/auth/register", {
    method: "POST",
    originHeader: "https://evil.example",
    body: {
      projectName: "منشأة أصل غير موثوق",
      name: "مهاجم",
      email: `cross-site-${suffix}@example.test`,
      password: passwords.owner,
    },
  });
  assert.equal(crossSiteRegistration.response.status, 403, JSON.stringify(crossSiteRegistration.payload));
  assert.equal(cookieFrom(crossSiteRegistration.response), null);

  for (const path of ["/auth/login/", "/auth/register/", "/platform-auth/login/"]) {
    const trailingSlashBypass = await request(path, {
      method: "POST",
      originHeader: "https://evil.example",
      body: path.includes("register")
        ? {
            projectName: "منشأة مسار بديل",
            name: "مهاجم",
            email: `trailing-${suffix}@example.test`,
            password: passwords.owner,
          }
        : path.includes("platform")
          ? { username: `security-admin-${suffix}`, password: passwords.admin }
          : { email: ids.users.owner.email, password: passwords.owner },
    });
    assert.equal(trailingSlashBypass.response.status, 403, `${path}: ${JSON.stringify(trailingSlashBypass.payload)}`);
    assert.equal(trailingSlashBypass.response.headers.get("set-cookie"), null);
  }

  const ownerLogin = await login(ids.users.owner.email, passwords.owner);
  const protectedWrite = {
    method: "POST",
    cookie: ownerLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { name: "عميل اختبار Origin" },
  };
  const noOrigin = await request("/data/customers", {
    ...protectedWrite,
    noOrigin: true,
  });
  assert.equal(noOrigin.response.status, 403, JSON.stringify(noOrigin.payload));

  const foreignOrigin = await request("/data/customers", {
    ...protectedWrite,
    originHeader: "https://evil.example",
  });
  assert.equal(foreignOrigin.response.status, 403, JSON.stringify(foreignOrigin.payload));
  assert.equal(foreignOrigin.response.headers.get("access-control-allow-origin"), null);

  const malformedOrigin = await request("/data/customers", {
    ...protectedWrite,
    originHeader: "not-a-valid-origin",
  });
  assert.equal(malformedOrigin.response.status, 403, JSON.stringify(malformedOrigin.payload));

  const publicRoute = await request("/auth/me", { noOrigin: true });
  assert.equal(publicRoute.response.status, 200);
  assert.equal(publicRoute.payload.user, null);
});

test("يمنع المنشأة ذات الاشتراك المنتهي من القراءة والكتابة", async () => {
  const expiredLogin = await login(ids.users["expired-owner"].email, passwords.expired);
  assert.equal(expiredLogin.payload.user.subscription.accessActive, false);

  const read = await request("/data/products", { cookie: expiredLogin.cookie });
  assert.equal(read.response.status, 402, JSON.stringify(read.payload));
  assert.equal(read.payload.code, "subscription_required");

  const write = await request("/data/products", {
    method: "POST",
    cookie: expiredLogin.cookie,
    headers: { "X-Wudooh-Data-Generation": "1" },
    body: { name: "كتابة بعد انتهاء الاشتراك", stock: 0 },
  });
  assert.equal(write.response.status, 402, JSON.stringify(write.payload));
  assert.equal(write.payload.code, "subscription_required");

  const backup = await request("/backup/export", { cookie: expiredLogin.cookie });
  assert.equal(backup.response.status, 402, JSON.stringify(backup.payload));
});

test("يحد محاولات دخول الإدارة العليا برسالة عامة", async () => {
  const attempts = [];
  const forwardedFor = `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`;
  for (let index = 0; index < 11; index += 1) {
    attempts.push(await request("/platform-auth/login", {
      method: "POST",
      forwardedFor,
      body: {
        username: `unknown-admin-${suffix}-${index}`,
        password: "wrong-password",
      },
    }));
  }

  for (const attempt of attempts.slice(0, 10)) {
    assert.equal(attempt.response.status, 401, JSON.stringify(attempt.payload));
    assert.equal(attempt.payload.error, "اسم المستخدم أو كلمة المرور غير صحيحة.");
    assert.equal(JSON.stringify(attempt.payload).includes(suffix), false);
  }
  assert.equal(attempts[10].response.status, 429, JSON.stringify(attempts[10].payload));
  assert.ok(Number(attempts[10].response.headers.get("retry-after")) > 0);
});

test("يحد محاولات الدخول حسب الهوية حتى عند تغيير عنوان IP", async () => {
  const attempts = [];
  const email = `unknown-identity-${suffix}@example.test`;
  for (let index = 0; index < 6; index += 1) {
    attempts.push(await request("/auth/login", {
      method: "POST",
      forwardedFor: `2001:db8:${index + 1}:${randomUUID().slice(0, 4)}::1`,
      body: { email, password: "wrong-password" },
    }));
  }

  for (const attempt of attempts.slice(0, 5)) {
    assert.equal(attempt.response.status, 401, JSON.stringify(attempt.payload));
    assert.equal(attempt.payload.error, "البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    assert.equal(JSON.stringify(attempt.payload).includes(email), false);
  }
  assert.equal(attempts[5].response.status, 429, JSON.stringify(attempts[5].payload));
  assert.ok(Number(attempts[5].response.headers.get("retry-after")) > 0);
});

test("يعتمد عنوان العميل الذي يمرره نظير الـproxy الموثوق", async () => {
  const distinctClients = [];
  for (let index = 0; index < 11; index += 1) {
    distinctClients.push(await request("/auth/login", {
      method: "POST",
      forwardedFor: `2001:db8:${index + 20}:${randomUUID().slice(0, 4)}::1`,
      body: {
        email: `trusted-proxy-distinct-${suffix}-${index}@example.test`,
        password: "wrong-password",
      },
    }));
  }
  assert.deepEqual(
    distinctClients.map(({ response }) => response.status),
    Array(11).fill(401),
  );

  const sharedForwardedFor = `2001:db8:${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}::1`;
  const sharedClientAttempts = [];
  for (let index = 0; index < 11; index += 1) {
    sharedClientAttempts.push(await request("/auth/login", {
      method: "POST",
      forwardedFor: sharedForwardedFor,
      body: {
        email: `trusted-proxy-shared-${suffix}-${index}@example.test`,
        password: "wrong-password",
      },
    }));
  }
  assert.deepEqual(
    sharedClientAttempts.slice(0, 10).map(({ response }) => response.status),
    Array(10).fill(401),
  );
  assert.equal(sharedClientAttempts[10].response.status, 429, JSON.stringify(sharedClientAttempts[10].payload));
});

test("يتجاهل عنوان X-Forwarded-For عند الاتصال المباشر من نظير غير موثوق", async () => {
  const attempts = [];
  for (let index = 0; index < 11; index += 1) {
    attempts.push(await requestFromDirectPeer("/auth/login", {
      method: "POST",
      forwardedFor: `2001:db8:${index + 1}:${randomUUID().slice(0, 4)}::1`,
      body: {
        email: `direct-peer-${suffix}-${index}@example.test`,
        password: "wrong-password",
      },
    }));
  }

  for (const attempt of attempts.slice(0, 10)) {
    assert.equal(attempt.response.status, 401, JSON.stringify(attempt.payload));
    assert.equal(attempt.payload.error, "البريد الإلكتروني أو كلمة المرور غير صحيحة.");
  }
  assert.equal(attempts[10].response.status, 429, JSON.stringify(attempts[10].payload));
  assert.ok(Number(attempts[10].response.headers.get("retry-after")) > 0);
});