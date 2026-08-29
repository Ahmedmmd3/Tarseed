import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  erpRecordsTable,
  organizationsTable,
  platformAuditLogsTable,
  teamAuditLogsTable,
  platformAdminsTable,
  testWorkspaceInvitationsTable,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { hashPassword, hashSessionToken } from "../src/lib/team-auth.ts";
import { lockAndValidateDataGeneration } from "../src/middleware/team-auth.ts";

let server;
let origin;
let adminId;
let organizationId;
const testOrganizationIds = [];
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const username = `admin.${suffix}`;
const password = "Secure-platform-test-password-123";
const organizationName = `منشأة اختبار الإدارة ${suffix}`;
const ownerEmail = `owner-${suffix}@example.test`;

async function request(path, { method = "GET", body, cookie, headers = {}, forwardedFor = "203.0.113.180" } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      "X-Forwarded-For": forwardedFor,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
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
  for (const id of testOrganizationIds) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, id));
  }
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
  const login = await request("/auth/login", {
    method: "POST",
    body: {
      email: ownerEmail,
      password: "Tenant-test-password-123",
    },
    forwardedFor: "203.0.113.182",
  });
  assert.equal(login.response.status, 401, "يجب ألا يعمل اعتماد غير صحيح لمالك المنشأة");

  const ownerLogin = await request("/auth/login", {
    method: "POST",
    body: {
      email: ownerEmail,
      password: "Owner-test-password-123",
    },
    forwardedFor: "203.0.113.182",
  });
  assert.equal(ownerLogin.response.status, 200, JSON.stringify(ownerLogin.payload));
  const tenantCookie = cookieFrom(ownerLogin.response, "wudooh_session");
  assert.ok(tenantCookie);

  const overview = await request("/super-admin/overview", { cookie: tenantCookie });
  assert.equal(overview.response.status, 401);
  assert.equal(overview.payload.error, "غير مصرح لك بالوصول إلى الإدارة العليا.");
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

test("تنتظر عملية التعليق القفل وتُرفض عمليات النسخ والفوترة والفريق المنتظرة بلا كتابة", async () => {
  const adminLogin = await request("/platform-auth/login", { method: "POST", body: { username, password } });
  const adminCookie = cookieFrom(adminLogin.response, "wudooh_super_admin_session");
  const ownerLogin = await request("/auth/login", {
    method: "POST", body: { email: ownerEmail, password: "Owner-test-password-123" },
  });
  const ownerCookie = cookieFrom(ownerLogin.response, "wudooh_session");
  assert.ok(adminCookie && ownerCookie);

  // First prove the HTTP suspension action cannot pass an existing tenant
  // organization lock. This is the same PostgreSQL row lock used by all
  // protected mutations.
  let releaseHeld;
  let lockedResolve;
  const locked = new Promise(resolve => { lockedResolve = resolve; });
  const held = db.transaction(async tx => {
    await tx.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).for("update");
    lockedResolve();
    await new Promise(resolve => { releaseHeld = resolve; });
  });
  await locked;
  let suspensionFinished = false;
  const suspension = request(`/super-admin/organizations/${organizationId}/subscription-action`, {
    method: "POST", cookie: adminCookie, body: { action: "suspend_access", confirmed: true, reason: "اختبار قفل التزامن" },
  }).then(result => { suspensionFinished = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(suspensionFinished, false, "يجب أن ينتظر التعليق العملية التي تمسك قفل المنشأة");
  releaseHeld();
  await held;
  const suspended = await suspension;
  assert.equal(suspended.response.status, 200, JSON.stringify(suspended.payload));

  const activeAgain = await request(`/super-admin/organizations/${organizationId}/subscription-action`, {
    method: "POST", cookie: adminCookie, body: { action: "restore_access", confirmed: true, reason: "تهيئة اختبار العمليات المنتظرة" },
  });
  assert.equal(activeAgain.response.status, 200, JSON.stringify(activeAgain.payload));

  const beforeRecords = await db.select({ id: erpRecordsTable.id }).from(erpRecordsTable)
    .where(eq(erpRecordsTable.organizationId, organizationId));
  const beforeAudit = await db.select({ id: teamAuditLogsTable.id }).from(teamAuditLogsTable)
    .where(eq(teamAuditLogsTable.organizationId, organizationId));

  const [generation] = await db.select({ dataGeneration: organizationsTable.dataGeneration }).from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId));
  const suffix2 = randomUUID().slice(0, 8);
  let releaseSuspension;
  let suspensionLockedResolve;
  const suspensionLocked = new Promise(resolve => { suspensionLockedResolve = resolve; });
  const heldSuspension = db.transaction(async tx => {
    await tx.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).for("update");
    await tx.update(organizationsTable).set({ platformAccessSuspendedAt: new Date() })
      .where(eq(organizationsTable.id, organizationId));
    suspensionLockedResolve();
    await new Promise(resolve => { releaseSuspension = resolve; });
  });
  await suspensionLocked;

  let completedWrites = 0;
  const writes = Promise.all([
    request("/backup/restore", { method: "POST", cookie: ownerCookie, body: { version: 1, organizationId, records: [] } }),
    request("/e-invoicing/setup", {
      method: "PUT", cookie: ownerCookie, headers: { "X-Wudooh-Data-Generation": String(generation.dataGeneration) },
      body: { unitName: "وحدة اختبار", deviceSerialNumber: "DEVICE-LOCK", sellerName: "منشأة اختبار", vatNumber: "300000000000003", commercialRegistrationNumber: "1010000000", street: "شارع", buildingNumber: "1", city: "الرياض", postalCode: "12345", countryCode: "SA", vatRate: 15 },
    }),
    request("/team/members", {
      method: "POST", cookie: ownerCookie,
      body: { name: "عضو قفل", email: `blocked-${suffix2}@example.test`, password: "Member-password-123", roleId: "sales", locationScope: "none", permissions: {} },
    }),
  ].map(promise => promise.then(result => {
    completedWrites += 1;
    return result;
  })));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(completedWrites, 0, "يجب أن تنتظر عمليات المنشأة التحقق من قفل التعليق");
  releaseSuspension();
  await heldSuspension;
  const [backup, setup, member] = await writes;

  for (const result of [backup, setup, member]) {
    assert.equal(result.response.status, 402, JSON.stringify(result.payload));
    assert.equal(result.payload.code, "platform_access_suspended");
  }
  const afterRecords = await db.select({ id: erpRecordsTable.id }).from(erpRecordsTable)
    .where(eq(erpRecordsTable.organizationId, organizationId));
  const afterAudit = await db.select({ id: teamAuditLogsTable.id }).from(teamAuditLogsTable)
    .where(eq(teamAuditLogsTable.organizationId, organizationId));
  assert.deepEqual(afterRecords, beforeRecords, "لا يجوز أن تكتب العمليات المعلقة سجلات المجال");
  assert.equal(afterAudit.length, beforeAudit.length, "لا يجوز أن تنشئ العمليات المعلقة سجلات تدقيق منشأة");

  // Restore so cleanup and any later tests retain an active tenant.
  const restored = await request(`/super-admin/organizations/${organizationId}/subscription-action`, {
    method: "POST", cookie: adminCookie, body: { action: "restore_access", confirmed: true, reason: "تنظيف اختبار القفل" },
  });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.payload));
});

test("ينشئ السوبر أدمن مساحة اختبار معلّمة ولا يحصل على جلسة داخلها", async () => {
  const unauthorized = await request("/super-admin/test-workspaces", {
    method: "POST",
    body: {
      workspaceName: `مساحة غير مصرح بها ${suffix}`,
      ownerName: "مالك غير مصرح",
      ownerEmail: `unauthorized-${suffix}@example.test`,
    },
  });
  assert.equal(unauthorized.response.status, 401);

  const login = await request("/platform-auth/login", {
    method: "POST",
    body: { username, password },
    forwardedFor: "203.0.113.190",
  });
  const adminCookie = cookieFrom(login.response, "wudooh_super_admin_session");
  assert.ok(adminCookie);
  const testWorkspaceName = `تدقيق محاسبي ${suffix}`;
  const testOwnerEmail = `audit-owner-${suffix}@example.test`;
  const created = await request("/super-admin/test-workspaces", {
    method: "POST",
    cookie: adminCookie,
    body: {
      workspaceName: testWorkspaceName,
      ownerName: "مالك مساحة التدقيق",
      ownerEmail: testOwnerEmail,
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.workspace.isTestWorkspace, true);
  assert.equal(created.payload.workspace.status, "pending_owner");
  assert.equal(JSON.stringify(created.payload).includes("token"), false);
  testOrganizationIds.push(created.payload.workspace.id);

  const [organization] = await db.select().from(organizationsTable)
    .where(eq(organizationsTable.id, created.payload.workspace.id));
  assert.equal(organization.isTestWorkspace, true);
  assert.equal(organization.subscriptionStatus, "trialing");
  assert.equal(organization.platformAccessSuspendedAt, null);
  const owners = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.organizationId, organization.id));
  assert.equal(owners.length, 0, "لا ينشأ مالك نشط قبل إثبات حيازة رابط الدعوة");
  const invitations = await db.select().from(testWorkspaceInvitationsTable)
    .where(eq(testWorkspaceInvitationsTable.organizationId, organization.id));
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].email, testOwnerEmail);
  assert.equal(invitations[0].acceptedAt, null);
  assert.ok(invitations[0].sentAt instanceof Date);

  const tenantSession = await request("/auth/me", { cookie: adminCookie });
  assert.equal(tenantSession.payload.user, null, "كوكي الإدارة العليا لا تتحول إلى جلسة منشأة");
});

test("يقبل مالك الاختبار الدعوة مرة واحدة ويظهر كمالك مفعّل", async () => {
  const now = new Date();
  const rawToken = `test-workspace-invitation-${randomUUID()}-${randomUUID()}`;
  const workspaceName = `مساحة قبول دعوة ${suffix}`;
  const email = `accepted-auditor-${suffix}@example.test`;
  const [organization] = await db.insert(organizationsTable).values({
    name: workspaceName,
    planId: "trial",
    subscriptionStatus: "trialing",
    trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    isTestWorkspace: true,
  }).returning();
  testOrganizationIds.push(organization.id);
  await db.insert(testWorkspaceInvitationsTable).values({
    organizationId: organization.id,
    createdByAdminId: adminId,
    email,
    ownerName: "مدقق الحسابات",
    tokenHash: hashSessionToken(rawToken),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    sentAt: now,
  });

  const status = await request(`/auth/test-workspace-invitations/status?token=${encodeURIComponent(rawToken)}`);
  assert.equal(status.response.status, 200, JSON.stringify(status.payload));
  assert.equal(status.payload.invitation.workspaceName, workspaceName);
  assert.equal(status.payload.invitation.email, email);

  const accepted = await request("/auth/test-workspace-invitations/accept", {
    method: "POST",
    body: { token: rawToken, password: "Accepted-owner-password-123!" },
    forwardedFor: "203.0.113.191",
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.user.organizationId, organization.id);
  assert.equal(accepted.payload.user.roleId, "owner");
  assert.ok(accepted.payload.user.emailVerifiedAt);
  assert.equal(accepted.payload.user.phone, null);
  const ownerCookie = cookieFrom(accepted.response, "wudooh_session");
  assert.ok(ownerCookie);

  const ownerSession = await request("/auth/me", { cookie: ownerCookie });
  assert.equal(ownerSession.payload.user.organizationId, organization.id);
  const repeated = await request("/auth/test-workspace-invitations/accept", {
    method: "POST",
    body: { token: rawToken, password: "Accepted-owner-password-123!" },
    forwardedFor: "203.0.113.192",
  });
  assert.equal(repeated.response.status, 400);

  const [storedOwner] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.email, email));
  assert.equal(storedOwner.status, "active");
  assert.ok(storedOwner.emailVerifiedAt instanceof Date);
  const [invitation] = await db.select().from(testWorkspaceInvitationsTable)
    .where(eq(testWorkspaceInvitationsTable.organizationId, organization.id));
  assert.ok(invitation.acceptedAt instanceof Date);
  const activationLogs = await db.select().from(platformAuditLogsTable)
    .where(eq(platformAuditLogsTable.organizationId, organization.id));
  assert.ok(activationLogs.some((log) => log.action === "test_workspace_activated"));
});

test("يرفض الدعوات غير المرسلة والمنتهية ويدوّر الرمز عند إعادة الإرسال", async () => {
  const resendAdminUsername = `resend-admin.${suffix}`;
  const [resendAdmin] = await db.insert(platformAdminsTable).values({
    username: resendAdminUsername,
    displayName: "مدير إعادة إرسال الاختبار",
    passwordHash: await hashPassword(password),
  }).returning({ id: platformAdminsTable.id });
  const login = await request("/platform-auth/login", {
    method: "POST",
    body: { username: resendAdminUsername, password },
    forwardedFor: "203.0.113.193",
  });
  const adminCookie = cookieFrom(login.response, "wudooh_super_admin_session");
  assert.ok(adminCookie);
  const now = new Date();
  const [organization] = await db.insert(organizationsTable).values({
    name: `مساحة ضبط دعوات ${suffix}`,
    isTestWorkspace: true,
    trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  }).returning();
  testOrganizationIds.push(organization.id);
  const unsentToken = `unsent-${randomUUID()}-${randomUUID()}`;
  const [invitation] = await db.insert(testWorkspaceInvitationsTable).values({
    organizationId: organization.id,
    createdByAdminId: resendAdmin.id,
    email: `resend-${suffix}@example.test`,
    ownerName: "مالك إعادة الإرسال",
    tokenHash: hashSessionToken(unsentToken),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  }).returning();

  const unsentStatus = await request(`/auth/test-workspace-invitations/status?token=${encodeURIComponent(unsentToken)}`);
  assert.equal(unsentStatus.response.status, 400);
  const unsentAccept = await request("/auth/test-workspace-invitations/accept", {
    method: "POST",
    body: { token: unsentToken, password: "Unsent-owner-password-123!" },
  });
  assert.equal(unsentAccept.response.status, 400);

  const resent = await request(`/super-admin/test-workspaces/${organization.id}/resend-invitation`, {
    method: "POST",
    cookie: adminCookie,
  });
  assert.equal(resent.response.status, 200, JSON.stringify(resent.payload));
  const [afterResend] = await db.select().from(testWorkspaceInvitationsTable)
    .where(eq(testWorkspaceInvitationsTable.id, invitation.id));
  assert.ok(afterResend.sentAt instanceof Date);
  assert.notEqual(afterResend.tokenHash, hashSessionToken(unsentToken), "يجب إبطال الرمز السابق عند إعادة الإرسال");
  const oldTokenStatus = await request(`/auth/test-workspace-invitations/status?token=${encodeURIComponent(unsentToken)}`);
  assert.equal(oldTokenStatus.response.status, 400);

  const expiredToken = `expired-${randomUUID()}-${randomUUID()}`;
  await db.update(testWorkspaceInvitationsTable).set({
    tokenHash: hashSessionToken(expiredToken),
    sentAt: now,
    expiresAt: new Date(now.getTime() - 1000),
  }).where(eq(testWorkspaceInvitationsTable.id, invitation.id));
  const expiredStatus = await request(`/auth/test-workspace-invitations/status?token=${encodeURIComponent(expiredToken)}`);
  assert.equal(expiredStatus.response.status, 400);
  await db.delete(platformAdminsTable).where(eq(platformAdminsTable.id, resendAdmin.id));
});