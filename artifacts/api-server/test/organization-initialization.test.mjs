import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test, { after, before } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  erpRecordsTable,
  organizationsTable,
  platformAdminsTable,
  pool,
  testWorkspaceInvitationsTable,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { DEMO_SEED_KEY, initializeOrganization, seedDemoData } from "../src/lib/seed-demo-data.ts";
import { hashPassword, hashSessionToken } from "../src/lib/team-auth.ts";

const execFileAsync = promisify(execFile);
const EXPECTED_COUNTS = {
  accounts: 15,
  customers: 3,
  products: 5,
  invoices: 4,
  expenses: 5,
  warehouses: 2,
};

let server;
let origin;
const organizationIds = [];
const platformAdminIds = [];
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

async function request(path, { method = "GET", body, cookie, forwardedFor = "203.0.113.210" } = {}) {
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

async function assertInitializedOrganization(organizationId, label) {
  const records = await db.select().from(erpRecordsTable)
    .where(eq(erpRecordsTable.organizationId, organizationId));
  const counts = records.reduce((result, record) => {
    result[record.tableName] = (result[record.tableName] ?? 0) + 1;
    return result;
  }, {});

  for (const [tableName, expected] of Object.entries(EXPECTED_COUNTS)) {
    assert.equal(counts[tableName] ?? 0, expected, `${label}: عدد ${tableName} غير مطابق`);
  }
  for (const tableName of ["accounts", "customers", "products", "invoices", "expenses"]) {
    const seeded = records.filter((record) => record.tableName === tableName);
    assert.ok(
      seeded.every((record) => record.data.demoSeedKey === DEMO_SEED_KEY),
      `${label}: يجب أن تنتمي كل سجلات ${tableName} إلى البذور الموحدة`,
    );
  }
}

before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const organizationId of organizationIds) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId));
  }
  for (const adminId of platformAdminIds) {
    await db.delete(platformAdminsTable).where(eq(platformAdminsTable.id, adminId));
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("توحد التسجيل والدعوة وسكربت المتصفح بيانات المنشأة التجريبية بلا تكرار", async () => {
  const registrationEmail = `registration-${suffix}@example.test`;
  const registration = await request("/auth/register", {
    method: "POST",
    body: {
      projectName: `منشأة تسجيل ${suffix}`,
      name: "مالك التسجيل",
      email: registrationEmail,
      phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
      password: "Registration-password-123!",
    },
  });
  assert.equal(registration.response.status, 202, JSON.stringify(registration.payload));
  const [registeredOwner] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.email, registrationEmail));
  assert.ok(registeredOwner);
  organizationIds.push(registeredOwner.organizationId);
  await assertInitializedOrganization(registeredOwner.organizationId, "التسجيل العادي");

  const adminUsername = `seed-admin.${suffix}`;
  const adminPassword = "Platform-admin-password-123!";
  const [admin] = await db.insert(platformAdminsTable).values({
    username: adminUsername,
    displayName: "مدير اختبار تهيئة المنشأة",
    passwordHash: await hashPassword(adminPassword),
  }).returning();
  platformAdminIds.push(admin.id);
  const adminLogin = await request("/platform-auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
    forwardedFor: "203.0.113.211",
  });
  assert.equal(adminLogin.response.status, 200, JSON.stringify(adminLogin.payload));
  const adminCookie = cookieFrom(adminLogin.response, "wudooh_super_admin_session");
  assert.ok(adminCookie);

  const invitedEmail = `invited-${suffix}@example.test`;
  const createdWorkspace = await request("/super-admin/test-workspaces", {
    method: "POST",
    cookie: adminCookie,
    body: {
      workspaceName: `مساحة دعوة ${suffix}`,
      ownerName: "مالك مساحة الدعوة",
      ownerEmail: invitedEmail,
    },
    forwardedFor: "203.0.113.212",
  });
  assert.equal(createdWorkspace.response.status, 201, JSON.stringify(createdWorkspace.payload));
  const invitedOrganizationId = createdWorkspace.payload.workspace.id;
  organizationIds.push(invitedOrganizationId);
  await assertInitializedOrganization(invitedOrganizationId, "إنشاء مساحة الاختبار");

  const invitationToken = `organization-seed-${randomUUID()}-${randomUUID()}`;
  const [invitation] = await db.select().from(testWorkspaceInvitationsTable)
    .where(eq(testWorkspaceInvitationsTable.organizationId, invitedOrganizationId));
  assert.ok(invitation);
  await db.update(testWorkspaceInvitationsTable).set({
    tokenHash: hashSessionToken(invitationToken),
    sentAt: new Date(),
  }).where(eq(testWorkspaceInvitationsTable.id, invitation.id));
  const accepted = await request("/auth/test-workspace-invitations/accept", {
    method: "POST",
    body: { token: invitationToken, password: "Invited-owner-password-123!" },
    forwardedFor: "203.0.113.213",
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.payload));
  await assertInitializedOrganization(invitedOrganizationId, "قبول دعوة مساحة الاختبار");

  const browserEmail = `browser-${suffix}@example.test`;
  const browserPassword = "Browser-test-password-123!";
  const now = new Date();
  const [browserOrganization] = await db.insert(organizationsTable).values({
    name: `حساب متصفح قديم ${suffix}`,
    dataGeneration: 1,
    planId: "pro",
    subscriptionStatus: "active",
    trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    subscriptionStartedAt: now,
    subscriptionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    isTestWorkspace: true,
  }).returning();
  organizationIds.push(browserOrganization.id);
  await db.insert(teamUsersTable).values({
    organizationId: browserOrganization.id,
    email: browserEmail,
    emailVerifiedAt: now,
    name: "مالك حساب متصفح قديم",
    passwordHash: await hashPassword(browserPassword),
    roleId: "owner",
    permissions: {},
    locationScope: "all",
    warehouseIds: [],
    status: "active",
  });
  await seedDemoData(browserOrganization.id, browserOrganization.dataGeneration);
  await db.delete(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, browserOrganization.id),
    eq(erpRecordsTable.tableName, "warehouses"),
  ));

  const runBrowserSetup = () => execFileAsync("pnpm", ["run", "setup:browser-test-account"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROD_TEST_EMAIL: browserEmail,
      PROD_TEST_PASSWORD: browserPassword,
    },
  });
  await runBrowserSetup();
  await assertInitializedOrganization(browserOrganization.id, "إصلاح حساب المتصفح القديم");
  await runBrowserSetup();
  await assertInitializedOrganization(browserOrganization.id, "إعادة تشغيل تجهيز حساب المتصفح");
});

test("تمنع تهيئة البيانات التجريبية المتزامنة التكرار", async () => {
  const now = new Date();
  const [organization] = await db.insert(organizationsTable).values({
    name: `منشأة تهيئة متزامنة ${suffix}`,
    dataGeneration: 1,
    planId: "pro",
    subscriptionStatus: "active",
    trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    subscriptionStartedAt: now,
    subscriptionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    isTestWorkspace: true,
  }).returning();
  organizationIds.push(organization.id);

  const results = await Promise.all([
    seedDemoData(organization.id, organization.dataGeneration),
    seedDemoData(organization.id, organization.dataGeneration),
  ]);

  assert.deepEqual(results.filter(({ created }) => created === 0).length, 1);
  assert.equal(results.filter(({ created }) => created > 0).length, 1);
  await assertInitializedOrganization(organization.id, "التهيئة المتزامنة");
});

test("تتراجع تهيئة البذور بالكامل بعد فشل إدراج جزئي وتنجح إعادة المحاولة مرة واحدة", async () => {
  const now = new Date();
  const [organization] = await db.insert(organizationsTable).values({
    name: `منشأة تراجع البذور ${suffix}`,
    dataGeneration: 1,
    initializationStatus: "pending",
    planId: "pro",
    subscriptionStatus: "active",
    trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    subscriptionStartedAt: now,
    subscriptionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    isTestWorkspace: true,
  }).returning();
  organizationIds.push(organization.id);

  const triggerFunction = `fail_demo_seed_${suffix}`;
  const triggerName = `${triggerFunction}_trigger`;
  try {
    await db.execute(sql.raw(`
      CREATE FUNCTION ${triggerFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.table_name = 'products' AND NEW.data->>'demoSeedKey' = '${DEMO_SEED_KEY}' THEN
          RAISE EXCEPTION 'فشل مقصود لاختبار التراجع الذري للبذور';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON erp_records
      FOR EACH ROW EXECUTE FUNCTION ${triggerFunction}();
    `));

    let failure;
    try {
      await initializeOrganization(organization.id, organization.dataGeneration);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "يجب أن يفشل إدراج البذور بسبب العطل المقصود");
    assert.equal(failure.message.includes("فشل مقصود"), false, "يجب ألا يكشف الخطأ الآمن تفاصيل قاعدة البيانات");
    const recordsAfterFailure = await db.select().from(erpRecordsTable)
      .where(eq(erpRecordsTable.organizationId, organization.id));
    assert.equal(recordsAfterFailure.length, 0, "يجب ألا تبقى أي سجلات بذور بعد فشل التهيئة");
    const [failedOrganization] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.id, organization.id));
    assert.equal(failedOrganization.initializationStatus, "failed");
    assert.equal(failedOrganization.initializationFailureCode, "seed_data_error");
    assert.match(failedOrganization.initializationFailureReason, /البيانات الأساسية/);
    assert.equal(failedOrganization.initializationFailureReason.includes("فشل مقصود"), false);

    const interruptedRegistrationEmail = `init-failure-${suffix}@example.test`;
    const interruptedRegistration = await request("/auth/register", {
      method: "POST",
      body: {
        projectName: `منشأة تسجيل متعثرة ${suffix}`,
        name: "مالك تسجيل متعثر",
        email: interruptedRegistrationEmail,
        phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
        password: "Initialization-failure-password-123!",
      },
      forwardedFor: "203.0.113.218",
    });
    assert.equal(interruptedRegistration.response.status, 503, JSON.stringify(interruptedRegistration.payload));
    assert.equal(interruptedRegistration.payload.code, "organization_initialization_failed");
    const [interruptedOwner] = await db.select().from(teamUsersTable)
      .where(eq(teamUsersTable.email, interruptedRegistrationEmail));
    assert.ok(interruptedOwner, "يجب أن يبقى حساب المالك بعد فشل تهيئة منشأته");
    organizationIds.push(interruptedOwner.organizationId);
    const blockedVerification = await request("/auth/email-verification/verify", {
      method: "POST",
      body: { email: interruptedRegistrationEmail, code: "654321" },
      forwardedFor: "203.0.113.219",
    });
    assert.equal(blockedVerification.response.status, 503, JSON.stringify(blockedVerification.payload));
    assert.equal(blockedVerification.payload.code, "organization_initialization_incomplete");
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON erp_records`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${triggerFunction}()`));
  }

  const adminUsername = `retry-admin.${suffix}`;
  const adminPassword = "Retry-admin-password-123!";
  const [admin] = await db.insert(platformAdminsTable).values({
    username: adminUsername,
    displayName: "مشرف إعادة التهيئة",
    passwordHash: await hashPassword(adminPassword),
  }).returning();
  platformAdminIds.push(admin.id);
  const adminLogin = await request("/platform-auth/login", {
    method: "POST",
    body: { username: adminUsername, password: adminPassword },
    forwardedFor: "203.0.113.214",
  });
  const adminCookie = cookieFrom(adminLogin.response, "wudooh_super_admin_session");
  assert.ok(adminCookie);

  const overview = await request("/super-admin/overview", {
    cookie: adminCookie,
    forwardedFor: "203.0.113.215",
  });
  assert.equal(overview.response.status, 200, JSON.stringify(overview.payload));
  const failedInOverview = overview.payload.initializationFailures.find((item) => item.id === organization.id);
  assert.ok(failedInOverview, "يجب أن تظهر المنشأة المتعثرة للمشرف");
  assert.equal(failedInOverview.initializationFailureCode, "seed_data_error");
  assert.equal(failedInOverview.initializationFailureReason.includes("فشل مقصود"), false);

  const firstRetry = await request(`/super-admin/organizations/${organization.id}/initialization-retry`, {
    method: "POST",
    cookie: adminCookie,
    forwardedFor: "203.0.113.216",
  });
  assert.equal(firstRetry.response.status, 200, JSON.stringify(firstRetry.payload));
  assert.equal(firstRetry.payload.status, "ready");
  assert.ok(firstRetry.payload.created > 0, "يجب أن تنشئ إعادة المحاولة المجموعة الكاملة");
  await assertInitializedOrganization(organization.id, "إعادة المحاولة بعد فشل البذور");

  const secondRetry = await request(`/super-admin/organizations/${organization.id}/initialization-retry`, {
    method: "POST",
    cookie: adminCookie,
    forwardedFor: "203.0.113.217",
  });
  assert.equal(secondRetry.response.status, 200, JSON.stringify(secondRetry.payload));
  assert.deepEqual(
    { status: secondRetry.payload.status, created: secondRetry.payload.created, retried: secondRetry.payload.retried },
    { status: "ready", created: 0, retried: false },
    "يجب ألا تعيد إعادة المحاولة إنشاء المجموعة مرة أخرى",
  );
  const [readyOrganization] = await db.select().from(organizationsTable)
    .where(eq(organizationsTable.id, organization.id));
  assert.equal(readyOrganization.initializationStatus, "ready");
  assert.equal(readyOrganization.initializationFailureCode, null);
  assert.equal(readyOrganization.initializationFailureReason, null);
  await assertInitializedOrganization(organization.id, "إعادة المحاولة الثانية للبذور");

  const [interruptedOwner] = await db.select().from(teamUsersTable)
    .where(eq(teamUsersTable.email, `init-failure-${suffix}@example.test`));
  assert.ok(interruptedOwner);
  const registrationRetry = await request(`/super-admin/organizations/${interruptedOwner.organizationId}/initialization-retry`, {
    method: "POST",
    cookie: adminCookie,
    forwardedFor: "203.0.113.220",
  });
  assert.equal(registrationRetry.response.status, 200, JSON.stringify(registrationRetry.payload));
  const verifiedAfterRetry = await request("/auth/email-verification/verify", {
    method: "POST",
    body: { email: interruptedOwner.email, code: "654321" },
    forwardedFor: "203.0.113.221",
  });
  assert.equal(verifiedAfterRetry.response.status, 200, JSON.stringify(verifiedAfterRetry.payload));

  const [stalePendingOrganization] = await db.insert(organizationsTable).values({
    name: `منشأة معلقة ${suffix}`,
    dataGeneration: 1,
    initializationStatus: "pending",
  }).returning();
  organizationIds.push(stalePendingOrganization.id);
  const pendingOverview = await request("/super-admin/overview", {
    cookie: adminCookie,
    forwardedFor: "203.0.113.222",
  });
  assert.equal(pendingOverview.response.status, 200, JSON.stringify(pendingOverview.payload));
  assert.ok(
    pendingOverview.payload.initializationFailures.some((item) => item.id === stalePendingOrganization.id),
    "يجب أن تظهر التهيئة المعلقة للمشرف حتى بعد انقطاع العملية",
  );
  const concurrentPendingRetries = await Promise.all([
    request(`/super-admin/organizations/${stalePendingOrganization.id}/initialization-retry`, {
      method: "POST",
      cookie: adminCookie,
      forwardedFor: "203.0.113.223",
    }),
    request(`/super-admin/organizations/${stalePendingOrganization.id}/initialization-retry`, {
      method: "POST",
      cookie: adminCookie,
      forwardedFor: "203.0.113.224",
    }),
  ]);
  assert.equal(concurrentPendingRetries[0].response.status, 200, JSON.stringify(concurrentPendingRetries[0].payload));
  assert.equal(concurrentPendingRetries[1].response.status, 200, JSON.stringify(concurrentPendingRetries[1].payload));
  const concurrentCreatedCounts = concurrentPendingRetries
    .map((retry) => retry.payload.created)
    .sort((left, right) => left - right);
  assert.equal(concurrentCreatedCounts[0], 0, "يجب ألا تنشئ المحاولة المتزامنة الثانية أي سجلات");
  assert.ok(concurrentCreatedCounts[1] > 0, "يجب أن تنشئ محاولة واحدة فقط مجموعة البذور");
  await assertInitializedOrganization(stalePendingOrganization.id, "إعادة تهيئة الحالة المعلقة");
});
