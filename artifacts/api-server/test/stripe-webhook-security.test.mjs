import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  db,
  stripeWebhookSecurityMetricsTable,
} from "@workspace/db";
import {
  dispatchStripeWebhookSecurityAlert,
  recordExpiredStripeWebhookSignature,
  STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD,
  STRIPE_EXPIRED_SIGNATURE_WINDOW_MS,
} from "../src/lib/logger.ts";
import { isExpiredStripeSignatureError } from "../src/lib/stripe-webhooks.ts";

async function clearExpiredSignatureMetric() {
  await db.delete(stripeWebhookSecurityMetricsTable).where(
    eq(stripeWebhookSecurityMetricsTable.rejectionReason, "expired_signature"),
  );
}

test.beforeEach(clearExpiredSignatureMetric);
test.after(clearExpiredSignatureMetric);

test("يتعرف فقط على خطأ انتهاء مهلة توقيع Stripe", () => {
  const expiredError = Object.assign(new Error("Timestamp outside the tolerance zone"), {
    name: "StripeSignatureVerificationError",
  });
  const invalidSignatureError = Object.assign(new Error("No signatures found matching the expected signature"), {
    name: "StripeSignatureVerificationError",
  });

  assert.equal(isExpiredStripeSignatureError(expiredError), true);
  assert.equal(isExpiredStripeSignatureError(invalidSignatureError), false);
  assert.equal(isExpiredStripeSignatureError(new Error("Timestamp outside the tolerance zone")), false);
  assert.equal(isExpiredStripeSignatureError(null), false);
});

test("يجمع الرفض المتزامن وينبه مرة واحدة داخل النافذة ثم يعيد العد بعدها", async () => {
  const startedAt = Date.now() + 60_000;

  let metric = await recordExpiredStripeWebhookSignature(startedAt);
  assert.deepEqual(metric, {
    attemptsInWindow: 1,
    windowSeconds: STRIPE_EXPIRED_SIGNATURE_WINDOW_MS / 1000,
    alertThreshold: STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD,
    alertTriggered: false,
    windowStartedAt: new Date(startedAt).toISOString(),
  });

  const concurrentMetrics = await Promise.all(
    Array.from(
      { length: STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD - 1 },
      () => recordExpiredStripeWebhookSignature(startedAt),
    ),
  );

  assert.equal(
    concurrentMetrics.filter((result) => result.alertTriggered).length,
    1,
    "لا ينبغي أن ترسل النسخ المتزامنة أكثر من تنبيه واحد",
  );
  assert.equal(
    Math.max(...concurrentMetrics.map((result) => result.attemptsInWindow)),
    STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD,
  );

  metric = await recordExpiredStripeWebhookSignature(startedAt + STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD);
  assert.equal(metric.attemptsInWindow, STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD + 1);
  assert.equal(metric.alertTriggered, false);

  metric = await recordExpiredStripeWebhookSignature(startedAt + STRIPE_EXPIRED_SIGNATURE_WINDOW_MS);
  assert.equal(metric.attemptsInWindow, 1);
  assert.equal(metric.alertTriggered, false);
});

test("يرسل التنبيه التشغيلي السبب والعدد والنافذة دون تعطيل مسار الرفض", async () => {
  const alert = {
    rejectionReason: "expired_signature",
    attemptsInWindow: STRIPE_EXPIRED_SIGNATURE_ALERT_THRESHOLD,
    windowSeconds: STRIPE_EXPIRED_SIGNATURE_WINDOW_MS / 1000,
    windowStartedAt: new Date().toISOString(),
  };
  let delivered;
  let releaseDelivery;
  const deliveryStarted = new Promise((resolve) => {
    releaseDelivery = resolve;
  });

  dispatchStripeWebhookSecurityAlert(alert, async (received) => {
    delivered = received;
    await deliveryStarted;
  });

  assert.deepEqual(delivered, alert);
  releaseDelivery();
  await new Promise((resolve) => setImmediate(resolve));
});