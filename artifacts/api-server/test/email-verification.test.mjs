import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  emailVerificationCodesTable,
  organizationsTable,
  teamUsersTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { hashPassword, normalizeSaudiPhone } from "../src/lib/team-auth.ts";

let server;
let origin;
const organizationIds = [];
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const verificationCode = process.env.EMAIL_VERIFICATION_TEST_CODE;
const phoneVerificationCode = process.env.PHONE_VERIFICATION_TEST_CODE;
const password = "StrongPass!9";

function mobile() {
  return `05${String(randomInt(10_000_000, 100_000_000))}`;
}

async function request(path, { body, cookie, forwardedFor = `203.0.113.${randomInt(1, 250)}` } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Forwarded-For": forwardedFor,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function sessionCookie(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(?:^|,\s*)wudooh_session=([^;]+)/);
  return match ? `wudooh_session=${match[1]}` : null;
}

async function registration(email, phone, customPassword = password) {
  const startedAt = performance.now();
  const result = await request("/auth/register", {
    body: {
      projectName: `منشأة تحقق ${suffix}`,
      name: "مالك التحقق",
      email,
      phone,
      password: customPassword,
    },
  });
  return { ...result, durationMs: performance.now() - startedAt };
}

async function trackOrganization(email) {
  const [user] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.email, email)).limit(1);
  if (user) organizationIds.push(user.organizationId);
  return user;
}

before(async () => {
  assert.match(verificationCode ?? "", /^\d{6}$/);
  assert.match(phoneVerificationCode ?? "", /^\d{6}$/);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await Promise.all([...new Set(organizationIds)].map((id) =>
    db.delete(organizationsTable).where(eq(organizationsTable.id, id))));
  await new Promise((resolve) => server.close(resolve));
});

test("لا يصدر جلسة حتى ينجح رمز البريد ورمز الجوال", async () => {
  const email = `pending-${suffix}@example.test`;
  const phone = mobile();
  const created = await registration(email, phone);
  assert.equal(created.response.status, 202, JSON.stringify(created.payload));
  assert.equal(created.payload.verificationRequired, true);
  assert.equal(sessionCookie(created.response), null);

  const user = await trackOrganization(email);
  assert.equal(user.status, "pending_email_verification");
  assert.equal(user.phone, `+966${phone.slice(1)}`);
  assert.equal(user.emailVerifiedAt, null);
  assert.equal(user.phoneVerifiedAt, null);

  const loginBeforeVerification = await request("/auth/login", {
    body: { identifier: phone, password },
  });
  assert.equal(loginBeforeVerification.response.status, 403, JSON.stringify(loginBeforeVerification.payload));
  assert.equal(loginBeforeVerification.payload.code, "email_verification_required");

  const invalid = await request("/auth/email-verification/verify", {
    body: { email, code: "000000" },
  });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.payload));

  const verified = await request("/auth/email-verification/verify", {
    body: { email, code: verificationCode },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
  assert.equal(sessionCookie(verified.response), null);
  assert.equal(verified.payload.phoneVerificationRequired, true);

  const loginBeforePhoneVerification = await request("/auth/login", {
    body: { identifier: phone, password },
  });
  assert.equal(loginBeforePhoneVerification.response.status, 403, JSON.stringify(loginBeforePhoneVerification.payload));
  assert.equal(loginBeforePhoneVerification.payload.code, "phone_verification_required");

  const phoneVerified = await request("/auth/phone-verification/verify", {
    body: { email, code: phoneVerificationCode },
  });
  assert.equal(phoneVerified.response.status, 200, JSON.stringify(phoneVerified.payload));
  assert.ok(sessionCookie(phoneVerified.response));
  assert.equal(phoneVerified.payload.user.email, email);
  assert.equal(phoneVerified.payload.user.phone, `+966${phone.slice(1)}`);
  assert.ok(phoneVerified.payload.user.emailVerifiedAt);
  assert.ok(phoneVerified.payload.user.phoneVerifiedAt);

  const phoneLogin = await request("/auth/login", {
    body: { identifier: phone, password },
  });
  assert.equal(phoneLogin.response.status, 200, JSON.stringify(phoneLogin.payload));
  const emailLogin = await request("/auth/login", {
    body: { identifier: email, password },
  });
  assert.equal(emailLogin.response.status, 200, JSON.stringify(emailLogin.payload));
});

test("يبقي الرقم القديم حتى توثيق الجديد ثم ينقل الدخول إليه", async () => {
  const email = `phone-change-${suffix}@example.test`;
  const oldPhone = mobile();
  const newPhone = mobile();
  await registration(email, oldPhone);
  const user = await trackOrganization(email);
  await request("/auth/email-verification/verify", { body: { email, code: verificationCode } });
  const initialVerification = await request("/auth/phone-verification/verify", {
    body: { email, code: phoneVerificationCode },
  });
  const cookie = sessionCookie(initialVerification.response);
  assert.ok(cookie);

  const requested = await request("/auth/phone-change/request", {
    cookie,
    body: { phone: newPhone },
  });
  assert.equal(requested.response.status, 202, JSON.stringify(requested.payload));
  const [beforeVerification] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, user.id));
  assert.equal(beforeVerification.phone, `+966${oldPhone.slice(1)}`);
  assert.ok(beforeVerification.phoneVerifiedAt);

  const verified = await request("/auth/phone-change/verify", {
    cookie,
    body: { code: phoneVerificationCode },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
  assert.equal(verified.payload.reauthenticationRequired, true);
  const [afterVerification] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, user.id));
  assert.equal(afterVerification.phone, `+966${newPhone.slice(1)}`);
  assert.ok(afterVerification.phoneVerifiedAt);

  const oldLogin = await request("/auth/login", { body: { identifier: oldPhone, password } });
  assert.equal(oldLogin.response.status, 401, JSON.stringify(oldLogin.payload));
  const newLogin = await request("/auth/login", { body: { identifier: newPhone, password } });
  assert.equal(newLogin.response.status, 200, JSON.stringify(newLogin.payload));
});

test("يرفض كلمة المرور الضعيفة ويقبل الجوال المكرر برسالة عامة", async () => {
  const weak = await registration(`weak-${suffix}@example.test`, mobile(), "weakpassword");
  assert.equal(weak.response.status, 400, JSON.stringify(weak.payload));
  assert.match(weak.payload.error, /حرف كبير/);

  const firstEmail = `phone-first-${suffix}@example.test`;
  const duplicateEmail = `phone-second-${suffix}@example.test`;
  const phone = mobile();
  const first = await registration(firstEmail, phone);
  assert.equal(first.response.status, 202, JSON.stringify(first.payload));
  const firstUser = await trackOrganization(firstEmail);
  const oldLastSentAt = new Date(Date.now() - 120_000);
  await db.update(emailVerificationCodesTable)
    .set({ lastSentAt: oldLastSentAt })
    .where(eq(emailVerificationCodesTable.userId, firstUser.id));
  const pendingDuplicate = await registration(firstEmail, phone);
  assert.equal(pendingDuplicate.response.status, 202, JSON.stringify(pendingDuplicate.payload));
  assert.deepEqual(pendingDuplicate.payload, first.payload);
  const [reissuedCode] = await db.select().from(emailVerificationCodesTable)
    .where(eq(emailVerificationCodesTable.userId, firstUser.id));
  assert.ok(reissuedCode.lastSentAt > oldLastSentAt);

  const duplicate = await registration(duplicateEmail, phone);
  assert.equal(duplicate.response.status, 202, JSON.stringify(duplicate.payload));
  assert.deepEqual(duplicate.payload, {
    verificationRequired: true,
    email: duplicateEmail,
    phone: first.payload.phone,
    expiresInSeconds: 600,
  });
  assert.equal(sessionCookie(duplicate.response), null);
  const [unchangedUser] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, firstUser.id));
  assert.equal(unchangedUser.email, firstEmail);
  assert.equal(unchangedUser.phone, `+966${phone.slice(1)}`);
  assert.equal(unchangedUser.name, firstUser.name);
});

test("لا يترك حساباً معلقاً إذا فشل إرسال رمز الجوال", async () => {
  const email = `sms-failure-${suffix}@example.test`;
  process.env.SMS_DELIVERY_TEST_FAIL = "1";
  try {
    const failed = await registration(email, mobile());
    assert.equal(failed.response.status, 503, JSON.stringify(failed.payload));
    const users = await db.select().from(teamUsersTable).where(eq(teamUsersTable.email, email));
    assert.equal(users.length, 0);
  } finally {
    delete process.env.SMS_DELIVERY_TEST_FAIL;
  }
});

test("يوحّد رد التسجيل للحساب النشط دون تعديل بياناته أو إصدار جلسة", async () => {
  const email = `active-duplicate-${suffix}@example.test`;
  const phone = mobile();
  const created = await registration(email, phone);
  assert.equal(created.response.status, 202, JSON.stringify(created.payload));
  const user = await trackOrganization(email);
  await db.update(emailVerificationCodesTable)
    .set({ lastSentAt: new Date(Date.now() - 120_000) })
    .where(eq(emailVerificationCodesTable.userId, user.id));
  const verified = await request("/auth/email-verification/verify", {
    body: { email, code: verificationCode },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
  const phoneVerified = await request("/auth/phone-verification/verify", {
    body: { email, code: phoneVerificationCode },
  });
  assert.equal(phoneVerified.response.status, 200, JSON.stringify(phoneVerified.payload));
  const [activeSnapshot] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, user.id));
  const duplicate = await registration(email, phone);
  assert.equal(duplicate.response.status, 202, JSON.stringify(duplicate.payload));
  assert.deepEqual(duplicate.payload, created.payload);
  assert.equal(sessionCookie(duplicate.response), null);
  const [unchangedUser] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, user.id));
  assert.deepEqual(unchangedUser, activeSnapshot);
});

test("لا يكشف الحساب النشط عند تأخر مزود البريد أو فشل الإرسال", async () => {
  const activeEmail = `provider-active-${suffix}@example.test`;
  const activePhone = mobile();
  const createdActive = await registration(activeEmail, activePhone);
  const activeUser = await trackOrganization(activeEmail);
  const verified = await request("/auth/email-verification/verify", {
    body: { email: activeEmail, code: verificationCode },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
  const phoneVerified = await request("/auth/phone-verification/verify", {
    body: { email: activeEmail, code: phoneVerificationCode },
  });
  assert.equal(phoneVerified.response.status, 200, JSON.stringify(phoneVerified.payload));
  const [activeSnapshot] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, activeUser.id));

  process.env.EMAIL_DELIVERY_TEST_DELAY_MS = "900";
  process.env.EMAIL_DELIVERY_TEST_FAIL = "1";
  try {
    const newEmail = `provider-new-${suffix}@example.test`;
    const createdNew = await registration(newEmail, mobile());
    const existingActive = await registration(activeEmail, activePhone);
    await trackOrganization(newEmail);

    assert.equal(createdNew.response.status, 202, JSON.stringify(createdNew.payload));
    assert.equal(existingActive.response.status, 202, JSON.stringify(existingActive.payload));
    assert.deepEqual(
      { ...createdNew.payload, email: "<submitted-email>", phone: "<submitted-phone>" },
      { ...existingActive.payload, email: "<submitted-email>", phone: "<submitted-phone>" },
    );
    assert.equal(sessionCookie(createdNew.response), null);
    assert.equal(sessionCookie(existingActive.response), null);
    assert.ok(createdNew.durationMs < 700, `new registration took ${createdNew.durationMs}ms`);
    assert.ok(existingActive.durationMs < 700, `existing registration took ${existingActive.durationMs}ms`);
    assert.ok(
      Math.abs(createdNew.durationMs - existingActive.durationMs) < 200,
      `registration timing differed by ${Math.abs(createdNew.durationMs - existingActive.durationMs)}ms`,
    );
    const [unchangedActive] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.id, activeUser.id));
    assert.deepEqual(unchangedActive, activeSnapshot);
  } finally {
    delete process.env.EMAIL_DELIVERY_TEST_DELAY_MS;
    delete process.env.EMAIL_DELIVERY_TEST_FAIL;
  }
});

test("يقبل سباقي تسجيل للهوية نفسها دون إنشاء حسابين", async () => {
  const email = `concurrent-${suffix}@example.test`;
  const phone = mobile();
  const [first, second] = await Promise.all([
    registration(email, phone),
    registration(email, phone),
  ]);
  assert.equal(first.response.status, 202, JSON.stringify(first.payload));
  assert.equal(second.response.status, 202, JSON.stringify(second.payload));
  assert.deepEqual(first.payload, second.payload);
  assert.equal(sessionCookie(first.response), null);
  assert.equal(sessionCookie(second.response), null);
  const users = await db.select().from(teamUsersTable).where(eq(teamUsersTable.email, email));
  assert.equal(users.length, 1);
  organizationIds.push(users[0].organizationId);
});

test("يرفض الرمز المنتهي ويعيد الإصدار دون كشف حالة الحساب", async () => {
  const email = `expired-${suffix}@example.test`;
  const created = await registration(email, mobile());
  assert.equal(created.response.status, 202, JSON.stringify(created.payload));
  const user = await trackOrganization(email);
  await db.update(emailVerificationCodesTable)
    .set({
      expiresAt: new Date(Date.now() - 1_000),
      lastSentAt: new Date(Date.now() - 120_000),
    })
    .where(eq(emailVerificationCodesTable.userId, user.id));

  const expired = await request("/auth/email-verification/verify", {
    body: { email, code: verificationCode },
  });
  assert.equal(expired.response.status, 400, JSON.stringify(expired.payload));

  const resend = await request("/auth/email-verification/resend", { body: { email } });
  const unknown = await request("/auth/email-verification/resend", {
    body: { email: `unknown-${suffix}@example.test` },
  });
  assert.equal(resend.response.status, 202, JSON.stringify(resend.payload));
  assert.equal(unknown.response.status, 202, JSON.stringify(unknown.payload));
  assert.deepEqual(resend.payload, unknown.payload);

  const verified = await request("/auth/email-verification/verify", {
    body: { email, code: verificationCode },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));
});

test("يقفل رمز التفعيل بعد خمس محاولات خاطئة", async () => {
  const email = `attempts-${suffix}@example.test`;
  const created = await registration(email, mobile());
  assert.equal(created.response.status, 202, JSON.stringify(created.payload));
  await trackOrganization(email);

  const attempts = [];
  for (let index = 0; index < 5; index += 1) {
    attempts.push(await request("/auth/email-verification/verify", {
      body: { email, code: String(100000 + index) },
    }));
  }
  assert.deepEqual(attempts.slice(0, 4).map(({ response }) => response.status), [400, 400, 400, 400]);
  assert.equal(attempts[4].response.status, 429, JSON.stringify(attempts[4].payload));

  const correctAfterLock = await request("/auth/email-verification/verify", {
    body: { email, code: verificationCode },
  });
  assert.equal(correctAfterLock.response.status, 429, JSON.stringify(correctAfterLock.payload));
});

test("يحافظ على دخول الحسابات القديمة بالبريد", async () => {
  const email = `legacy-${suffix}@example.test`;
  const [organization] = await db.insert(organizationsTable).values({
    name: `منشأة قديمة ${suffix}`,
  }).returning();
  organizationIds.push(organization.id);
  await db.insert(teamUsersTable).values({
    organizationId: organization.id,
    email,
    name: "مالك قديم",
    passwordHash: await hashPassword(password),
    roleId: "owner",
    status: "active",
  });

  const login = await request("/auth/login", {
    body: { identifier: email, password },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.payload));
  assert.equal(login.payload.user.email, email);
  assert.equal(login.payload.user.emailVerifiedAt, null);
});

test("لا يثق بجوال حساب قديم قبل إكمال رمز التحقق", async () => {
  const email = `legacy-phone-${suffix}@example.test`;
  const phone = mobile();
  const normalizedPhone = normalizeSaudiPhone(phone);
  assert.ok(normalizedPhone);
  const [organization] = await db.insert(organizationsTable).values({
    name: `منشأة جوال قديمة ${suffix}`,
  }).returning();
  organizationIds.push(organization.id);
  await db.insert(teamUsersTable).values({
    organizationId: organization.id,
    email,
    phone: normalizedPhone,
    name: "مالك بجوال قديم",
    passwordHash: await hashPassword(password),
    roleId: "owner",
    status: "active",
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: null,
  });

  process.env.SMS_DELIVERY_FORCE_UNCONFIGURED = "1";
  try {
    const unavailablePhoneLogin = await request("/auth/login", {
      body: { identifier: phone, password },
    });
    assert.equal(unavailablePhoneLogin.response.status, 503, JSON.stringify(unavailablePhoneLogin.payload));
    const legacyEmailLogin = await request("/auth/login", {
      body: { identifier: email, password },
    });
    assert.equal(legacyEmailLogin.response.status, 200, JSON.stringify(legacyEmailLogin.payload));
  } finally {
    delete process.env.SMS_DELIVERY_FORCE_UNCONFIGURED;
  }

  const denied = await request("/auth/login", {
    body: { identifier: phone, password },
  });
  assert.equal(denied.response.status, 403, JSON.stringify(denied.payload));
  assert.equal(denied.payload.code, "phone_verification_required");

  const resent = await request("/auth/phone-verification/resend", {
    body: { email },
  });
  assert.equal(resent.response.status, 202, JSON.stringify(resent.payload));
  const verified = await request("/auth/phone-verification/verify", {
    body: { email, code: phoneVerificationCode },
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.payload));

  const login = await request("/auth/login", {
    body: { identifier: phone, password },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.payload));
});