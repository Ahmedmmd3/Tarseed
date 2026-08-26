import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  platformAdminsTable,
  platformAdminSessionsTable,
  type PlatformAdmin,
} from "@workspace/db";
import { hashSessionToken } from "../lib/team-auth";

export const PLATFORM_ADMIN_COOKIE = "wudooh_super_admin_session";

export type PlatformAdminContext = Pick<PlatformAdmin, "id" | "username" | "displayName" | "status">;

export async function getPlatformAdminContext(request: Request): Promise<PlatformAdminContext | null> {
  const token = request.cookies?.[PLATFORM_ADMIN_COOKIE];
  if (typeof token !== "string" || !token) return null;

  const [admin] = await db
    .select({
      id: platformAdminsTable.id,
      username: platformAdminsTable.username,
      displayName: platformAdminsTable.displayName,
      status: platformAdminsTable.status,
    })
    .from(platformAdminSessionsTable)
    .innerJoin(platformAdminsTable, eq(platformAdminSessionsTable.adminId, platformAdminsTable.id))
    .where(and(
      eq(platformAdminSessionsTable.tokenHash, hashSessionToken(token)),
      isNull(platformAdminSessionsTable.revokedAt),
      gt(platformAdminSessionsTable.expiresAt, new Date()),
      eq(platformAdminsTable.status, "active"),
    ))
    .limit(1);

  return admin ?? null;
}

export async function requirePlatformAdmin(request: Request, response: Response, next: NextFunction): Promise<void> {
  const admin = await getPlatformAdminContext(request);
  if (!admin) {
    response.status(401).json({ error: "غير مصرح لك بالوصول إلى الإدارة العليا." });
    return;
  }
  response.locals.platformAdmin = admin;
  next();
}