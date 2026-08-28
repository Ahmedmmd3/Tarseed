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
  const phoneVerification = await request("/auth/phone-verification/verify", {
    method: "POST",
    body: { email, code: process.env.PHONE_VERIFICATION_TEST_CODE },
  });
  assert.equal(phoneVerification.response.status, 200, JSON.stringify(phoneVerification.payload));
  const cookie = cookieFrom(phoneVerification.response);
  generationByCookie.set(cookie, phoneVerification.payload.user.dataGeneration);
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
    assert.equal(result.payload.accounts.length, 8);
  }
  assert.deepEqual(
    initializationResults.map((result) => result.payload.created).sort((left, right) => left - right),
    [0, 8],
  );

  const accounts = await request("/data/accounts", { cookie: owner.cookie });
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload));
  const codes = accounts.payload.records.map((account) => account.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual([...codes].sort(), ["1000", "1100", "1200", "2000", "3000", "4000", "5000", "5100"]);

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
});