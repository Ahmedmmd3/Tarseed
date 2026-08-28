import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripe-client";
import { ensureInitialPlatformAdmin } from "./lib/platform-admin-bootstrap";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initializeStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe.");
  await runMigrations({ databaseUrl });
  const stripeSync = await getStripeSync();
  const publicAppUrl = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") {
    logger.info("Managed Stripe webhook configuration is skipped outside production.");
  } else if (publicAppUrl) {
    await stripeSync.findOrCreateManagedWebhook(`${publicAppUrl}/api/stripe/webhook`);
  } else {
    logger.warn("PUBLIC_APP_URL is unavailable; managed Stripe webhook was not configured.");
  }
  await stripeSync.syncBackfill();
}

try {
  try {
    await initializeStripe();
  } catch (error) {
    if (process.env.STRIPE_STARTUP_REQUIRED !== "false") throw error;
    logger.warn(
      { err: error },
      "Stripe startup initialization is disabled; billing and subscription synchronization are unavailable.",
    );
  }
  const platformAdminCreated = await ensureInitialPlatformAdmin();
  if (platformAdminCreated) {
    logger.info("Initial platform administrator created.");
  }
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
} catch (error) {
  logger.error({ err: error }, "Server initialization failed");
  process.exit(1);
}
