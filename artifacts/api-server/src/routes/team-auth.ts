import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  authSessionsTable,
  db,
  erpRecordsTable,
  organizationsTable,
  passwordResetTokensTable,
  teamAuditLogsTable,
  teamUsersTable,
  type TeamUser,
} from "@workspace/db";
import { createPasswordResetToken, createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "../lib/team-auth";
import { logger } from "../lib/logger";
import { getAuthContext, requireAuth, requireOwner, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
const SESSION_DAYS = 14;
const REMOTE_SESSION_HINT_COOKIE = "wudooh_remote_session";
const PERMISSION_KEYS = new Set(["dashboard", "sales", "accounting", "inventory", "hr", "operations", "reports"]);
const ROLE_IDS = new Set(["sales", "accountant", "inventory", "hr", "manager", "custom"]);
const LOCATION_SCOPES = new Set(["all", "selected", "none"]);
const PASSWORD_RESET_MINUTES = 30;
const connectors = new ReplitConnectors();

function safeUser(user: TeamUser, projectName: string, dataGeneration: number) {
  return {
    id: user.id,
    accountId: user.id,
    organizationId: user.organizationId,
    projectName,
    dataGeneration,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
    permissions: user.permissions,
    locationScope: user.locationScope,
    warehouseIds: user.warehouseIds,
    status: user.status,
    isTeamMember: user.roleId !== "owner",
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
    throw new Error("Password reset email delivery is not configured.");
  }
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

async function notifyOwnersAboutResetDeliveryFailure({
  organizationId,
  targetEmail,
}: {
  organizationId: number;
  targetEmail: string;
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
    details: "تعذر تسليم رابط استعادة كلمة المرور. راجع إعدادات البريد وسجل الخدمة.",
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
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "أدخل الاسم والبريد الإلكتروني الصحيحين." };
  if ((requiresPassword && password.length < 8) || (!requiresPassword && password && password.length < 8)) return { error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." };
  if (!ROLE_IDS.has(roleId) || !LOCATION_SCOPES.has(locationScope)) return { error: "بيانات الدور أو نطاق المواقع غير صحيحة." };
  if (locationScope !== "selected" && warehouseIds.length) return { error: "حدّد المواقع فقط عند اختيار نطاق مواقع محددة." };
  if (locationScope === "selected" && warehouseIds.length === 0) return { error: "اختر موقعاً واحداً على الأقل أو استخدم نطاق «لا مواقع»." };
  return { data: { name, email, password, roleId, status, permissions, locationScope, warehouseIds } };
}

router.post("/auth/register", async (request: Request, response: Response): Promise<void> => {
  const body = request.body as Record<string, unknown>;
  const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
  const validation = validateMemberBody({ ...body, roleId: "sales", locationScope: "all" }, true);
  if (!projectName || !validation.data) {
    response.status(400).json({ error: projectName ? validation.error : "أدخل اسم المنشأة." });
    return;
  }
  const existing = await db.select({ id: teamUsersTable.id }).from(teamUsersTable).where(eq(teamUsersTable.email, validation.data.email)).limit(1);
  if (existing.length) {
    response.status(409).json({ error: "تعذر إنشاء الحساب بهذه البيانات." });
    return;
  }
  const passwordHash = await hashPassword(validation.data.password);
  const { password: _password, ...ownerData } = validation.data;
  const result = await db.transaction(async (tx) => {
    const [organization] = await tx.insert(organizationsTable).values({ name: projectName }).returning();
    const [user] = await tx.insert(teamUsersTable).values({
      organizationId: organization.id,
      ...ownerData,
      passwordHash,
      roleId: "owner",
      permissions: Object.fromEntries([...PERMISSION_KEYS].map(key => [key, true])),
      locationScope: "all",
      warehouseIds: [],
    }).returning();
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
    return { organization, user };
  });
  const token = await createSession(result.user.id);
  setSession(response, token);
  response.status(201).json({ user: safeUser(result.user, result.organization.name, result.organization.dataGeneration) });
});

router.post("/auth/login", async (request: Request, response: Response): Promise<void> => {
  const body = request.body as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const [result] = await db.select({
    user: teamUsersTable,
    projectName: organizationsTable.name,
    dataGeneration: organizationsTable.dataGeneration,
  })
    .from(teamUsersTable)
    .innerJoin(organizationsTable, eq(teamUsersTable.organizationId, organizationsTable.id))
    .where(eq(teamUsersTable.email, email))
    .limit(1);
  if (!result || result.user.status !== "active" || !(await verifyPassword(password, result.user.passwordHash))) {
    response.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة." });
    return;
  }
  const token = await createSession(result.user.id);
  setSession(response, token);
  await recordAudit({ ...result.user, projectName: result.projectName, dataGeneration: result.dataGeneration }, "login", "user", result.user.email);
  response.json({ user: safeUser(result.user, result.projectName, result.dataGeneration) });
});

router.post("/auth/password-reset/request", async (request: Request, response: Response): Promise<void> => {
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const message = "إذا كان البريد الإلكتروني مسجلاً، فستصلك رسالة تحتوي على رابط استعادة كلمة المرور.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    response.status(400).json({ error: "أدخل بريداً إلكترونياً صحيحاً." });
    return;
  }

  const [user] = await db.select().from(teamUsersTable).where(eq(teamUsersTable.email, email)).limit(1);
  if (!user || user.status !== "active") {
    response.status(202).json({ message });
    return;
  }

  const token = createPasswordResetToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000);
  const [record] = await db.transaction(async (tx) => {
    await tx.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user.id));
    return tx.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    }).returning();
  });

  try {
    await sendPasswordResetEmail({
      email: user.email,
      name: user.name,
      resetUrl: passwordResetUrl(request, token),
    });
  } catch (error) {
    await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.id, record.id));
    logger.error({ err: error, userId: user.id }, "Unable to deliver password reset email");
    try {
      await notifyOwnersAboutResetDeliveryFailure({
        organizationId: user.organizationId,
        targetEmail: user.email,
      });
    } catch (notificationError) {
      logger.error(
        { err: notificationError, userId: user.id },
        "Unable to record password reset delivery failure notification",
      );
    }
  }

  response.status(202).json({ message });
});

router.post("/auth/password-reset/confirm", async (request: Request, response: Response): Promise<void> => {
  const token = typeof request.body?.token === "string" ? request.body.token.trim() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  if (token.length < 32 || password.length < 8) {
    response.status(400).json({ error: "رابط الاستعادة غير صالح أو كلمة المرور أقصر من 8 أحرف." });
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
  response.json({ user: auth ? safeUser(auth, auth.projectName, auth.dataGeneration) : null });
});

router.get("/auth/password-reset/status", requireAuth, requireOwner, (_request: Request, response: Response): void => {
  const sender = process.env.RESEND_FROM_EMAIL?.trim() || null;
  response.json({ emailDeliveryConfigured: Boolean(sender), sender });
});

router.get("/team/members", requireAuth, requireOwner, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const users = await db.select().from(teamUsersTable).where(eq(teamUsersTable.organizationId, auth.organizationId)).orderBy(teamUsersTable.createdAt);
  response.json({ members: users.filter(user => user.id !== auth.id).map(user => safeUser(user, auth.projectName, auth.dataGeneration)) });
});

router.post("/team/members", requireAuth, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const validation = validateMemberBody(request.body as Record<string, unknown>, true);
  if (!validation.data) {
    response.status(400).json({ error: validation.error });
    return;
  }
  const existing = await db.select({ id: teamUsersTable.id }).from(teamUsersTable).where(eq(teamUsersTable.email, validation.data.email)).limit(1);
  if (existing.length) {
    response.status(409).json({ error: "تعذر إنشاء الحساب بهذه البيانات." });
    return;
  }
  const { password, ...memberData } = validation.data;
  const [user] = await db.insert(teamUsersTable).values({
    ...memberData,
    organizationId: auth.organizationId,
    passwordHash: await hashPassword(password),
  }).returning();
  await recordAudit(auth, "member_created", user.name, user.roleId);
  response.status(201).json({ member: safeUser(user, auth.projectName, auth.dataGeneration) });
});

router.patch("/team/members/:id", requireAuth, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const id = Number(request.params.id);
  const validation = validateMemberBody(request.body as Record<string, unknown>, false);
  if (!Number.isInteger(id) || !validation.data) {
    response.status(400).json({ error: validation.error || "معرّف العضو غير صالح." });
    return;
  }
  const [member] = await db.select().from(teamUsersTable).where(and(eq(teamUsersTable.id, id), eq(teamUsersTable.organizationId, auth.organizationId))).limit(1);
  if (!member || member.roleId === "owner") {
    response.status(404).json({ error: "لم يتم العثور على عضو الفريق." });
    return;
  }
  const { password, ...memberData } = validation.data;
  const update = {
    ...memberData,
    updatedAt: new Date(),
    ...(password ? { passwordHash: await hashPassword(password) } : {}),
  };
  const [updated] = await db.update(teamUsersTable).set(update).where(eq(teamUsersTable.id, id)).returning();
  if (updated.status === "inactive") {
    await db.update(authSessionsTable).set({ revokedAt: new Date() }).where(eq(authSessionsTable.userId, id));
  }
  await recordAudit(auth, updated.status === "inactive" ? "member_disabled" : "member_updated", updated.name, updated.roleId);
  response.json({ member: safeUser(updated, auth.projectName, auth.dataGeneration) });
});

router.post("/team/members/:id/toggle", requireAuth, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const id = Number(request.params.id);
  const [member] = await db.select().from(teamUsersTable).where(and(eq(teamUsersTable.id, id), eq(teamUsersTable.organizationId, auth.organizationId))).limit(1);
  if (!member || member.roleId === "owner") {
    response.status(404).json({ error: "لم يتم العثور على عضو الفريق." });
    return;
  }
  const status = member.status === "inactive" ? "active" : "inactive";
  const [updated] = await db.update(teamUsersTable).set({ status, updatedAt: new Date() }).where(eq(teamUsersTable.id, id)).returning();
  if (status === "inactive") await db.update(authSessionsTable).set({ revokedAt: new Date() }).where(eq(authSessionsTable.userId, id));
  await recordAudit(auth, status === "inactive" ? "member_disabled" : "member_enabled", updated.name, updated.roleId);
  response.json({ member: safeUser(updated, auth.projectName, auth.dataGeneration) });
});

router.get("/audit-logs", requireAuth, requireOwner, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const logs = await db.select().from(teamAuditLogsTable)
    .where(eq(teamAuditLogsTable.organizationId, auth.organizationId))
    .orderBy(desc(teamAuditLogsTable.createdAt))
    .limit(50);
  response.json({ logs });
});

export default router;