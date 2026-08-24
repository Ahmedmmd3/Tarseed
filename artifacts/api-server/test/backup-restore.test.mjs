import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.BACKUP_TEST_ORIGIN ?? "http://127.0.0.1:80";
const apiBase = `${origin}/api`;

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
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
  return cookieFrom(response);
}

test("يستعيد المالك نسخة بيانات منشأته دون إبقاء التغييرات اللاحقة", async () => {
  const cookie = await registerOwner();
  const originalAccount = await request("/data/accounts", {
    method: "POST",
    cookie,
    body: { code: unique("1000"), name: "حساب قبل النسخة", type: "asset", balance: 0, status: "active" },
  });
  assert.equal(originalAccount.response.status, 201, JSON.stringify(originalAccount.payload));

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

  const restored = await request("/backup/restore", {
    method: "POST",
    cookie,
    body: exported.payload,
  });
  assert.equal(restored.response.status, 200, JSON.stringify(restored.payload));

  const accounts = await request("/data/accounts", { cookie });
  assert.equal(accounts.response.status, 200, JSON.stringify(accounts.payload));
  assert.ok(accounts.payload.records.some((account) => account.name === "حساب قبل النسخة"));
  assert.ok(!accounts.payload.records.some((account) => account.name === "حساب بعد النسخة"));
});