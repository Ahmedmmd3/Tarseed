import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./team-auth";

export const purchaseOrderSharesTable = pgTable(
  "purchase_order_shares",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    purchaseOrderId: integer("purchase_order_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    decisionStatus: text("decision_status").notNull().default("pending"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("purchase_order_shares_token_hash_unique").on(table.tokenHash),
    index("purchase_order_shares_order_idx").on(table.organizationId, table.purchaseOrderId),
    index("purchase_order_shares_expiry_idx").on(table.expiresAt),
    index("purchase_order_shares_org_expiry_idx").on(table.organizationId, table.expiresAt),
  ],
);
