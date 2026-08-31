import test from "node:test";
import assert from "node:assert/strict";

import { calculateReport } from "../src/routes/accounting.ts";

const accounts = [
  { id: 1, code: "1000", name: "الصندوق", type: "asset", openingBalance: 0, status: "active" },
  { id: 2, code: "2000", name: "الموردون", type: "liability", openingBalance: 0, status: "active" },
  { id: 3, code: "3000", name: "رأس المال", type: "equity", openingBalance: 0, status: "active" },
  { id: 4, code: "4000", name: "المبيعات", type: "revenue", openingBalance: 0, status: "active" },
  { id: 5, code: "5000", name: "المصروفات", type: "expense", openingBalance: 0, status: "active" },
];

test("keeps prior unclosed earnings in the balance sheet without adding them to period income", () => {
  const priorProfit = 28_610;
  const report = calculateReport(accounts, [
    {
      id: 1,
      date: "2025-12-31",
      status: "posted",
      lines: [
        { accountId: "1", debit: priorProfit, credit: 0 },
        { accountId: "4", debit: 0, credit: priorProfit },
      ],
    },
    {
      id: 2,
      date: "2026-02-01",
      status: "posted",
      lines: [
        { accountId: "1", debit: 1_000, credit: 0 },
        { accountId: "4", debit: 0, credit: 1_000 },
      ],
    },
    {
      id: 3,
      date: "2026-02-02",
      status: "posted",
      lines: [
        { accountId: "5", debit: 250, credit: 0 },
        { accountId: "1", debit: 0, credit: 250 },
      ],
    },
  ], "2026-01-01", "2026-12-31");

  assert.equal(report.totals.netIncome, 750);
  assert.equal(report.balanceSheet.unclosedEarnings, priorProfit + 750);
  assert.equal(report.balanceSheet.totalAssets, report.balanceSheet.totalLiabilitiesAndEquity);
  assert.equal(report.totals.trialDebit, report.totals.trialCredit);
});

test("subtracts a credit balance from its asset group instead of turning it positive", () => {
  const report = calculateReport(accounts, [
    {
      id: 4,
      date: "2026-03-01",
      status: "posted",
      lines: [
        { accountId: "5", debit: 500, credit: 0 },
        { accountId: "1", debit: 0, credit: 500 },
      ],
    },
  ], "2026-01-01", "2026-12-31");

  assert.equal(report.balanceSheet.totalAssets, -500);
  assert.equal(report.balanceSheet.unclosedEarnings, -500);
  assert.equal(report.balanceSheet.totalAssets, report.balanceSheet.totalLiabilitiesAndEquity);
  assert.equal(report.totals.trialDebit, report.totals.trialCredit);
});