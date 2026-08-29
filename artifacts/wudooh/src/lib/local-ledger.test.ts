// @ts-nocheck
import { describe, expect, it } from "vitest";

import type { Account, Journal } from "../context/store";
import { buildLocalLedger } from "./local-ledger";

const account = (
  id: string,
  type: Account["type"],
  openingBalance = 0,
): Account => ({
  id,
  code: `${id}000`,
  name: `حساب ${id}`,
  type,
  parent: null,
  openingBalance,
  balance: openingBalance,
  status: "active",
});

const journal = (
  id: string,
  date: string,
  lines: Journal["lines"],
  status: Journal["status"] = "posted",
): Journal => ({
  id,
  number: `J-${id}`,
  date,
  description: `قيد ${id}`,
  lines,
  status,
});

describe("local ledger", () => {
  it("يحسب الرصيد التراكمي لكل حركة بشكل صحيح", () => {
    const report = buildLocalLedger(
      [account("1", "asset", 100), account("2", "equity")],
      [
        journal("1", "2026-01-05", [
          { id: "1a", accountId: "1", debit: 50, credit: 0 },
          { id: "1b", accountId: "2", debit: 0, credit: 50 },
        ]),
        journal("2", "2026-01-10", [
          { id: "2a", accountId: "1", debit: 0, credit: 20 },
          { id: "2b", accountId: "2", debit: 20, credit: 0 },
        ]),
      ],
      "1",
      "2026-01-01",
      "2026-01-31",
    );

    expect(report?.movements.map((movement) => movement.balance)).toEqual([150, 130]);
    expect(report?.totals.endingBalance).toBe(130);
  });

  it.each(["asset", "expense"] as const)(
    "حسابات %s ترتفع بالمدين",
    (type) => {
      const report = buildLocalLedger(
        [account("1", type), account("2", "equity")],
        [journal("1", "2026-02-01", [
          { id: "1a", accountId: "1", debit: 80, credit: 0 },
          { id: "1b", accountId: "2", debit: 0, credit: 80 },
        ])],
        "1",
        "2026-02-01",
        "2026-02-28",
      );

      expect(report?.account.normalBalance).toBe("debit");
      expect(report?.totals.movement).toBe(80);
      expect(report?.totals.endingBalance).toBe(80);
    },
  );

  it.each(["liability", "revenue"] as const)(
    "حسابات %s ترتفع بالدائن",
    (type) => {
      const report = buildLocalLedger(
        [account("1", type), account("2", "asset")],
        [journal("1", "2026-02-01", [
          { id: "1a", accountId: "2", debit: 120, credit: 0 },
          { id: "1b", accountId: "1", debit: 0, credit: 120 },
        ])],
        "1",
        "2026-02-01",
        "2026-02-28",
      );

      expect(report?.account.normalBalance).toBe("credit");
      expect(report?.totals.movement).toBe(120);
      expect(report?.totals.endingBalance).toBe(120);
    },
  );

  it("يفلتر الحركات حسب from وto مع احتساب الرصيد السابق", () => {
    const report = buildLocalLedger(
      [account("1", "asset", 10), account("2", "equity")],
      [
        journal("before", "2026-01-31", [
          { id: "ba", accountId: "1", debit: 5, credit: 0 },
          { id: "bb", accountId: "2", debit: 0, credit: 5 },
        ]),
        journal("inside", "2026-02-15", [
          { id: "ia", accountId: "1", debit: 20, credit: 0 },
          { id: "ib", accountId: "2", debit: 0, credit: 20 },
        ]),
        journal("after", "2026-03-01", [
          { id: "aa", accountId: "1", debit: 30, credit: 0 },
          { id: "ab", accountId: "2", debit: 0, credit: 30 },
        ]),
        journal("draft", "2026-02-20", [
          { id: "da", accountId: "1", debit: 40, credit: 0 },
          { id: "db", accountId: "2", debit: 0, credit: 40 },
        ], "draft"),
      ],
      "1",
      "2026-02-01",
      "2026-02-28",
    );

    expect(report?.balanceBeforePeriod).toBe(15);
    expect(report?.movements.map((movement) => movement.journalId)).toEqual(["inside"]);
    expect(report?.totals.debit).toBe(20);
    expect(report?.totals.endingBalance).toBe(35);
  });
});