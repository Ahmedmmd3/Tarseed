import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  stripeWebhookEventsTable,
  teamAuditLogsTable,
} from "@workspace/db";
import app from "../src/app.ts";
import { setStripeSyncWebhookProcessorForTests } from "../src/lib/stripe-client.ts";

const stripeWebhookSecret = "whsec_wudooh_billing_test_secret";
const testPriceId = "price_wudoohprotest";
const testCustomerId = "cus_wudoohbillingtest";
const testSubscriptionId = "sub_wudoohbillingtest";
const testPeriodStart = Math.floor(Date.now() / 1000) - 60;
const testPeriodEnd = testPeriodStart + (30 * 24 * 60 * 60);

const testProduct = {
  id: "prod_wudoohprotest",
  object: "product",
  active: true,
  name: "وضوح الاحترافية",
  description: "باقة اختبارية شهرية",
  metadata: { wudoohPlan: "true", planId: "pro" },
};

const testPrice = {
  id: testPriceId,
  object: "price",
  active: true,
  type: "recurring",
  currency: "sar",
  unit_amount: 9900,
  recurring: { interval: "month", interval_count: 1 },
  product: testProduct,
};

let appServer;
let stripeServer;
let origin;
let stripeApiBaseUrl;
let originalFetch;
let requestedCheckoutBody = "";
let requestedPortalBody = "";

function unique(prefix) {
  return `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function request(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await originalFetch(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...headers,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function cookieFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "يجب أن ينشئ التسجيل جلسة للمالك");
  return cookie.split(";")[0];
}

function activeSubscriptionEvent(organizationId, eventId) {
  return {
    id: eventId,
    object: "event",
    type: "customer.subscription.created",
    data: {
      object: {
        id: testSubscriptionId,
        object: "subscription",
        customer: testCustomerId,
        status: "active",
        start_date: testPeriodStart,
        metadata: { organizationId: String(organizationId), planId: "pro" },
        items: {
          object: "list",
          data: [{
            id: "si_wudoohbillingtest",
            object: "subscription_item",
            current_period_end: testPeriodEnd,
            price: {
              id: testPriceId,
              object: "price",
              metadata: { planId: "pro" },
            },
          }],
        },
      },
    },
  };
}

test.before(async () => {
  originalFetch = globalThis.fetch;
  stripeServer = createServer(async (requestToStripe, responseFromStripe) => {
    const url = new URL(requestToStripe.url ?? "/", `http://${requestToStripe.headers.host}`);
    if (requestToStripe.method === "GET" && url.pathname === "/v1/prices") {
      sendJson(responseFromStripe, 200, { object: "list", data: [testPrice], has_more: false, url: "/v1/prices" });
      return;
    }
    if (requestToStripe.method === "GET" && url.pathname === `/v1/prices/${testPriceId}`) {
      sendJson(responseFromStripe, 200, testPrice);
      return;
    }
    if (requestToStripe.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      requestedCheckoutBody = await readBody(requestToStripe);
      sendJson(responseFromStripe, 200, {
        id: "cs_wudoohbillingtest",
        object: "checkout.session",
        url: "https://checkout.stripe.test/c/pay/cs_wudoohbillingtest",
      });
      return;
    }
    if (requestToStripe.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
      requestedPortalBody = await readBody(requestToStripe);
      sendJson(responseFromStripe, 200, {
        id: "bps_wudoohbillingtest",
        object: "billing_portal.session",
        url: "https://billing.stripe.test/session/bps_wudoohbillingtest",
      });
      return;
    }
    if (requestToStripe.method === "GET" && /^\/v1\/events\/evt_[A-Za-z0-9]+$/.test(url.pathname)) {
      const eventPayload = globalThis.__wudoohStripeTestEvent;
      sendJson(responseFromStripe, 200, eventPayload);
      return;
    }
    sendJson(responseFromStripe, 404, { error: { message: `Unhandled Stripe test request: ${requestToStripe.method} ${url.pathname}` } });
  });
  await new Promise((resolve) => stripeServer.listen(0, "127.0.0.1", resolve));
  const stripeAddress = stripeServer.address();
  assert.ok(stripeAddress && typeof stripeAddress === "object");
  stripeApiBaseUrl = `http://127.0.0.1:${stripeAddress.port}`;

  process.env.STRIPE_API_BASE_URL = stripeApiBaseUrl;
  process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.test";
  process.env.REPL_IDENTITY = "billing-test-identity";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://connectors.test/api/v2/connection")) {
      return new Response(JSON.stringify({ items: [{ settings: { secret: "sk_test_wudoohbilling" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  setStripeSyncWebhookProcessorForTests(() => ({
    async processWebhook(payload, signature) {
      Stripe.webhooks.constructEvent(payload, signature, stripeWebhookSecret);
    },
  }));

  appServer = createServer(app);
  await new Promise((resolve) => appServer.listen(0, "127.0.0.1", resolve));
  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress === "object");
  origin = `http://127.0.0.1:${appAddress.port}`;
});

test.after(async () => {
  setStripeSyncWebhookProcessorForTests(null);
  globalThis.fetch = originalFetch;
  await Promise.all([
    new Promise((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve())),
    new Promise((resolve, reject) => stripeServer.close((error) => error ? reject(error) : resolve())),
  ]);
});

test("يكمل Checkout التجريبي ويعالج حدث Stripe الموقّع مرة واحدة ويفتح Customer Portal للمالك النشط", async () => {
  const ownerEmail = `${unique("billing-owner")}@example.test`;
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: {
      projectName: unique("منشأة اختبار الدفع"),
      name: "مالك اختبار الدفع",
      email: ownerEmail,
      password: "Safe-test-password-123",
    },
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.payload));
  const ownerCookie = cookieFrom(registered.response);
  const organizationId = registered.payload.user?.organizationId;
  assert.equal(typeof organizationId, "number");

  const plans = await request("/api/billing/plans");
  assert.equal(plans.response.status, 200, JSON.stringify(plans.payload));
  assert.deepEqual(plans.payload.plans, [{
    id: "pro",
    name: testProduct.name,
    description: testProduct.description,
    prices: [{
      id: testPriceId,
      amount: 9900,
      currency: "sar",
      interval: "month",
      intervalCount: 1,
    }],
  }]);

  const checkout = await request("/api/billing/checkout", {
    method: "POST",
    cookie: ownerCookie,
    body: { priceId: testPriceId },
  });
  assert.equal(checkout.response.status, 200, JSON.stringify(checkout.payload));
  assert.equal(checkout.payload.url, "https://checkout.stripe.test/c/pay/cs_wudoohbillingtest");
  const checkoutFields = new URLSearchParams(requestedCheckoutBody);
  assert.equal(checkoutFields.get("mode"), "subscription");
  assert.equal(checkoutFields.get("line_items[0][price]"), testPriceId);
  assert.equal(checkoutFields.get("metadata[organizationId]"), String(organizationId));
  assert.equal(checkoutFields.get("metadata[planId]"), "pro");
  assert.equal(checkoutFields.get("subscription_data[metadata][organizationId]"), String(organizationId));

  const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
  const signedEvent = activeSubscriptionEvent(organizationId, eventId);
  globalThis.__wudoohStripeTestEvent = signedEvent;
  const rawPayload = JSON.stringify(signedEvent);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: rawPayload,
    secret: stripeWebhookSecret,
  });

  const firstWebhook = await originalFetch(`${origin}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body: rawPayload,
  });
  assert.equal(firstWebhook.status, 200);
  assert.deepEqual(await firstWebhook.json(), { received: true });

  const repeatedWebhook = await originalFetch(`${origin}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body: rawPayload,
  });
  assert.equal(repeatedWebhook.status, 200);
  assert.deepEqual(await repeatedWebhook.json(), { received: true });

  const session = await request("/api/auth/me", { cookie: ownerCookie });
  assert.equal(session.response.status, 200, JSON.stringify(session.payload));
  assert.equal(session.payload.user.subscription.planId, "pro");
  assert.equal(session.payload.user.subscription.status, "active");
  assert.equal(session.payload.user.subscription.accessActive, true);
  assert.equal(session.payload.user.subscription.subscriptionStartedAt, new Date(testPeriodStart * 1000).toISOString());
  assert.equal(session.payload.user.subscription.subscriptionEndsAt, new Date(testPeriodEnd * 1000).toISOString());

  const eventRows = await db.select({ id: stripeWebhookEventsTable.id })
    .from(stripeWebhookEventsTable)
    .where(eq(stripeWebhookEventsTable.id, eventId));
  assert.equal(eventRows.length, 1, "يجب حفظ معرّف webhook مرة واحدة فقط");
  const subscriptionAuditLogs = await db.select({ id: teamAuditLogsTable.id })
    .from(teamAuditLogsTable)
    .where(and(
      eq(teamAuditLogsTable.organizationId, organizationId),
      eq(teamAuditLogsTable.action, "subscription_activated"),
    ));
  assert.equal(subscriptionAuditLogs.length, 1, "يجب تسجيل تفعيل الاشتراك مرة واحدة فقط");

  const portal = await request("/api/billing/portal", {
    method: "POST",
    cookie: ownerCookie,
  });
  assert.equal(portal.response.status, 200, JSON.stringify(portal.payload));
  assert.equal(portal.payload.url, "https://billing.stripe.test/session/bps_wudoohbillingtest");
  assert.equal(new URLSearchParams(requestedPortalBody).get("customer"), testCustomerId);

  const [organization] = await db.select({
    stripeSubscriptionId: organizationsTable.stripeSubscriptionId,
    subscriptionStatus: organizationsTable.subscriptionStatus,
  }).from(organizationsTable).where(eq(organizationsTable.id, organizationId));
  assert.deepEqual(organization, {
    stripeSubscriptionId: testSubscriptionId,
    subscriptionStatus: "active",
  });
});