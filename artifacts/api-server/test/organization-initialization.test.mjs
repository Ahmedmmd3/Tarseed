import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test, { after, before } from "node:test";
import { and, eq } from "drizzle-orm";
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
import { DEMO_SEED_KEY, seedDemoData } from "../src/lib/seed-demo-data.ts";
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