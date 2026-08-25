import pino from "pino";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, stripeWebhookSecurityMetricsTable } from "@workspace/db";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

export const STRIPE_EXPIRED_SIGNATURE_WINDOW_MS = 15 * 60 * 1000;
export const STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD = 5;

export type StripeExpiredSignatureMetric = {
  attemptsInWindow: number;
  windowSeconds: number;
  alertThreshold: number;
  alertTriggered: boolean;
};

export async function recordExpiredStripeWebhookSignature(
  now = Date.now(),
): Promise<StripeExpiredSignatureMetric> {
  const observedAt = new Date(now);
  const expiredBefore = new Date(now - STRIPE_EXPIRED_SIGNATURE_WINDOW_MS);
  const metricTable = stripeWebhookSecurityMetricsTable;
  const windowExpired = sql`(
    ${metricTable.windowStartedAt} > ${observedAt}
    OR ${metricTable.windowStartedAt} <= ${expiredBefore}
  )`;
  const [metric] = await db
    .insert(metricTable)
    .values({
      rejectionReason: "expired_signature",
      attemptsInWindow: 1,
      windowStartedAt: observedAt,
      alertSent: false,
    })
    .onConflictDoUpdate({
      target: metricTable.rejectionReason,
      set: {
        windowStartedAt: sql`CASE WHEN ${windowExpired} THEN ${observedAt} ELSE ${metricTable.windowStartedAt} END`,
        attemptsInWindow: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${metricTable.attemptsInWindow} + 1 END`,
        alertSent: sql`CASE WHEN ${windowExpired} THEN false ELSE ${metricTable.alertSent} END`,
      },
    })
    .returning({
      attemptsInWindow: metricTable.attemptsInWindow,
      windowStartedAt: metricTable.windowStartedAt,
    });
  if (!metric) {
    throw new Error("Expired Stripe signature metric was not recorded.");
  }

  const shouldTriggerAlert = metric.attemptsInWindow >= STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD;
  let alertTriggered = false;
  if (shouldTriggerAlert) {
    const [claimedAlert] = await db
      .update(metricTable)
      .set({ alertSent: true })
      .where(and(
        eq(metricTable.rejectionReason, "expired_signature"),
        eq(metricTable.windowStartedAt, metric.windowStartedAt),
        eq(metricTable.alertSent, false),
        gte(metricTable.attemptsInWindow, STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD),
      ))
      .returning({ rejectionReason: metricTable.rejectionReason });
    alertTriggered = Boolean(claimedAlert);
  }

  const details = {
    securityEvent: "stripe_webhook_signature_rejected",
    rejectionReason: "expired_signature",
    attemptsInWindow: metric.attemptsInWindow,
    windowSeconds: STRIPE_EXPIRED_SIGNATURE_WINDOW_MS / 1000,
    alertThreshold: STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD,
    windowStartedAt: metric.windowStartedAt.toISOString(),
  } as const;
  logger.warn(details, "Expired Stripe webhook signature rejected");

  if (alertTriggered) {
    logger.error(
      {
        securityAlert: "repeated_expired_signature_rejections",
        rejectionReason: details.rejectionReason,
        attemptsInWindow: details.attemptsInWindow,
        windowSeconds: details.windowSeconds,
        alertThreshold: details.alertThreshold,
      },
      "Repeated expired Stripe webhook signature rejections detected",
    );
  }

  return {
    attemptsInWindow: metric.attemptsInWindow,
    windowSeconds: details.windowSeconds,
    alertThreshold: details.alertThreshold,
    alertTriggered,
  };
}
