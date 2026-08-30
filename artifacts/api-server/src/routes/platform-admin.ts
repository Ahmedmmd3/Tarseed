import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  organizationsTable,
  platformAdminsTable,
  platformAdminSessionsTable,
  platformAuditLogsTable,
  testWorkspaceInvitationsTable,
  teamUsersTable,
} from "@workspace/db";
import {
  initializeOrganization,
  safeInitializationFailure,
  type InitializationFailure,
} from "../lib/seed-demo-data";
import { createSessionToken, hashSessionToken, isEmail, verifyPassword } from "../lib/team-auth";
import {
  getPlatformAdminContext,
  PLATFORM_ADMIN_COOKIE,
  requirePlatformAdmin,
  type PlatformAdminContext,
} from "../middleware/platform-auth";
import { subscriptionState, type SubscriptionFields } from "../middleware/team-auth";

const router: IRouter = Router();
const SESSION_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_NAMES: Record<string, string> = {
  trial: "التجربة المجانية",
  basic: "ترصيد الأساسي",
  pro: "ترصيد الاحترافي",
  business: "ترصيد للأعمال",
};
const SUBSCRIPTION_ACTIONS = new Set(["extend_trial", "extend_access", "suspend_access", "restore_access"]);
const MAX_EXTENSION_DAYS = 365;
const TEST_WORKSPACE_INVITATION_DAYS = 2;
const connectors = new ReplitConnectors();

function setPlatformAdminSession(response: Response, token: string): void {
  response.cookie(PLATFORM_ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_DAYS * DAY_MS,
    path: "/",
  });
}

function safeAdmin(admin: PlatformAdminContext) {
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.displayName,
    role: "super_admin" as const,
  };
}

function effectiveEndDate(subscription: SubscriptionFields): Date | null {
  if (subscription.subscriptionStatus === "trialing") return subscription.trialEndsAt;
  if (subscription.subscriptionStatus === "active") return subscription.subscriptionEndsAt;
  return subscription.subscriptionEndsAt ?? subscription.trialEndsAt;
}

function daysRemaining(endDate: Date | null, now: Date): number | null {
  if (!endDate) return null;
  return Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS));
}

function organizationIdFromRequest(request: Request): number | null {
  const rawId = Array.isArray(request.params.organizationId) ? request.params.organizationId[0] : request.params.organizationId;
  const id = Number.parseInt(rawId ?? "", 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function recordInitializationFailure(
  admin: PlatformAdminContext,
  organizationId: number,
  failure: InitializationFailure,
): Promise<void> {
  await db.insert(platformAuditLogsTable).values({
    adminId: admin.id,
    organizationId,
    actorName: admin.displayName,
    action: "organization_initialization_failed",
    entity: `organization:${organizationId}`,
    details: JSON.stringify({
      failureCode: failure.code,
      failureReason: failure.reason,
    }),
  });
}

function subscriptionSnapshot(subscription: SubscriptionFields, now: Date) {
  const endDate = effectiveEndDate(subscription);
  return {
    planId: subscription.planId,
    subscriptionStatus: subscription.subscriptionStatus,
    accessStatus: subscriptionState(subscription, now),
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    subscriptionEndsAt: subscription.subscriptionEndsAt?.toISOString() ?? null,
    effectiveEndsAt: endDate?.toISOString() ?? null,
    accessSuspendedAt: subscription.platformAccessSuspendedAt?.toISOString() ?? null,
  };
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

function appOrigin(request: Request): string {
  const configuredOrigin = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production" && !configuredOrigin) {
    throw new Error("PUBLIC_APP_URL is required for production invitation links.");
  }
  if (configuredOrigin) {
    const parsed = new URL(configuredOrigin);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new Error("PUBLIC_APP_URL must use HTTPS in production.");
    }
    return parsed.origin;
  }
  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return `${forwardedProtocol || request.protocol}://${request.get("host")}`;
}

async function sendTestWorkspaceInvitation({
  email,
  ownerName,
  workspaceName,
  invitationUrl,
}: {
  email: string;
  ownerName: string;
  workspaceName: string;
  invitationUrl: string;
}): Promise<void> {
  const sender = process.env.RESEND_FROM_EMAIL?.trim();
  if (!sender && process.env.NODE_ENV === "production") {
    throw new Error("Email delivery is not configured.");
  }
  if (process.env.NODE_ENV === "test") {
    const delay = Number.parseInt(process.env.TEST_WORKSPACE_INVITATION_TEST_DELAY_MS ?? "0", 10);
    if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (process.env.TEST_WORKSPACE_INVITATION_TEST_FAIL === "1") throw new Error("Simulated invitation delivery failure.");
    return;
  }
  const result = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender || "ترصيد <onboarding@resend.dev>",
      to: [email],
      subject: `دعوة مالك مساحة اختبار في ترصيد: ${workspaceName}`,
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#0f172a">
          <h1 style="font-size:22px">دعوة إلى مساحة اختبار في ترصيد</h1>
          <p>مرحباً ${escapeHtml(ownerName)}،</p>
          <p>تمت دعوتك لتكون مالك مساحة الاختبار <strong>${escapeHtml(workspaceName)}</strong> المخصصة لتدقيق المحاسبة.</p>
          <p>افتح الرابط التالي خلال ${TEST_WORKSPACE_INVITATION_DAYS} يومين لتأكيد بريدك واختيار كلمة مرور آمنة:</p>
          <p style="margin:24px 0"><a href="${escapeHtml(invitationUrl)}" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">قبول الدعوة وتجهيز الحساب</a></p>
          <p>هذه الدعوة تستخدم مرة واحدة، ولا تمنح الإدارة العليا صلاحية الدخول إلى بيانات المساحة.</p>
        </div>`,
    }),
  });
  if (!result.ok) throw new Error(`Resend request failed with status ${result.status}`);
}

router.post("/platform-auth/login", async (request: Request, response: Response): Promise<void> => {
  const username = typeof request.body?.username === "string" ? request.body.username.trim().toLowerCase() : "";
  const password = typeof request.body?.password === "string" ? request.body.password : "";
  const [admin] = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.username, username)).limit(1);
  const valid = Boolean(admin && admin.status === "active" && await verifyPassword(password, admin.passwordHash));

  if (!valid || !admin) {
    await db.insert(platformAuditLogsTable).values({
      adminId: admin?.id ?? null,
      actorName: username || "غير معروف",
      action: "login_failed",
      entity: "platform_admin",
    });
    response.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
    return;
  }

  const token = createSessionToken();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(platformAdminSessionsTable).values({
      adminId: admin.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS),
    });
    await tx.update(platformAdminsTable).set({ lastLoginAt: now, updatedAt: now }).where(eq(platformAdminsTable.id, admin.id));
    await tx.insert(platformAuditLogsTable).values({
      adminId: admin.id,
      actorName: admin.displayName,
      action: "login",
      entity: "platform_admin",
    });
  });
  setPlatformAdminSession(response, token);
  response.json({ admin: safeAdmin(admin) });
});

router.get("/platform-auth/me", async (request: Request, response: Response): Promise<void> => {
  const admin = await getPlatformAdminContext(request);
  response.json({ admin: admin ? safeAdmin(admin) : null });
});

router.post("/platform-auth/logout", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const admin = response.locals.platformAdmin as PlatformAdminContext;
  const token = request.cookies?.[PLATFORM_ADMIN_COOKIE];
  if (typeof token === "string") {
    await db.update(platformAdminSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(platformAdminSessionsTable.tokenHash, hashSessionToken(token)));
  }
  await db.insert(platformAuditLogsTable).values({
    adminId: admin.id,
    actorName: admin.displayName,
    action: "logout",
    entity: "platform_admin",
  });
  response.clearCookie(PLATFORM_ADMIN_COOKIE, { path: "/" });
  response.sendStatus(204);
});

router.get("/super-admin/overview", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const admin = response.locals.platformAdmin as PlatformAdminContext;
  const search = typeof request.query.search === "string" ? request.query.search.trim().toLowerCase().slice(0, 100) : "";
  const requestedStatus = typeof request.query.status === "string" ? request.query.status : "all";
  const statusFilter = ["all", "trialing", "active", "expired", "inactive"].includes(requestedStatus) ? requestedStatus : "all";
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(String(request.query.pageSize ?? "25"), 10) || 25));
  const now = new Date();

  const [organizations, users] = await Promise.all([
    db.select().from(organizationsTable).orderBy(asc(organizationsTable.id)),
    db.select({
      id: teamUsersTable.id,
      organizationId: teamUsersTable.organizationId,
      name: teamUsersTable.name,
      email: teamUsersTable.email,
      roleId: teamUsersTable.roleId,
      status: teamUsersTable.status,
    }).from(teamUsersTable).orderBy(asc(teamUsersTable.id)),
  ]);

  const usersByOrganization = new Map<number, typeof users>();
  for (const user of users) {
    const list = usersByOrganization.get(user.organizationId) ?? [];
    list.push(user);
    usersByOrganization.set(user.organizationId, list);
  }

  const rows = organizations.map((organization) => {
    const members = usersByOrganization.get(organization.id) ?? [];
    const owner = members.find((member) => member.roleId === "owner") ?? null;
    const subscription: SubscriptionFields = organization;
    const status = subscriptionState(subscription, now);
    const endDate = effectiveEndDate(subscription);
    return {
      id: organization.id,
      name: organization.name,
      owner: owner ? { name: owner.name, email: owner.email } : null,
      userCount: members.length,
      activeUserCount: members.filter((member) => member.status === "active").length,
      planId: organization.planId,
      planName: PLAN_NAMES[organization.planId] ?? organization.planId,
      isTestWorkspace: organization.isTestWorkspace,
      status,
      trialEndsAt: organization.trialEndsAt?.toISOString() ?? null,
      subscriptionEndsAt: organization.subscriptionEndsAt?.toISOString() ?? null,
      effectiveEndsAt: endDate?.toISOString() ?? null,
      daysRemaining: daysRemaining(endDate, now),
      accessSuspended: Boolean(organization.platformAccessSuspendedAt),
      hasBillingPortal: Boolean(organization.stripeCustomerId),
      managedByStripe: Boolean(organization.stripeSubscriptionId),
      initializationStatus: organization.initializationStatus,
      initializationFailureCode: organization.initializationFailureCode,
      initializationFailureReason: organization.initializationFailureReason,
      initializationFailedAt: organization.initializationFailedAt?.toISOString() ?? null,
      initializationAttempts: organization.initializationAttempts,
      initializationPendingAt: organization.initializationPendingAt?.toISOString() ?? null,
      initializationLastAttemptAt: organization.initializationLastAttemptAt?.toISOString() ?? null,
      createdAt: organization.createdAt.toISOString(),
    };
  });

  const summary = rows.reduce((result, row) => {
    result.totalOrganizations += 1;
    result.totalUsers += row.userCount;
    result[row.status] += 1;
    return result;
  }, {
    totalOrganizations: 0,
    totalUsers: 0,
    trialing: 0,
    active: 0,
    expired: 0,
    inactive: 0,
    initializationFailed: 0,
  });
  summary.initializationFailed = rows.filter((row) => row.initializationStatus !== "ready").length;

  const filtered = rows
    .filter((row) => statusFilter === "all" || row.status === statusFilter)
    .filter((row) => !search || [
      row.name,
      row.owner?.name ?? "",
      row.owner?.email ?? "",
      row.planName,
    ].some((value) => value.toLowerCase().includes(search)))
    .sort((left, right) => right.id - left.id);
  const start = (page - 1) * pageSize;

  await db.insert(platformAuditLogsTable).values({
    adminId: admin.id,
    actorName: admin.displayName,
    action: "overview_viewed",
    entity: "organizations",
    details: `page=${page};status=${statusFilter};search=${search ? "yes" : "no"}`,
  });

  response.json({
    summary,
    organizations: filtered.slice(start, start + pageSize),
    initializationFailures: rows
      .filter((row) => row.initializationStatus !== "ready")
      .sort((left, right) => right.id - left.id),
    pagination: {
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    },
    generatedAt: now.toISOString(),
  });
});

router.post("/super-admin/test-workspaces", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const admin = response.locals.platformAdmin as PlatformAdminContext;
  const workspaceName = typeof request.body?.workspaceName === "string" ? request.body.workspaceName.trim() : "";
  const ownerName = typeof request.body?.ownerName === "string" ? request.body.ownerName.trim() : "";
  const ownerEmail = typeof request.body?.ownerEmail === "string" ? request.body.ownerEmail.trim().toLowerCase() : "";

  if (workspaceName.length < 2 || workspaceName.length > 120) {
    response.status(400).json({ error: "أدخل اسم مساحة اختبار بين حرفين و120 حرفاً." });
    return;
  }
  if (ownerName.length < 2 || ownerName.length > 120) {
    response.status(400).json({ error: "أدخل اسم مالك الاختبار بين حرفين و120 حرفاً." });
    return;
  }
  if (!isEmail(ownerEmail)) {
    response.status(400).json({ error: "أدخل بريداً إلكترونياً صحيحاً لمالك الاختبار." });
    return;
  }

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TEST_WORKSPACE_INVITATION_DAYS * DAY_MS);
  let invitationUrl: string;
  try {
    invitationUrl = `${appOrigin(request)}/test-workspace-invite?token=${encodeURIComponent(token)}`;
  } catch (error) {
    request.log.error({ err: error }, "Test workspace invitation origin is not configured");
    response.status(503).json({ error: "تعذر إنشاء رابط دعوة آمن. راجع إعداد عنوان التطبيق المنشور." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [existingUser] = await tx.select({ id: teamUsersTable.id })
        .from(teamUsersTable)
        .where(eq(teamUsersTable.email, ownerEmail))
        .limit(1);
      if (existingUser) return { kind: "conflict" as const };

      const [organization] = await tx.insert(organizationsTable).values({
        name: workspaceName,
        initializationStatus: "pending",
        planId: "trial",
        subscriptionStatus: "trialing",
        trialStartedAt: now,
        trialEndsAt: new Date(now.getTime() + 30 * DAY_MS),
        isTestWorkspace: true,
      }).returning();
      const [invitation] = await tx.insert(testWorkspaceInvitationsTable).values({
        organizationId: organization.id,
        createdByAdminId: admin.id,
        email: ownerEmail,
        ownerName,
        tokenHash,
        expiresAt,
      }).returning({ id: testWorkspaceInvitationsTable.id });
      await tx.insert(platformAuditLogsTable).values({
        adminId: admin.id,
        organizationId: organization.id,
        actorName: admin.displayName,
        action: "test_workspace_created",
        entity: `organization:${organization.id}`,
        details: JSON.stringify({
          workspaceName,
          ownerEmail,
          invitationId: invitation.id,
          expiresAt: expiresAt.toISOString(),
        }),
      });
      return { kind: "created" as const, organization, invitationId: invitation.id };
    });

    if (result.kind === "conflict") {
      response.status(409).json({ error: "لا يمكن دعوة هذا البريد لأنه مرتبط بحساب منشأة موجود." });
      return;
    }

    try {
      await initializeOrganization(result.organization.id, result.organization.dataGeneration, now);
    } catch (error) {
      const failure = safeInitializationFailure(error);
      await recordInitializationFailure(admin, result.organization.id, failure);
      request.log.error({ err: error, organizationId: result.organization.id }, "Test workspace initialization failed");
      response.status(503).json({
        error: "أُنشئت مساحة الاختبار لكن تعذر تجهيز بياناتها. أصلح السبب ثم أعد التهيئة من سجل المنشآت.",
        code: "organization_initialization_failed",
        workspace: {
          id: result.organization.id,
          name: result.organization.name,
          isTestWorkspace: true,
          status: "initialization_failed",
          initializationFailureReason: failure.reason,
        },
      });
      return;
    }

    try {
      await sendTestWorkspaceInvitation({ email: ownerEmail, ownerName, workspaceName, invitationUrl });
      const [markedSent] = await db.update(testWorkspaceInvitationsTable)
        .set({ sentAt: new Date(), deliveryFailedAt: null })
        .where(and(
          eq(testWorkspaceInvitationsTable.id, result.invitationId),
          eq(testWorkspaceInvitationsTable.tokenHash, tokenHash),
        ))
        .returning({ id: testWorkspaceInvitationsTable.id });
      if (!markedSent) throw new Error("Invitation delivery attempt was superseded.");
    } catch (error) {
      await db.update(testWorkspaceInvitationsTable)
        .set({ deliveryFailedAt: new Date() })
        .where(and(
          eq(testWorkspaceInvitationsTable.id, result.invitationId),
          eq(testWorkspaceInvitationsTable.tokenHash, tokenHash),
        ));
      request.log.error({ err: error, organizationId: result.organization.id }, "Unable to deliver test workspace invitation");
      response.status(503).json({
        error: "أُنشئت مساحة الاختبار لكن تعذر إرسال الدعوة. أعد الإرسال من سجل المنشآت.",
        code: "invitation_delivery_failed",
        workspace: { id: result.organization.id, name: result.organization.name, isTestWorkspace: true, status: "delivery_failed" },
      });
      return;
    }

    response.status(201).json({
      workspace: {
        id: result.organization.id,
        name: result.organization.name,
        isTestWorkspace: true,
        status: "pending_owner",
        invitationExpiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    request.log.error({ err: error }, "Test workspace provisioning failed");
    response.status(500).json({ error: "تعذر إنشاء مساحة الاختبار. لم يتم حفظ أي مساحة." });
  }
});

router.post("/super-admin/organizations/:organizationId/initialization-retry", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const admin = response.locals.platformAdmin as PlatformAdminContext;
  const organizationId = organizationIdFromRequest(request);
  if (!organizationId) {
    response.status(400).json({ error: "معرّف المنشأة غير صحيح." });
    return;
  }

  const [organization] = await db.select({
    id: organizationsTable.id,
    dataGeneration: organizationsTable.dataGeneration,
    initializationStatus: organizationsTable.initializationStatus,
  }).from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  if (!organization) {
    response.status(404).json({ error: "المنشأة غير موجودة." });
    return;
  }
  if (organization.initializationStatus === "ready") {
    response.json({ organizationId, status: "ready", created: 0, retried: false });
    return;
  }

  try {
    const result = await initializeOrganization(organization.id, organization.dataGeneration);
    await db.insert(platformAuditLogsTable).values({
      adminId: admin.id,
      organizationId,
      actorName: admin.displayName,
      action: "organization_initialization_retried",
      entity: `organization:${organizationId}`,
      details: JSON.stringify({ created: result.created }),
    });
    response.json({ organizationId, status: "ready", created: result.created, retried: true });
  } catch (error) {
    const failure = safeInitializationFailure(error);
    await recordInitializationFailure(admin, organizationId, failure);
    request.log.error({ err: error, organizationId }, "Organization initialization retry failed");
    response.status(503).json({
      error: "تعذر إعادة تهيئة المنشأة. أصلح السبب ثم أعد المحاولة.",
      code: "organization_initialization_failed",
      initialization: {
        status: "failed",
        failureCode: failure.code,
        failureReason: failure.reason,
      },
    });
  }
});

router.post("/super-admin/test-workspaces/:organizationId/resend-invitation", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const admin = response.locals.platformAdmin as PlatformAdminContext;
  const organizationId = organizationIdFromRequest(request);
  if (!organizationId) {
    response.status(400).json({ error: "معرّف مساحة الاختبار غير صحيح." });
    return;
  }
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TEST_WORKSPACE_INVITATION_DAYS * DAY_MS);
  let invitationUrl: string;
  try {
    invitationUrl = `${appOrigin(request)}/test-workspace-invite?token=${encodeURIComponent(token)}`;
  } catch (error) {
    request.log.error({ err: error }, "Test workspace invitation origin is not configured");
    response.status(503).json({ error: "تعذر إنشاء رابط دعوة آمن. راجع إعداد عنوان التطبيق المنشور." });
    return;
  }

  const prepared = await db.transaction(async (tx) => {
    const [organization] = await tx.select().from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .for("update");
    if (!organization || !organization.isTestWorkspace) return { kind: "missing" as const };
    if (organization.initializationStatus !== "ready") return { kind: "initialization_incomplete" as const };
    const [invitation] = await tx.select().from(testWorkspaceInvitationsTable)
      .where(eq(testWorkspaceInvitationsTable.organizationId, organizationId))
      .orderBy(desc(testWorkspaceInvitationsTable.createdAt))
      .limit(1)
      .for("update");
    if (!invitation || invitation.acceptedAt) return { kind: "conflict" as const };
    await tx.update(testWorkspaceInvitationsTable).set({
      tokenHash,
      expiresAt,
      sentAt: null,
      deliveryFailedAt: null,
    }).where(eq(testWorkspaceInvitationsTable.id, invitation.id));
    return { kind: "prepared" as const, organization, invitation };
  });
  if (prepared.kind === "missing") {
    response.status(404).json({ error: "مساحة الاختبار غير موجودة." });
    return;
  }
  if (prepared.kind === "initialization_incomplete") {
    response.status(409).json({ error: "يجب إكمال تهيئة مساحة الاختبار قبل إرسال الدعوة." });
    return;
  }
  if (prepared.kind === "conflict") {
    response.status(409).json({ error: "قبل المالك الدعوة بالفعل ولا تحتاج إلى إعادة إرسال." });
    return;
  }
  try {
    await sendTestWorkspaceInvitation({
      email: prepared.invitation.email,
      ownerName: prepared.invitation.ownerName,
      workspaceName: prepared.organization.name,
      invitationUrl,
    });
    const [markedSent] = await db.update(testWorkspaceInvitationsTable)
      .set({ sentAt: new Date(), deliveryFailedAt: null })
      .where(and(
        eq(testWorkspaceInvitationsTable.id, prepared.invitation.id),
        eq(testWorkspaceInvitationsTable.tokenHash, tokenHash),
      ))
      .returning({ id: testWorkspaceInvitationsTable.id });
    if (!markedSent) {
      response.status(409).json({ error: "تجاوز طلب أحدث محاولة إعادة الإرسال هذه. استخدم أحدث دعوة فقط." });
      return;
    }
    await db.insert(platformAuditLogsTable).values({
      adminId: admin.id,
      organizationId,
      actorName: admin.displayName,
      action: "test_workspace_invitation_resent",
      entity: `organization:${organizationId}`,
      details: JSON.stringify({ invitationId: prepared.invitation.id, expiresAt: expiresAt.toISOString() }),
    });
    response.json({ sent: true, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    await db.update(testWorkspaceInvitationsTable)
      .set({ deliveryFailedAt: new Date() })
      .where(and(
        eq(testWorkspaceInvitationsTable.id, prepared.invitation.id),
        eq(testWorkspaceInvitationsTable.tokenHash, tokenHash),
      ));
    request.log.error({ err: error, organizationId }, "Unable to resend test workspace invitation");
    response.status(503).json({ error: "تعذر إعادة إرسال الدعوة. يمكنك المحاولة مرة أخرى لاحقاً." });
  }
});

router.post("/super-admin/organizations/:organizationId/subscription-action", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const admin = response.locals.platformAdmin as PlatformAdminContext;
  const organizationId = organizationIdFromRequest(request);
  const body = request.body as Record<string, unknown> | undefined;
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const confirmed = body?.confirmed === true || body?.confirmation === true;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  if (!organizationId || !SUBSCRIPTION_ACTIONS.has(action)) {
    response.status(400).json({ error: "اختر إجراء اشتراك صحيحاً." });
    return;
  }
  if (!confirmed) {
    response.status(400).json({ error: "يلزم تأكيد الإجراء قبل تنفيذه.", code: "confirmation_required" });
    return;
  }

  const rawDays = body?.durationDays;
  const durationDays = rawDays === undefined || rawDays === null || rawDays === ""
    ? null
    : Number(rawDays);
  if (action === "extend_trial" || action === "extend_access") {
    if (typeof durationDays !== "number" || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_EXTENSION_DAYS) {
      response.status(400).json({ error: `اختر مدة بين يوم واحد و${MAX_EXTENSION_DAYS} يوماً.` });
      return;
    }
  } else if (durationDays !== null) {
    response.status(400).json({ error: "لا تحتاج إجراءات الإيقاف أو الاستعادة إلى مدة." });
    return;
  }

  const now = new Date();
  try {
    const result = await db.transaction(async (tx) => {
      const [organization] = await tx.select().from(organizationsTable)
        .where(eq(organizationsTable.id, organizationId))
        .for("update");
      if (!organization) return { kind: "not_found" as const };

      const current: SubscriptionFields = organization;
      if (action === "extend_trial" && (organization.stripeSubscriptionId || organization.planId !== "trial")) {
        return { kind: "conflict" as const, error: "لا يمكن تمديد تجربة منشأة مرتبطة باشتراك مدفوع. افتح إدارة الاشتراك من Stripe بدلاً من ذلك." };
      }
      if (action === "extend_access" && organization.stripeSubscriptionId) {
        return { kind: "conflict" as const, error: "لا يمكن تعديل مدة اشتراك Stripe محلياً. افتح إدارة الاشتراك من Stripe بدلاً من ذلك." };
      }
      if (action === "restore_access" && !organization.platformAccessSuspendedAt) {
        return { kind: "conflict" as const, error: "الوصول لهذه المنشأة غير معلّق حالياً." };
      }

      const previous = subscriptionSnapshot(current, now);
      const currentEnd = effectiveEndDate(current);
      const baseTime = Math.max(now.getTime(), currentEnd?.getTime() ?? now.getTime());
      const extensionEnd = typeof durationDays === "number" ? new Date(baseTime + durationDays * DAY_MS) : null;
      let update: Partial<typeof organizationsTable.$inferInsert>;

      if (action === "extend_trial") {
        update = {
          planId: "trial",
          subscriptionStatus: "trialing",
          trialEndsAt: extensionEnd!,
          platformAccessSuspendedAt: null,
        };
      } else if (action === "extend_access") {
        update = {
          subscriptionStatus: "active",
          subscriptionStartedAt: organization.subscriptionStartedAt ?? now,
          subscriptionEndsAt: extensionEnd!,
          platformAccessSuspendedAt: null,
        };
      } else if (action === "suspend_access") {
        update = { platformAccessSuspendedAt: now };
      } else {
        update = { platformAccessSuspendedAt: null };
      }

      const [updated] = await tx.update(organizationsTable)
        .set(update)
        .where(eq(organizationsTable.id, organizationId))
        .returning();
      if (!updated) throw new Error("Subscription action did not update an organization.");

      const next = subscriptionSnapshot(updated, now);
      const [audit] = await tx.insert(platformAuditLogsTable).values({
        adminId: admin.id,
        organizationId,
        actorName: admin.displayName,
        action,
        entity: `organization:${organizationId}`,
        details: JSON.stringify({
          reason: reason || "إجراء من بوابة الإدارة العليا",
          confirmed: true,
          confirmedAt: now.toISOString(),
          previous,
          next,
        }),
      }).returning({ id: platformAuditLogsTable.id, createdAt: platformAuditLogsTable.createdAt });

      return { kind: "success" as const, action, organization: updated, audit };
    });

    if (result.kind === "not_found") {
      response.status(404).json({ error: "المنشأة غير موجودة." });
      return;
    }
    if (result.kind === "conflict") {
      response.status(409).json({ error: result.error });
      return;
    }
    response.json({
      organizationId,
      action: result.action,
      auditLog: {
        id: result.audit.id,
        createdAt: result.audit.createdAt.toISOString(),
      },
      subscription: subscriptionSnapshot(result.organization, now),
    });
  } catch (error) {
    request.log.error({ error, organizationId, action }, "Platform subscription action failed");
    response.status(500).json({ error: "تعذر تنفيذ إجراء الاشتراك. لم يتم حفظ التغيير." });
  }
});

router.get("/super-admin/organizations/:organizationId/audit-logs", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const organizationId = organizationIdFromRequest(request);
  if (!organizationId) {
    response.status(400).json({ error: "معرّف المنشأة غير صحيح." });
    return;
  }
  const logs = await db.select({
    id: platformAuditLogsTable.id,
    actorName: platformAuditLogsTable.actorName,
    action: platformAuditLogsTable.action,
    entity: platformAuditLogsTable.entity,
    details: platformAuditLogsTable.details,
    createdAt: platformAuditLogsTable.createdAt,
  }).from(platformAuditLogsTable)
    .where(and(
      eq(platformAuditLogsTable.organizationId, organizationId),
      eq(platformAuditLogsTable.entity, `organization:${organizationId}`),
    ))
    .orderBy(desc(platformAuditLogsTable.createdAt))
    .limit(50);
  response.json({ logs: logs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() })) });
});

router.post("/super-admin/organizations/:organizationId/billing-portal", requirePlatformAdmin, async (request: Request, response: Response): Promise<void> => {
  const admin = response.locals.platformAdmin as PlatformAdminContext;
  const organizationId = organizationIdFromRequest(request);
  if (!organizationId) {
    response.status(400).json({ error: "معرّف المنشأة غير صحيح." });
    return;
  }
  const [organization] = await db.select({
    stripeCustomerId: organizationsTable.stripeCustomerId,
    name: organizationsTable.name,
  }).from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  if (!organization) {
    response.status(404).json({ error: "المنشأة غير موجودة." });
    return;
  }
  if (!organization.stripeCustomerId) {
    response.status(409).json({ error: "لا توجد بيانات دفع مرتبطة بهذه المنشأة بعد." });
    return;
  }

  try {
    const stripe = await (await import("../lib/stripe-client")).getUncachableStripeClient();
    const baseUrl = `${request.protocol}://${request.get("host")}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: `${baseUrl}/super-admin`,
    });
    const [audit] = await db.insert(platformAuditLogsTable).values({
      adminId: admin.id,
      organizationId,
      actorName: admin.displayName,
      action: "subscription_portal_opened",
      entity: `organization:${organizationId}`,
      details: JSON.stringify({ confirmed: true, openedAt: new Date().toISOString() }),
    }).returning({ id: platformAuditLogsTable.id });
    response.json({ url: session.url, auditLogId: audit?.id ?? null });
  } catch (error) {
    request.log.error({ error, organizationId }, "Platform billing portal failed");
    response.status(503).json({ error: "تعذر فتح إدارة الاشتراك حالياً." });
  }
});

export default router;