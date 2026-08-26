import { Router, type IRouter, type Request, type Response } from "express";
import { asc, eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  platformAdminsTable,
  platformAdminSessionsTable,
  platformAuditLogsTable,
  teamUsersTable,
} from "@workspace/db";
import { createSessionToken, hashSessionToken, verifyPassword } from "../lib/team-auth";
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
      status,
      trialEndsAt: organization.trialEndsAt?.toISOString() ?? null,
      subscriptionEndsAt: organization.subscriptionEndsAt?.toISOString() ?? null,
      effectiveEndsAt: endDate?.toISOString() ?? null,
      daysRemaining: daysRemaining(endDate, now),
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
  });

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
    pagination: {
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    },
    generatedAt: now.toISOString(),
  });
});

export default router;