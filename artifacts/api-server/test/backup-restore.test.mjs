import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.BACKUP_TEST_ORIGIN ?? "http://127.0.0.1:80";
const apiBase = `${origin}/api`;
const generationByCookie = new Map();

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

async function request(path, { method = "GET", body, cookie, dataGeneration } = {}) {
  const generation = dataGeneration ?? generationByCookie.get(cookie);
  const response = await fetch(`${apiBase}${path}`, {
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

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "يجب أن ينشئ التسجيل جلسة");
  return cookie.split(";")[0];
}

async function registerOwner() {
  const { response, payload } = await request("/auth/register", {
    method: "POST",
    body: {
      projectName: unique("منشأة النسخ"),
      name: "مالك النسخ",
      email: `${unique("backup-owner")}@example.test`,
      password: "Safe-test-password-123",
    },
  });
  assert.equal(response.status, 201, JSON.stringify(payload));
  const cookie = cookieFrom(response);
  generationByCookie.set(cookie, payload.user.dataGeneration);
  return cookie;
}

test("يستعيد المالك نسخة بيانات منشأته دون إبقاء التغييرات اللاحقة", async () => {
  const cookie = await registerOwner();
  const originalAccount = await request("/data/accounts", {
    method: "POST",
    cookie,
    body: { code: unique("1000"), name: "حساب قبل النسخة", type: "asset", balance: 0, status: "active" },
  });
  assert.equal(originalAccount.response.status, 201, JSON.stringify(originalAccount.payload));
  const originalJournal = await request("/data/journalEntries", {
    method: "POST",
    cookie,
    body: {
      date: "2026-01-10",
      description: "قيد محفوظ في النسخة",
      status: "draft",
      lines: [
        { accountId: String(originalAccount.payload.record.id), debit: 100, credit: 0 },
        { accountId: String(originalAccount.payload.record.id), debit: 0, credit: 100 },
      ],
    },
  });
  assert.equal(originalJournal.response.status, 201, JSON.stringify(originalJournal.payload));

  const exported = await request("/backup/export", { cookie });
  assert.equal(exported.response.status, 200, JSON.stringify(exported.payload));
  assert.equal(exported.payload.version, 1);
  assert.ok(Array.isArray(exported.payload.records));

  const laterAccount = await request("/data/accounts", {
    method: "POST",
    cookie,
    body: { code: unique("2000"), name: "حساب بعد النسخة", type: "expense", balance: 0, status: "active" },
  });
  assert.equal(laterAccount.response.status, 201, JSON.stringify(laterAccount.payload));

  const missingOrganization = { ...exported.payload };
  delete missingOrganization.organizationId;
  const missingOrganizationRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: missingOrganization,
  });
  assert.equal(missingOrganizationRestore.response.status, 400, JSON.stringify(missingOrganizationRestore.payload));

  const otherOrganizationRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: { ...exported.payload, organizationId: exported.payload.organizationId + 1 },
  });
  assert.equal(otherOrganizationRestore.response.status, 409, JSON.stringify(otherOrganizationRestore.payload));

  const malformedRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: {
      ...exported.payload,
      records: [{ id: 1, tableName: "mutationOperations", data: {} }],
    },
  });
  assert.equal(malformedRestore.response.status, 400, JSON.stringify(malformedRestore.payload));

  const semanticallyInvalidRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: {
      ...exported.payload,
      records: [
        ...exported.payload.records,
        {
          id: Math.max(...exported.payload.records.map((record) => record.id)) + 1,
          tableName: "journalEntries",
          data: {
            date: "2026-01-15",
            description: "قيد غير متوازن",
            status: "draft",
            lines: [
              { accountId: String(originalAccount.payload.record.id), debit: 100, credit: 0 },
              { accountId: String(originalAccount.payload.record.id), debit: 0, credit: 50 },
            ],
          },
        },
      ],
    },
  });
  assert.equal(semanticallyInvalidRestore.response.status, 400, JSON.stringify(semanticallyInvalidRestore.payload));
  const accountsBeforeRestore = await request("/data/accounts", { cookie });
  assert.ok(accountsBeforeRestore.payload.records.some((account) => account.name === "حساب بعد النسخة"));

  const invalidNumberRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: {
      ...exported.payload,
      records: exported.payload.records.map((record) => record.id === originalAccount.payload.record.id
        ? { ...record, data: { ...record.data, balance: null } }
        : record),
    },
  });
  assert.equal(invalidNumberRestore.response.status, 400, JSON.stringify(invalidNumberRestore.payload));

  const impossibleDateRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: {
      ...exported.payload,
      records: [
        ...exported.payload.records,
        {
          id: Math.max(...exported.payload.records.map((record) => record.id)) + 1,
          tableName: "journalEntries",
          data: {
            date: "2026-99-99",
            description: "تاريخ غير صالح",
            status: "draft",
            lines: [
              { accountId: originalAccount.payload.record.id, debit: 50, credit: 0 },
              { accountId: originalAccount.payload.record.id, debit: 0, credit: 50 },
            ],
          },
        },
      ],
    },
  });
  assert.equal(impossibleDateRestore.response.status, 400, JSON.stringify(impossibleDateRestore.payload));
  const impossibleInvoiceDateRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: {
      ...exported.payload,
      records: [
        ...exported.payload.records,
        {
          id: Math.max(...exported.payload.records.map((record) => record.id)) + 1,
          tableName: "invoices",
          data: { number: "INV-INVALID", total: 25, date: "2026-99-99" },
        },
      ],
    },
  });
  assert.equal(impossibleInvoiceDateRestore.response.status, 400, JSON.stringify(impossibleInvoiceDateRestore.payload));
  const hollowClosureRestore = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: {
      ...exported.payload,
      records: [
        ...exported.payload.records,
        {
          id: Math.max(...exported.payload.records.map((record) => record.id)) + 1,
          tableName: "financialClosures",
          data: { from: "2026-01-01", to: "2026-01-31", status: "closed", netIncome: null, totals: {}, trialBalance: [], receivables: [], payables: [] },
        },
      ],
    },
  });
  assert.equal(hollowClosureRestore.response.status, 400, JSON.stringify(hollowClosureRestore.payload));
  const accountsAfterInvalidRestores = await request("/data/accounts", { cookie });
  assert.ok(accountsAfterInvalidRestores.payload.records.some((account) => account.name === "حساب بعد النسخة"));

  const staleGeneration = generationByCookie.get(cookie);
  const restored = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: exported.payload,
  });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.payload));
  assert.ok(restored.payload.dataGeneration > staleGeneration);

  const staleMutation = await request("/data/accounts", {
    method: "POST",
    cookie,
    dataGeneration: staleGeneration,
    body: { code: unique("9999"), name: "تغيير قديم", type: "asset", balance: 0, status: "active" },
  });
  assert.equal(staleMutation.response.status, 409, JSON.stringify(staleMutation.payload));
  generationByCookie.set(cookie, restored.payload.dataGeneration);

  const accounts = await request("/data/accounts", { cookie });
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload));
  assert.ok(accounts.payload.records.some((account) => account.name === "حساب قبل النسخة"));
  assert.ok(!accounts.payload.records.some((account) => account.name === "حساب بعد النسخة"));
  assert.ok(!accounts.payload.records.some((account) => account.name === "تغيير قديم"));
  const journals = await request("/data/journalEntries", { cookie });
  assert.ok(journals.payload.records.some((journal) => journal.description === "قيد محفوظ في النسخة"));
});