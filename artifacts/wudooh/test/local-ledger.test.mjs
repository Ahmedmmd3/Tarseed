import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalLedger, migrateLegacyLocalOpeningBalances } from '../src/lib/local-ledger.ts';

test('does not count journals twice when local balance already includes posted history', () => {
  const accounts = [
    { id: '1', code: '1100', name: 'البنك', type: 'asset', parent: null, balance: 58000, status: 'active' },
    { id: '2', code: '3000', name: 'رأس المال', type: 'equity', parent: null, balance: 60000, status: 'active' },
    { id: '3', code: '5100', name: 'مصروفات', type: 'expense', parent: null, balance: 2000, status: 'active' },
  ];
  const journals = [
    {
      id: 'j1',
      number: 'J-0001',
      date: '2026-01-01',
      description: 'رأس المال',
      status: 'posted',
      lines: [{ id: 'l1', accountId: '1', debit: 60000, credit: 0 }, { id: 'l2', accountId: '2', debit: 0, credit: 60000 }],
    },
    {
      id: 'j2',
      number: 'J-0002',
      date: '2026-01-20',
      description: 'مصروف',
      status: 'posted',
      lines: [{ id: 'l3', accountId: '3', debit: 2000, credit: 0 }, { id: 'l4', accountId: '1', debit: 0, credit: 2000 }],
    },
  ];

  const migratedAccounts = migrateLegacyLocalOpeningBalances(accounts, journals);
  const report = buildLocalLedger(migratedAccounts, journals, '1', '2026-01-01', '2026-12-31');
  assert.equal(report.openingBalance, 0);
  assert.equal(report.balanceBeforePeriod, 0);
  assert.equal(report.totals.endingBalance, 58000);
});

test('honors an explicit immutable opening balance', () => {
  const report = buildLocalLedger(
    [
      { id: '1', code: '1000', name: 'الصندوق', type: 'asset', parent: null, openingBalance: 100, balance: 999, status: 'active' },
      { id: '2', code: '4000', name: 'الإيراد', type: 'revenue', parent: null, openingBalance: 0, balance: 50, status: 'active' },
    ],
    [{
      id: 'j1',
      number: 'J-0001',
      date: '2026-02-01',
      description: 'تحصيل',
      status: 'posted',
      lines: [{ id: 'l1', accountId: '1', debit: 50, credit: 0 }, { id: 'l2', accountId: '2', debit: 0, credit: 50 }],
    }],
    '1',
    '2026-02-01',
    '2026-02-28',
  );

  assert.equal(report.openingBalance, 100);
  assert.equal(report.totals.endingBalance, 150);
});