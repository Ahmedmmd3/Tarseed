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
  accountant: "Accountant-role-test-123",
  cashier: "Cashier-role-test-123",
  warehouse: "Warehouse-role-test-123",
  hr: "Hr-role-test-123",
};
const roles = {
  accountant: {
    roleId: "accountant",
    permissions: { dashboard: true, accounting: true, reports: true },
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

async function login(key) {
  const result = await request("/auth/login", {
    method: "POST",
    body: { email: fixture.users[key].email, password: passwords[key] },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const cookie = cookieFrom(result.response);
  assert.ok(cookie);
  return { ...result, cookie };
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
  fixture.records.invoice = await createRecord(organization.id, "invoices", {
    invoiceNumber: `ROLE-${suffix}`,
    warehouseId: fixture.warehouses.allowed.id,
    date: "2026-08-20",
    total: 25,
  });
  fixture.records.employee = await createRecord(organization.id, "employees", {
    name: "موظف اختبار الموارد البشرية",
    status: "active",
  });

  for (const [key, role] of Object.entries(roles)) {
    await createUser(organization.id, key, passwords[key], role);
  }
});

after(async () => {
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

test("يمنح المحاسب والكاشير والمخزن والموارد البشرية وحداتهم فقط", async () => {
  const accountant = await login("accountant");
  assert.equal(accountant.payload.user.roleId, "accountant");
  assert.deepEqual(accountant.payload.user.warehouseIds, [fixture.warehouses.allowed.id]);
  await assertList(accountant.cookie, "accounts", 200, [fixture.records.account.id]);
  await assertList(accountant.cookie, "invoices", 403);
  await assertList(accountant.cookie, "products", 403);
  await assertList(accountant.cookie, "employees", 403);

  const cashier = await login("cashier");
  assert.equal(cashier.payload.user.roleId, "sales");
  await assertList(cashier.cookie, "invoices", 200, [fixture.records.invoice.id]);
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