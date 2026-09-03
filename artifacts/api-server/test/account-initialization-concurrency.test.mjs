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
  return { email, password, cookie, dataGeneration: emailVerification.payload.user.dataGeneration };
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
    assert.equal(result.payload.accounts.length, 13);
  }
  assert.deepEqual(
    initializationResults.map((result) => result.payload.created).sort((left, right) => left - right),
    [0, 0],
  );

  const accounts = await request("/data/accounts", { cookie: owner.cookie });
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload));
  const codes = accounts.payload.records.map((account) => account.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual([...codes].sort(), ["1000", "1100", "1200", "1300", "2000", "2100", "3000", "3100", "4000", "5000", "5100", "5200", "5300"]);

  const initiallyEmptyDemoTables = await Promise.all([
    request("/data/customers", { cookie: owner.cookie }),
    request("/data/products", { cookie: owner.cookie }),
    request("/data/invoices", { cookie: owner.cookie }),
    request("/data/expenses", { cookie: owner.cookie }),
    request("/data/journalEntries", { cookie: owner.cookie }),
  ]);
  assert.ok(initiallyEmptyDemoTables.every((result) => result.payload.records.every((record) => !record.isDemoData)));
  const initialDemoStatus = await request("/demo-data", { cookie: owner.cookie });
  assert.equal(initialDemoStatus.response.status, 200, JSON.stringify(initialDemoStatus.payload));
  assert.equal(initialDemoStatus.payload.hasDemoData, false);

  const addedDemo = await request("/demo-data", { method: "POST", cookie: owner.cookie });
  assert.equal(addedDemo.response.status, 201, JSON.stringify(addedDemo.payload));
  assert.ok(addedDemo.payload.created > 0);
  generationByCookie.set(owner.cookie, addedDemo.payload.dataGeneration);
  const [customers, products, invoices, expenses, journals] = await Promise.all([
    request("/data/customers", { cookie: owner.cookie }),
    request("/data/products", { cookie: owner.cookie }),
    request("/data/invoices", { cookie: owner.cookie }),
    request("/data/expenses", { cookie: owner.cookie }),
    request("/data/journalEntries", { cookie: owner.cookie }),
  ]);
  assert.equal(customers.payload.records.filter((record) => record.isDemoData).length, 3);
  assert.deepEqual(
    products.payload.records.filter((record) => record.isDemoData).map((record) => [record.sku, record.sellPrice, record.stock]),
    [["QH001", 45, 100], ["TM001", 120, 50], ["AS001", 200, 30], ["ZF001", 350, 20], ["MA001", 25, 200]],
  );
  assert.deepEqual(
    invoices.payload.records.filter((record) => record.isDemoData).map((record) => record.total),
    [4500, 8200, 3750, 6100],
  );
  assert.equal(expenses.payload.records.filter((record) => record.isDemoData).length, 5);
  const demoJournals = journals.payload.records.filter((record) => record.isDemoData);
  assert.equal(demoJournals.length, 10);
  assert.ok(demoJournals.every((journal) => {
    const debit = journal.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = journal.lines.reduce((sum, line) => sum + line.credit, 0);
    return Math.abs(debit - credit) < 0.005;
  }));

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
  const correction = await request("/accounting/opening-balances", {
    method: "POST", cookie: owner.cookie,
    body: { accountId: childId, counterAccountId: capital.id, amount: 1500.5, side: "debit", date: "2026-01-03", mode: "correction", operationId: crypto.randomUUID() },
  });
  assert.equal(correction.response.status, 201, JSON.stringify(correction.payload));
  assert.equal(correction.payload.journal.sourceType, "opening_balance_correction");
  assert.equal(correction.payload.journal.lines.find((line) => line.accountId === String(childId)).debit, 250);
  assert.equal(correction.payload.journal.lines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
  const unsafeDelete = await request("/demo-data", { method: "DELETE", cookie: owner.cookie });
  assert.equal(unsafeDelete.response.status, 200, JSON.stringify(unsafeDelete.payload));
  generationByCookie.set(owner.cookie, unsafeDelete.payload.dataGeneration);
  const defaultAccountsAfterDelete = await request("/data/accounts", { cookie: owner.cookie });
  assert.deepEqual(
    defaultAccountsAfterDelete.payload.records
      .filter((account) => ["1000", "1100", "1200", "1300", "2000", "2100", "3000", "3100", "4000", "5000", "5100", "5200", "5300"].includes(account.code))
      .map((account) => account.code)
      .sort(),
    ["1000", "1100", "1200", "1300", "2000", "2100", "3000", "3100", "4000", "5000", "5100", "5200", "5300"],
  );

  const outsider = await registerOwner();
  const outsiderDemo = await request("/demo-data", {
    method: "POST",
    cookie: outsider.cookie,
  });
  assert.equal(outsiderDemo.response.status, 201, JSON.stringify(outsiderDemo.payload));
  generationByCookie.set(outsider.cookie, outsiderDemo.payload.dataGeneration);
  const isolatedParent = await request("/data/accounts", {
    method: "POST", cookie: outsider.cookie,
    body: { code: "991001", name: "محاولة ربط خارجية", type: "asset", parent: String(parentId), openingBalance: 0, balance: 0, status: "active" },
  });
  assert.equal(isolatedParent.response.status, 404, JSON.stringify(isolatedParent.payload));

  const ownCustomer = await request("/data/customers", {
    method: "POST",
    cookie: outsider.cookie,
    body: { name: "عميل المستخدم", phone: "0500000000", status: "active" },
  });
  assert.equal(ownCustomer.response.status, 201, JSON.stringify(ownCustomer.payload));
  const ownAccount = await request("/data/accounts", {
    method: "POST",
    cookie: outsider.cookie,
    body: { code: "990001", name: "حساب المستخدم المستقل", type: "asset", parent: null, openingBalance: 0, status: "active" },
  });
  assert.equal(ownAccount.response.status, 201, JSON.stringify(ownAccount.payload));
  const ownProduct = await request("/data/products", {
    method: "POST",
    cookie: outsider.cookie,
    body: { name: "منتج المستخدم المستقل", sku: unique("USR"), sellPrice: 75, costPrice: 50, stock: 0, vatRate: 15, status: "active" },
  });
  assert.equal(ownProduct.response.status, 201, JSON.stringify(ownProduct.payload));
  const deletedDemo = await request("/demo-data", {
    method: "DELETE",
    cookie: outsider.cookie,
  });
  assert.equal(deletedDemo.response.status, 200, JSON.stringify(deletedDemo.payload));
  assert.ok(deletedDemo.payload.deleted > 0);
  assert.equal(deletedDemo.payload.dataGeneration, outsiderDemo.payload.dataGeneration + 1);
  generationByCookie.set(outsider.cookie, deletedDemo.payload.dataGeneration);
  const [accountsAfterDelete, customersAfterDelete, productsAfterDelete, warehousesAfterDelete] = await Promise.all([
    request("/data/accounts", { cookie: outsider.cookie }),
    request("/data/customers", { cookie: outsider.cookie }),
    request("/data/products", { cookie: outsider.cookie }),
    request("/data/warehouses", { cookie: outsider.cookie }),
  ]);
  assert.equal(accountsAfterDelete.payload.records.length, 14);
  assert.ok(accountsAfterDelete.payload.records.some((record) => record.name === "حساب المستخدم المستقل"));
  assert.ok(accountsAfterDelete.payload.records.some((record) => record.code === "1000" && !record.isDemoData));
  assert.deepEqual(customersAfterDelete.payload.records.map((record) => record.name), ["عميل المستخدم"]);
  assert.deepEqual(productsAfterDelete.payload.records.map((record) => record.name), ["منتج المستخدم المستقل"]);
  assert.equal(warehousesAfterDelete.payload.records.length, 2);
});