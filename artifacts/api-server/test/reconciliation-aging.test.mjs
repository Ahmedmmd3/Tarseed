import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.RECONCILIATION_TEST_ORIGIN ?? "http://127.0.0.1:80";
const api = `${origin}/api`;
const generations = new Map();
const unique = (value) => `${value}-${crypto.randomUUID().slice(0, 8)}`;

async function request(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const generation = generations.get(cookie);
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
      ...(Number.isInteger(generation) ? { "X-Wudooh-Data-Generation": String(generation) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function owner() {
  const email = `${unique("reconciliation")}@example.test`;
  const password = "Safe-test-password-123";
  const forwarded = { "X-Forwarded-For": `198.51.100.${Math.floor(Math.random() * 200) + 1}` };
  let result = await request("/auth/register", { method: "POST", headers: forwarded, body: {
    projectName: unique("منشأة تسوية"), name: "مالك التسوية", email,
    phone: `05${crypto.randomUUID().replaceAll(/\D/g, "").slice(0, 8).padEnd(8, "0")}`, password,
  } });
  assert.equal(result.response.status, 202, JSON.stringify(result.payload));
  result = await request("/auth/email-verification/verify", { method: "POST", headers: forwarded, body: { email, code: process.env.EMAIL_VERIFICATION_TEST_CODE } });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  generations.set(cookie, result.payload.user.dataGeneration);
  return { email, password, cookie };
}

async function login(email, password) {
  const result = await request("/auth/login", { method: "POST", headers: { "X-Forwarded-For": "198.51.100.210" }, body: { email, password } });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  generations.set(cookie, result.payload.user.dataGeneration);
  return cookie;
}

async function setup() {
  const accountOwner = await owner();
  let result = await request("/accounting/initialize", { method: "POST", cookie: accountOwner.cookie });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  result = await request("/data/accounts", { cookie: accountOwner.cookie });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  const account = (code) => result.payload.records.find((item) => item.code === code);
  const [cash, bank] = [account("1000"), account("1100")];
  assert.ok(cash?.id && bank?.id, "تهيئة الحسابات يجب أن تنشئ الصندوق والبنك");
  const locations = await request("/data/warehouses", { cookie: accountOwner.cookie });
  assert.equal(locations.response.status, 200, JSON.stringify(locations.payload));
  return { ...accountOwner, cash, bank, offset: result.payload.records.find((item) => item.id !== bank.id && item.id !== cash.id), warehouse: locations.payload.records[0], otherWarehouse: locations.payload.records[1] };
}

async function postJournal(cookie, date, bankId, offsetId, amount, reference) {
  const absolute = Math.abs(amount);
  const bankDebit = amount >= 0 ? absolute : 0;
  const bankCredit = amount >= 0 ? 0 : absolute;
  let result = await request("/data/journalEntries", { method: "POST", cookie, body: {
    date, reference, description: "قيد اختبار التسوية", status: "draft",
    lines: [{ accountId: String(bankId), debit: bankDebit, credit: bankCredit }, { accountId: String(offsetId), debit: bankCredit, credit: bankDebit }],
  } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  result = await request(`/data/journalEntries/${result.payload.record.id}`, { method: "PATCH", cookie, body: { status: "posted" } });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  return result.payload.record;
}

test("صلاحيات ونطاقات التسوية ومعرف العملية والحسابات المسموحة", async () => {
  const fixture = await setup();
  const noAccountingEmail = `${unique("without-accounting")}@example.test`;
  let result = await request("/team/members", { method: "POST", cookie: fixture.cookie, body: {
    name: "بلا محاسبة", email: noAccountingEmail, password: fixture.password, roleId: "sales", permissions: { sales: true }, locationScope: "all",
  } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  const noAccounting = await login(noAccountingEmail, fixture.password);
  result = await request("/accounting/reconciliations", { cookie: noAccounting });
  assert.equal(result.response.status, 403);

  const selectedEmail = `${unique("selected-accountant")}@example.test`;
  result = await request("/team/members", { method: "POST", cookie: fixture.cookie, body: {
    name: "محاسب موقع", email: selectedEmail, password: fixture.password, roleId: "sales", permissions: { accounting: true },
    locationScope: "selected", warehouseIds: [fixture.warehouse.id],
  } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  const selected = await login(selectedEmail, fixture.password);
  const body = { accountId: fixture.bank.id, statementDate: "2026-05-15", statementBalance: 0, lines: [] };
  result = await request("/accounting/reconciliations", { method: "POST", cookie: selected, headers: { "Idempotency-Key": unique("missing-location") }, body });
  assert.equal(result.response.status, 403);
  result = await request("/accounting/reconciliations", { method: "POST", cookie: selected, headers: { "Idempotency-Key": unique("wrong-location") }, body: { ...body, warehouseId: fixture.otherWarehouse.id } });
  assert.equal(result.response.status, 403);
  const key = unique("recon-replay");
  result = await request("/accounting/reconciliations", { method: "POST", cookie: selected, headers: { "Idempotency-Key": key }, body: { ...body, warehouseId: fixture.warehouse.id } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  const sessionId = result.payload.session.id;
  result = await request("/accounting/reconciliations", { method: "POST", cookie: selected, headers: { "Idempotency-Key": key }, body: { ...body, warehouseId: fixture.warehouse.id } });
  assert.equal(result.response.status, 200); assert.equal(result.payload.replayed, true);
  result = await request("/accounting/reconciliations", { method: "POST", cookie: selected, headers: { "Idempotency-Key": key }, body: { ...body, statementBalance: 1, warehouseId: fixture.warehouse.id } });
  assert.equal(result.response.status, 409);
  result = await request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique("cash") }, body: { ...body, accountId: fixture.cash.id } });
  assert.equal(result.response.status, 201);
  result = await request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique("other") }, body: { ...body, accountId: fixture.offset.id } });
  assert.equal(result.response.status, 400);
  const another = await owner();
  result = await request(`/accounting/reconciliations/${sessionId}`, { cookie: another.cookie });
  assert.equal(result.response.status, 404, "لا يجوز كشف جلسة منشأة أخرى");
});

test("المطابقة والاعتماد والتعديلات متزنة ومعادة بأمان", async () => {
  const fixture = await setup();
  const journal = await postJournal(fixture.cookie, "2026-05-14", fixture.bank.id, fixture.offset.id, 100, "BANK-100");
  const manualJournal = await postJournal(fixture.cookie, "2026-05-14", fixture.bank.id, fixture.offset.id, 55, "MANUAL-55");
  const create = await request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique("matching") }, body: {
    accountId: fixture.bank.id, statementDate: "2026-05-15", statementBalance: 155,
    lines: [{ date: "2026-05-15", amount: 100, description: "إيداع", reference: "BANK-100" }, { date: "2026-05-15", amount: 100, description: "نسخة", reference: "BANK-100" }, { date: "2026-05-15", amount: 55, description: "يدوي", reference: "MANUAL-NEEDS-REVIEW" }],
  } });
  assert.equal(create.response.status, 201, JSON.stringify(create.payload));
  const id = create.payload.session.id;
  let result = await request(`/accounting/reconciliations/${id}/approve`, { method: "POST", cookie: fixture.cookie });
  assert.equal(result.response.status, 409, "يرفض اعتماد أسطر ناقصة");
  result = await request(`/accounting/reconciliations/${id}/auto-match`, { method: "POST", cookie: fixture.cookie });
  assert.equal(result.response.status, 200); assert.equal(result.payload.matched, 1);
  const detail = await request(`/accounting/reconciliations/${id}`, { cookie: fixture.cookie });
  const duplicate = detail.payload.statementLines.find((line) => line.reference === "BANK-100" && line.status === "unmatched");
  const manual = detail.payload.statementLines.find((line) => line.reference === "MANUAL-NEEDS-REVIEW");
  result = await request(`/accounting/reconciliations/${id}/matches`, { method: "POST", cookie: fixture.cookie, body: { statementLineId: manual.id, journalId: manualJournal.id } });
  assert.equal(result.response.status, 400, "السبب اليدوي مطلوب");
  result = await request(`/accounting/reconciliations/${id}/matches`, { method: "POST", cookie: fixture.cookie, body: { statementLineId: manual.id, journalId: manualJournal.id, reason: "مراجعة كشف البنك" } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  result = await request(`/accounting/reconciliations/${id}/matches`, { method: "POST", cookie: fixture.cookie, body: { statementLineId: duplicate.id, journalId: journal.id, reason: "محاولة مكررة" } });
  assert.equal(result.response.status, 409, "لا يستخدم القيد نفسه مرتين");
  const approvalJournal = await postJournal(fixture.cookie, "2026-05-15", fixture.bank.id, fixture.offset.id, 33, "APPROVE-33");
  const approval = await request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique("approval") }, body: {
    accountId: fixture.bank.id, statementDate: "2026-05-15", statementBalance: 188,
    lines: [{ date: "2026-05-15", amount: 33, description: "قيد الاعتماد", reference: "APPROVE-33" }],
  } });
  assert.equal(approval.response.status, 201, JSON.stringify(approval.payload));
  result = await request(`/accounting/reconciliations/${approval.payload.session.id}/auto-match`, { method: "POST", cookie: fixture.cookie });
  assert.equal(result.response.status, 200); assert.equal(result.payload.outcomes[0].journalId, approvalJournal.id);
  result = await request(`/accounting/reconciliations/${approval.payload.session.id}/approve`, { method: "POST", cookie: fixture.cookie });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.session.bookBalance, 188); assert.equal(result.payload.session.statementBalance, 188); assert.equal(result.payload.session.difference, 0);
  result = await request(`/accounting/reconciliations/${approval.payload.session.id}/approve`, { method: "POST", cookie: fixture.cookie });
  assert.equal(result.response.status, 200); assert.equal(result.payload.session.status, "approved");
  const adjustmentKey = unique("fee");
  result = await request(`/accounting/reconciliations/${id}/adjustments`, { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": adjustmentKey }, body: { type: "bankFee", amount: 5, date: "2026-05-15", offsetAccountId: fixture.offset.id } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  assert.equal(result.payload.journal.lines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
  result = await request(`/accounting/reconciliations/${id}/adjustments`, { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": adjustmentKey }, body: { type: "bankFee", amount: 5, date: "2026-05-15", offsetAccountId: fixture.offset.id } });
  assert.equal(result.response.status, 200); assert.equal(result.payload.replayed, true);
  for (const [type, amount] of [["interest", 3], ["cashVariance", -2]]) {
    result = await request(`/accounting/reconciliations/${id}/adjustments`, { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique(type) }, body: { type, amount, date: "2026-05-15", offsetAccountId: fixture.offset.id } });
    assert.equal(result.response.status, 201); assert.equal(result.payload.journal.lines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
  }
  result = await request("/accounting/close", { method: "POST", cookie: fixture.cookie, body: { from: "2026-05-15", to: "2026-05-15", confirmation: "CLOSE_PERIOD" } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  result = await request(`/accounting/reconciliations/${id}/adjustments`, { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique("closed-adjustment") }, body: { type: "bankFee", amount: 1, date: "2026-05-15", offsetAccountId: fixture.offset.id } });
  assert.equal(result.response.status, 409, "يرفض قيد التسوية في فترة مقفلة");
});

test("تقادم الذمم يحسب كل الشرائح ويستبعد السجلات غير المستحقة", async () => {
  const fixture = await setup();
  const definitions = [["today", "2026-06-30", 10], ["future", "2026-07-01", 20], ["one", "2026-06-01", 30], ["thirtyOne", "2026-05-30", 40], ["sixtyOne", "2026-04-30", 50], ["old", "2026-03-31", 60]];
  for (const [reference, dueDate, amount] of definitions) {
    const result = await request("/data/receivables", { method: "POST", cookie: fixture.cookie, body: { type: "receivable", party: reference, reference, dueDate, issueDate: "2026-01-01", amount, paid: 0, status: "unpaid" } });
    assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  }
  for (const status of ["draft", "cancelled", "paid"]) await request("/data/receivables", { method: "POST", cookie: fixture.cookie, body: { type: "receivable", party: status, dueDate: "2026-01-01", amount: 99, paid: status === "paid" ? 99 : 0, status } });
  const isolatedTenant = await owner();
  const isolated = await request("/data/receivables", { method: "POST", cookie: isolatedTenant.cookie, body: { type: "receivable", party: "منشأة أخرى", dueDate: "2026-01-01", amount: 777, paid: 0, status: "unpaid" } });
  assert.equal(isolated.response.status, 201, JSON.stringify(isolated.payload));
  const result = await request("/accounting/aging?asOf=2026-06-30&type=receivable", { cookie: fixture.cookie });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.payload.totals, { notDue: 30, "1-30": 30, "31-60": 40, "61-90": 50, over90: 60 });
  assert.equal(result.payload.total, 210);
});

test("المطابقة اليدوية والتلقائية ترفضان الإشارة أو التاريخ المستقبلي", async () => {
  const fixture = await setup();
  const future = await postJournal(fixture.cookie, "2026-07-01", fixture.bank.id, fixture.offset.id, 70, "FUTURE-70");
  const wrongSign = await postJournal(fixture.cookie, "2026-06-20", fixture.bank.id, fixture.offset.id, -40, "NEGATIVE-40");
  const created = await request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique("date-sign") }, body: {
    accountId: fixture.bank.id, statementDate: "2026-06-30", statementBalance: 0,
    lines: [{ date: "2026-06-30", amount: 70, description: "مستقبلي", reference: "FUTURE-70" }, { date: "2026-06-30", amount: 40, description: "إشارة مخالفة", reference: "NEGATIVE-40" }],
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const id = created.payload.session.id;
  let result = await request(`/accounting/reconciliations/${id}/auto-match`, { method: "POST", cookie: fixture.cookie });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.matched, 0, "لا تطابق الآلة قيداً بعد تاريخ الكشف");
  const detail = await request(`/accounting/reconciliations/${id}`, { cookie: fixture.cookie });
  const futureLine = detail.payload.statementLines.find((line) => line.reference === "FUTURE-70");
  const signLine = detail.payload.statementLines.find((line) => line.reference === "NEGATIVE-40");
  result = await request(`/accounting/reconciliations/${id}/matches`, { method: "POST", cookie: fixture.cookie, body: { statementLineId: futureLine.id, journalId: future.id, reason: "محاولة مستقبلية" } });
  assert.equal(result.response.status, 409);
  result = await request(`/accounting/reconciliations/${id}/matches`, { method: "POST", cookie: fixture.cookie, body: { statementLineId: signLine.id, journalId: wrongSign.id, reason: "محاولة إشارة مخالفة" } });
  assert.equal(result.response.status, 409);
});

test("إنشاء متزامن يعيد نفس الجلسة، واعتماد الفرق غير الصفري ومطابقة القيد المكررة مرفوضان", async () => {
  const fixture = await setup();
  const journal = await postJournal(fixture.cookie, "2026-06-20", fixture.bank.id, fixture.offset.id, 66, "CONCURRENT-66");
  const key = unique("concurrent-create");
  const body = { accountId: fixture.bank.id, statementDate: "2026-06-30", statementBalance: 10, lines: [{ date: "2026-06-20", amount: 66, description: "الأول", reference: "NEEDS-MANUAL-1" }, { date: "2026-06-20", amount: 66, description: "الثاني", reference: "NEEDS-MANUAL-2" }] };
  const [first, second] = await Promise.all([
    request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": key }, body }),
    request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": key }, body }),
  ]);
  assert.deepEqual([first.response.status, second.response.status].sort(), [200, 201], JSON.stringify([first.payload, second.payload]));
  assert.equal(first.payload.session.id, second.payload.session.id);
  assert.equal([first.payload.replayed, second.payload.replayed].filter(Boolean).length, 1);
  const sessionId = first.payload.session.id;
  const detail = await request(`/accounting/reconciliations/${sessionId}`, { cookie: fixture.cookie });
  const [lineOne, lineTwo] = detail.payload.statementLines;
  const outcomes = await Promise.all([
    request(`/accounting/reconciliations/${sessionId}/matches`, { method: "POST", cookie: fixture.cookie, body: { statementLineId: lineOne.id, journalId: journal.id, reason: "تزامن 1" } }),
    request(`/accounting/reconciliations/${sessionId}/matches`, { method: "POST", cookie: fixture.cookie, body: { statementLineId: lineTwo.id, journalId: journal.id, reason: "تزامن 2" } }),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.response.status).sort(), [201, 409], JSON.stringify(outcomes.map((outcome) => outcome.payload)));

  const balancedJournal = await postJournal(fixture.cookie, "2026-06-21", fixture.bank.id, fixture.offset.id, 10, "DIFFERENCE-10");
  const mismatch = await request("/accounting/reconciliations", { method: "POST", cookie: fixture.cookie, headers: { "Idempotency-Key": unique("nonzero-difference") }, body: {
    accountId: fixture.bank.id, statementDate: "2026-06-30", statementBalance: 999,
    lines: [{ date: "2026-06-21", amount: 10, description: "مكتمل لكن فرق", reference: "DIFFERENCE-10" }],
  } });
  assert.equal(mismatch.response.status, 201);
  const auto = await request(`/accounting/reconciliations/${mismatch.payload.session.id}/auto-match`, { method: "POST", cookie: fixture.cookie });
  assert.equal(auto.response.status, 200); assert.equal(auto.payload.outcomes[0].journalId, balancedJournal.id);
  const approval = await request(`/accounting/reconciliations/${mismatch.payload.session.id}/approve`, { method: "POST", cookie: fixture.cookie });
  assert.equal(approval.response.status, 409, "لا يكفي تطابق جميع الأسطر عندما فرق الرصيد غير صفري");
});