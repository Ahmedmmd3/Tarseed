import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripe-client";

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
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) {
    await stripeSync.findOrCreateManagedWebhook(`https://${domain}/api/stripe/webhook`);
  } else {
    logger.warn("REPLIT_DOMAINS is unavailable; managed Stripe webhook was not configured.");
  }
  await stripeSync.syncBackfill();
}

try {
  await initializeStripe();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
} catch (error) {
  logger.error({ err: error }, "Stripe initialization failed");
  process.exit(1);
}
