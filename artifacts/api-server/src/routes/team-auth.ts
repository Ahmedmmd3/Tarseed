import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  authSessionsTable,
  db,
  emailVerificationCodesTable,
  erpRecordsTable,
  organizationsTable,
  passwordResetTokensTable,
  teamAuditLogsTable,
  teamUsersTable,
  type TeamUser,
} from "@workspace/db";
import {
  createEmailVerificationCode,
  createPasswordResetToken,
  createSessionToken,
  hashEmailVerificationCode,
  hashPassword,
  hashSessionToken,
  isEmail,
  normalizeSaudiPhone,
  validatePassword,
  verifyCodeHash,
  verifyPassword,
} from "../lib/team-auth";
import { logger } from "../lib/logger";
import { getAuthContext, hasSubscriptionAccess, requireAuth, requireOwner, requireSubscriptionAccess, subscriptionState, type AuthContext, type SubscriptionFields } from "../middleware/team-auth";

const router: IRouter = Router();
const SESSION_DAYS = 14;
const REMOTE_SESSION_HINT_COOKIE = "wudooh_remote_session";
const PERMISSION_KEYS = new Set(["dashboard", "sales", "accounting", "inventory", "hr", "operations", "reports"]);
const ROLE_IDS = new Set(["sales", "accountant", "inventory", "hr", "manager", "custom"]);
const LOCATION_SCOPES = new Set(["all", "selected", "none"]);
const PASSWORD_RESET_MINUTES = 30;
const PASSWORD_RESET_RESPONSE_FLOOR_MS = 300;
const EMAIL_VERIFICATION_MINUTES = 10;
const EMAIL_VERIFICATION_RESEND_SECONDS = 60;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
const EMAIL_VERIFICATION_RESPONSE_FLOOR_MS = 300;
const connectors = new ReplitConnectors();

function safeUser(user: TeamUser, organization: Pick<AuthContext, "projectName" | "dataGeneration" | "planId" | "subscriptionStatus" | "trialStartedAt" | "trialEndsAt" | "subscriptionStartedAt" | "subscriptionEndsAt" | "platformAccessSuspendedAt">) {
  const subscription: SubscriptionFields = {
    planId: organization.planId,
    subscriptionStatus: organization.subscriptionStatus,
    trialStartedAt: organization.trialStartedAt,
    trialEndsAt: organization.trialEndsAt,
    subscriptionStartedAt: organization.subscriptionStartedAt,
    subscriptionEndsAt: organization.subscriptionEndsAt,
    platformAccessSuspendedAt: organization.platformAccessSuspendedAt,
  };
  return {
    id: user.id,
    accountId: user.id,
    organizationId: user.organizationId,
    projectName: organization.projectName,
    dataGeneration: organization.dataGeneration,
    email: user.email,
    phone: user.phone,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    name: user.name,
    roleId: user.roleId,
    permissions: user.permissions,
    locationScope: user.locationScope,
    warehouseIds: user.warehouseIds,
    status: user.status,
    isTeamMember: user.roleId !== "owner",
    subscription: {
      planId: subscription.planId,
      status: subscriptionState(subscription),
      accessActive: hasSubscriptionAccess(subscription),
      trialStartedAt: subscription.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      subscriptionStartedAt: subscription.subscriptionStartedAt?.toISOString() ?? null,
      subscriptionEndsAt: subscription.subscriptionEndsAt?.toISOString() ?? null,
    },
  };
}

function setSession(response: Response, token: string): void {
  response.cookie("wudooh_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
  // This is only a non-sensitive availability hint for the frontend. The
  // actual session remains in the httpOnly cookie above.
  response.cookie(REMOTE_SESSION_HINT_COOKIE, "1", {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

async function createSession(userId: number): Promise<string> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(authSessionsTable).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return token;
}

async function recordAudit(auth: AuthContext, action: string, entity = "", details = ""): Promise<void> {
  await db.insert(teamAuditLogsTable).values({
    organizationId: auth.organizationId,
    actorId: auth.id,
    actorName: auth.name || auth.email,
    action,
    entity,
    details,
  });
}

function subscriptionWriteFailure(organization: SubscriptionFields | undefined): { error: string; code: string } {
  return organization?.platformAccessSuspendedAt
    ? { error: "تم تعليق وصول هذه المنشأة من إدارة المنصة.", code: "platform_access_suspended" }
    : { error: "يتطلب الوصول إلى لوحة التحكم اشتراكاً فعالاً أو فترة تجريبية سارية.", code: "subscription_required" };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character] ?? character));
}

function passwordResetUrl(request: Request, token: string): string {
  const configuredOrigin = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const origin = configuredOrigin || `${forwardedProtocol || request.protocol}://${request.get("host")}`;
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

async function sendResendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
  const configuredSender = process.env.RESEND_FROM_EMAIL?.trim();
  if (!configuredSender && process.env.NODE_ENV === "production") {
    throw new Error("Email delivery is not configured.");
  }
  if (process.env.NODE_ENV === "test") return;
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: configuredSender || "Tarseed <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend request failed with status ${response.status}`);
  }
}

async function sendEmailVerificationCode({
  email,
  name,
  code,
}: {
  email: string;
  name: string;
  code: string;
}): Promise<void> {
  await sendResendEmail({
    to: email,
    subject: "رمز تفعيل حساب ترصيد",
    html: `
      <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#0f172a">
        <h1 style="font-size:22px">تفعيل حسابك في ترصيد</h1>
        <p>مرحباً ${escapeHtml(name)}،</p>
        <p>أدخل الرمز التالي لإكمال إنشاء حساب منشأتك:</p>
        <p dir="ltr" style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:10px;color:#0f766e">${escapeHtml(code)}</p>
        <p>ينتهي الرمز خلال ${EMAIL_VERIFICATION_MINUTES} دقائق، ويمكن استخدامه مرة واحدة فقط.</p>
        <p>إذا لم تطلب إنشاء الحساب، تجاهل هذه الرسالة.</p>
      </div>`,
  });
}

async function sendPasswordResetEmail({ email, name, resetUrl }: { email: string; name: string; resetUrl: string }): Promise<void> {
  await sendResendEmail({
    to: email,
    subject: "استعادة كلمة مرور ترصيد",
    html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
          <h1 style="font-size:22px">استعادة كلمة المرور</h1>
          <p>مرحباً ${escapeHtml(name)}،</p>
          <p>وصلنا طلباً لإعادة تعيين كلمة مرور حسابك في ترصيد. استخدم الرابط التالي لاختيار كلمة مرور جديدة:</p>
          <p style="margin:28px 0"><a href="${resetUrl}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">إعادة تعيين كلمة المرور</a></p>
          <p>ينتهي هذا الرابط خلال ${PASSWORD_RESET_MINUTES} دقيقة ويمكن استخدامه مرة واحدة فقط.</p>
          <p>إذا لم تطلب تغيير كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان.</p>
        </div>`,
  });
}

async function deliverPasswordResetEmail({
  user,
  request,
  token,
  recordId,
}: {
  user: TeamUser;
  request: Request;
  token: string;
  recordId: number;
}): Promise<void> {
  try {
    await sendPasswordResetEmail({
      email: user.email,
      name: user.name,
      resetUrl: passwordResetUrl(request, token),
    });
  } catch (error) {
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.id, recordId));
    const reason = deliveryFailureReason(error);
    logger.error(
      {
        err: error,
        organizationId: user.organizationId,
        userId: user.id,
        provider: "resend",
        operation: "password_reset_delivery",
        deliveryFailureReason: reason,
      },
      "Unable to deliver password reset email",
    );
    try {
      await notifyOwnersAboutResetDeliveryFailure({
        organizationId: user.organizationId,
        targetEmail: user.email,
        reason,
      });
    } catch (notificationError) {
      logger.error(
        { err: notificationError, userId: user.id },
        "Unable to record password reset failure notification",
      );
    }
  }
}

function deliveryFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Email delivery is not configured.") {
    return "لم يُضبط عنوان بريد الإرسال.";
  }
  const status = /Resend request failed with status (\d{3})/.exec(message)?.[1];
  if (status) {
    return `رفض مزود البريد Resend الطلب برمز الحالة ${status}.`;
  }
  return "تعذر الاتصال بمزود البريد Resend. راجع سجل الخادم.";
}

async function notifyOwnersAboutResetDeliveryFailure({
  organizationId,
  targetEmail,
  reason,
}: {
  organizationId: number;
  targetEmail: string;
  reason: string;
}): Promise<void> {
  const owners = await db.select({
    id: teamUsersTable.id,
    email: teamUsersTable.email,
    name: teamUsersTable.name,
  }).from(teamUsersTable).where(and(
    eq(teamUsersTable.organizationId, organizationId),
    eq(teamUsersTable.roleId, "owner"),
    eq(teamUsersTable.status, "active"),
  ));

  await db.insert(teamAuditLogsTable).values({
    organizationId,
    actorId: null,
    actorName: "النظام",
    action: "password_reset_delivery_failed",
    entity: targetEmail,
    details: `تعذر تسليم رابط استعادة كلمة المرور. السبب التشخيصي: ${reason}`,
  });

  await Promise.all(owners.map(async (owner) => {
    try {
      await sendResendEmail({
        to: owner.email,
        subject: "تنبيه: تعذر إرسال رابط استعادة كلمة المرور",
        html: `
          <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
            <h1 style="font-size:22px">تعذر إرسال رابط استعادة كلمة المرور</h1>
            <p>مرحباً ${escapeHtml(owner.name)}،</p>
            <p>تعذر على ترصيد تسليم رابط استعادة كلمة المرور لأحد أعضاء الفريق.</p>
            <p>السبب التشخيصي: ${escapeHtml(reason)}</p>
            <p>راجع إعدادات البريد وسجل التدقيق في إدارة الفريق. لم يتم تضمين أي رمز أو رابط حساس في هذا التنبيه.</p>
          </div>`,
      });
    } catch (notificationError) {
      logger.warn(
        { err: notificationError, organizationId, ownerId: owner.id },
        "Unable to deliver password reset failure notification to owner",
      );
    }
  }));
}

function validateMemberBody(body: Record<string, unknown>, requiresPassword: boolean) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const roleId = typeof body.roleId === "string" ? body.roleId : "custom";
  const status = body.status === "inactive" ? "inactive" : "active";
  const locationScope = typeof body.locationScope === "string" ? body.locationScope : "selected";
  const rawPermissions = body.permissions && typeof body.permissions === "object" ? body.permissions as Record<string, unknown> : {};
  const permissions = Object.fromEntries([...PERMISSION_KEYS].map(key => [key, rawPermissions[key] === true]));
  const rawWarehouseIds = Array.isArray(body.warehouseIds) ? body.warehouseIds : [];
  const warehouseIds = [...new Set(rawWarehouseIds.filter(id => Number.isInteger(id) && Number(id) > 0).map(Number))];
  if (!name || !isEmail(email)) return { error: "أدخل الاسم والبريد الإلكتروني الصحيحين." };
  const passwordError = password ? validatePassword(password) : null;
  if ((requiresPassword && !password) || passwordError) return { error: passwordError ?? "أدخل كلمة مرور قوية." };
  if (!ROLE_IDS.has(roleId) || !LOCATION_SCOPES.has(locationScope)) return { error: "بيانات الدور أو نطاق المواقع غير صحيحة." };
  if (locationScope !== "selected" && warehouseIds.length) return { error: "حدّد المواقع فقط عند اختيار نطاق مواقع محددة." };
  if (locationScope === "selected" && warehouseIds.length === 0) return { error: "اختر موقعاً واحداً على الأقل أو استخدم نطاق «لا مواقع»." };
  return { data: { name, email, password, roleId, status, permissions, locationScope, warehouseIds } };
}

router.post("/auth/register", async (request: Request, response: Response): Promise<void> => {
  const body = request.body as Record<string, unknown>;
  const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
  const phone = typeof body.phone === "string" ? normalizeSaudiPhone(body.phone) : null;
  const validation = validateMemberBody({ ...body, roleId: "sales", locationScope: "all" }, true);
  if (!projectName || !phone || !validation.data) {
    response.status(400).json({
      error: !projectName
        ? "أدخل اسم المنشأة."
        : !phone
          ? "أدخل رقم جوال صحيحاً، مثل 05xxxxxxxx."
          : validation.error,
    });
    return;
  }
  const existing = await db.select({ id: teamUsersTable.id }).from(teamUsersTable).where(or(
    eq(teamUsersTable.email, validation.data.email),
    eq(teamUsersTable.phone, phone),
  )).limit(1);
  if (existing.length) {
    response.status(409).json({ error: "تعذر إنشاء الحساب بهذه البيانات." });
    return;
  }
  const passwordHash = await hashPassword(validation.data.password);
  const { password: _password, ...ownerData } = validation.data;
  const trialStartedAt = new Date();
  const trialEndsAt = new Date(trialStartedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
  const verificationCode = process.env.NODE_ENV === "test" && /^\d{6}$/.test(process.env.EMAIL_VERIFICATION_TEST_CODE ?? "")
    ? process.env.EMAIL_VERIFICATION_TEST_CODE as string
    : createEmailVerificationCode();
  let result: { organizationId: number; userId: number };
  try {
    result = await db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizationsTable).values({
        name: projectName,
        planId: "trial",
        subscriptionStatus: "trialing",
        trialStartedAt,
        trialEndsAt,
      }).returning();
      const [user] = await tx.insert(teamUsersTable).values({
        organizationId: organization.id,
        ...ownerData,
        phone,
        emailVerifiedAt: null,
        passwordHash,
        status: "pending_email_verification",
        roleId: "owner",
        permissions: Object.fromEntries([...PERMISSION_KEYS].map(key => [key, true])),
        locationScope: "all",
        warehouseIds: [],
      }).returning();
      await tx.insert(emailVerificationCodesTable).values({
        userId: user.id,
        codeHash: hashEmailVerificationCode(verificationCode),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_MINUTES * 60 * 1000),
      });
      await tx.insert(erpRecordsTable).values([
        {
          organizationId: organization.id,
          tableName: "warehouses",
          data: { name: "المستودع الرئيسي", type: "warehouse", city: "", manager: "", status: "active" },
        },
        {
          organizationId: organization.id,
          tableName: "warehouses",
          data: { name: "فرع المبيعات", type: "branch", city: "", manager: "", status: "active" },
        },
      ]);
      return { organizationId: organization.id, userId: user.id };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      response.status(409).json({ error: "تعذر إنشاء الحساب بهذه البيانات." });
      return;
    }
    throw error;
  }

  try {
    await sendEmailVerificationCode({
      email: validation.data.email,
      name: validation.data.name,
      code: verificationCode,
    });
  } catch (error) {
    await db.delete(organizationsTable).where(eq(organizationsTable.id, result.organizationId));
    logger.error(
      { err: error, userId: result.userId, operation: "email_verification_delivery" },
      "Unable to deliver registration verification email",
    );
    response.status(503).json({ error: "تعذر إرسال رمز التفعيل حالياً. تحقق من البريد وحاول مرة أخرى." });
    return;
  }

  response.status(202).json({
    verificationRequired: true,
    email: validation.data.email,
    expiresInSeconds: EMAIL_VERIFICATION_MINUTES * 60,
  });
});

router.post("/auth/login", async (request: Request, response: Response): Promise<void> => {
  const body = request.body as Record<string, unknown>;
  const rawIdentifier = typeof body.identifier === "string"
    ? body.identifier.trim()
    : typeof body.email === "string"
      ? body.email.trim()
      : "";
  const email = rawIdentifier.toLowerCase();
  const phone = isEmail(email) ? null : normalizeSaudiPhone(rawIdentifier);
  const password = typeof body.password === "string" ? body.password : "";
  const identityCondition = isEmail(email)
    ? eq(teamUsersTable.email, email)
    : phone
      ? eq(teamUsersTable.phone, phone)
      : null;
  if (!identityCondition) {
    response.status(401).json({ error: "البريد الإلكتروني أو رقم الجوال أو كلمة المرور غير صحيحة." });
    return;
  }
  const [candidate] = await db.select({
    id: teamUsersTable.id,
    organizationId: teamUsersTable.organizationId,
  }).from(teamUsersTable)
    .where(identityCondition)
    .limit(1);
  if (!candidate) {
    response.status(401).json({ error: "البريد الإلكتروني أو رقم الجوال أو كلمة المرور غير صحيحة." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.select().from(organizationsTable)
      .where(eq(organizationsTable.id, candidate.organizationId))
      .for("update");
    if (!organization) return null;
    const [user] = await tx.select().from(teamUsersTable)
      .where(and(
        eq(teamUsersTable.id, candidate.id),
        eq(teamUsersTable.organizationId, organization.id),
        identityCondition,
      ))
      .for("update");
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return null;
    }
    if (user.status === "pending_email_verification") {
      return { kind: "unverified" as const, email: user.email };
    }
    if (user.status !== "active") return null;
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await tx.insert(authSessionsTable).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
    return { kind: "authenticated" as const, user, organization, token };
  });
  if (!result) {
    response.status(401).json({ error: "البريد الإلكتروني أو رقم الجوال أو كلمة المرور غير صحيحة." });
    return;
  }
  if (result.kind === "unverified") {
    response.status(403).json({
      error: "يجب تفعيل البريد الإلكتروني قبل تسجيل الدخول.",
      code: "email_verification_required",
      email: result.email,
    });
    return;
  }

  setSession(response, result.token);
  const auth: AuthContext = {
    ...result.user,
    projectName: result.organization.name,
    dataGeneration: result.organization.dataGeneration,
    planId: result.organization.planId,
    subscriptionStatus: result.organization.subscriptionStatus,
    trialStartedAt: result.organization.trialStartedAt,
    trialEndsAt: result.organization.trialEndsAt,
    subscriptionStartedAt: result.organization.subscriptionStartedAt,
    subscriptionEndsAt: result.organization.subscriptionEndsAt,
    platformAccessSuspendedAt: result.organization.platformAccessSuspendedAt,
  };
  await recordAudit(auth, "login", "user", result.user.email);
  response.json({ user: safeUser(result.user, auth) });
});

router.post("/auth/email-verification/verify", async (request: Request, response: Response): Promise<void> => {
  const startedAt = Date.now();
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const code = typeof request.body?.code === "string" ? request.body.code.replace(/\D/g, "") : "";
  if (!isEmail(email) || !/^\d{6}$/.test(code)) {
    response.status(400).json({ error: "أدخل البريد ورمز التفعيل المكوّن من 6 أرقام." });
    return;
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(teamUsersTable)
      .where(eq(teamUsersTable.email, email))
      .for("update");
    if (!user || user.status !== "pending_email_verification") return { kind: "invalid" as const };

    const [verification] = await tx.select().from(emailVerificationCodesTable)
      .where(eq(emailVerificationCodesTable.userId, user.id))
      .for("update");
    if (!verification || verification.usedAt || verification.expiresAt <= now) {
      return { kind: "invalid" as const };
    }
    if (verification.attemptCount >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      return { kind: "limited" as const };
    }
    if (!verifyCodeHash(code, verification.codeHash)) {
      const nextAttemptCount = verification.attemptCount + 1;
      await tx.update(emailVerificationCodesTable)
        .set({ attemptCount: nextAttemptCount })
        .where(eq(emailVerificationCodesTable.id, verification.id));
      return nextAttemptCount >= EMAIL_VERIFICATION_MAX_ATTEMPTS
        ? { kind: "limited" as const }
        : { kind: "invalid" as const };
    }

    const [organization] = await tx.select().from(organizationsTable)
      .where(eq(organizationsTable.id, user.organizationId))
      .for("update");
    if (!organization) return { kind: "invalid" as const };
    const [activatedUser] = await tx.update(teamUsersTable)
      .set({ status: "active", emailVerifiedAt: now, updatedAt: now })
      .where(eq(teamUsersTable.id, user.id))
      .returning();
    await tx.update(emailVerificationCodesTable)
      .set({ usedAt: now })
      .where(eq(emailVerificationCodesTable.id, verification.id));
    const token = createSessionToken();
    await tx.insert(authSessionsTable).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    });
    return { kind: "verified" as const, user: activatedUser, organization, token };
  });

  const remainingDelay = EMAIL_VERIFICATION_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  if (result.kind === "limited") {
    response.status(429).json({ error: "تم تجاوز محاولات الرمز. اطلب رمزاً جديداً." });
    return;
  }
  if (result.kind === "invalid") {
    response.status(400).json({ error: "رمز التفعيل غير صحيح أو انتهت صلاحيته." });
    return;
  }

  setSession(response, result.token);
  response.json({ user: safeUser(result.user, {
    projectName: result.organization.name,
    dataGeneration: result.organization.dataGeneration,
    planId: result.organization.planId,
    subscriptionStatus: result.organization.subscriptionStatus,
    trialStartedAt: result.organization.trialStartedAt,
    trialEndsAt: result.organization.trialEndsAt,
    subscriptionStartedAt: result.organization.subscriptionStartedAt,
    subscriptionEndsAt: result.organization.subscriptionEndsAt,
    platformAccessSuspendedAt: result.organization.platformAccessSuspendedAt,
  }) });
});

router.post("/auth/email-verification/resend", async (request: Request, response: Response): Promise<void> => {
  const startedAt = Date.now();
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const message = "إذا كان الحساب بانتظار التفعيل، فسيصلك رمز جديد على البريد.";
  if (!isEmail(email)) {
    response.status(400).json({ error: "أدخل بريداً إلكترونياً صحيحاً." });
    return;
  }
  const code = process.env.NODE_ENV === "test" && /^\d{6}$/.test(process.env.EMAIL_VERIFICATION_TEST_CODE ?? "")
    ? process.env.EMAIL_VERIFICATION_TEST_CODE as string
    : createEmailVerificationCode();
  const now = new Date();
  const issue = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(teamUsersTable).where(eq(teamUsersTable.email, email)).for("update");
    if (!user || user.status !== "pending_email_verification") return null;
    const [existingCode] = await tx.select().from(emailVerificationCodesTable)
      .where(eq(emailVerificationCodesTable.userId, user.id))
      .for("update");
    if (existingCode && now.getTime() - existingCode.lastSentAt.getTime() < EMAIL_VERIFICATION_RESEND_SECONDS * 1000) {
      return null;
    }
    const values = {
      codeHash: hashEmailVerificationCode(code),
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_MINUTES * 60 * 1000),
      usedAt: null,
      attemptCount: 0,
      lastSentAt: now,
    };
    if (existingCode) {
      await tx.update(emailVerificationCodesTable).set(values).where(eq(emailVerificationCodesTable.id, existingCode.id));
    } else {
      await tx.insert(emailVerificationCodesTable).values({ userId: user.id, ...values });
    }
    return { user };
  });
  if (issue) {
    try {
      await sendEmailVerificationCode({ email: issue.user.email, name: issue.user.name, code });
    } catch (error) {
      logger.error(
        { err: error, userId: issue.user.id, operation: "email_verification_resend" },
        "Unable to resend email verification code",
      );
    }
  }
  const remainingDelay = EMAIL_VERIFICATION_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  response.status(202).json({ message });
});

router.post("/auth/password-reset/request", async (request: Request, response: Response): Promise<void> => {
  const startedAt = Date.now();
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const message = "إذا كان البريد الإلكتروني مسجلاً، فستصلك رسالة تحتوي على رابط استعادة كلمة المرور.";
  if (!isEmail(email)) {
    response.status(400).json({ error: "أدخل بريداً إلكترونياً صحيحاً." });
    return;
  }

  const token = createPasswordResetToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000);
  const reset = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(teamUsersTable).where(eq(teamUsersTable.email, email)).limit(1);
    if (!user || user.status !== "active") {
      await tx.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));
      await tx.select({ id: passwordResetTokensTable.id })
        .from(passwordResetTokensTable)
        .where(eq(passwordResetTokensTable.tokenHash, tokenHash))
        .limit(1);
      return null;
    }
    await tx.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user.id));
    const [record] = await tx.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    }).returning();
    return { user, record };
  });

  if (reset) {
    // Unknown addresses have no provider request. Keep the response independent
    // of email delivery so that this difference cannot be measured as account
    // enumeration, while still cleaning up unusable tokens on delivery failure.
    void deliverPasswordResetEmail({
      user: reset.user,
      request,
      token,
      recordId: reset.record.id,
    });
  }
  const remainingDelay = PASSWORD_RESET_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  }
  response.status(202).json({ message });
});

router.post("/auth/password-reset/confirm", async (request: Request, response: Response): Promise<void> => {
  const token = typeof request.body?.token === "string" ? request.body.token.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const passwordError = validatePassword(password);
  if (token.length < 32 || passwordError) {
    response.status(400).json({ error: token.length < 32 ? "رابط الاستعادة غير صالح." : passwordError });
    return;
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [resetToken] = await tx.select().from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, hashSessionToken(token)))
      .for("update");
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now) {
      return { kind: "invalid" as const };
    }

    const [user] = await tx.select().from(teamUsersTable).where(eq(teamUsersTable.id, resetToken.userId)).for("update");
    if (!user || user.status !== "active") {
      return { kind: "invalid" as const };
    }

    await tx.update(teamUsersTable).set({ passwordHash: await hashPassword(password), updatedAt: now }).where(eq(teamUsersTable.id, user.id));
    await tx.update(passwordResetTokensTable).set({ usedAt: now }).where(eq(passwordResetTokensTable.id, resetToken.id));
    await tx.update(authSessionsTable).set({ revokedAt: now }).where(eq(authSessionsTable.userId, user.id));
    await tx.insert(teamAuditLogsTable).values({
      organizationId: user.organizationId,
      actorId: user.id,
      actorName: user.name,
      action: "password_reset_completed",
      entity: user.email,
    });
    return { kind: "updated" as const };
  });

  if (result.kind === "invalid") {
    response.status(400).json({ error: "رابط الاستعادة غير صالح أو انتهت صلاحيته." });
    return;
  }
  response.json({ message: "تم تحديث كلمة المرور. سجّل الدخول بكلمة المرور الجديدة." });
});

router.post("/auth/logout", requireAuth, async (request: Request, response: Response): Promise<void> => {
  const token = request.cookies?.wudooh_session;
  if (typeof token === "string") {
    await db.update(authSessionsTable).set({ revokedAt: new Date() }).where(eq(authSessionsTable.tokenHash, hashSessionToken(token)));
  }
  response.clearCookie("wudooh_session", { path: "/" });
  response.clearCookie(REMOTE_SESSION_HINT_COOKIE, { path: "/" });
  response.sendStatus(204);
});

router.get("/auth/me", async (request: Request, response: Response): Promise<void> => {
  const auth = await getAuthContext(request);
  response.json({ user: auth ? safeUser(auth, auth) : null });
});

router.get("/auth/password-reset/status", requireAuth, requireSubscriptionAccess, requireOwner, (_request: Request, response: Response): void => {
  const sender = process.env.RESEND_FROM_EMAIL?.trim() || null;
  response.json({ emailDeliveryConfigured: Boolean(sender), sender });
});

router.get("/team/members", requireAuth, requireSubscriptionAccess, requireOwner, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const users = await db.select().from(teamUsersTable).where(eq(teamUsersTable.organizationId, auth.organizationId)).orderBy(teamUsersTable.createdAt);
  response.json({ members: users.filter(user => user.id !== auth.id).map(user => safeUser(user, auth)) });
});

router.post("/team/members", requireAuth, requireSubscriptionAccess, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const validation = validateMemberBody(request.body as Record<string, unknown>, true);
  if (!validation.data) {
    response.status(400).json({ error: validation.error });
    return;
  }
  const { password, ...memberData } = validation.data;
  const passwordHash = await hashPassword(password);
  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.select().from(organizationsTable)
      .where(eq(organizationsTable.id, auth.organizationId)).for("update");
    if (!organization || !hasSubscriptionAccess(organization)) return { kind: "access" as const, organization };
    const [existing] = await tx.select({ id: teamUsersTable.id }).from(teamUsersTable)
      .where(eq(teamUsersTable.email, memberData.email)).limit(1);
    if (existing) return { kind: "conflict" as const };
    const [user] = await tx.insert(teamUsersTable).values({
      ...memberData,
      organizationId: auth.organizationId,
      passwordHash,
      emailVerifiedAt: new Date(),
    }).returning();
    await tx.insert(teamAuditLogsTable).values({
      organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email,
      action: "member_created", entity: user.name, details: user.roleId,
    });
    return { kind: "created" as const, user };
  });
  if (result.kind === "access") {
    response.status(402).json(subscriptionWriteFailure(result.organization));
    return;
  }
  if (result.kind === "conflict") {
    response.status(409).json({ error: "تعذر إنشاء الحساب بهذه البيانات." });
    return;
  }
  const user = result.user;
  response.status(201).json({ member: safeUser(user, auth) });
});

router.patch("/team/members/:id", requireAuth, requireSubscriptionAccess, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const id = Number(request.params.id);
  const validation = validateMemberBody(request.body as Record<string, unknown>, false);
  if (!Number.isInteger(id) || !validation.data) {
    response.status(400).json({ error: validation.error || "معرّف العضو غير صالح." });
    return;
  }
  const { password, ...memberData } = validation.data;
  const update = {
    ...memberData,
    updatedAt: new Date(),
    ...(password ? { passwordHash: await hashPassword(password) } : {}),
  };
  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.select().from(organizationsTable).where(eq(organizationsTable.id, auth.organizationId)).for("update");
    if (!organization || !hasSubscriptionAccess(organization)) return { kind: "access" as const, organization };
    const [member] = await tx.select().from(teamUsersTable).where(and(eq(teamUsersTable.id, id), eq(teamUsersTable.organizationId, auth.organizationId))).for("update");
    if (!member || member.roleId === "owner") return { kind: "missing" as const };
    const [updated] = await tx.update(teamUsersTable).set(update).where(eq(teamUsersTable.id, id)).returning();
    if (password || updated.status === "inactive") {
      await tx.update(authSessionsTable).set({ revokedAt: new Date() }).where(eq(authSessionsTable.userId, id));
    }
    await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: updated.status === "inactive" ? "member_disabled" : "member_updated", entity: updated.name, details: updated.roleId });
    return { kind: "updated" as const, updated };
  });
  if (result.kind === "access") { response.status(402).json(subscriptionWriteFailure(result.organization)); return; }
  if (result.kind === "missing") { response.status(404).json({ error: "لم يتم العثور على عضو الفريق." }); return; }
  const updated = result.updated;
  response.json({ member: safeUser(updated, auth) });
});

router.post("/team/members/:id/toggle", requireAuth, requireSubscriptionAccess, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const id = Number(request.params.id);
  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.select().from(organizationsTable).where(eq(organizationsTable.id, auth.organizationId)).for("update");
    if (!organization || !hasSubscriptionAccess(organization)) return { kind: "access" as const, organization };
    const [member] = await tx.select().from(teamUsersTable).where(and(eq(teamUsersTable.id, id), eq(teamUsersTable.organizationId, auth.organizationId))).for("update");
    if (!member || member.roleId === "owner") return { kind: "missing" as const };
    const status = member.status === "inactive" ? "active" : "inactive";
    const [updated] = await tx.update(teamUsersTable).set({ status, updatedAt: new Date() }).where(eq(teamUsersTable.id, id)).returning();
    if (status === "inactive") await tx.update(authSessionsTable).set({ revokedAt: new Date() }).where(eq(authSessionsTable.userId, id));
    await tx.insert(teamAuditLogsTable).values({ organizationId: auth.organizationId, actorId: auth.id, actorName: auth.name || auth.email, action: status === "inactive" ? "member_disabled" : "member_enabled", entity: updated.name, details: updated.roleId });
    return { kind: "updated" as const, updated };
  });
  if (result.kind === "access") { response.status(402).json(subscriptionWriteFailure(result.organization)); return; }
  if (result.kind === "missing") { response.status(404).json({ error: "لم يتم العثور على عضو الفريق." }); return; }
  const updated = result.updated;
  response.json({ member: safeUser(updated, auth) });
});

router.get("/audit-logs", requireAuth, requireSubscriptionAccess, requireOwner, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const logs = await db.select().from(teamAuditLogsTable)
    .where(eq(teamAuditLogsTable.organizationId, auth.organizationId))
    .orderBy(desc(teamAuditLogsTable.createdAt))
    .limit(50);
  response.json({ logs });
});

export default router;