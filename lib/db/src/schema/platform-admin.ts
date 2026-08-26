import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const platformAdminsTable = pgTable(
  "platform_admins",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull().default("مدير المنصة"),
    passwordHash: text("password_hash").notNull(),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_admins_username_unique").on(table.username),
  ],
);

export const platformAdminSessionsTable = pgTable(
  "platform_admin_sessions",
  {
    id: serial("id").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => platformAdminsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_admin_sessions_token_hash_unique").on(table.tokenHash),
    index("platform_admin_sessions_admin_idx").on(table.adminId),
  ],
);

export const platformAuditLogsTable = pgTable(
  "platform_audit_logs",
  {
    id: serial("id").primaryKey(),
    adminId: integer("admin_id").references(() => platformAdminsTable.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull().default(""),
    details: text("details").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_audit_logs_admin_created_idx").on(table.adminId, table.createdAt),
  ],
);

export type PlatformAdmin = typeof platformAdminsTable.$inferSelect;