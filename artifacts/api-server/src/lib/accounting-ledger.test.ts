// @ts-nocheck
import { describe, expect, it } from "vitest";

import { buildLedgerReport } from "./accounting-ledger";
import { generateInvoiceDocument, type InvoiceInput } from "./e-invoicing";
import {
  JournalAdjustmentError,
  prepareJournalAdjustment,
} from "./journal-adjustments";

const accounts = [
  { id: 1, code: "1000", name: "الصندوق", type: "asset", openingBalance: 0, status: "active" },
  { id: 2, code: "4000", name: "المبيعات", type: "revenue", openingBalance: 0, status: "active" },
  { id: 3, code: "5100", name: "المصروفات", type: "expense", openingBalance: 0, status: "active" },
  { id: 4, code: "3000", name: "رأس المال", type: "equity", openingBalance: 0, status: "active" },
];

function periodTotals(from: string, to: string) {
  const journals = [
    {
      id: 1,
      number: "J-0001",
      date: "2026-01-10",
      description: "مبيعات نقدية",
      status: "posted",
      lines: [
        { accountId: "1", debit: 1_000, credit: 0 },
        { accountId: "2", debit: 0, credit: 1_000 },
      ],
    },
    {
      id: 2,
      number: "J-0002",
      date: "2026-01-15",
      description: "مصروف تشغيل",
      status: "posted",
      lines: [
        { accountId: "3", debit: 250, credit: 0 },
        { accountId: "1", debit: 0, credit: 250 },
      ],
    },
    {
      id: 3,
      number: "J-0003",
      date: "2025-12-31",
      description: "خارج الفترة",
      status: "posted",
      lines: [
        { accountId: "1", debit: 500, credit: 0 },
        { accountId: "2", debit: 0, credit: 500 },
      ],
    },
  ];
  const revenue = buildLedgerReport(accounts, journals, "2", from, to);
  const expenses = buildLedgerReport(accounts, journals, "3", from, to);
  const revenueTotal = revenue?.totals.movement ?? 0;
  const expenseTotal = expenses?.totals.movement ?? 0;
  return {
    revenue: revenueTotal,
    expenses: expenseTotal,
    netProfit: revenueTotal - expenseTotal,
  };
}

function invoiceInput(vatRate: number): InvoiceInput {
  return {
    invoiceNumber: `VAT-${vatRate}`,
    invoiceCounter: 1,
    previousInvoiceHash: "previous-invoice-hash",
    documentType: "simplified",
    issueAt: new Date("2026-01-20T12:00:00.000Z"),
    customerName: "عميل نقدي",
    paymentMethod: "cash",
    lines: [{
      name: "خدمة اختبار",
      sku: "TEST",
      quantity: 1,
      unitPrice: 100,
      total: 100,
      vatRate,
    }],
    seller: {
      sellerName: "منشأة الاختبار",
      vatNumber: "310123456700003",
      commercialRegistrationNumber: "1010101010",
      street: "طريق الاختبار",
      buildingNumber: "1234",
      city: "الرياض",
      postalCode: "12345",
      countryCode: "SA",
      vatRate,
      pricesIncludeVat: false,
    },
  };
}

describe("accounting ledger core logic", () => {
  it("calculatePeriodTotals يحسب الإيرادات والمصاريف وصافي الربح", () => {
    expect(periodTotals("2026-01-01", "2026-01-31")).toEqual({
      revenue: 1_000,
      expenses: 250,
      netProfit: 750,
    });
  });

  it("يرفض قيداً مدينه لا يساوي دائنه", () => {
    const original = {
      id: 10,
      number: "J-0010",
      date: "2026-01-01",
      description: "قيد أصلي",
      status: "posted",
      lines: [
        { accountId: "1", debit: 100, credit: 0 },
        { accountId: "4", debit: 0, credit: 100 },
      ],
    };

    expect(() => prepareJournalAdjustment(original, "correct", {
      date: "2026-01-21",
      reason: "تصحيح اختبار",
      description: "قيد غير متوازن",
      lines: [
        { accountId: "1", debit: 100, credit: 0 },
        { accountId: "4", debit: 0, credit: 90 },
      ],
    })).toThrowError(JournalAdjustmentError);

    try {
      prepareJournalAdjustment(original, "correct", {
        date: "2026-01-21",
        reason: "تصحيح اختبار",
        description: "قيد غير متوازن",
        lines: [
          { accountId: "1", debit: 100, credit: 0 },
          { accountId: "4", debit: 0, credit: 90 },
        ],
      });
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "إجمالي المدين يجب أن يساوي إجمالي الدائن.",
      });
    }
  });

  it.each([
    { rate: 0, expectedTax: 0, expectedGross: 100 },
    { rate: 15, expectedTax: 15, expectedGross: 115 },
    { rate: 5, expectedTax: 5, expectedGross: 105 },
  ])("يحسب ضريبة القيمة المضافة بنسبة $rate%", async ({ rate, expectedTax, expectedGross }) => {
    const invoice = await generateInvoiceDocument(invoiceInput(rate));

    expect(invoice.taxExclusiveAmount).toBe(100);
    expect(invoice.taxAmount).toBe(expectedTax);
    expect(invoice.taxInclusiveAmount).toBe(expectedGross);
  });

  it("يضيف قيد الرصيد الافتتاحي إلى الأستاذ بشكل صحيح", () => {
    const report = buildLedgerReport(accounts, [{
      id: 20,
      number: "OPEN-0001",
      date: "2026-01-01",
      description: "رصيد افتتاحي — الصندوق",
      status: "posted",
      sourceType: "opening_balance",
      sourceId: "1",
      lines: [
        { accountId: "1", debit: 2_500, credit: 0 },
        { accountId: "4", debit: 0, credit: 2_500 },
      ],
    }], "1", "2026-01-01", "2026-01-31");

    expect(report).not.toBeNull();
    expect(report?.openingBalance).toBe(0);
    expect(report?.movements).toHaveLength(1);
    expect(report?.movements[0].balance).toBe(2_500);
    expect(report?.totals.endingBalance).toBe(2_500);
  });
});