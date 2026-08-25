import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { authSessionsTable, db, organizationsTable, teamUsersTable, type TeamUser } from "@workspace/db";
import { hashSessionToken } from "../lib/team-auth";

export type SubscriptionStatus = "trialing" | "active" | "expired" | "inactive";
export type SubscriptionFields = {
  planId: string;
  subscriptionStatus: string;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  subscriptionStartedAt: Date | null;
  subscriptionEndsAt: Date | null;
};
export type AuthContext = TeamUser & { projectName: string; dataGeneration: number } & SubscriptionFields;
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function subscriptionState(subscription: SubscriptionFields, now = new Date()): SubscriptionStatus {
  if (subscription.subscriptionStatus === "active"
    && (!subscription.subscriptionEndsAt || subscription.subscriptionEndsAt > now)) {
    return "active";
  }
  if (subscription.subscriptionStatus === "trialing"
    && Boolean(subscription.trialEndsAt && subscription.trialEndsAt > now)) {
    return "trialing";
  }
  if (subscription.subscriptionStatus === "trialing" || subscription.subscriptionStatus === "active") return "expired";
  return "inactive";
}

export function hasSubscriptionAccess(subscription: SubscriptionFields, now = new Date()): boolean {
  const state = subscriptionState(subscription, now);
  return state === "active" || state === "trialing";
}

export async function getAuthContext(request: Request): Promise<AuthContext | null> {
  const token = request.cookies?.wudooh_session;
  if (typeof token !== "string" || !token) return null;
  const [result] = await db
    .select({
      user: teamUsersTable,
      projectName: organizationsTable.name,
      dataGeneration: organizationsTable.dataGeneration,
      planId: organizationsTable.planId,
      subscriptionStatus: organizationsTable.subscriptionStatus,
      trialStartedAt: organizationsTable.trialStartedAt,
      trialEndsAt: organizationsTable.trialEndsAt,
      subscriptionStartedAt: organizationsTable.subscriptionStartedAt,
      subscriptionEndsAt: organizationsTable.subscriptionEndsAt,
    })
    .from(authSessionsTable)
    .innerJoin(teamUsersTable, eq(authSessionsTable.userId, teamUsersTable.id))
    .innerJoin(organizationsTable, eq(teamUsersTable.organizationId, organizationsTable.id))
    .where(and(
      eq(authSessionsTable.tokenHash, hashSessionToken(token)),
      isNull(authSessionsTable.revokedAt),
      gt(authSessionsTable.expiresAt, new Date()),
      eq(teamUsersTable.status, "active"),
    ))
    .limit(1);
  return result ? {
    ...result.user,
    projectName: result.projectName,
    dataGeneration: result.dataGeneration,
    planId: result.planId,
    subscriptionStatus: result.subscriptionStatus,
    trialStartedAt: result.trialStartedAt,
    trialEndsAt: result.trialEndsAt,
    subscriptionStartedAt: result.subscriptionStartedAt,
    subscriptionEndsAt: result.subscriptionEndsAt,
  } : null;
}

export async function requireAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  const auth = await getAuthContext(request);
  if (!auth) {
    response.status(401).json({ error: "غير مصرح لك بالوصول." });
    return;
  }
  response.locals.auth = auth;
  next();
}

export function requireOwner(_request: Request, response: Response, next: NextFunction): void {
  const auth = response.locals.auth as AuthContext | undefined;
  if (!auth || auth.roleId !== "owner") {
    response.status(403).json({ error: "هذه العملية متاحة لمالك المنشأة فقط." });
    return;
  }
  next();
}

export function requireCurrentDataGeneration(request: Request, response: Response, next: NextFunction): void {
  const auth = response.locals.auth as AuthContext | undefined;
  const generation = Number(request.get("X-Wudooh-Data-Generation"));
  if (!auth || !Number.isSafeInteger(generation) || generation !== auth.dataGeneration) {
    response.status(409).json({
      error: "تغيّرت بيانات المنشأة منذ تحميلها. حدّث الصفحة قبل متابعة التعديل.",
      code: "stale_data_generation",
    });
    return;
  }
  response.locals.dataGeneration = generation;
  next();
}

export function requireSubscriptionAccess(_request: Request, response: Response, next: NextFunction): void {
  const auth = response.locals.auth as AuthContext | undefined;
  if (!auth || !hasSubscriptionAccess(auth)) {
    response.status(402).json({
      error: "يتطلب الوصول إلى لوحة التحكم اشتراكاً فعالاً أو فترة تجريبية سارية.",
      code: "subscription_required",
    });
    return;
  }
  next();
}

export async function lockAndValidateDataGeneration(tx: DatabaseTransaction, response: Response): Promise<boolean> {
  const auth = response.locals.auth as AuthContext | undefined;
  const generation = response.locals.dataGeneration;
  if (!auth || !Number.isSafeInteger(generation)) return false;
  const [organization] = await tx.select({ dataGeneration: organizationsTable.dataGeneration })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, auth.organizationId))
    .for("update");
  return organization?.dataGeneration === generation;
}