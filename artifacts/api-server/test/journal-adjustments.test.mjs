import assert from 'node:assert/strict';
import test from 'node:test';
import { auditDetails, JournalAdjustmentError, prepareJournalAdjustment } from '../src/lib/journal-adjustments.ts';

const original = {
  id: 41,
  number: 'J-0041',
  date: '2026-08-01',
  description: 'قيد بيع',
  status: 'posted',
  warehouseId: 7,
  lines: [
    { id: '1', accountId: '1000', debit: 500, credit: 0 },
    { id: '2', accountId: '4000', debit: 0, credit: 500 },
  ],
};

test('prepares an immutable linked reversal with copied location scope', () => {
  const prepared = prepareJournalAdjustment(original, 'reverse', {
    date: '2026-08-10',
    reason: 'تسجيل العملية مرتين',
  });

  assert.equal(prepared.reversal.adjustsJournalId, 41);
  assert.equal(prepared.reversal.adjustmentType, 'reversal');
  assert.equal(prepared.reversal.warehouseId, 7);
  assert.deepEqual(prepared.reversal.lines, [
    { id: 'reversal-1', accountId: '1000', debit: 0, credit: 500 },
    { id: 'reversal-2', accountId: '4000', debit: 500, credit: 0 },
  ]);
  assert.equal(prepared.correction, undefined);
  assert.equal(original.lines[0].debit, 500);
});

test('prepares a reversal and corrected posted journal together', () => {
  const prepared = prepareJournalAdjustment(original, 'correct', {
    date: '2026-08-10',
    reason: 'المبلغ الصحيح 450',
    description: 'قيد بيع مصحح',
    lines: [
      { accountId: '1000', debit: 450, credit: 0 },
      { accountId: '4000', debit: 0, credit: 450 },
    ],
  });

  assert.equal(prepared.correction.adjustmentType, 'correction');
  assert.equal(prepared.correction.adjustsJournalId, 41);
  assert.equal(prepared.correction.status, 'posted');
  assert.equal(prepared.correction.lines[0].debit, 450);
});

test('rejects a second adjustment and invalid corrected entries', () => {
  assert.throws(
    () => prepareJournalAdjustment({ ...original, adjustmentStatus: 'reversed' }, 'reverse', { date: '2026-08-10', reason: 'مرة أخرى' }),
    (error) => error instanceof JournalAdjustmentError && error.status === 409,
  );
  assert.throws(
    () => prepareJournalAdjustment(original, 'correct', {
      date: '2026-08-10',
      reason: 'تصحيح المبلغ',
      description: 'غير متزن',
      lines: [
        { accountId: '1000', debit: 450, credit: 0 },
        { accountId: '4000', debit: 0, credit: 400 },
      ],
    }),
    (error) => error instanceof JournalAdjustmentError && error.status === 400,
  );
});

test('rejects direct adjustment of source-generated journals', () => {
  assert.throws(
    () => prepareJournalAdjustment({ ...original, sourceType: 'sale', sourceId: 88 }, 'reverse', {
      date: '2026-08-10',
      reason: 'تصحيح فاتورة',
    }),
    (error) => error instanceof JournalAdjustmentError && error.status === 409 && error.message.includes('المستند'),
  );
});

test('keeps before and after snapshots in the audit payload', () => {
  const prepared = prepareJournalAdjustment(original, 'reverse', {
    date: '2026-08-10',
    reason: 'تسجيل مكرر',
  });
  const details = JSON.parse(auditDetails(original, prepared, [99]));

  assert.equal(details.original.id, 41);
  assert.equal(details.original.lines[0].debit, 500);
  assert.equal(details.original.status, 'posted');
  assert.equal(details.original.warehouseId, 7);
  assert.equal(details.created[0].id, 99);
  assert.equal(details.created[0].lines[0].credit, 500);
  assert.equal(details.reason, 'تسجيل مكرر');
  assert.equal(details.relationship.originalRemainsUnchanged, true);
  assert.deepEqual(details.relationship.createdJournalIds, [99]);
});