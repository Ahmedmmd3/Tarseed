import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  platformAuditLogsTable,
  platformAdminsTable,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { hashPassword } from "../src/lib/team-auth.ts";
import { lockAndValidateDataGeneration } from "../src/middleware/team-auth.ts";

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

});

test("يتطلب التأكيد ويطبّق تعليق الوصول واستعادته ذرياً مع سجل موافقات كامل", async () => {
  const login = await request("/platform-auth/login", {
    method: "POST",
    body: { username, password },
    forwardedFor: "203.0.113.184",
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.payload));
  const adminCookie = cookieFrom(login.response, "wudooh_super_admin_session");
  assert.ok(adminCookie);

  const [before] = await db.select({
    subscriptionStatus: organizationsTable.subscriptionStatus,
    subscriptionEndsAt: organizationsTable.subscriptionEndsAt,
    platformAccessSuspendedAt: organizationsTable.platformAccessSuspendedAt,
  }).from(organizationsTable).where(eq(organizationsTable.id, organizationId));
  assert.ok(before);

  const unconfirmed = await request(`/super-admin/organizations/${organizationId}/subscription-action`, {
    method: "POST",
    cookie: adminCookie,
    body: { action: "suspend_access", reason: "اختبار التأكيد" },
  });
  assert.equal(unconfirmed.response.status, 400);
  assert.equal(unconfirmed.payload.code, "confirmation_required");

  const [afterUnconfirmed] = await db.select({
    subscriptionStatus: organizationsTable.subscriptionStatus,
    subscriptionEndsAt: organizationsTable.subscriptionEndsAt,
    platformAccessSuspendedAt: organizationsTable.platformAccessSuspendedAt,
  }).from(organizationsTable).where(eq(organizationsTable.id, organizationId));
  assert.deepEqual(afterUnconfirmed, before, "يجب ألا يتغير الاشتراك من دون تأكيد");

  const suspended = await request(`/super-admin/organizations/${organizationId}/subscription-action`, {
    method: "POST",
    cookie: adminCookie,
    body: { action: "suspend_access", reason: "اختبار تعليق وصول المنشأة", confirmed: true },
  });
  assert.equal(suspended.response.status, 200, JSON.stringify(suspended.payload));
  assert.equal(suspended.payload.subscription.accessStatus, "inactive");

  const [afterSuspend] = await db.select({
    subscriptionStatus: organizationsTable.subscriptionStatus,
    subscriptionEndsAt: organizationsTable.subscriptionEndsAt,
    platformAccessSuspendedAt: organizationsTable.platformAccessSuspendedAt,
  }).from(organizationsTable).where(eq(organizationsTable.id, organizationId));
  assert.equal(afterSuspend.subscriptionStatus, before.subscriptionStatus, "يجب إبقاء حالة Stripe الأصلية");
  assert.equal(afterSuspend.subscriptionEndsAt.toISOString(), before.subscriptionEndsAt.toISOString());
  assert.ok(afterSuspend.platformAccessSuspendedAt instanceof Date);

  const stalePreSuspensionResponse = {
    locals: {
      auth: { organizationId },
      dataGeneration: 1,
    },
  };
  const writeStillAllowed = await db.transaction((tx) => lockAndValidateDataGeneration(tx, stalePreSuspensionResponse));
  assert.equal(writeStillAllowed, false, "يجب أن يعيد قفل الكتابة فحص التعليق حتى لو بدأت المصادقة قبله");

  const ownerLogin = await request("/auth/login", {
    method: "POST",
    body: { email: ownerEmail, password: "Owner-test-password-123" },
    forwardedFor: "203.0.113.185",
  });
  assert.equal(ownerLogin.response.status, 200, JSON.stringify(ownerLogin.payload));
  assert.equal(ownerLogin.payload.user.subscription.status, "inactive");
  assert.equal(ownerLogin.payload.user.subscription.accessActive, false);

  const restored = await request(`/super-admin/organizations/${organizationId}/subscription-action`, {
    method: "POST",
    cookie: adminCookie,
    body: { action: "restore_access", reason: "اختبار استعادة الوصول", confirmed: true },
  });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.payload));
  assert.equal(restored.payload.subscription.accessStatus, "active");

  const extended = await request(`/super-admin/organizations/${organizationId}/subscription-action`, {
    method: "POST",
    cookie: adminCookie,
    body: { action: "extend_access", durationDays: 5, reason: "اختبار تمديد الوصول", confirmed: true },
  });
  assert.equal(extended.response.status, 200, JSON.stringify(extended.payload));
  assert.equal(extended.payload.subscription.accessStatus, "active");
  assert.ok(new Date(extended.payload.subscription.subscriptionEndsAt) > before.subscriptionEndsAt);

  const auditResponse = await request(`/super-admin/organizations/${organizationId}/audit-logs`, {
    cookie: adminCookie,
  });
  assert.equal(auditResponse.response.status, 200, JSON.stringify(auditResponse.payload));
  assert.ok(auditResponse.payload.logs.length >= 3);
  const loggedActions = new Set(auditResponse.payload.logs.map((log) => log.action));
  assert.ok(loggedActions.has("suspend_access"));
  assert.ok(loggedActions.has("restore_access"));
  assert.ok(loggedActions.has("extend_access"));
  const suspendLog = auditResponse.payload.logs.find((log) => log.action === "suspend_access");
  const suspendDetails = JSON.parse(suspendLog.details);
  assert.equal(suspendDetails.confirmed, true);
  assert.equal(suspendDetails.reason, "اختبار تعليق وصول المنشأة");
  assert.equal(suspendDetails.previous.accessStatus, "active");
  assert.equal(suspendDetails.next.accessStatus, "inactive");

  const directAuditRows = await db.select({ id: platformAuditLogsTable.id })
    .from(platformAuditLogsTable)
    .where(eq(platformAuditLogsTable.organizationId, organizationId));
  assert.ok(directAuditRows.length >= 3);

  const logout = await request("/platform-auth/logout", { method: "POST", cookie: adminCookie });
  assert.equal(logout.response.status, 204);
  const sessionAfterLogout = await request("/platform-auth/me", { cookie: adminCookie });
  assert.equal(sessionAfterLogout.payload.admin, null);
});