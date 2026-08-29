import type { Account, Journal } from '@/context/store';

export type LocalLedgerMovement = {
  journalId: string;
  date: string;
  reference: string;
  description: string;
  counterpart: string;
  debit: number;
  credit: number;
  balance: number;
};

export type LocalLedgerReport = {
  account: {
    id: number;
    code: string;
    name: string;
    type: string;
    normalBalance: 'debit' | 'credit';
  };
  period: { from: string; to: string };
  openingBalance: number;
  balanceBeforePeriod: number;
  movements: LocalLedgerMovement[];
  totals: {
    debit: number;
    credit: number;
    movement: number;
    endingBalance: number;
  };
};

const signedBalance = (account: Account, line: { debit: number; credit: number }): number => (
  account.type === 'asset' || account.type === 'expense'
    ? line.debit - line.credit
    : line.credit - line.debit
);

export function migrateLegacyLocalOpeningBalances(accounts: Account[], journals: Journal[]): Account[] {
  const posted = journals.filter((journal) => journal.status === 'posted');
  return accounts.map((account) => {
    if (Number.isFinite(account.openingBalance)) return account;
    const completePostedMovement = posted.reduce((total, journal) => total + journal.lines
      .filter((line) => line.accountId === account.id)
      .reduce((subtotal, line) => subtotal + signedBalance(account, line), 0), 0);
    return { ...account, openingBalance: account.balance - completePostedMovement };
  });
}

export function buildLocalLedger(
  accounts: Account[],
  journals: Journal[],
  accountId: string,
  from: string,
  to: string,
): LocalLedgerReport | null {
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return null;
  const accountById = new Map(accounts.map((item) => [item.id, item]));
  const allPosted = journals
    .filter((journal) => journal.status === 'posted' && Boolean(journal.date))
    .sort((left, right) => left.date.localeCompare(right.date) || left.number.localeCompare(right.number, 'en'));
  const openingBalance = Number(account.openingBalance ?? account.balance);
  const postedToDate = allPosted.filter((journal) => journal.date <= to);
  const balanceBeforePeriod = openingBalance + postedToDate
    .filter((journal) => journal.date < from)
    .reduce((total, journal) => total + journal.lines
      .filter((line) => line.accountId === accountId)
      .reduce((subtotal, line) => subtotal + signedBalance(account, line), 0), 0);
  let balance = balanceBeforePeriod;
  const movements = postedToDate
    .filter((journal) => journal.date >= from)
    .flatMap((journal) => {
      const counterparts = journal.lines
        .filter((line) => line.accountId !== accountId)
        .map((line) => accountById.get(line.accountId))
        .filter((item): item is Account => Boolean(item))
        .map((item) => `${item.code} — ${item.name}`)
        .filter((label, index, all) => all.indexOf(label) === index)
        .join('، ') || 'قيد مباشر';
      return journal.lines
        .filter((line) => line.accountId === accountId)
        .map((line) => {
          balance += signedBalance(account, line);
          return {
            journalId: journal.id,
            date: journal.date,
            reference: journal.number || `#${journal.id}`,
            description: journal.description || 'بدون بيان',
            counterpart: counterparts,
            debit: line.debit,
            credit: line.credit,
            balance,
          };
        });
    });
  const debit = movements.reduce((total, movement) => total + movement.debit, 0);
  const credit = movements.reduce((total, movement) => total + movement.credit, 0);
  return {
    account: {
      id: Number(account.id),
      code: account.code,
      name: account.name,
      type: account.type,
      normalBalance: account.type === 'asset' || account.type === 'expense' ? 'debit' : 'credit',
    },
    period: { from, to },
    openingBalance,
    balanceBeforePeriod,
    movements,
    totals: {
      debit,
      credit,
      movement: account.type === 'asset' || account.type === 'expense' ? debit - credit : credit - debit,
      endingBalance: balance,
    },
  };
}