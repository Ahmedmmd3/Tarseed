import { Router, type IRouter, type Request, type Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import { getUncachableStripeClient } from "../lib/stripe-client";
import { requireAuth, requireOwner, subscriptionState, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();

type PublicPrice = {
  id: string;
  amount: number | null;
  currency: string;
  interval: string | null;
  intervalCount: number | null;
};

type PublicPlan = {
  id: string;
  name: string;
  description: string | null;
  prices: PublicPrice[];
};

function publicPlanId(product: { metadata?: Stripe.Metadata }): string | null {
  const planId = product.metadata?.planId?.trim();
  return planId || null;
}

function isActiveProduct(product: string | Stripe.Product | Stripe.DeletedProduct): product is Stripe.Product {
  return typeof product !== "string" && !("deleted" in product && product.deleted === true);
}

router.get("/billing/plans", async (_request: Request, response: Response): Promise<void> => {
  try {
    const stripe = await getUncachableStripeClient();
    const prices = await stripe.prices.list({
      active: true,
      type: "recurring",
      limit: 100,
      expand: ["data.product"],
    });
    const plans = new Map<string, PublicPlan>();
    for (const price of prices.data) {
      const product = price.product;
      if (!isActiveProduct(product) || !product.active || product.metadata?.wudoohPlan !== "true") continue;
      const planId = publicPlanId(product);
      if (!planId) continue;
      const plan: PublicPlan = plans.get(planId) ?? {
        id: planId,
        name: product.name,
        description: product.description,
        prices: [],
      };
      plan.prices.push({
        id: price.id,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval ?? null,
        intervalCount: price.recurring?.interval_count ?? null,
      });
      plans.set(planId, plan);
    }
    response.json({ plans: [...plans.values()] });
  } catch (error) {
    response.status(503).json({ error: "تعذر تحميل الباقات من مزود الدفع حالياً." });
  }
});

router.post("/billing/checkout", requireAuth, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const priceId = typeof request.body?.priceId === "string" ? request.body.priceId.trim() : "";
  if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
    response.status(400).json({ error: "اختر باقة صحيحة." });
    return;
  }
  if (subscriptionState(auth) === "active") {
    response.status(409).json({ error: "اشتراكك نشط بالفعل. استخدم إدارة الاشتراك لتغيير الباقة أو وسيلة الدفع." });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    const product = price.product;
    if (!price.active || price.type !== "recurring" || !isActiveProduct(product) || !product.active || product.metadata?.wudoohPlan !== "true" || !publicPlanId(product)) {
      response.status(400).json({ error: "الباقة المختارة غير متاحة." });
      return;
    }

    const [organization] = await db.select({
      stripeCustomerId: organizationsTable.stripeCustomerId,
    }).from(organizationsTable).where(eq(organizationsTable.id, auth.organizationId)).limit(1);
    const baseUrl = `${request.protocol}://${request.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(organization?.stripeCustomerId
        ? { customer: organization.stripeCustomerId }
        : { customer_email: auth.email }),
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${baseUrl}/manager?billing=success`,
      cancel_url: `${baseUrl}/manager?billing=cancelled`,
      metadata: {
        organizationId: String(auth.organizationId),
        planId: publicPlanId(product),
      },
      subscription_data: {
        metadata: {
          organizationId: String(auth.organizationId),
          planId: publicPlanId(product),
        },
      },
    });
    response.json({ url: session.url });
  } catch {
    response.status(503).json({ error: "تعذر بدء عملية الدفع حالياً. حاول مرة أخرى." });
  }
});

router.post("/billing/portal", requireAuth, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const [organization] = await db.select({
    stripeCustomerId: organizationsTable.stripeCustomerId,
  }).from(organizationsTable).where(eq(organizationsTable.id, auth.organizationId)).limit(1);
  if (!organization?.stripeCustomerId) {
    response.status(409).json({ error: "لا توجد بيانات دفع مرتبطة بهذه المنشأة بعد." });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const baseUrl = `${request.protocol}://${request.get("host")}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: `${baseUrl}/manager`,
    });
    response.json({ url: session.url });
  } catch {
    response.status(503).json({ error: "تعذر فتح إدارة الاشتراك حالياً." });
  }
});

export default router;