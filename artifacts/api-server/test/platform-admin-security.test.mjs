import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  platformAdminsTable,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { hashPassword } from "../src/lib/team-auth.ts";

let server;
let origin;
let adminId;
let organizationId;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const username = `admin.${suffix}`;
const password = "Secure-platform-test-password-123";
const organizationName = `منشأة اختبار الإدارة ${suffix}`;
const ownerEmail = `owner-${suffix}@example.test`;

async function request(path, { method = "GET", body, cookie, forwardedFor = "203.0.113.180" } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      "X-Forwarded-For": forwardedFor,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function cookieFrom(response, name) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : null;
}

before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  const [admin] = await db.insert(platformAdminsTable).values({
    username,
    displayName: "مدير اختبار المنصة",
    passwordHash: await hashPassword(password),
  }).returning({ id: platformAdminsTable.id });
  adminId = admin.id;

  const now = new Date();
  const [organization] = await db.insert(organizationsTable).values({
    name: organizationName,
    planId: "pro",
    subscriptionStatus: "active",
    trialStartedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
    trialEndsAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
    subscriptionStartedAt: now,
    subscriptionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  }).returning({ id: organizationsTable.id });
  organizationId = organization.id;
  await db.insert(teamUsersTable).values({
    organizationId,
    email: ownerEmail,
    name: "مالك منشأة الاختبار",
    passwordHash: await hashPassword("Owner-test-password-123"),
    roleId: "owner",
    permissions: {},
    locationScope: "all",
    warehouseIds: [],
  });
});

after(async () => {
  if (adminId) await db.delete(platformAdminsTable).where(eq(platformAdminsTable.id, adminId));
  if (organizationId) await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId));
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("يرفض اعتماد الإدارة الخاطئ ولا يكشف بيانات الحساب", async () => {
  const { response, payload } = await request("/platform-auth/login", {
    method: "POST",
    body: { username, password: "incorrect-password" },
    forwardedFor: "203.0.113.181",
  });
  assert.equal(response.status, 401);
  assert.equal(payload.error, "اسم المستخدم أو كلمة المرور غير صحيحة.");
  assert.equal(JSON.stringify(payload).includes(username), false);
});

test("يعزل جلسة الإدارة عن جلسة مالك المنشأة", async () => {
  const registration = await request("/auth/register", {
    method: "POST",
    body: {
      projectName: `منشأة عزل ${suffix}`,
      name: "مالك عادي",
      email: `tenant-${suffix}@example.test`,
      password: "Tenant-test-password-123",
    },
    forwardedFor: "203.0.113.182",
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.payload));
  const tenantCookie = cookieFrom(registration.response, "wudooh_session");
  assert.ok(tenantCookie);

  const overview = await request("/super-admin/overview", { cookie: tenantCookie });
  assert.equal(overview.response.status, 401);
  assert.equal(overview.payload.error, "غير مصرح لك بالوصول إلى الإدارة العليا.");
  await db.delete(organizationsTable).where(eq(organizationsTable.id, registration.payload.user.organizationId));
});

test("يسمح للسوبر أدمن ويحسب الاشتراك والمدة المتبقية على الخادم", async () => {
  const login = await request("/platform-auth/login", {
    method: "POST",
    body: { username, password },
    forwardedFor: "203.0.113.183",
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.payload));
  assert.equal(login.payload.admin.username, username);
  assert.equal(login.payload.admin.role, "super_admin");
  assert.equal(login.payload.admin.passwordHash, undefined);
  const adminCookie = cookieFrom(login.response, "wudooh_super_admin_session");
  assert.ok(adminCookie);

  const tenantSession = await request("/auth/me", { cookie: adminCookie });
  assert.equal(tenantSession.response.status, 200);
  assert.equal(tenantSession.payload.user, null);

  const adminSession = await request("/platform-auth/me", { cookie: adminCookie });
  assert.equal(adminSession.response.status, 200);
  assert.equal(adminSession.payload.admin.username, username);

  const overview = await request(`/super-admin/overview?search=${encodeURIComponent(ownerEmail)}&status=active`, {
    cookie: adminCookie,
  });
  assert.equal(overview.response.status, 200, JSON.stringify(overview.payload));
  assert.equal(overview.payload.organizations.length, 1);
  const [organization] = overview.payload.organizations;
  assert.equal(organization.name, organizationName);
  assert.equal(organization.owner.email, ownerEmail);
  assert.equal(organization.status, "active");
  assert.ok(organization.daysRemaining >= 29 && organization.daysRemaining <= 30);
  assert.equal(JSON.stringify(organization).includes("password"), false);
  assert.equal(JSON.stringify(organization).includes("stripe"), false);

  const logout = await request("/platform-auth/logout", { method: "POST", cookie: adminCookie });
  assert.equal(logout.response.status, 204);
  const sessionAfterLogout = await request("/platform-auth/me", { cookie: adminCookie });
  assert.equal(sessionAfterLogout.payload.admin, null);
});