import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.LOCATION_SCOPE_TEST_ORIGIN ?? "http://127.0.0.1:80";
const apiBase = `${origin}/api`;
const generationByCookie = new Map();

function unique(value) {
  return `${value}-${crypto.randomUUID().slice(0, 8)}`;
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const generation = generationByCookie.get(cookie);
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
  assert.ok(cookie, "يجب أن ينشئ الخادم جلسة مستقلة");
  return cookie.split(";")[0];
}

async function registerOwner() {
  const email = `${unique("location-owner")}@example.test`;
  const password = "Safe-test-password-123";
  const { response, payload } = await request("/auth/register", {
    method: "POST",
    body: { projectName: unique("منشأة نطاق المواقع"), name: "مالك الاختبار", email, password },
  });
  assert.equal(response.status, 201, JSON.stringify(payload));
  const cookie = cookieFrom(response);
  generationByCookie.set(cookie, payload.user.dataGeneration);
  return { email, password, cookie };
}

async function login(email, password) {
  const { response, payload } = await request("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(response.status, 200, JSON.stringify(payload));
  const cookie = cookieFrom(response);
  generationByCookie.set(cookie, payload.user.dataGeneration);
  return cookie;
}

async function mutate(cookie, method, path, body) {
  return request(path, { method, cookie, ...(body ? { body } : {}) });
}

test("يمنع موظف الموقع المحدد من تعديل أو حذف منتج تابع لموقع آخر", async () => {
  const owner = await registerOwner();
  const locations = await request("/data/warehouses", { cookie: owner.cookie });
  assert.equal(locations.response.status, 200, JSON.stringify(locations.payload));
  const [allowedLocation, restrictedLocation] = locations.payload.records;
  assert.ok(allowedLocation?.id && restrictedLocation?.id, "يجب إنشاء موقعين للاختبار");

  const product = await mutate(owner.cookie, "POST", "/data/products", {
    name: unique("منتج موقع آخر"),
    warehouseId: restrictedLocation.id,
    stock: 0,
    sellPrice: 20,
  });
  assert.equal(product.response.status, 201, JSON.stringify(product.payload));

  const memberEmail = `${unique("location-member")}@example.test`;
  const member = await mutate(owner.cookie, "POST", "/team/members", {
    name: "موظف موقع محدد",
    email: memberEmail,
    password: "Safe-test-password-123",
    roleId: "inventory",
    permissions: { inventory: true },
    locationScope: "selected",
    warehouseIds: [allowedLocation.id],
  });
  assert.equal(member.response.status, 201, JSON.stringify(member.payload));
  const memberCookie = await login(memberEmail, "Safe-test-password-123");

  const update = await mutate(memberCookie, "PATCH", `/data/products/${product.payload.record.id}`, {
    name: "محاولة تعديل خارج النطاق",
  });
  assert.equal(update.response.status, 403, JSON.stringify(update.payload));

  const remove = await mutate(memberCookie, "DELETE", `/data/products/${product.payload.record.id}`);
  assert.equal(remove.response.status, 403, JSON.stringify(remove.payload));
});