import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  erpRecordsTable,
  organizationsTable,
  pool,
  teamAuditLogsTable,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { hashPassword } from "../src/lib/team-auth.ts";

let server;
let origin;
let organizationId;
let ownerId;
let ownerCookie;
let memberCookie;
let dataGeneration;
let parent;
let branch;
let child;
let grandchild;
let journal;
let orphan;
let invalidParent;
let invalidAncestorParent;
let cycleA;
let cycleB;

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? {
        Cookie: cookie,
        "X-Wudooh-Data-Generation": String(dataGeneration),
      } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(?:^|,\s*)wudooh_session=([^;]+)/);
  return match ? `wudooh_session=${match[1]}` : null;
}

async function createRecord(tableName, data) {
  const [record] = await db.insert(erpRecordsTable).values({
    organizationId,
    tableName,
    data,
  }).returning();
  return record;
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.EMAIL_VERIFICATION_TEST_CODE = "654321";

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `hierarchy-owner-${suffix}@example.test`;
  const password = "Hierarchy-owner-test-123";
  const registered = await request("/auth/register", {
    method: "POST",
    body: {
      projectName: `منشأة اختبار إصلاح الشجرة ${suffix}`,
      name: "مالك اختبار إصلاح الشجرة",
      email,
      phone: `05${Date.now().toString().slice(-8)}`,
      password,
    },
  });
  assert.equal(registered.response.status, 202, JSON.stringify(registered.payload));

  const verified = await request("/auth/email-verification/verify", {
    method: "POST",
    body: { email, code: "654321" },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
  ownerCookie = cookieFrom(verified.response);
  assert.ok(ownerCookie);
  organizationId = Number(verified.payload.user.organizationId);
  ownerId = Number(verified.payload.user.id);
  dataGeneration = Number(verified.payload.user.dataGeneration);

  const memberPassword = "Hierarchy-member-test-123";
  const [member] = await db.insert(teamUsersTable).values({
    organizationId,
    email: `hierarchy-member-${suffix}@example.test`,
    name: "محاسب اختبار إصلاح الشجرة",
    passwordHash: await hashPassword(memberPassword),
    roleId: "accountant",
    permissions: { dashboard: true, accounting: true, reports: true },
    locationScope: "all",
    warehouseIds: [],
    status: "active",
    emailVerifiedAt: new Date(),
  }).returning();
  const memberLogin = await request("/auth/login", {
    method: "POST",
    body: { email: member.email, password: memberPassword },
  });
  assert.equal(memberLogin.response.status, 200, JSON.stringify(memberLogin.payload));
  memberCookie = cookieFrom(memberLogin.response);
  assert.ok(memberCookie);

  parent = await createRecord("accounts", {
    code: `T-${suffix}-1`, name: "أصل أب", type: "asset", openingBalance: 125, balance: 460, status: "active",
  });
  branch = await createRecord("accounts", {
    code: `T-${suffix}-2`, name: "فرع متعارض", type: "revenue", parent: String(parent.id),
    openingBalance: 20, balance: 315, status: "active",
  });
  child = await createRecord("accounts", {
    code: `T-${suffix}-3`, name: "ابن الفرع", type: "revenue", parent: String(branch.id),
    openingBalance: 30, balance: 205, status: "active",
  });
  grandchild = await createRecord("accounts", {
    code: `T-${suffix}-4`, name: "حفيد الفرع", type: "expense", parent: String(child.id),
    openingBalance: 40, balance: 95, status: "active",
  });
  journal = await createRecord("journalEntries", {
    number: `J-${suffix}`,
    date: "2026-09-08",
    description: "قيد يجب ألا يتغير أثناء إصلاح التصنيف",
    status: "posted",
    lines: [
      { accountId: String(branch.id), debit: 315, credit: 0 },
      { accountId: String(parent.id), debit: 0, credit: 315 },
    ],
  });
  orphan = await createRecord("accounts", {
    code: `T-${suffix}-5`, name: "حساب بأب مفقود", type: "asset", parent: "999999999",
    openingBalance: 12, balance: 44, status: "active",
  });
  invalidParent = await createRecord("accounts", {
    code: `T-${suffix}-8`, name: "حساب برابط أب مشوه", type: "asset", parent: "legacy-parent",
    openingBalance: 18, balance: 52, status: "active",
  });
  invalidAncestorParent = await createRecord("accounts", {
    code: `T-${suffix}-9`, name: "أب ذو مسار مشوه", type: "asset", parent: "01",
    openingBalance: 0, balance: 0, status: "active",
  });
  cycleA = await createRecord("accounts", {
    code: `T-${suffix}-6`, name: "طرف الدورة الأول", type: "asset",
    openingBalance: 0, balance: 0, status: "active",
  });
  cycleB = await createRecord("accounts", {
    code: `T-${suffix}-7`, name: "طرف الدورة الثاني", type: "liability", parent: String(cycleA.id),
    openingBalance: 0, balance: 0, status: "active",
  });
  await db.update(erpRecordsTable).set({
    data: { ...cycleA.data, parent: String(cycleB.id) },
  }).where(eq(erpRecordsTable.id, cycleA.id));
});

after(async () => {
  if (organizationId) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId));
  }
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await pool.end();
});

test("يحصر الفحص والإصلاح بالمالك ويتطلب التأكيد ويحافظ على القيود والأرصدة", async () => {
  const repairAuditLogs = () => db.select().from(teamAuditLogsTable).where(and(
    eq(teamAuditLogsTable.organizationId, organizationId),
    eq(teamAuditLogsTable.action, "account_hierarchy_repaired"),
  ));

  const memberIssues = await request("/accounting/account-hierarchy/issues", { cookie: memberCookie });
  assert.equal(memberIssues.response.status, 403);
  assert.match(memberIssues.payload.error, /مالك/);

  const memberRepair = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: memberCookie,
    body: { accountId: branch.id, confirmation: "MATCH_PARENT_TYPE" },
  });
  assert.equal(memberRepair.response.status, 403);
  assert.match(memberRepair.payload.error, /مالك/);
  assert.equal((await repairAuditLogs()).length, 0);

  const beforeRows = await db.select().from(erpRecordsTable).where(inArray(
    erpRecordsTable.id,
    [parent.id, branch.id, child.id, grandchild.id, journal.id],
  ));
  const beforeById = new Map(beforeRows.map((row) => [row.id, row.data]));

  const missingConfirmation = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: branch.id },
  });
  assert.equal(missingConfirmation.response.status, 400);
  assert.equal((await repairAuditLogs()).length, 0);

  const unchangedAfterRejection = await db.select().from(erpRecordsTable).where(inArray(
    erpRecordsTable.id,
    [branch.id, child.id, grandchild.id, journal.id],
  ));
  for (const row of unchangedAfterRejection) {
    assert.deepEqual(row.data, beforeById.get(row.id));
  }

  const issuesBefore = await request("/accounting/account-hierarchy/issues", { cookie: ownerCookie });
  assert.equal(issuesBefore.response.status, 200);
  assert.ok(issuesBefore.payload.issues.some((issue) => issue.accountId === branch.id));
  assert.ok(issuesBefore.payload.issues.some((issue) => issue.kind === "missing_parent" && issue.accountId === orphan.id));
  assert.ok(issuesBefore.payload.issues.some((issue) => issue.kind === "invalid_parent" && issue.accountId === invalidParent.id));
  assert.ok(issuesBefore.payload.issues.some((issue) => issue.kind === "invalid_parent" && issue.accountId === invalidAncestorParent.id));
  const [invalidParentBeforeRepair] = await db.select().from(erpRecordsTable).where(eq(erpRecordsTable.id, invalidParent.id));
  assert.equal(invalidParentBeforeRepair.data.parent, "legacy-parent");
  const cycleIssue = issuesBefore.payload.issues.find((issue) => issue.kind === "cycle");
  assert.deepEqual([...cycleIssue.cycleAccountIds].sort((a, b) => a - b), [cycleA.id, cycleB.id].sort((a, b) => a - b));

  const invalidMove = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: orphan.id, parentId: branch.id, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(invalidMove.response.status, 409);
  assert.match(invalidMove.payload.error, /التصنيف/);

  const invalidMalformedMove = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: invalidParent.id, parentId: branch.id, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(invalidMalformedMove.response.status, 409);
  assert.match(invalidMalformedMove.payload.error, /التصنيف/);

  const moveUnderMalformedAncestry = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: invalidParent.id, parentId: invalidAncestorParent.id, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(moveUnderMalformedAncestry.response.status, 409);
  assert.match(moveUnderMalformedAncestry.payload.error, /غير صالح/);
  const [invalidParentAfterRejectedMove] = await db.select().from(erpRecordsTable).where(eq(erpRecordsTable.id, invalidParent.id));
  assert.equal(invalidParentAfterRejectedMove.data.parent, "legacy-parent");

  const detachedInvalidParent = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: invalidParent.id, parentId: null, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(detachedInvalidParent.response.status, 200, JSON.stringify(detachedInvalidParent.payload));
  assert.equal(detachedInvalidParent.payload.parentId, null);

  const detachedOrphan = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: orphan.id, parentId: null, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(detachedOrphan.response.status, 200, JSON.stringify(detachedOrphan.payload));
  assert.equal(detachedOrphan.payload.parentId, null);

  const movedCycleAccount = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: cycleA.id, parentId: parent.id, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(movedCycleAccount.response.status, 200, JSON.stringify(movedCycleAccount.payload));
  assert.equal(movedCycleAccount.payload.parentId, parent.id);

  const auditDetailsFor = async (account) => {
    const logs = (await repairAuditLogs()).filter((log) => log.entity === String(account.id));
    assert.equal(logs.length, 1);
    return JSON.parse(logs[0].details);
  };
  assert.deepEqual(await auditDetailsFor(orphan), {
    issueKind: "missing_parent",
    repairType: "detach",
    oldParentId: 999999999,
    newParentId: null,
  });
  assert.deepEqual(await auditDetailsFor(cycleA), {
    issueKind: "cycle",
    repairType: "reparent",
    oldParentId: cycleB.id,
    newParentId: parent.id,
  });

  const issuesAfterBreakingCycle = await request("/accounting/account-hierarchy/issues", { cookie: ownerCookie });
  assert.ok(!issuesAfterBreakingCycle.payload.issues.some((issue) => issue.kind === "cycle" && issue.cycleAccountIds.some(
    (accountId) => [cycleA.id, cycleB.id].includes(accountId),
  )));
  assert.ok(issuesAfterBreakingCycle.payload.issues.some(
    (issue) => issue.kind === "type_mismatch" && issue.accountId === cycleB.id,
  ));

  const repairedCycleMismatch = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: cycleB.id, confirmation: "MATCH_PARENT_TYPE" },
  });
  assert.equal(repairedCycleMismatch.response.status, 200, JSON.stringify(repairedCycleMismatch.payload));
  assert.equal(repairedCycleMismatch.payload.targetType, "asset");

  const repaired = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: branch.id, confirmation: "MATCH_PARENT_TYPE" },
  });
  assert.equal(repaired.response.status, 200, JSON.stringify(repaired.payload));
  assert.deepEqual(
    [...repaired.payload.repairedAccountIds].sort((a, b) => a - b),
    [branch.id, child.id, grandchild.id].sort((a, b) => a - b),
  );
  assert.equal(repaired.payload.targetType, "asset");

  const branchRepairAuditLogs = (await repairAuditLogs()).filter((log) => log.entity === String(branch.id));
  assert.equal(branchRepairAuditLogs.length, 1);
  assert.equal(branchRepairAuditLogs[0].organizationId, organizationId);
  assert.equal(branchRepairAuditLogs[0].actorId, ownerId);
  assert.equal(branchRepairAuditLogs[0].action, "account_hierarchy_repaired");
  assert.deepEqual(JSON.parse(branchRepairAuditLogs[0].details), {
    issueKind: "type_mismatch",
    repairType: "match_parent_type",
    oldParentId: parent.id,
    newParentId: parent.id,
  });

  const replayedRepair = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: branch.id, confirmation: "MATCH_PARENT_TYPE" },
  });
  assert.equal(replayedRepair.response.status, 200, JSON.stringify(replayedRepair.payload));
  assert.deepEqual(replayedRepair.payload.repairedAccountIds, []);
  assert.equal(
    (await repairAuditLogs()).filter((log) => log.entity === String(branch.id)).length,
    1,
  );

  const repairedRows = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, organizationId),
    inArray(erpRecordsTable.id, [parent.id, branch.id, child.id, grandchild.id, journal.id]),
  ));
  const repairedById = new Map(repairedRows.map((row) => [row.id, row.data]));
  for (const account of [branch, child, grandchild]) {
    assert.equal(repairedById.get(account.id).type, "asset");
    assert.equal(repairedById.get(account.id).openingBalance, beforeById.get(account.id).openingBalance);
    assert.equal(repairedById.get(account.id).balance, beforeById.get(account.id).balance);
  }
  assert.deepEqual(repairedById.get(parent.id), beforeById.get(parent.id));
  assert.deepEqual(repairedById.get(journal.id), beforeById.get(journal.id));

  const issuesAfter = await request("/accounting/account-hierarchy/issues", { cookie: ownerCookie });
  assert.equal(issuesAfter.response.status, 200);
  assert.ok(!issuesAfter.payload.issues.some(
    (issue) => [branch.id, child.id, grandchild.id].includes(issue.accountId),
  ));
  assert.ok(!issuesAfter.payload.issues.some((issue) => issue.kind === "missing_parent" && issue.accountId === orphan.id));
  assert.ok(!issuesAfter.payload.issues.some((issue) => issue.kind === "invalid_parent" && issue.accountId === invalidParent.id));
  assert.ok(!issuesAfter.payload.issues.some((issue) => issue.kind === "cycle" && issue.cycleAccountIds.some(
    (accountId) => [cycleA.id, cycleB.id].includes(accountId),
  )));
  assert.ok(!issuesAfter.payload.issues.some(
    (issue) => issue.kind === "type_mismatch" && [cycleA.id, cycleB.id].includes(issue.accountId),
  ));
});