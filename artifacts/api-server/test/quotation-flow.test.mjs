import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.QUOTATION_TEST_ORIGIN ?? "http://127.0.0.1:80";
const generations = new Map();

async function request(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(cookie && generations.has(cookie) ? { "X-Wudooh-Data-Generation": String(generations.get(cookie)) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function owner(label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `${label}-${suffix}@example.test`;
  const authHeaders = { "X-Forwarded-For": `203.0.113.${Math.floor(Math.random() * 200) + 1}` };
  const registration = await request("/auth/register", {
    method: "POST",
    headers: authHeaders,
    body: { projectName: `منشأة ${suffix}`, name: "مالك الاختبار", email, phone: `05${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`, password: "Safe-test-password-123" },
  });
  assert.equal(registration.response.status, 202, JSON.stringify(registration.payload));
  const verification = await request("/auth/email-verification/verify", {
    method: "POST",
    headers: authHeaders,
    body: { email, code: process.env.EMAIL_VERIFICATION_TEST_CODE },
  });
  assert.equal(verification.response.status, 200, JSON.stringify(verification.payload));
  const cookie = verification.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  generations.set(cookie, verification.payload.user.dataGeneration);
  return cookie;
}

function quotation(customerName, expiryDate = "2099-12-31") {
  return {
    number: "CLIENT-MUST-NOT-WIN",
    customerName,
    issueDate: "2026-09-01",
    expiryDate,
    status: "draft",
    items: [{ description: "خدمة استشارية", quantity: 2, unitPrice: 100, discount: 10, vatRate: 15, lineNet: 1, vatAmount: 1, total: 1 }],
    subtotal: 1,
    discount: 1,
    tax: 1,
    total: 1,
  };
}

test("ينشئ أرقام عروض متسلسلة ويحسب الإجماليات في الخادم ويعزل المنشآت", async () => {
  const firstOwner = await owner("quotation-a");
  const secondOwner = await owner("quotation-b");
  const first = await request("/data/quotations", { method: "POST", cookie: firstOwner, body: quotation("العميل الأول") });
  const second = await request("/data/quotations", { method: "POST", cookie: firstOwner, body: quotation("العميل الثاني") });
  assert.equal(first.response.status, 201, JSON.stringify(first.payload));
  assert.equal(second.response.status, 201, JSON.stringify(second.payload));
  assert.equal(first.payload.record.number, "QUO-0001");
  assert.equal(second.payload.record.number, "QUO-0002");
  assert.deepEqual(
    { subtotal: first.payload.record.subtotal, discount: first.payload.record.discount, tax: first.payload.record.tax, total: first.payload.record.total },
    { subtotal: 200, discount: 10, tax: 28.5, total: 218.5 },
  );
  const isolated = await request("/data/quotations", { cookie: secondOwner });
  assert.equal(isolated.response.status, 200);
  assert.equal(isolated.payload.records.some((record) => record.customerName === "العميل الأول"), false);
});

test("يحوّل العرض مرة واحدة ويربط الفاتورة ويقفل العرض", async () => {
  const cookie = await owner("quotation-convert");
  const created = await request("/data/quotations", { method: "POST", cookie, body: quotation("عميل التحويل") });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const id = created.payload.record.id;
  const converted = await request(`/data/quotations/${id}/convert`, { method: "POST", cookie });
  assert.equal(converted.response.status, 201, JSON.stringify(converted.payload));
  assert.equal(converted.payload.quotation.status, "accepted");
  assert.equal(converted.payload.invoice.sourceQuotationId, id);
  assert.equal(converted.payload.quotation.convertedInvoiceId, converted.payload.invoice.id);
  assert.equal((await request(`/data/quotations/${id}/convert`, { method: "POST", cookie })).response.status, 409);
  assert.equal((await request(`/data/quotations/${id}`, { method: "PATCH", cookie, body: { notes: "تعديل" } })).response.status, 409);
  assert.equal((await request(`/data/quotations/${id}`, { method: "DELETE", cookie })).response.status, 409);
});

test("يرفض تحويل العرض المنتهي", async () => {
  const cookie = await owner("quotation-expired");
  const expiredQuotation = quotation("عميل منتهي", "2026-08-31");
  expiredQuotation.issueDate = "2026-08-01";
  const created = await request("/data/quotations", { method: "POST", cookie, body: expiredQuotation });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const converted = await request(`/data/quotations/${created.payload.record.id}/convert`, { method: "POST", cookie });
  assert.equal(converted.response.status, 409);
  assert.match(converted.payload.error, /انتهت صلاحية/);
});