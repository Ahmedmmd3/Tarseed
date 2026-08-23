import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { authSessionsTable, db, organizationsTable, teamUsersTable, type TeamUser } from "@workspace/db";
import { hashSessionToken } from "../lib/team-auth";

export type AuthContext = TeamUser & { projectName: string };

export async function getAuthContext(request: Request): Promise<AuthContext | null> {
  const token = request.cookies?.wudooh_session;
  if (typeof token !== "string" || !token) return null;
  const [result] = await db
    .select({ user: teamUsersTable, projectName: organizationsTable.name })
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
  return result ? { ...result.user, projectName: result.projectName } : null;
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