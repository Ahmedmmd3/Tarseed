import test from "node:test";
import assert from "node:assert/strict";
import { buildLedgerReport } from "../src/lib/accounting-ledger.ts";

const accounts = [
  { id: 1, code: "1000", name: "الصندوق", type: "asset", openingBalance: 100, balance: 999, status: "active" },
  { id: 2, code: "5000", name: "مصروف أدوات", type: "expense", openingBalance: 0, balance: 0, status: "active" },
  { id: 3, code: "4000", name: "المبيعات", type: "revenue", openingBalance: 0, balance: 0, status: "active" },
];

test("builds a debit-normal ledger with prior balance and sorted posted movements", () => {
  const report = buildLedgerReport(accounts, [
    {
      id: 10,
      number: "J-0010",
      date: "2026-01-20",
      description: "رصيد سابق",
      status: "posted",
      lines: [{ accountId: "1", debit: 50, credit: 0 }, { accountId: "3", debit: 0, credit: 50 }],
    },
    {
      id: 12,
      number: "J-0012",
      date: "2026-02-02",
      description: "شراء أدوات",
      status: "posted",
      lines: [{ accountId: "2", debit: 25, credit: 0 }, { accountId: "1", debit: 0, credit: 25 }],
    },
    {
      id: 11,
      number: "J-0011",
      date: "2026-02-01",
      description: "تحصيل",
      status: "posted",
      lines: [{ accountId: "1", debit: 10, credit: 0 }, { accountId: "3", debit: 0, credit: 10 }],
    },
    {
      id: 13,
      number: "J-0013",
      date: "2026-02-03",
      description: "مسودة لا تظهر",
      status: "draft",
      lines: [{ accountId: "1", debit: 500, credit: 0 }, { accountId: "3", debit: 0, credit: 500 }],
    },
  ], "1", "2026-02-01", "2026-02-28");

  assert.equal(report.account.normalBalance, "debit");
  assert.equal(report.openingBalance, 100);
  assert.equal(report.balanceBeforePeriod, 150);
  assert.deepEqual(report.movements.map((movement) => movement.reference), ["J-0011", "J-0012"]);
  assert.deepEqual(report.movements.map((movement) => movement.balance), [160, 135]);
  assert.equal(report.totals.debit, 10);
  assert.equal(report.totals.credit, 25);
  assert.equal(report.totals.endingBalance, 135);
  assert.equal(report.movements[0].counterpart, "4000 — المبيعات");
});

test("uses credit-normal signs and excludes movements outside the selected period", () => {
  const report = buildLedgerReport(accounts, [
    {
      id: 20,
      number: "J-0020",
      date: "2026-01-31",
      description: "قبل الفترة",
      status: "posted",
      lines: [{ accountId: "3", debit: 0, credit: 200 }, { accountId: "1", debit: 200, credit: 0 }],
    },
    {
      id: 21,
      number: "J-0021",
      date: "2026-02-04",
      description: "إيراد الفترة",
      status: "posted",
      lines: [{ accountId: "3", debit: 0, credit: 80 }, { accountId: "1", debit: 80, credit: 0 }],
    },
    {
      id: 22,
      number: "J-0022",
      date: "2026-02-05",
      description: "رد إيراد",
      status: "posted",
      lines: [{ accountId: "3", debit: 20, credit: 0 }, { accountId: "1", debit: 0, credit: 20 }],
    },
  ], "3", "2026-02-01", "2026-02-28");

  assert.equal(report.account.normalBalance, "credit");
  assert.equal(report.balanceBeforePeriod, 200);
  assert.deepEqual(report.movements.map((movement) => movement.reference), ["J-0021", "J-0022"]);
  assert.deepEqual(report.movements.map((movement) => movement.balance), [280, 260]);
  assert.equal(report.totals.movement, 60);
  assert.equal(report.totals.endingBalance, 260);
});

test("keeps the stored balance as the opening balance for legacy accounts", () => {
  const report = buildLedgerReport(
    [{ id: 9, code: "1900", name: "رصيد قديم", type: "asset", balance: 725, status: "active" }],
    [],
    "9",
    "2026-01-01",
    "2026-12-31",
  );

  assert.equal(report.openingBalance, 725);
  assert.equal(report.balanceBeforePeriod, 725);
  assert.equal(report.totals.endingBalance, 725);
});