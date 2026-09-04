// @ts-nocheck
import { describe, expect, it } from "vitest";
import { calculateDiscountRecommendation } from "./financial-discount";

const product = (overrides = {}) => ({
  productId: 7, productName: "قهوة", salePriceExVat: 100, vatRate: 15, fallbackCost: 50, ...overrides,
});

describe("calculateDiscountRecommendation", () => {
  it("uses an ex-VAT selling price and preserves its safety margin", () => {
    const result = calculateDiscountRecommendation(product());
    expect(result).toMatchObject({ currentPriceExVat: 100, vatRate: 15, recommendedDiscountPercent: 10, recommendedPriceExVat: 90 });
    expect(result!.expectedMarginAmount).toBe(40);
  });

  it("uses weighted available FIFO cost ahead of stale product cost", () => {
    const result = calculateDiscountRecommendation(product({
      fallbackCost: 10,
      fifoLayers: [{ remainingQuantity: 2, unitCostExVat: 40 }, { remainingQuantity: 3, unitCostExVat: 60 }],
    }));
    expect(result).toMatchObject({ costSource: "fifo", costFloorExVat: 52, recommendedPriceExVat: 90 });
  });

  it("refuses to guess when no reliable cost exists", () => {
    expect(calculateDiscountRecommendation(product({ fallbackCost: 0 }))).toBe(null);
  });

  it("never recommends a price below its cost floor", () => {
    const result = calculateDiscountRecommendation(product({ fallbackCost: 88 }));
    expect(result!.recommendedPriceExVat).toBeGreaterThanOrEqual(result!.costFloorExVat);
    expect(result!.expectedMarginPercent).toBeGreaterThanOrEqual(10);
  });

  it("recommends no discount when the current price is at or below cost", () => {
    const result = calculateDiscountRecommendation(product({ salePriceExVat: 80, fallbackCost: 90 }));
    expect(result).toMatchObject({ recommendedDiscountPercent: 0, recommendedPriceExVat: 100, maxNoLossDiscountPercent: 0 });
  });

  it("rounds monetary and percentage outputs to two decimals", () => {
    const result = calculateDiscountRecommendation(product({ salePriceExVat: 19.99, fallbackCost: 12.345 }));
    expect(result).toMatchObject({ costFloorExVat: 12.35, recommendedPriceExVat: 17.99, recommendedDiscountPercent: 10.01 });
  });
});