import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import test, { after, before } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  authSessionsTable,
  db,
  erpRecordsTable,
  organizationsTable,
  platformAdminsTable,
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
};
const passwords = {
  owner: "Owner-security-test-123",
  member: "Member-security-test-123",
  inventoryMember: "Inventory-security-test-123",
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