import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { pool } from "@workspace/db";
import app from "../src/app.ts";

let server;
let origin;
const generationByCookie = new Map();

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "يجب أن ينشئ الخادم جلسة مستقلة للعميل");
  return cookie.split(";")[0];
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const generation = generationByCookie.get(cookie);
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(Number.isSafeInteger(generation) ? { "X-Wudooh-Data-Generation": String(generation) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function registerOwner() {
  const email = `${unique("account-init")}@example.test`;
  const password = "Safe-test-password-123";
  const phone = `05${crypto.randomUUID().replaceAll(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const registration = await request("/auth/register", {
    method: "POST",
    body: {
      projectName: unique("منشأة دليل الحسابات"),
      name: "مالك دليل الحسابات",
      email,
      phone,
      password,
    },
  });
  assert.equal(registration.response.status, 202, JSON.stringify(registration.payload));
  const emailVerification = await request("/auth/email-verification/verify", {
    method: "POST",
    body: { email, code: process.env.EMAIL_VERIFICATION_TEST_CODE },
  });
  assert.equal(emailVerification.response.status, 200, JSON.stringify(emailVerification.payload));
  const cookie = cookieFrom(emailVerification.response);
  generationByCookie.set(cookie, emailVerification.payload.user.dataGeneration);
  return { email, password, cookie };
}

async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const cookie = cookieFrom(result.response);
  generationByCookie.set(cookie, result.payload.user.dataGeneration);
  return cookie;
}

before(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("تهيئة دليل الحسابات المتزامنة تبقى ذرية ولا تكرر أي كود", async () => {
  const owner = await registerOwner();
  const secondCookie = await login(owner.email, owner.password);

  const initializationResults = await Promise.all([
    request("/accounting/initialize", { method: "POST", cookie: owner.cookie }),
    request("/accounting/initialize", { method: "POST", cookie: secondCookie }),
  ]);

  for (const result of initializationResults) {
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    assert.ok(Array.isArray(result.payload.accounts));
    assert.equal(result.payload.accounts.length, 12);
  }
  assert.deepEqual(
    initializationResults.map((result) => result.payload.created).sort((left, right) => left - right),
    [0, 12],
  );

  const accounts = await request("/data/accounts", { cookie: owner.cookie });
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload));
  const codes = accounts.payload.records.map((account) => account.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual([...codes].sort(), ["1000", "1100", "1200", "1300", "1400", "2000", "2100", "3000", "4000", "5000", "5100", "6000"]);

  const duplicateCode = `9${crypto.randomUUID().replaceAll(/\D/g, "").slice(0, 7).padEnd(7, "0")}`;
  const duplicateCreates = await Promise.all([
    request("/data/accounts", {
      method: "POST",
      cookie: owner.cookie,
      body: { code: duplicateCode, name: "حساب متزامن أول", type: "asset", parent: null, balance: 0, status: "active" },
    }),
    request("/data/accounts", {
      method: "POST",
      cookie: secondCookie,
      body: { code: duplicateCode, name: "حساب متزامن ثان", type: "asset", parent: null, balance: 0, status: "active" },
    }),
  ]);
  assert.deepEqual(
    duplicateCreates.map((result) => result.response.status).sort((left, right) => left - right),
    [201, 409],
  );

  const accountsAfterDuplicateAttempt = await request("/data/accounts", { cookie: owner.cookie });
  assert.equal(accountsAfterDuplicateAttempt.response.status, 200, JSON.stringify(accountsAfterDuplicateAttempt.payload));
  assert.equal(accountsAfterDuplicateAttempt.payload.records.filter((account) => account.code === duplicateCode).length, 1);

  const parentCreate = await request("/data/accounts", {
    method: "POST", cookie: owner.cookie,
    body: { code: unique("91").replaceAll(/\D/g, "").slice(0, 6).padEnd(6, "1"), name: "أصل رئيسي", type: "asset", parent: null, openingBalance: 0, balance: 0, status: "active" },
  });
  assert.equal(parentCreate.response.status, 201, JSON.stringify(parentCreate.payload));
  const parentId = parentCreate.payload.record.id;
  const childCreate = await request("/data/accounts", {
    method: "POST", cookie: owner.cookie,
    body: { code: unique("92").replaceAll(/\D/g, "").slice(0, 6).padEnd(6, "2"), name: "أصل فرعي", type: "asset", parent: String(parentId), openingBalance: 0, balance: 0, status: "active" },
  });
  assert.equal(childCreate.response.status, 201, JSON.stringify(childCreate.payload));
  const childId = childCreate.payload.record.id;

  const cycle = await request(`/data/accounts/${parentId}`, {
    method: "PATCH", cookie: owner.cookie, body: { parent: String(childId) },
  });
  assert.equal(cycle.response.status, 409, JSON.stringify(cycle.payload));
  const disableParent = await request(`/data/accounts/${parentId}`, {
    method: "PATCH", cookie: owner.cookie, body: { status: "inactive" },
  });
  assert.equal(disableParent.response.status, 409, JSON.stringify(disableParent.payload));

  const allAccounts = await request("/data/accounts", { cookie: owner.cookie });
  const capital = allAccounts.payload.records.find((account) => account.code === "3000");
  const operationId = crypto.randomUUID();
  const opening = await request("/accounting/opening-balances", {
    method: "POST", cookie: owner.cookie,
    body: { accountId: childId, counterAccountId: capital.id, amount: 1250.5, side: "debit", date: "2026-01-01", operationId },
  });
  assert.equal(opening.response.status, 201, JSON.stringify(opening.payload));
  assert.equal(opening.payload.journal.sourceType, "opening_balance");
  assert.equal(opening.payload.journal.status, "posted");
  assert.equal(opening.payload.journal.lines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
  const replay = await request("/accounting/opening-balances", {
    method: "POST", cookie: owner.cookie,
    body: { accountId: childId, counterAccountId: capital.id, amount: 1250.5, side: "debit", date: "2026-01-01", operationId },
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.journal.id, opening.payload.journal.id);
  const duplicateOpening = await request("/accounting/opening-balances", {
    method: "POST", cookie: owner.cookie,
    body: { accountId: childId, counterAccountId: capital.id, amount: 100, side: "debit", date: "2026-01-02", operationId: crypto.randomUUID() },
  });
  assert.equal(duplicateOpening.response.status, 409, JSON.stringify(duplicateOpening.payload));

  const outsider = await registerOwner();
  const isolatedParent = await request("/data/accounts", {
    method: "POST", cookie: outsider.cookie,
    body: { code: "991001", name: "محاولة ربط خارجية", type: "asset", parent: String(parentId), openingBalance: 0, balance: 0, status: "active" },
  });
  assert.equal(isolatedParent.response.status, 404, JSON.stringify(isolatedParent.payload));
});