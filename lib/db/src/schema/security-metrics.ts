import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const stripeWebhookSecurityMetricsTable = pgTable("stripe_webhook_security_metrics", {
  rejectionReason: text("rejection_reason").primaryKey(),
  attemptsInWindow: integer("attempts_in_window").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  alertSent: boolean("alert_sent").notNull().default(false),
});