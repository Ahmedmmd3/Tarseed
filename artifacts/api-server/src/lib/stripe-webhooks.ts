import Stripe from "stripe";
import { eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  stripeWebhookEventsTable,
  teamAuditLogsTable,
} from "@workspace/db";
import { getStripeSync, getUncachableStripeClient, retrieveStripeEvent } from "./stripe-client";
import { logger } from "./logger";

type SubscriptionUpdate = {
  organizationId: number;
  customerId: string | null;
  subscriptionId: string;
  planId: string;
  status: "active" | "inactive";
  startedAt: Date | null;
  endsAt: Date | null;
  action: "subscription_activated" | "subscription_plan_changed" | "subscription_renewed" | "subscription_deactivated";
  details: string;
};

function unixDate(value: number | null | undefined): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

function subscriptionStatus(status: Stripe.Subscription.Status): "active" | "inactive" {
  return status === "active" || status === "trialing" ? "active" : "inactive";
}

function subscriptionFromEvent(event: Stripe.Event): Stripe.Subscription | null {
  const object = event.data.object;
  if (!object || typeof object !== "object") return null;
  if (object.object !== "subscription") return null;
  return object as Stripe.Subscription;
}

async function resolveSubscription(event: Stripe.Event): Promise<Stripe.Subscription | null> {
  const embedded = subscriptionFromEvent(event);
  if (embedded) return embedded;

  const object = event.data.object as unknown as {
    subscription?: string | { id: string };
    parent?: { subscription_details?: { subscription?: string | { id: string } } };
  };
  const rawSubscription = object.subscription ?? object.parent?.subscription_details?.subscription;
  const subscriptionId = typeof rawSubscription === "string"
    ? rawSubscription
    : rawSubscription?.id ?? null;
  if (!subscriptionId) return null;

  const stripe = await getUncachableStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId);
}

function eventCustomerId(event: Stripe.Event, subscription: Stripe.Subscription | null): string | null {
  if (subscription?.customer) {
    return typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  }
  const object = event.data.object as Stripe.Checkout.Session | Stripe.Invoice;
  if (object?.customer) return typeof object.customer === "string" ? object.customer : object.customer.id;
  return null;
}

function eventOrganizationId(event: Stripe.Event, subscription: Stripe.Subscription | null): number | null {
  const object = event.data.object as Stripe.Checkout.Session | Stripe.Invoice;
  const raw = subscription?.metadata?.organizationId
    ?? object?.metadata?.organizationId
    ?? null;
  const organizationId = Number(raw);
  return Number.isSafeInteger(organizationId) && organizationId > 0 ? organizationId : null;
}

function subscriptionPlanId(subscription: Stripe.Subscription): string {
  const metadataPlan = subscription.metadata?.planId?.trim();
  if (metadataPlan) return metadataPlan;
  const price = subscription.items.data[0]?.price;
  const priceMetadata = typeof price === "object" ? price.metadata?.planId : undefined;
  return priceMetadata?.trim() || "standard";
}

export function isExpiredStripeSignatureError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; type?: unknown; message?: unknown };
  const isSignatureVerificationError =
    candidate.name === "StripeSignatureVerificationError"
    || candidate.type === "StripeSignatureVerificationError";
  return isSignatureVerificationError && candidate.message === "Timestamp outside the tolerance zone";
}

async function updateFromEvent(event: Stripe.Event): Promise<SubscriptionUpdate | null> {
  const subscription = await resolveSubscription(event);
  const organizationId = eventOrganizationId(event, subscription);
  if (!subscription || !organizationId) return null;

  const customerId = eventCustomerId(event, subscription);
  const end = unixDate(subscription.items.data[0]?.current_period_end);
  const started = unixDate(subscription.start_date);
  const inactive = event.type === "customer.subscription.deleted"
    || subscriptionStatus(subscription.status) === "inactive";
  const active = !inactive;

  let action: SubscriptionUpdate["action"];
  if (event.type === "invoice.paid") {
    action = "subscription_renewed";
  } else if (inactive) {
    action = "subscription_deactivated";
  } else {
    action = "subscription_activated";
  }

  return {
    organizationId,
    customerId,
    subscriptionId: subscription.id,
    planId: subscriptionPlanId(subscription),
    status: active ? "active" : "inactive",
    startedAt: started,
    endsAt: end,
    action,
    details: `Stripe event ${event.id} · الباقة: ${subscriptionPlanId(subscription)} · الاشتراك: ${subscription.id}`,
  };
}

export async function processStripeWebhook(payload: Buffer, signature: string): Promise<void> {
  const stripeSync = await getStripeSync();
  await stripeSync.processWebhook(payload, signature);
  const event = await retrieveStripeEvent(payload);
  await processStripeEvent(event);
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  const supported = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
  ]);
  if (!supported.has(event.type)) return;

  const update = await updateFromEvent(event);
  if (!update) {
    logger.warn({ eventId: event.id, eventType: event.type }, "Stripe event did not identify an organization");
    return;
  }

  await db.transaction(async (tx) => {
    const inserted = await tx.insert(stripeWebhookEventsTable).values({
      id: event.id,
      eventType: event.type,
      organizationId: update.organizationId,
    }).onConflictDoNothing().returning({ id: stripeWebhookEventsTable.id });
    if (!inserted.length) return;

    const [organization] = await tx.select({
      planId: organizationsTable.planId,
      subscriptionStatus: organizationsTable.subscriptionStatus,
    }).from(organizationsTable)
      .where(eq(organizationsTable.id, update.organizationId))
      .for("update");
    if (!organization) return;

    const wasActive = organization.subscriptionStatus === "active";
    const action = update.action === "subscription_activated" && wasActive && organization.planId !== update.planId
      ? "subscription_plan_changed"
      : update.action;
    await tx.update(organizationsTable).set({
      planId: update.planId,
      subscriptionStatus: update.status,
      subscriptionStartedAt: update.startedAt,
      subscriptionEndsAt: update.endsAt,
      ...(update.customerId ? { stripeCustomerId: update.customerId } : {}),
      stripeSubscriptionId: update.subscriptionId,
    }).where(eq(organizationsTable.id, update.organizationId));
    await tx.insert(teamAuditLogsTable).values({
      organizationId: update.organizationId,
      actorId: null,
      actorName: "Stripe",
      action,
      entity: update.subscriptionId,
      details: update.details,
    });
  });
}