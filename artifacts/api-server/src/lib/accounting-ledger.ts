export type LedgerAccountRecord = {
  id: number;
  code?: unknown;
  name?: unknown;
  type?: unknown;
  status?: unknown;
  openingBalance?: unknown;
  balance?: unknown;
};

export type LedgerLineRecord = {
  accountId?: unknown;
  debit?: unknown;
  credit?: unknown;
};

export type LedgerJournalRecord = {
  id: number;
  number?: unknown;
  reference?: unknown;
  date?: unknown;
  description?: unknown;
  status?: unknown;
  lines?: unknown;
};

export type LedgerReport = {
  account: {
    id: number;
    code: string;
    name: string;
    type: string;
    normalBalance: "debit" | "credit";
  };
  period: { from: string; to: string };
  openingBalance: number;
  balanceBeforePeriod: number;
  movements: Array<{
    journalId: number;
    date: string;
    reference: string;
    description: string;
    counterpart: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  totals: {
    debit: number;
    credit: number;
    movement: number;
    endingBalance: number;
  };
};

const numberValue = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

const dateValue = (value: unknown): string => (
  typeof value === "string" ? value.slice(0, 10) : ""
);

const textValue = (value: unknown, fallback: string): string => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
};

const normalBalanceFor = (type: unknown): "debit" | "credit" => (
  type === "asset" || type === "expense" ? "debit" : "credit"
);

const lineRecords = (value: unknown): LedgerLineRecord[] => (
  Array.isArray(value)
    ? value.filter((line): line is LedgerLineRecord => Boolean(line) && typeof line === "object")
    : []
);

export function buildLedgerReport(
  accounts: LedgerAccountRecord[],
  journals: LedgerJournalRecord[],
  accountId: string,
  from: string,
  to: string,
): LedgerReport | null {
  const account = accounts.find((candidate) => String(candidate.id) === accountId);
  if (!account) return null;

  const normalBalance = normalBalanceFor(account.type);
  const signedAmount = (line: LedgerLineRecord): number => {
    const debit = numberValue(line.debit);
    const credit = numberValue(line.credit);
    return normalBalance === "debit" ? debit - credit : credit - debit;
  };
  const accountMap = new Map(accounts.map((candidate) => [String(candidate.id), candidate]));
  const posted = journals
    .filter((journal) => journal.status === "posted")
    .map((journal) => ({ journal, date: dateValue(journal.date) }))
    .filter(({ date }) => Boolean(date) && date <= to);

  const openingBalance = numberValue(account.openingBalance ?? account.balance);
  const balanceBeforePeriod = openingBalance + posted
    .filter(({ date }) => date < from)
    .reduce((total, { journal }) => total + lineRecords(journal.lines)
      .filter((line) => String(line.accountId ?? "") === accountId)
      .reduce((subtotal, line) => subtotal + signedAmount(line), 0), 0);

  const inPeriod = posted
    .filter(({ date }) => date >= from && date <= to)
    .sort((left, right) => (
      left.date.localeCompare(right.date)
      || textValue(left.journal.number ?? left.journal.reference, `#${left.journal.id}`)
        .localeCompare(textValue(right.journal.number ?? right.journal.reference, `#${right.journal.id}`), "en")
      || left.journal.id - right.journal.id
    ));

  let balance = balanceBeforePeriod;
  const movements = inPeriod.flatMap(({ journal, date }) => {
    const lines = lineRecords(journal.lines);
    const counterparts = lines
      .filter((line) => String(line.accountId ?? "") !== accountId)
      .map((line) => accountMap.get(String(line.accountId ?? "")))
      .filter((candidate): candidate is LedgerAccountRecord => Boolean(candidate))
      .map((candidate) => `${textValue(candidate.code, "")} — ${textValue(candidate.name, "حساب غير معروف")}`.replace(/^ — /, ""))
      .filter((label, index, all) => all.indexOf(label) === index);
    const counterpart = counterparts.join("، ") || "قيد مباشر";

    return lines
      .filter((line) => String(line.accountId ?? "") === accountId)
      .map((line) => {
        const debit = numberValue(line.debit);
        const credit = numberValue(line.credit);
        balance += signedAmount(line);
        return {
          journalId: journal.id,
          date,
          reference: textValue(journal.number ?? journal.reference, `#${journal.id}`),
          description: textValue(journal.description, "بدون بيان"),
          counterpart,
          debit,
          credit,
          balance,
        };
      });
  });

  const debit = movements.reduce((total, movement) => total + movement.debit, 0);
  const credit = movements.reduce((total, movement) => total + movement.credit, 0);
  return {
    account: {
      id: account.id,
      code: textValue(account.code, ""),
      name: textValue(account.name, "حساب غير معروف"),
      type: textValue(account.type, ""),
      normalBalance,
    },
    period: { from, to },
    openingBalance,
    balanceBeforePeriod,
    movements,
    totals: {
      debit,
      credit,
      movement: normalBalance === "debit" ? debit - credit : credit - debit,
      endingBalance: balance,
    },
  };
}