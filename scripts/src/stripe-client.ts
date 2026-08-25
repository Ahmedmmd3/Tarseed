import Stripe from "stripe";

async function getStripeSecretKey(): Promise<string> {
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
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } },
  );
  if (!response.ok) throw new Error(`Unable to fetch Stripe connection: ${response.status}`);
  const payload = await response.json() as { items?: Array<{ settings?: { secret?: string } }> };
  const key = payload.items?.[0]?.settings?.secret;
  if (!key) throw new Error("Stripe connection is missing its secret key.");
  return key;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  return new Stripe(await getStripeSecretKey());
}