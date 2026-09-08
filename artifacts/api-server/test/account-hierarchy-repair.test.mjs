import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  erpRecordsTable,
  organizationsTable,
  pool,
  teamAuditLogsTable,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { findAccountHierarchyIssues } from "../src/lib/account-hierarchy.ts";
import { hashPassword } from "../src/lib/team-auth.ts";

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffleWithRandom(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function referenceCycleKeys(rows) {
  const parents = new Map(rows.map((row) => [
    row.id,
    typeof row.data.parent === "string" && /^[1-9]\d*$/.test(row.data.parent)
      ? Number(row.data.parent)
      : null,
  ]));
  const cycles = new Set();

  for (const startId of parents.keys()) {
    const visitedAt = new Map();
    const path = [];
    let cursor = startId;
    while (cursor !== null && parents.has(cursor) && !visitedAt.has(cursor)) {
      visitedAt.set(cursor, path.length);
      path.push(cursor);
      cursor = parents.get(cursor);
    }
    if (cursor !== null && visitedAt.has(cursor)) {
      const cycle = path.slice(visitedAt.get(cursor)).sort((left, right) => left - right);
      cycles.add(cycle.join(","));
    }
  }

  return [...cycles].sort();
}

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

test("يفحص المنطق المشترك الأب النشط والتصنيف والدورات من اللقطة نفسها", () => {
  const rows = [
    { id: 1, data: { code: "1000", name: "أب موقوف", type: "asset", status: "inactive", parent: null } },
    { id: 2, data: { code: "1100", name: "فرع نشط", type: "asset", status: "active", parent: "1" } },
    { id: 3, data: { code: "2000", name: "تصنيف مختلف", type: "liability", status: "active", parent: "2" } },
    { id: 4, data: { code: "1200", name: "دورة أولى", type: "asset", status: "active", parent: "5" } },
    { id: 5, data: { code: "1210", name: "دورة ثانية", type: "asset", status: "active", parent: "4" } },
  ];

  const issues = findAccountHierarchyIssues(rows);
  assert.ok(issues.some((issue) => issue.kind === "inactive_parent" && issue.accountId === 2));
  assert.ok(issues.some((issue) => issue.kind === "type_mismatch" && issue.accountId === 3));
  assert.ok(issues.some((issue) => issue.kind === "cycle"
    && [...issue.cycleAccountIds].sort((left, right) => left - right).join(",") === "4,5"));
});

test("يثبت ترتيب البلاغات عند تغير ترتيب صفوف الحسابات", () => {
  const rows = [
    { id: 30, data: { code: "30", name: "أب موقوف", type: "asset", status: "inactive", parent: null } },
    { id: 20, data: { code: "20", name: "أب مختلف", type: "liability", status: "active", parent: null } },
    { id: 10, data: { code: "10", name: "مشكلتان", type: "asset", status: "active", parent: "20" } },
    { id: 40, data: { code: "40", name: "تحت أب موقوف", type: "asset", status: "active", parent: "30" } },
    { id: 50, data: { code: "50", name: "أب مفقود", type: "asset", status: "active", parent: "999" } },
    { id: 60, data: { code: "60", name: "رابط مشوه", type: "asset", status: "active", parent: "legacy" } },
    { id: 70, data: { code: "70", name: "دورة", type: "asset", status: "active", parent: "70" } },
  ];
  const issueOrder = (orderedRows) => findAccountHierarchyIssues(orderedRows)
    .map((issue) => `${issue.accountId}:${issue.kind}`);
  const expectedOrder = [
    "10:type_mismatch",
    "40:inactive_parent",
    "50:missing_parent",
    "60:invalid_parent",
    "70:cycle",
  ];

  assert.deepEqual(issueOrder(rows), expectedOrder);
  assert.deepEqual(issueOrder([...rows].reverse()), expectedOrder);
});

test("يعرض الحساب الذي يشير إلى نفسه كدورة واحدة قابلة للفصل", { timeout: 500 }, () => {
  const selfParentId = 2;
  const rows = [
    {
      id: 1,
      data: {
        code: "SELF-ROOT",
        name: "حساب مستقل",
        type: "asset",
        status: "active",
        parent: null,
      },
    },
    {
      id: selfParentId,
      data: {
        code: "SELF-CYCLE",
        name: "حساب يشير إلى نفسه",
        type: "asset",
        status: "active",
        parent: String(selfParentId),
      },
    },
    {
      id: 3,
      data: {
        code: "SELF-OTHER",
        name: "حساب مرتبط مستقل",
        type: "asset",
        status: "active",
        parent: "1",
      },
    },
  ];
  const unchangedParents = new Map(rows.map((row) => [row.id, row.data.parent]));

  const cycleIssues = findAccountHierarchyIssues(rows).filter((issue) => issue.kind === "cycle");

  assert.equal(cycleIssues.length, 1, "يجب الإبلاغ عن الدورة الذاتية مرة واحدة فقط");
  assert.equal(cycleIssues[0].accountId, selfParentId);
  assert.deepEqual(cycleIssues[0].cycleAccountIds, [selfParentId]);
  assert.deepEqual(
    cycleIssues[0].cycleAccounts.map((account) => account.accountId),
    [selfParentId],
  );

  rows[1] = {
    ...rows[1],
    data: { ...rows[1].data, parent: null },
  };

  assert.ok(!findAccountHierarchyIssues(rows).some((issue) => issue.kind === "cycle"));
  assert.equal(rows[1].data.parent, null);
  assert.equal(rows[0].data.parent, unchangedParents.get(1));
  assert.equal(rows[2].data.parent, unchangedParents.get(3));
});

test("يكتشف دورة شديدة الطول مرة واحدة ويكسرها دون تغيير بقية الروابط", { timeout: 1_500 }, () => {
  const cycleSize = 5_000;
  const rows = Array.from({ length: cycleSize }, (_, index) => ({
    id: index + 1,
    data: {
      code: `LONG-${index + 1}`,
      name: `حساب الدورة الطويلة ${index + 1}`,
      type: "asset",
      status: "active",
      parent: String(index === cycleSize - 1 ? 1 : index + 2),
    },
  }));
  const originalParents = new Map(rows.map((row) => [row.id, row.data.parent]));

  const issuesBeforeRepair = findAccountHierarchyIssues(rows);
  const cycleIssues = issuesBeforeRepair.filter((issue) => issue.kind === "cycle");
  assert.equal(cycleIssues.length, 1, "يجب الإبلاغ عن الدورة الطويلة مرة واحدة فقط");
  assert.equal(cycleIssues[0].cycleAccountIds.length, cycleSize);
  assert.equal(new Set(cycleIssues[0].cycleAccountIds).size, cycleSize);
  assert.deepEqual(
    [...cycleIssues[0].cycleAccountIds].sort((left, right) => left - right),
    Array.from({ length: cycleSize }, (_, index) => index + 1),
  );

  rows[cycleSize - 1] = {
    ...rows[cycleSize - 1],
    data: { ...rows[cycleSize - 1].data, parent: null },
  };

  assert.ok(!findAccountHierarchyIssues(rows).some((issue) => issue.kind === "cycle"));
  assert.equal(rows[cycleSize - 1].data.parent, null);
  for (const row of rows.slice(0, -1)) {
    assert.equal(
      row.data.parent,
      originalParents.get(row.id),
      `يجب ألا يتغير رابط الحساب ${row.id} عند كسر طرف واحد`,
    );
  }
});

test("لا يكرر بلاغ الدورة عند اتصال سلاسل طويلة كثيرة بها", { timeout: 1_500 }, () => {
  const cycleAccountIds = [1, 2, 3];
  const rows = cycleAccountIds.map((id, index) => ({
    id,
    data: {
      code: `SHARED-CYCLE-${id}`,
      name: `طرف الدورة المشتركة ${id}`,
      type: "asset",
      status: "active",
      parent: String(cycleAccountIds[(index + 1) % cycleAccountIds.length]),
    },
  }));
  const branchCount = 200;
  const branchLength = 50;
  const branchAccountIds = [];
  let nextId = cycleAccountIds.length + 1;

  for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
    let parentId = cycleAccountIds[branchIndex % cycleAccountIds.length];
    const branchRows = [];
    for (let depth = 0; depth < branchLength; depth += 1) {
      const id = nextId;
      nextId += 1;
      branchAccountIds.push(id);
      branchRows.push({
        id,
        data: {
          code: `SHARED-BRANCH-${branchIndex + 1}-${depth + 1}`,
          name: `حساب خارج الدورة ${branchIndex + 1}-${depth + 1}`,
          type: "asset",
          status: "active",
          parent: String(parentId),
        },
      });
      parentId = id;
    }
    rows.unshift(...branchRows.reverse());
  }

  const cycleIssues = findAccountHierarchyIssues(rows).filter((issue) => issue.kind === "cycle");

  assert.equal(cycleIssues.length, 1, "يجب الإبلاغ عن الدورة المشتركة مرة واحدة فقط");
  assert.deepEqual(
    [...cycleIssues[0].cycleAccountIds].sort((left, right) => left - right),
    cycleAccountIds,
  );
  assert.ok(
    cycleIssues[0].cycleAccountIds.every((accountId) => !branchAccountIds.includes(accountId)),
    "يجب ألا تُحسب حسابات السلاسل المؤدية إلى الدورة ضمن أعضاء الدورة",
  );
});

test("يفصل بلاغات عدة دورات مع سلاسل تتجه إلى كل دورة", { timeout: 1_500 }, () => {
  const expectedCycles = [
    [1, 2],
    [3, 4, 5],
    [6, 7, 8, 9],
  ];
  const rows = expectedCycles.flatMap((cycleAccountIds, cycleIndex) => (
    cycleAccountIds.map((id, accountIndex) => ({
      id,
      data: {
        code: `SEPARATE-CYCLE-${cycleIndex + 1}-${accountIndex + 1}`,
        name: `طرف الدورة المنفصلة ${cycleIndex + 1}-${accountIndex + 1}`,
        type: "asset",
        status: "active",
        parent: String(cycleAccountIds[(accountIndex + 1) % cycleAccountIds.length]),
      },
    }))
  ));
  const chainAccountIds = new Set();
  let nextId = 10;

  for (let cycleIndex = 0; cycleIndex < expectedCycles.length; cycleIndex += 1) {
    for (let chainIndex = 0; chainIndex < 80; chainIndex += 1) {
      let parentId = expectedCycles[cycleIndex][chainIndex % expectedCycles[cycleIndex].length];
      const chainRows = [];
      for (let depth = 0; depth < 30; depth += 1) {
        const id = nextId;
        nextId += 1;
        chainAccountIds.add(id);
        chainRows.push({
          id,
          data: {
            code: `SEPARATE-CHAIN-${cycleIndex + 1}-${chainIndex + 1}-${depth + 1}`,
            name: `حساب سلسلة الدورة ${cycleIndex + 1}-${chainIndex + 1}-${depth + 1}`,
            type: "asset",
            status: "active",
            parent: String(parentId),
          },
        });
        parentId = id;
      }
      rows.unshift(...chainRows.reverse());
    }
  }

  const cycleIssues = findAccountHierarchyIssues(rows).filter((issue) => issue.kind === "cycle");
  const actualCycleKeys = cycleIssues.map((issue) => (
    [...issue.cycleAccountIds].sort((left, right) => left - right).join(",")
  )).sort();
  const expectedCycleKeys = expectedCycles.map((cycle) => [...cycle].sort(
    (left, right) => left - right,
  ).join(",")).sort();

  assert.equal(cycleIssues.length, expectedCycles.length, "يجب إرجاع بلاغ واحد لكل دورة منفصلة");
  assert.deepEqual(actualCycleKeys, expectedCycleKeys, "يجب ألا تندمج أعضاء الدورات أو تسقط دورة");
  assert.ok(
    cycleIssues.every((issue) => issue.cycleAccountIds.every(
      (accountId) => !chainAccountIds.has(accountId),
    )),
    "يجب ألا تدخل حسابات السلاسل ضمن أعضاء أي دورة",
  );
});

test("يطابق مرجعاً مستقلاً مهما تغير ترتيب صفوف رسوم الأبوة", { timeout: 1_000 }, () => {
  const random = createSeededRandom(0x20_08_20_26);

  for (let caseIndex = 0; caseIndex < 80; caseIndex += 1) {
    const accountCount = 12 + Math.floor(random() * 29);
    const parentById = new Map([
      [1, null],
      [2, 2],
      [3, 4],
      [4, 3],
      [5, 3],
      [6, 5],
      [7, 8],
      [8, 9],
      [9, 7],
    ]);
    for (let id = 10; id <= accountCount; id += 1) {
      parentById.set(id, random() < 0.22 ? null : 1 + Math.floor(random() * accountCount));
    }

    const rows = [...parentById].map(([id, parentId]) => ({
      id,
      data: {
        code: `GENERATED-${caseIndex}-${id}`,
        name: `حساب مولد ${caseIndex}-${id}`,
        type: "asset",
        status: "active",
        parent: parentId === null ? null : String(parentId),
      },
    }));
    const expectedCycleKeys = referenceCycleKeys(rows);
    const expectedCycleMembers = new Set(expectedCycleKeys.flatMap(
      (cycleKey) => cycleKey.split(",").map(Number),
    ));
    const shuffledOnce = [...rows];
    const shuffledTwice = [...rows];
    shuffleWithRandom(shuffledOnce, createSeededRandom(0xA11C_E000 + caseIndex));
    shuffleWithRandom(shuffledTwice, createSeededRandom(0xC1C1_E000 + caseIndex));
    const orderings = [rows, [...rows].reverse(), shuffledOnce, shuffledTwice];

    for (const [orderingIndex, orderedRows] of orderings.entries()) {
      const cycleIssues = findAccountHierarchyIssues(orderedRows)
        .filter((issue) => issue.kind === "cycle");
      const actualCycleKeys = cycleIssues.map((issue) => (
        [...issue.cycleAccountIds].sort((left, right) => left - right).join(",")
      )).sort();
      const context = `الحالة ${caseIndex} والترتيب ${orderingIndex}`;

      assert.deepEqual(
        actualCycleKeys,
        expectedCycleKeys,
        `يجب ثبات أعضاء دورات المرجع في ${context}`,
      );
      assert.equal(
        cycleIssues.length,
        expectedCycleKeys.length,
        `يجب ثبات عدد بلاغات الدورات في ${context}`,
      );
      assert.equal(
        new Set(actualCycleKeys).size,
        cycleIssues.length,
        `يجب إرجاع بلاغ واحد فقط لكل دورة في ${context}`,
      );
      assert.ok(
        cycleIssues.every((issue) => issue.cycleAccountIds.every(
          (accountId) => expectedCycleMembers.has(accountId),
        )),
        `يجب ألا تدخل السلاسل المؤدية إلى الدورات في ${context}`,
      );
    }
  }
});

let invalidAncestorParent;
let cycleA;
let cycleB;
let longCycleA;
let longCycleB;
let longCycleC;
let selfCycle;

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
  const inactiveParent = await createRecord("accounts", {
    code: `T-${suffix}-10`, name: "أب موقوف", type: "asset",
    openingBalance: 0, balance: 0, status: "inactive",
  });
  await createRecord("accounts", {
    code: `T-${suffix}-11`, name: "فرع نشط تحت أب موقوف", type: "asset", parent: String(inactiveParent.id),
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
  longCycleA = await createRecord("accounts", {
    code: `T-${suffix}-12`, name: "طرف الدورة الطويلة الأول", type: "asset",
    openingBalance: 0, balance: 0, status: "active",
  });
  longCycleB = await createRecord("accounts", {
    code: `T-${suffix}-13`, name: "طرف الدورة الطويلة الثاني", type: "asset", parent: String(longCycleA.id),
    openingBalance: 0, balance: 0, status: "active",
  });
  longCycleC = await createRecord("accounts", {
    code: `T-${suffix}-14`, name: "طرف الدورة الطويلة الثالث", type: "asset", parent: String(longCycleB.id),
    openingBalance: 0, balance: 0, status: "active",
  });
  await db.update(erpRecordsTable).set({
    data: { ...longCycleA.data, parent: String(longCycleC.id) },
  }).where(eq(erpRecordsTable.id, longCycleA.id));
  selfCycle = await createRecord("accounts", {
    code: `T-${suffix}-15`, name: "حساب بدورة ذاتية", type: "asset",
    openingBalance: 0, balance: 0, status: "active",
  });
  selfCycle = {
    ...selfCycle,
    data: { ...selfCycle.data, parent: String(selfCycle.id) },
  };
  await db.update(erpRecordsTable).set({
    data: selfCycle.data,
  }).where(eq(erpRecordsTable.id, selfCycle.id));
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

  const rollbackParent = await createRecord("accounts", {
    code: `ROLLBACK-${randomUUID().slice(0, 8)}-1`,
    name: "أب اختبار ذرية سجل الإصلاح",
    type: "asset",
    status: "active",
  });
  const rollbackAccount = await createRecord("accounts", {
    code: `ROLLBACK-${randomUUID().slice(0, 8)}-2`,
    name: "حساب اختبار ذرية سجل الإصلاح",
    type: "expense",
    parent: String(rollbackParent.id),
    status: "active",
  });
  const auditFailureFunction = `fail_hierarchy_repair_audit_${randomUUID().replaceAll("-", "")}`;
  const auditFailureTrigger = `${auditFailureFunction}_trigger`;
  try {
    await db.execute(sql.raw(`
      CREATE FUNCTION ${auditFailureFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.organization_id = ${organizationId}
          AND NEW.action = 'account_hierarchy_repaired'
          AND NEW.entity = '${rollbackAccount.id}' THEN
          RAISE EXCEPTION 'تعذر سجل تدقيق الإصلاح عمداً';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${auditFailureTrigger}
      BEFORE INSERT ON team_audit_logs
      FOR EACH ROW EXECUTE FUNCTION ${auditFailureFunction}();
    `));

    const failedRepair = await request("/accounting/account-hierarchy/repair", {
      method: "POST",
      cookie: ownerCookie,
      body: { accountId: rollbackAccount.id, confirmation: "MATCH_PARENT_TYPE" },
    });
    assert.equal(failedRepair.response.status, 500);

    const [accountAfterAuditFailure] = await db.select().from(erpRecordsTable)
      .where(eq(erpRecordsTable.id, rollbackAccount.id));
    assert.equal(accountAfterAuditFailure.data.parent, String(rollbackParent.id));
    assert.equal(accountAfterAuditFailure.data.type, "expense");
    assert.equal(
      (await repairAuditLogs()).filter((log) => log.entity === String(rollbackAccount.id)).length,
      0,
      "لا يجب حفظ سجل إصلاح جزئي عند فشل المعاملة",
    );
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${auditFailureTrigger} ON team_audit_logs`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${auditFailureFunction}()`));
  }

  const reparentAuditFailureFunction = `fail_hierarchy_reparent_audit_${randomUUID().replaceAll("-", "")}`;
  const reparentAuditFailureTrigger = `${reparentAuditFailureFunction}_trigger`;
  try {
    await db.execute(sql.raw(`
      CREATE FUNCTION ${reparentAuditFailureFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.organization_id = ${organizationId}
          AND NEW.action = 'account_hierarchy_repaired'
          AND NEW.entity = '${orphan.id}' THEN
          RAISE EXCEPTION 'تعذر سجل تدقيق نقل الحساب عمداً';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${reparentAuditFailureTrigger}
      BEFORE INSERT ON team_audit_logs
      FOR EACH ROW EXECUTE FUNCTION ${reparentAuditFailureFunction}();
    `));

    const failedReparent = await request("/accounting/account-hierarchy/repair", {
      method: "POST",
      cookie: ownerCookie,
      body: { accountId: orphan.id, parentId: parent.id, confirmation: "REPARENT_ACCOUNT" },
    });
    assert.equal(failedReparent.response.status, 500);

    const [accountAfterReparentAuditFailure] = await db.select().from(erpRecordsTable)
      .where(eq(erpRecordsTable.id, orphan.id));
    assert.equal(
      accountAfterReparentAuditFailure.data.parent,
      "999999999",
      "يجب أن يبقى رابط الأب القديم عند فشل سجل تدقيق النقل",
    );
    assert.equal(
      (await repairAuditLogs()).filter((log) => log.entity === String(orphan.id)).length,
      0,
      "لا يجب حفظ سجل إصلاح جزئي عند فشل نقل الحساب",
    );
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${reparentAuditFailureTrigger} ON team_audit_logs`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${reparentAuditFailureFunction}()`));
  }

  const detachAuditFailureFunction = `fail_hierarchy_detach_audit_${randomUUID().replaceAll("-", "")}`;
  const detachAuditFailureTrigger = `${detachAuditFailureFunction}_trigger`;
  try {
    await db.execute(sql.raw(`
      CREATE FUNCTION ${detachAuditFailureFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.organization_id = ${organizationId}
          AND NEW.action = 'account_hierarchy_repaired'
          AND NEW.entity = '${invalidParent.id}' THEN
          RAISE EXCEPTION 'تعذر سجل تدقيق فصل الحساب عمداً';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${detachAuditFailureTrigger}
      BEFORE INSERT ON team_audit_logs
      FOR EACH ROW EXECUTE FUNCTION ${detachAuditFailureFunction}();
    `));

    const failedDetach = await request("/accounting/account-hierarchy/repair", {
      method: "POST",
      cookie: ownerCookie,
      body: { accountId: invalidParent.id, parentId: null, confirmation: "REPARENT_ACCOUNT" },
    });
    assert.equal(failedDetach.response.status, 500);

    const [accountAfterDetachAuditFailure] = await db.select().from(erpRecordsTable)
      .where(eq(erpRecordsTable.id, invalidParent.id));
    assert.equal(
      accountAfterDetachAuditFailure.data.parent,
      "legacy-parent",
      "يجب أن يبقى رابط الأب التالف القديم عند فشل سجل تدقيق الفصل",
    );
    assert.equal(
      (await repairAuditLogs()).filter((log) => log.entity === String(invalidParent.id)).length,
      0,
      "لا يجب حفظ سجل إصلاح جزئي عند فشل فصل الحساب",
    );
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${detachAuditFailureTrigger} ON team_audit_logs`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${detachAuditFailureFunction}()`));
  }

  const cycleDetachAuditFailureFunction = `fail_hierarchy_cycle_detach_audit_${randomUUID().replaceAll("-", "")}`;
  const cycleDetachAuditFailureTrigger = `${cycleDetachAuditFailureFunction}_trigger`;
  try {
    await db.execute(sql.raw(`
      CREATE FUNCTION ${cycleDetachAuditFailureFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.organization_id = ${organizationId}
          AND NEW.action = 'account_hierarchy_repaired'
          AND NEW.entity = '${cycleA.id}' THEN
          RAISE EXCEPTION 'تعذر سجل تدقيق فصل طرف الدورة عمداً';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER ${cycleDetachAuditFailureTrigger}
      BEFORE INSERT ON team_audit_logs
      FOR EACH ROW EXECUTE FUNCTION ${cycleDetachAuditFailureFunction}();
    `));

    const failedCycleDetach = await request("/accounting/account-hierarchy/repair", {
      method: "POST",
      cookie: ownerCookie,
      body: { accountId: cycleA.id, parentId: null, confirmation: "REPARENT_ACCOUNT" },
    });
    assert.equal(failedCycleDetach.response.status, 500);

    const cycleAfterAuditFailure = await db.select().from(erpRecordsTable).where(inArray(
      erpRecordsTable.id,
      [cycleA.id, cycleB.id],
    ));
    const cycleAfterAuditFailureById = new Map(cycleAfterAuditFailure.map((row) => [row.id, row.data]));
    assert.equal(
      cycleAfterAuditFailureById.get(cycleA.id).parent,
      String(cycleB.id),
      "يجب أن يبقى رابط طرف الدورة الأول عند فشل سجل تدقيق الفصل",
    );
    assert.equal(
      cycleAfterAuditFailureById.get(cycleB.id).parent,
      String(cycleA.id),
      "يجب أن يبقى رابط طرف الدورة الثاني عند فشل سجل تدقيق الفصل",
    );
    assert.ok(
      findAccountHierarchyIssues(cycleAfterAuditFailure).some((issue) => issue.kind === "cycle"
        && issue.cycleAccountIds.includes(cycleA.id)
        && issue.cycleAccountIds.includes(cycleB.id)),
      "يجب أن تبقى الدورة كما هي عند فشل سجل تدقيق الفصل",
    );
    assert.equal(
      (await repairAuditLogs()).filter((log) => log.entity === String(cycleA.id)).length,
      0,
      "لا يجب حفظ سجل إصلاح جزئي عند فشل فصل طرف الدورة",
    );
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${cycleDetachAuditFailureTrigger} ON team_audit_logs`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${cycleDetachAuditFailureFunction}()`));
  }

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
  assert.ok(!issuesBefore.payload.issues.some((issue) => issue.kind === "inactive_parent"));
  const [invalidParentBeforeRepair] = await db.select().from(erpRecordsTable).where(eq(erpRecordsTable.id, invalidParent.id));
  assert.equal(invalidParentBeforeRepair.data.parent, "legacy-parent");
  const cycleIssue = issuesBefore.payload.issues.find((issue) => issue.kind === "cycle"
    && issue.cycleAccountIds.includes(cycleA.id));
  assert.deepEqual([...cycleIssue.cycleAccountIds].sort((a, b) => a - b), [cycleA.id, cycleB.id].sort((a, b) => a - b));
  const longCycleIssue = issuesBefore.payload.issues.find((issue) => issue.kind === "cycle"
    && issue.cycleAccountIds.includes(longCycleA.id));
  assert.deepEqual(
    [...longCycleIssue.cycleAccountIds].sort((a, b) => a - b),
    [longCycleA.id, longCycleB.id, longCycleC.id].sort((a, b) => a - b),
  );
  const selfCycleIssues = issuesBefore.payload.issues.filter((issue) => issue.kind === "cycle"
    && issue.cycleAccountIds.includes(selfCycle.id));
  assert.equal(selfCycleIssues.length, 1, "يجب أن تعرض الواجهة بلاغاً واحداً للدورة الذاتية");
  assert.deepEqual(selfCycleIssues[0].cycleAccountIds, [selfCycle.id]);
  assert.deepEqual(
    selfCycleIssues[0].cycleAccounts.map((account) => account.accountId),
    [selfCycle.id],
  );

  const unrelatedParentsBeforeSelfRepair = new Map(
    [parent, branch, child].map((account) => [account.id, account.data.parent ?? null]),
  );
  const repairedSelfCycle = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: selfCycle.id, parentId: null, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(repairedSelfCycle.response.status, 200, JSON.stringify(repairedSelfCycle.payload));
  assert.equal(repairedSelfCycle.payload.parentId, null);

  const rowsAfterSelfRepair = await db.select().from(erpRecordsTable).where(inArray(
    erpRecordsTable.id,
    [selfCycle.id, parent.id, branch.id, child.id],
  ));
  const rowsAfterSelfRepairById = new Map(rowsAfterSelfRepair.map((row) => [row.id, row.data]));
  assert.equal(rowsAfterSelfRepairById.get(selfCycle.id).parent, null);
  for (const [accountId, expectedParent] of unrelatedParentsBeforeSelfRepair) {
    assert.equal(
      rowsAfterSelfRepairById.get(accountId).parent ?? null,
      expectedParent,
      `يجب ألا يتغير رابط الحساب ${accountId} عند إصلاح الدورة الذاتية`,
    );
  }
  const issuesAfterSelfRepair = await request("/accounting/account-hierarchy/issues", { cookie: ownerCookie });
  assert.equal(issuesAfterSelfRepair.response.status, 200);
  assert.ok(!issuesAfterSelfRepair.payload.issues.some((issue) => issue.kind === "cycle"
    && issue.cycleAccountIds.includes(selfCycle.id)));

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
  assert.deepEqual(await auditDetailsFor(selfCycle), {
    issueKind: "cycle",
    repairType: "detach",
    oldParentId: selfCycle.id,
    newParentId: null,
  });

  const repairedLongCycle = await request("/accounting/account-hierarchy/repair", {
    method: "POST",
    cookie: ownerCookie,
    body: { accountId: longCycleA.id, parentId: parent.id, confirmation: "REPARENT_ACCOUNT" },
  });
  assert.equal(repairedLongCycle.response.status, 200, JSON.stringify(repairedLongCycle.payload));
  assert.equal(repairedLongCycle.payload.parentId, parent.id);

  const longCycleRowsAfterRepair = await db.select().from(erpRecordsTable).where(inArray(
    erpRecordsTable.id,
    [longCycleA.id, longCycleB.id, longCycleC.id],
  ));
  const longCycleAfterRepairById = new Map(longCycleRowsAfterRepair.map((row) => [row.id, row.data]));
  assert.equal(longCycleAfterRepairById.get(longCycleA.id).parent, String(parent.id));
  assert.equal(
    longCycleAfterRepairById.get(longCycleB.id).parent,
    String(longCycleA.id),
    "يجب أن يبقى رابط الطرف الثاني غير المعدل كما هو",
  );
  assert.equal(
    longCycleAfterRepairById.get(longCycleC.id).parent,
    String(longCycleB.id),
    "يجب أن يبقى رابط الطرف الثالث غير المعدل كما هو",
  );
  assert.ok(!findAccountHierarchyIssues(longCycleRowsAfterRepair).some((issue) => issue.kind === "cycle"));
  assert.deepEqual(await auditDetailsFor(longCycleA), {
    issueKind: "cycle",
    repairType: "reparent",
    oldParentId: longCycleC.id,
    newParentId: parent.id,
  });

  const issuesAfterBreakingCycle = await request("/accounting/account-hierarchy/issues", { cookie: ownerCookie });
  assert.ok(!issuesAfterBreakingCycle.payload.issues.some((issue) => issue.kind === "cycle" && issue.cycleAccountIds.some(
    (accountId) => [cycleA.id, cycleB.id].includes(accountId),
  )));
  assert.ok(!issuesAfterBreakingCycle.payload.issues.some((issue) => issue.kind === "cycle" && issue.cycleAccountIds.some(
    (accountId) => [longCycleA.id, longCycleB.id, longCycleC.id].includes(accountId),
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