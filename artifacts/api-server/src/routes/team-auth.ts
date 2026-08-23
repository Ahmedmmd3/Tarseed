import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  authSessionsTable,
  db,
  erpRecordsTable,
  organizationsTable,
  teamAuditLogsTable,
  teamUsersTable,
  type TeamUser,
} from "@workspace/db";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "../lib/team-auth";
import { getAuthContext, requireAuth, requireOwner, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
const SESSION_DAYS = 14;
const REMOTE_SESSION_HINT_COOKIE = "wudooh_remote_session";
const PERMISSION_KEYS = new Set(["dashboard", "sales", "accounting", "inventory", "hr", "operations", "reports"]);
const ROLE_IDS = new Set(["sales", "accountant", "inventory", "hr", "manager", "custom"]);
const LOCATION_SCOPES = new Set(["all", "selected", "none"]);

function safeUser(user: TeamUser, projectName: string) {
  return {
    id: user.id,
    accountId: user.id,
    organizationId: user.organizationId,
    projectName,
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
  response.status(201).json({ user: safeUser(result.user, result.organization.name) });
});

router.post("/auth/login", async (request: Request, response: Response): Promise<void> => {
  const body = request.body as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const [result] = await db.select({ user: teamUsersTable, projectName: organizationsTable.name })
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
  await recordAudit({ ...result.user, projectName: result.projectName }, "login", "user", result.user.email);
  response.json({ user: safeUser(result.user, result.projectName) });
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
  response.json({ user: auth ? safeUser(auth, auth.projectName) : null });
});

router.get("/team/members", requireAuth, requireOwner, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const users = await db.select().from(teamUsersTable).where(eq(teamUsersTable.organizationId, auth.organizationId)).orderBy(teamUsersTable.createdAt);
  response.json({ members: users.filter(user => user.id !== auth.id).map(user => safeUser(user, auth.projectName)) });
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
  response.status(201).json({ member: safeUser(user, auth.projectName) });
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
  response.json({ member: safeUser(updated, auth.projectName) });
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
  response.json({ member: safeUser(updated, auth.projectName) });
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