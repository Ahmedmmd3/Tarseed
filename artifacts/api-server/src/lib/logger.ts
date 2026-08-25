import pino from "pino";

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

type ExpiredSignatureMetricState = {
  windowStartedAt: number;
  count: number;
  alertSent: boolean;
};

let expiredSignatureMetric: ExpiredSignatureMetricState | null = null;

function activeExpiredSignatureMetric(now: number): ExpiredSignatureMetricState {
  if (
    !expiredSignatureMetric
    || now < expiredSignatureMetric.windowStartedAt
    || now >= expiredSignatureMetric.windowStartedAt + STRIPE_EXPIRED_SIGNATURE_WINDOW_MS
  ) {
    expiredSignatureMetric = {
      windowStartedAt: now,
      count: 0,
      alertSent: false,
    };
  }
  return expiredSignatureMetric;
}

export type StripeExpiredSignatureMetric = {
  attemptsInWindow: number;
  windowSeconds: number;
  alertThreshold: number;
  alertTriggered: boolean;
};

export function recordExpiredStripeWebhookSignature(
  now = Date.now(),
): StripeExpiredSignatureMetric {
  const metric = activeExpiredSignatureMetric(now);
  metric.count += 1;

  const details = {
    securityEvent: "stripe_webhook_signature_rejected",
    rejectionReason: "expired_signature",
    attemptsInWindow: metric.count,
    windowSeconds: STRIPE_EXPIRED_SIGNATURE_WINDOW_MS / 1000,
    alertThreshold: STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD,
  } as const;
  logger.warn(details, "Expired Stripe webhook signature rejected");

  const alertTriggered = metric.count >= STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD && !metric.alertSent;
  if (alertTriggered) {
    metric.alertSent = true;
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
    attemptsInWindow: metric.count,
    windowSeconds: details.windowSeconds,
    alertThreshold: details.alertThreshold,
    alertTriggered,
  };
}
