import { getUncachableStripeClient } from "./stripe-client";

const plans = [
  { id: "basic", name: "ترصيد الأساسي", description: "للمنشآت الصغيرة التي تبدأ بتنظيم المبيعات والمحاسبة.", monthly: 9_900, yearly: 99_000 },
  { id: "professional", name: "ترصيد الاحترافي", description: "للفرق التي تحتاج إدارة مالية ومخزوناً متكاملاً.", monthly: 19_900, yearly: 199_000 },
  { id: "business", name: "ترصيد للأعمال", description: "للنمو التشغيلي مع تقارير وإدارة فرق أوسع.", monthly: 34_900, yearly: 349_000 },
] as const;

async function ensurePrice(stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>, productId: string, planId: string, amount: number, interval: "month" | "year"): Promise<void> {
  const prices = await stripe.prices.list({ product: productId, active: true, type: "recurring", limit: 100 });
  const exists = prices.data.some((price) => price.unit_amount === amount && price.currency === "sar"
    && price.recurring?.interval === interval && price.metadata.planId === planId);
  if (exists) return;
  await stripe.prices.create({
    product: productId,
    currency: "sar",
    unit_amount: amount,
    recurring: { interval },
    metadata: { planId },
  });
}

async function seed(): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const products = await stripe.products.list({ active: true, limit: 100 });
  for (const plan of plans) {
    const existing = products.data.find((product) => product.metadata.wudoohPlan === "true" && product.metadata.planId === plan.id);
    const product = existing
      ? await stripe.products.update(existing.id, { name: plan.name, description: plan.description })
      : await stripe.products.create({
          name: plan.name,
          description: plan.description,
          metadata: { wudoohPlan: "true", planId: plan.id },
        });
    await ensurePrice(stripe, product.id, plan.id, plan.monthly, "month");
    await ensurePrice(stripe, product.id, plan.id, plan.yearly, "year");
    console.log(`Ready: ${plan.name}`);
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});