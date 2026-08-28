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
import { hashPassword } from "../src/lib/team-auth.ts";

let server;
let origin;
const organizationIds = [];
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const verificationCode = process.env.EMAIL_VERIFICATION_TEST_CODE;
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
  return request("/auth/register", {
    body: {
      projectName: `منشأة تحقق ${suffix}`,
      name: "مالك التحقق",
      email,
      phone,
      password: customPassword,
    },
  });
}

async function trackOrganization(email) {
  const [user] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.email, email)).limit(1);
  if (user) organizationIds.push(user.organizationId);
  return user;
}

before(async () => {
  assert.match(verificationCode ?? "", /^\d{6}$/);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await Promise.all([...new Set(organizationIds)].map((id) =>
    db.delete(organizationsTable).where(eq(organizationsTable.id, id))));
  await new Promise((resolve) => server.close(resolve));
});

test("ينشئ الحساب معلّقاً ولا يصدر جلسة قبل رمز البريد", async () => {
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
  assert.ok(sessionCookie(verified.response));
  assert.equal(verified.payload.user.email, email);
  assert.equal(verified.payload.user.phone, `+966${phone.slice(1)}`);
  assert.ok(verified.payload.user.emailVerifiedAt);

  const phoneLogin = await request("/auth/login", {
    body: { identifier: phone, password },
  });
  assert.equal(phoneLogin.response.status, 200, JSON.stringify(phoneLogin.payload));
  const emailLogin = await request("/auth/login", {
    body: { identifier: email, password },
  });
  assert.equal(emailLogin.response.status, 200, JSON.stringify(emailLogin.payload));
});

test("يرفض كلمة المرور الضعيفة والجوال المكرر", async () => {
  const weak = await registration(`weak-${suffix}@example.test`, mobile(), "weakpassword");
  assert.equal(weak.response.status, 400, JSON.stringify(weak.payload));
  assert.match(weak.payload.error, /حرف كبير/);

  const firstEmail = `phone-first-${suffix}@example.test`;
  const duplicateEmail = `phone-second-${suffix}@example.test`;
  const phone = mobile();
  const first = await registration(firstEmail, phone);
  assert.equal(first.response.status, 202, JSON.stringify(first.payload));
  await trackOrganization(firstEmail);
  const duplicate = await registration(duplicateEmail, phone);
  assert.equal(duplicate.response.status, 409, JSON.stringify(duplicate.payload));
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