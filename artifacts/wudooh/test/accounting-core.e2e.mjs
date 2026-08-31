import { expect, test } from '@playwright/test';

const accounts = [
  { id: '1', code: '1000', name: 'الصندوق', type: 'asset', parent: null, balance: 5000, status: 'active' },
  { id: '2', code: '1100', name: 'البنك', type: 'asset', parent: null, balance: 58000, status: 'active' },
  { id: '3', code: '1200', name: 'العملاء', type: 'asset', parent: null, balance: 12000, status: 'active' },
  { id: '4', code: '2000', name: 'الموردين', type: 'liability', parent: null, balance: 4000, status: 'active' },
  { id: '5', code: '3000', name: 'رأس المال', type: 'equity', parent: null, balance: 60000, status: 'active' },
  { id: '6', code: '4000', name: 'المبيعات', type: 'revenue', parent: null, balance: 17000, status: 'active' },
  { id: '7', code: '5000', name: 'المشتريات', type: 'expense', parent: null, balance: 4000, status: 'active' },
  { id: '8', code: '5100', name: 'مصروفات الرواتب', type: 'expense', parent: null, balance: 2000, status: 'active' },
];

function seededJournals() {
  const year = new Date().getFullYear();
  return [
    ['1', 'J-0001', `${year}-01-01`, 'رأس المال المبدئي', '2', '5', 60000],
    ['2', 'J-0002', `${year}-01-05`, 'مبيعات نقدية', '1', '6', 5000],
    ['3', 'J-0003', `${year}-01-10`, 'فاتورة بيع آجل للعميل شركة الأمل', '3', '6', 12000],
    ['4', 'J-0004', `${year}-01-12`, 'شراء بضاعة آجل من مورد الجملة', '7', '4', 4000],
    ['5', 'J-0005', `${year}-01-20`, 'إثبات مصروف الرواتب', '8', '2', 2000],
  ].map(([id, number, date, description, debitAccountId, creditAccountId, amount]) => ({
    id,
    number,
    date,
    description,
    status: 'posted',
    lines: [
      { id: `${id}-debit`, accountId: debitAccountId, debit: amount, credit: 0 },
      { id: `${id}-credit`, accountId: creditAccountId, debit: 0, credit: amount },
    ],
  }));
}

async function mockSharedAccounting(page, journals = seededJournals()) {
  const capturedJournalPosts = [];
  await page.context().addCookies([{
    name: 'wudooh_remote_session',
    value: '1',
    url: 'http://127.0.0.1:25936',
  }]);
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'accounting-test-owner',
          organizationId: 'accounting-test-organization',
          dataGeneration: 1,
          projectName: 'منشأة اختبارات المحاسبة',
          name: 'مالك اختبار المحاسبة',
          email: 'accounting-core@example.test',
          phone: '0500000000',
          roleId: 'owner',
          permissions: { dashboard: true, accounting: true, reports: true },
          locationScope: 'all',
          warehouseIds: [],
          status: 'active',
          isTeamMember: false,
          subscription: { accessActive: true, status: 'trialing' },
        },
      }),
    });
  });
  await page.route('**/api/accounting/initialize', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created: 0, accounts }) });
  });
  await page.route('**/api/data/accounts', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: accounts }) });
  });
  await page.route('**/api/data/journalEntries', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      capturedJournalPosts.push(body);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          record: { ...body, id: 'created-journal', number: `J-${String(journals.length + 1).padStart(4, '0')}` },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: journals }) });
  });
  await page.route('**/api/data/receivables', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) });
  });
  await page.route('**/api/data/financialClosures', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) });
  });
  await page.route('**/api/accounting/summary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totals: { revenue: 17000, expense: 6000, netIncome: 11000, receivables: 12000, payables: 0 },
        trialBalance: accounts.map((account) => ({
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          debit: account.type === 'asset' || account.type === 'expense' ? account.balance : 0,
          credit: account.type === 'liability' || account.type === 'equity' || account.type === 'revenue' ? account.balance : 0,
        })),
        incomeStatement: {
          revenue: [{ id: '6', name: 'المبيعات', amount: 17000 }],
          expense: [
            { id: '7', name: 'المشتريات', amount: 4000 },
            { id: '8', name: 'مصروفات الرواتب', amount: 2000 },
          ],
          netIncome: 11000,
        },
        balanceSheet: {
          baseEquity: 60000,
          unclosedEarnings: 11000,
          totalAssets: 75000,
          totalLiabilitiesAndEquity: 75000,
        },
        receivables: [{
          id: 'credit-invoice',
          party: 'شركة الأمل',
          type: 'receivable',
          reference: 'POS-CREDIT-1',
          dueDate: '2030-01-15',
          amount: 12000,
          paid: 0,
          remaining: 12000,
          status: 'unpaid',
        }],
      }),
    });
  });
  return capturedJournalPosts;
}

async function fillJournal(page, { description, debit, credit }) {
  await page.getByTestId('button-add-journal').click();
  await page.getByTestId('input-journal-desc').fill(description);
  await page.getByTestId('select-journal-account-0').selectOption({ index: 1 });
  await page.getByTestId('input-journal-debit-0').fill(String(debit));
  await page.getByTestId('select-journal-account-1').selectOption({ index: 2 });
  await page.getByTestId('input-journal-credit-1').fill(String(credit));
}

test('يرفض حفظ قيد غير متزن 100 مدين مقابل 90 دائن', async ({ page }) => {
  const capturedJournalPosts = await mockSharedAccounting(page);
  await page.goto('/journals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();
  const description = `قيد غير متزن ${crypto.randomUUID().slice(0, 8)}`;

  await fillJournal(page, { description, debit: 100, credit: 90 });

  await expect(page.getByRole('alert')).toContainText('القيد غير متزن');
  await expect(page.getByRole('alert')).toContainText('١٠٫٠٠');
  await expect(page.getByTestId('button-submit-journal')).toBeDisabled();
  await expect(page.getByTestId('card-journal-1')).toBeVisible();
  await expect(page.locator('[data-testid^="card-journal-"]').filter({ hasText: description })).toHaveCount(0);
  expect(capturedJournalPosts).toHaveLength(0);
});

test('يرسل القيد المتزن 100/100 إلى journalEntries كمسودة', async ({ page }) => {
  const capturedJournalPosts = await mockSharedAccounting(page, []);
  await page.goto('/journals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const description = `قيد متزن ${crypto.randomUUID().slice(0, 8)}`;
  await fillJournal(page, { description, debit: 100, credit: 100 });

  const journalRequestPromise = page.waitForRequest((request) =>
    request.method() === 'POST' && request.url().endsWith('/api/data/journalEntries'));
  await page.getByTestId('button-submit-journal').click();
  const journalRequest = await journalRequestPromise;
  const payload = journalRequest.postDataJSON();

  expect(payload.status).toBe('draft');
  expect(payload.description).toBe(description);
  expect(payload.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ debit: 100, credit: 0 }),
    expect.objectContaining({ debit: 0, credit: 100 }),
  ]));
  expect(payload.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(100);
  expect(payload.lines.reduce((sum, line) => sum + line.credit, 0)).toBe(100);
  expect(capturedJournalPosts).toHaveLength(1);
  await expect(page.getByTestId('page-journals')).toContainText(description);
  await expect(page.getByTestId('page-journals')).toContainText('مسودة غير معتمدة');
});

test('يطبق فلاتر التاريخ والحالة على القيود', async ({ page }) => {
  await mockSharedAccounting(page);
  await page.goto('/journals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();
  const year = new Date().getFullYear();
  const date = `${year}-01-05`;

  await expect(page.locator('[data-testid^="card-journal-"]')).toHaveCount(5);
  await page.getByTestId('input-journal-from').fill(date);
  await page.getByTestId('input-journal-to').fill(date);
  await expect(page.locator('[data-testid^="card-journal-"]')).toHaveCount(1);
  await expect(page.getByTestId('card-journal-2')).toContainText('مبيعات نقدية');

  await page.getByTestId('filter-journal-posted').click();
  await expect(page.locator('[data-testid^="card-journal-"]')).toHaveCount(1);
  await page.getByTestId('filter-journal-draft').click();
  await expect(page.getByTestId('page-journals')).toContainText('لا توجد قيود مطابقة');
  await expect(page.locator('[data-testid^="card-journal-"]')).toHaveCount(0);
});

test('يعرض مجموعات الحسابات والتقارير الثلاثة على سطح المكتب والجوال', async ({ page }) => {
  await mockSharedAccounting(page);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);

    await page.goto('/accounts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('page-accounts')).toBeVisible();
    for (const group of ['الأصول', 'الخصوم', 'حقوق الملكية', 'الإيرادات', 'المصروفات']) {
      await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible();
    }

    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('page-reports')).toBeVisible();
    await expect(page.getByTestId('tab-report-trial')).toBeVisible();
    await expect(page.getByTestId('tab-report-income')).toBeVisible();
    await expect(page.getByTestId('tab-report-balance')).toBeVisible();

    await page.getByTestId('tab-report-income').click();
    await expect(page.getByRole('heading', { name: 'قائمة الدخل (الأرباح والخسائر)' })).toBeVisible();
    await page.getByTestId('tab-report-balance').click();
    await expect(page.getByRole('heading', { name: 'قائمة المركز المالي (الميزانية العمومية)' })).toBeVisible();
    await expect(page.getByTestId('report-receivables')).toContainText('POS-CREDIT-1');
    await expect(page.getByTestId('report-receivables')).toContainText('2030-01-15');
    await expect(page.getByTestId('report-receivables')).toContainText('غير مسدد');
    await page.getByTestId('tab-report-trial').click();
    await expect(page.getByRole('heading', { name: 'ميزان المراجعة بالمجاميع والأرصدة' })).toBeVisible();
  }
});