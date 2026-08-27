import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import app from "../dist/app.mjs";

const server = createServer(app);
let origin;
let originalFetch;
let resetEmailBody;

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await originalFetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
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

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (requestUrl.startsWith(origin)) {
      return originalFetch(input, init);
    }

    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (body?.subject === "استعادة كلمة مرور ترصيد") {
      resetEmailBody = body;
    }
    return new Response(JSON.stringify({ error: "simulated Resend outage" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  };
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("يُبقي الرد عاماً ويسجل سبب فشل البريد ويحذف الرمز غير القابل للاستخدام", async () => {
  const ownerEmail = `${unique("reset-owner")}@example.test`;
  const ownerPassword = "Safe-test-password-123";
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: {
      projectName: unique("منشأة اختبار الاستعادة"),
      name: "مالك الاختبار",
      email: ownerEmail,
      password: ownerPassword,
    },
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.payload));
  const ownerCookie = cookieFrom(registered.response);

  const memberEmail = `${unique("reset-member")}@example.test`;
  const createdMember = await request("/api/team/members", {
    method: "POST",
    cookie: ownerCookie,
    body: {
      name: "عضو اختبار الاستعادة",
      email: memberEmail,
      password: ownerPassword,
      roleId: "sales",
      status: "active",
      permissions: { dashboard: true, sales: true },
      locationScope: "all",
      warehouseIds: [],
    },
  });
  assert.equal(createdMember.response.status, 201, JSON.stringify(createdMember.payload));

  const activeStartedAt = performance.now();
  const reset = await request("/api/auth/password-reset/request", {
    method: "POST",
    body: { email: memberEmail },
  });
  const activeDuration = performance.now() - activeStartedAt;
  assert.equal(reset.response.status, 202, JSON.stringify(reset.payload));
  assert.equal(reset.payload.message, "إذا كان البريد الإلكتروني مسجلاً، فستصلك رسالة تحتوي على رابط استعادة كلمة المرور.");
  assert.equal(JSON.stringify(reset.payload).includes(memberEmail), false);
  assert.ok(resetEmailBody, "يجب أن يحاول الخادم إرسال رسالة الاستعادة");

  const unknownStartedAt = performance.now();
  const unknownReset = await request("/api/auth/password-reset/request", {
    method: "POST",
    body: { email: `${unique("unknown-reset")}@example.test` },
  });
  const unknownDuration = performance.now() - unknownStartedAt;
  assert.equal(unknownReset.response.status, 202, JSON.stringify(unknownReset.payload));
  assert.ok(activeDuration >= 250, `زمن الحساب الفعلي أقصر من الحد المتوقع: ${activeDuration}ms`);
  assert.ok(unknownDuration >= 250, `زمن الحساب غير الموجود أقصر من الحد المتوقع: ${unknownDuration}ms`);
  assert.ok(
    Math.abs(activeDuration - unknownDuration) < 200,
    `فرق زمن الاستعادة أكبر من هامش الاختبار: active=${activeDuration}ms unknown=${unknownDuration}ms`,
  );

  const tokenMatch = resetEmailBody.html.match(/reset-password\?token=([^"'&]+)/);
  assert.ok(tokenMatch, "يجب أن تحتوي رسالة الاستعادة على رمز اختبار");
  const confirm = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: { token: decodeURIComponent(tokenMatch[1]), password: "New-test-password-123" },
  });
  assert.equal(confirm.response.status, 400, JSON.stringify(confirm.payload));
  assert.match(confirm.payload.error, /رابط الاستعادة غير صالح/);

  const auditLogs = await request("/api/audit-logs", { cookie: ownerCookie });
  assert.equal(auditLogs.response.status, 200, JSON.stringify(auditLogs.payload));
  const failure = auditLogs.payload.logs.find((log) => log.action === "password_reset_delivery_failed");
  assert.ok(failure, "يجب أن يرى المالك فشل التسليم في سجل التدقيق");
  assert.match(failure.details, /السبب التشخيصي: رفض مزود البريد Resend الطلب برمز الحالة 503/);
});