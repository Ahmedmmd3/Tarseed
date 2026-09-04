export type DiscountAnalysis = {
  productId: number; productName: string; vatRate: number; currentPriceExVat: number;
  costFloorExVat: number; costSource: "fifo" | "product";
  recommendedDiscountPercent: number; recommendedPriceExVat: number;
  maxNoLossDiscountPercent: number; expectedMarginAmount: number; expectedMarginPercent: number;
  warnings: string[];
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validMoney = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/** Pure, deliberately conservative pricing calculation. All prices are ex-VAT. */
export function calculateDiscountRecommendation(input: {
  productId: number; productName: string; salePriceExVat: unknown; vatRate: unknown;
  fifoLayers?: Array<{ remainingQuantity: unknown; unitCostExVat: unknown }>; fallbackCost?: unknown;
}): DiscountAnalysis | null {
  const price = validMoney(input.salePriceExVat);
  const vatRate = Number(input.vatRate);
  if (price === null || price <= 0 || ![0, 5, 15].includes(vatRate)) return null;
  const rawLayers = input.fifoLayers ?? [];
  const layers = rawLayers.map((layer) => ({
    quantity: validMoney(layer.remainingQuantity), cost: validMoney(layer.unitCostExVat),
  })).filter((layer): layer is { quantity: number; cost: number } => layer.quantity !== null && layer.quantity > 0 && layer.cost !== null);
  // A positive but malformed FIFO layer makes the available cost unreliable;
  // do not hide it by silently falling back to a catalogue value.
  if (rawLayers.some((layer) => {
    const quantity = validMoney(layer.remainingQuantity);
    return quantity !== null && quantity > 0 && validMoney(layer.unitCostExVat) === null;
  })) return null;
  const fifoQuantity = layers.reduce((sum, layer) => sum + layer.quantity, 0);
  const fifoCost = fifoQuantity > 0 ? layers.reduce((sum, layer) => sum + layer.quantity * layer.cost, 0) / fifoQuantity : null;
  const fallbackCost = validMoney(input.fallbackCost);
  // Zero/absent legacy costs are not trustworthy enough to support a discount.
  const cost = fifoCost ?? (fallbackCost !== null && fallbackCost > 0 ? fallbackCost : null);
  if (cost === null) return null;
  const costFloor = money(cost);
  const maxDiscount = money(Math.max(0, ((price - costFloor) / price) * 100));
  // Preserve at least 10% gross margin of the discounted net sale price.
  const safePrice = Math.max(costFloor, costFloor / 0.9, price * 0.9);
  // If today's price is already too low, do not call an increase a "discount".
  const recommendedPrice = money(safePrice);
  const recommendedDiscount = money(safePrice >= price ? 0 : ((price - recommendedPrice) / price) * 100);
  const marginAmount = money(recommendedPrice - costFloor);
  return {
    productId: input.productId, productName: input.productName, vatRate, currentPriceExVat: money(price),
    costFloorExVat: costFloor, costSource: fifoCost !== null ? "fifo" : "product",
    recommendedDiscountPercent: recommendedDiscount, recommendedPriceExVat: recommendedPrice,
    maxNoLossDiscountPercent: maxDiscount, expectedMarginAmount: marginAmount,
    expectedMarginPercent: recommendedPrice ? money((marginAmount / recommendedPrice) * 100) : 0,
    warnings: recommendedDiscount === 0 ? ["لا توجد مساحة خصم آمنة عند السعر والتكلفة الحاليين."] : [],
  };
}