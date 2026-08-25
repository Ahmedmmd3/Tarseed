import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

type StripeCredentials = {
  secretKey: string;
};

type StripeSyncWebhookProcessor = Pick<StripeSync, "processWebhook">;

let stripeSyncTestFactory: (() => StripeSyncWebhookProcessor) | null = null;

export function setStripeSyncWebhookProcessorForTests(
  factory: (() => StripeSyncWebhookProcessor) | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Stripe Sync test overrides are only available in test mode.");
  }
  stripeSyncTestFactory = factory;
}

function stripeClientOptions(): Stripe.StripeConfig {
  if (process.env.NODE_ENV !== "test") return {};

  const configuredBaseUrl = process.env.STRIPE_API_BASE_URL?.trim();
  if (!configuredBaseUrl) return {};

  const baseUrl = new URL(configuredBaseUrl);
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("STRIPE_API_BASE_URL must use http or https.");
  }
  return {
    host: baseUrl.hostname,
    port: baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80),
    protocol: baseUrl.protocol.slice(0, -1) as "http" | "https",
  };
}

async function getStripeCredentials(): Promise<StripeCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Stripe integration is not available in this environment.");
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Unable to fetch Stripe connection: ${response.status}`);
  }

  const payload = await response.json() as { items?: Array<{ settings?: { secret?: string } }> };
  const settings = payload.items?.[0]?.settings;
  if (!settings?.secret) {
    throw new Error("Stripe connection is missing its secret key.");
  }
  return { secretKey: settings.secret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey, stripeClientOptions());
}

export async function getStripeSync(): Promise<StripeSync> {
  if (stripeSyncTestFactory) return stripeSyncTestFactory() as StripeSync;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe sync.");
  const { secretKey } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: "",
  });
}

export async function retrieveStripeEvent(payload: Buffer): Promise<Stripe.Event> {
  const decoded = JSON.parse(payload.toString("utf8")) as { id?: unknown };
  const eventId = typeof decoded.id === "string" && /^evt_[A-Za-z0-9]+$/.test(decoded.id) ? decoded.id : null;
  if (!eventId) throw new Error("Stripe webhook payload has no valid event ID.");
  const stripe = await getUncachableStripeClient();
  return stripe.events.retrieve(eventId);
}