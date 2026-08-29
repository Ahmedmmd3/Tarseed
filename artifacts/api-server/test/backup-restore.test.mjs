import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.BACKUP_TEST_ORIGIN ?? "http://127.0.0.1:80";
const apiBase = `${origin}/api`;
const generationByCookie = new Map();

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

async function request(path, { method = "GET", body, cookie, dataGeneration, headers = {} } = {}) {
  const generation = dataGeneration ?? generationByCookie.get(cookie);
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(Number.isSafeInteger(generation) ? { "X-Wudooh-Data-Generation": String(generation) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
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
  const email = `${unique("backup-owner")}@example.test`;
  const password = "Safe-test-password-123";
  const phone = `05${crypto.randomUUID().replaceAll(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const authHeaders = { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 1}` };
  const registration = await request("/auth/register", {
    method: "POST",
    headers: authHeaders,
    body: {
      projectName: unique("منشأة النسخ"),
      name: "مالك النسخ",
      email,
      phone,
      password,
    },
  });
  assert.equal(registration.response.status, 202, JSON.stringify(registration.payload));
  const emailVerification = await request("/auth/email-verification/verify", {
    method: "POST", headers: authHeaders, body: { email, code: process.env.EMAIL_VERIFICATION_TEST_CODE },
  });
  assert.equal(emailVerification.response.status, 200, JSON.stringify(emailVerification.payload));
  const cookie = cookieFrom(emailVerification.response);
  generationByCookie.set(cookie, emailVerification.payload.user.dataGeneration);
  return { cookie, email, password };
}

test("يستعيد المالك نسخة بيانات منشأته دون إبقاء التغييرات اللاحقة", async () => {
  const { cookie, email, password } = await registerOwner();
  const accountDefinitions = [
    { code: "1000", name: "النقدية قبل النسخة", type: "asset" },
    { code: "4000", name: "إيرادات المبيعات قبل النسخة", type: "revenue" },
    { code: "5000", name: "مصروف التشغيل قبل النسخة", type: "expense" },
  ];
  const accountsByType = {};
  for (const definition of accountDefinitions) {
    const createdAccount = await request("/data/accounts", {
      method: "POST",
      cookie,
      body: { ...definition, code: unique(definition.code), balance: 0, status: "active" },
    });
    assert.equal(createdAccount.response.status, 201, JSON.stringify(createdAccount.payload));
    accountsByType[definition.type] = createdAccount.payload.record;
  }

  const originalJournals = [
    {
      date: "2026-01-10",
      description: "إيراد مبيعات منشور محفوظ في النسخة",
      lines: [
        { accountId: String(accountsByType.asset.id), debit: 1500, credit: 0 },
        { accountId: String(accountsByType.revenue.id), debit: 0, credit: 1500 },
      ],
    },
    {
      date: "2026-01-20",
      description: "مصروف تشغيل منشور محفوظ في النسخة",
      lines: [
        { accountId: String(accountsByType.expense.id), debit: 300, credit: 0 },
        { accountId: String(accountsByType.asset.id), debit: 0, credit: 300 },
      ],
    },
  ];
  const postedJournals = [];
  for (const journal of originalJournals) {
    const createdJournal = await request("/data/journalEntries", {
      method: "POST",
      cookie,
      body: { ...journal, status: "draft" },
    });
    assert.equal(createdJournal.response.status, 201, JSON.stringify(createdJournal.payload));
    const postedJournal = await request(`/data/journalEntries/${createdJournal.payload.record.id}`, {
      method: "PATCH",
      cookie,
      body: { status: "posted" },
    });
    assert.equal(postedJournal.response.status, 200, JSON.stringify(postedJournal.payload));
    assert.equal(postedJournal.payload.record.status, "posted");
    postedJournals.push(postedJournal.payload.record);
  }

  const originalClosure = await request("/accounting/close", {
    method: "POST",
    cookie,
    body: { from: "2026-01-01", to: "2026-01-31", confirmation: "CLOSE_PERIOD" },
  });
  assert.equal(originalClosure.response.status, 201, JSON.stringify(originalClosure.payload));
  const summaryBeforeRestore = await request("/accounting/summary?from=2026-01-01&to=2026-01-31", { cookie });
  assert.equal(summaryBeforeRestore.response.status, 200, JSON.stringify(summaryBeforeRestore.payload));
  assert.equal(summaryBeforeRestore.payload.totals.revenue, 1500);
  assert.equal(summaryBeforeRestore.payload.totals.expense, 300);
  assert.equal(summaryBeforeRestore.payload.totals.netIncome, 1200);
  assert.equal(summaryBeforeRestore.payload.journals, postedJournals.length);
  const { receivables: _receivables, payables: _payables, ...reportTotals } = summaryBeforeRestore.payload.totals;
  assert.deepEqual(originalClosure.payload.closure.totals, reportTotals);
  assert.deepEqual(originalClosure.payload.closure.trialBalance, summaryBeforeRestore.payload.trialBalance);
  assert.equal(originalClosure.payload.closure.netIncome, summaryBeforeRestore.payload.totals.netIncome);

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
              { accountId: String(accountsByType.asset.id), debit: 100, credit: 0 },
              { accountId: String(accountsByType.asset.id), debit: 0, credit: 50 },
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
      records: exported.payload.records.map((record) => record.id === accountsByType.asset.id
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
              { accountId: accountsByType.asset.id, debit: 50, credit: 0 },
              { accountId: accountsByType.asset.id, debit: 0, credit: 50 },
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

  const renewedLogin = await request("/auth/login", {
    method: "POST",
    headers: { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: { email, password },
  });
  assert.equal(renewedLogin.response.status, 200, JSON.stringify(renewedLogin.payload));
  assert.equal(renewedLogin.payload.user?.dataGeneration, restored.payload.dataGeneration);
  const renewedCookie = cookieFrom(renewedLogin.response);
  const renewedSession = await request("/auth/me", { cookie: renewedCookie });
  assert.equal(renewedSession.response.status, 200, JSON.stringify(renewedSession.payload));
  assert.equal(renewedSession.payload.user?.dataGeneration, restored.payload.dataGeneration);

  const accounts = await request("/data/accounts", { cookie });
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload));
  assert.ok(accounts.payload.records.some((account) => account.name === "النقدية قبل النسخة"));
  assert.ok(accounts.payload.records.some((account) => account.name === "إيرادات المبيعات قبل النسخة"));
  assert.ok(accounts.payload.records.some((account) => account.name === "مصروف التشغيل قبل النسخة"));
  assert.ok(!accounts.payload.records.some((account) => account.name === "حساب بعد النسخة"));
  assert.ok(!accounts.payload.records.some((account) => account.name === "تغيير قديم"));
  const journals = await request("/data/journalEntries", { cookie });
  assert.ok(journals.payload.records.some((journal) => journal.description === "إيراد مبيعات منشور محفوظ في النسخة"));
  assert.ok(journals.payload.records.some((journal) => journal.description === "مصروف تشغيل منشور محفوظ في النسخة"));
  const closures = await request("/data/financialClosures", { cookie });
  assert.equal(closures.response.status, 200, JSON.stringify(closures.payload));
  const restoredClosure = closures.payload.records.find((closure) => closure.id === originalClosure.payload.closure.id);
  assert.ok(restoredClosure);
  const { userId: _userId, ...restoredClosureData } = restoredClosure;
  assert.deepEqual(restoredClosureData, originalClosure.payload.closure);
  const summaryAfterRestore = await request("/accounting/summary?from=2026-01-01&to=2026-01-31", { cookie });
  assert.equal(summaryAfterRestore.response.status, 200, JSON.stringify(summaryAfterRestore.payload));
  const { receivables: _restoredReceivables, payables: _restoredPayables, ...restoredReportTotals } = summaryAfterRestore.payload.totals;
  assert.deepEqual(restoredClosureData.totals, restoredReportTotals);
  assert.deepEqual(restoredClosureData.trialBalance, summaryAfterRestore.payload.trialBalance);
  assert.deepEqual(summaryAfterRestore.payload, summaryBeforeRestore.payload);

  const createdAfterRestore = await request("/data/accounts", {
    method: "POST",
    cookie,
    body: { code: unique("3000"), name: "حساب جديد بعد الاستعادة", type: "asset", balance: 0, status: "active" },
  });
  assert.equal(createdAfterRestore.response.status, 201, JSON.stringify(createdAfterRestore.payload));
  assert.ok(createdAfterRestore.payload.record.id > Math.max(...exported.payload.records.map((record) => record.id)));
});