import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.AUTH_SECURITY_TEST_ORIGIN ?? "http://127.0.0.1:8080";
const apiBase = `${origin}/api`;

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

async function request(path, { method = "GET", body, forwardedFor } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test("يعيد الدخول رسالة عامة ويحظره بعد تجاوز حد العنوان", async () => {
  const forwardedFor = "198.51.100.20";
  const attempts = [];
  for (let index = 0; index < 11; index += 1) {
    attempts.push(await request("/auth/login", {
      method: "POST",
      body: {
        email: `${unique(`rate-login-${index}`)}@example.test`,
        password: "wrong-password",
      },
      forwardedFor,
    }));
  }

  for (const [index, attempt] of attempts.slice(0, 10).entries()) {
    const email = `rate-login-${index}`;
    assert.ok([401, 500].includes(attempt.response.status), JSON.stringify(attempt.payload));
    assert.ok(
      ["البريد الإلكتروني أو كلمة المرور غير صحيحة.", "تعذر إتمام الطلب حالياً. حاول لاحقاً."].includes(attempt.payload.error),
      JSON.stringify(attempt.payload),
    );
    assert.equal(JSON.stringify(attempt.payload).includes(email), false);
  }
  assert.equal(attempts[10].response.status, 429);
  assert.ok(Number(attempts[10].response.headers.get("retry-after")) > 0);
  assert.equal(attempts[10].payload.error, "تم تجاوز عدد المحاولات المسموح. انتظر قليلاً ثم أعد المحاولة.");
});

test("يعيد طلب الاستعادة رسالة عامة ويحظره بعد تجاوز حد شريحة البريد", async () => {
  const email = `${unique("rate-reset")}@example.test`;
  const attempts = [];
  for (let index = 0; index < 4; index += 1) {
    attempts.push(await request("/auth/password-reset/request", {
      method: "POST",
      body: { email },
      forwardedFor: `198.51.100.${30 + index}`,
    }));
  }

  assert.deepEqual(attempts.slice(0, 3).map(({ response }) => response.status), Array(3).fill(202));
  assert.equal(attempts[0].payload.message, "إذا كان البريد الإلكتروني مسجلاً، فستصلك رسالة تحتوي على رابط استعادة كلمة المرور.");
  assert.equal(attempts[0].payload.error, undefined);
  assert.equal(JSON.stringify(attempts[0].payload).includes(email), false);
  assert.equal(attempts[3].response.status, 429);
  assert.ok(Number(attempts[3].response.headers.get("retry-after")) > 0);
});

test("يعيد طلب الاستعادة رسالة عامة عند فشل التسليم دون كشف بيانات حساسة", async () => {
  const email = `${unique("delivery-failure")}@example.test`;
  const { response, payload } = await request("/auth/password-reset/request", {
    method: "POST",
    body: { email },
    forwardedFor: "203.0.113.77",
  });

  assert.equal(response.status, 202, JSON.stringify(payload));
  assert.equal(payload.error, undefined);
  assert.equal(JSON.stringify(payload).includes(email), false);
});

test("يضيف الخادم ترويسات الحماية وعدم التخزين", async () => {
  const { response } = await request("/auth/me", { forwardedFor: "198.51.100.50" });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("permissions-policy"), "geolocation=(), microphone=(), camera=()");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-powered-by"), null);
});