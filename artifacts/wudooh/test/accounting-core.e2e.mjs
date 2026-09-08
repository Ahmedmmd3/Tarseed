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
  const accountRecords = accounts.map((account) => ({ ...account }));
  let nextAccountId = 100;
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created: 0, accounts: accountRecords }) });
  });
  await page.route('**/api/data/accounts', async (route) => {
    if (route.request().method() === 'POST') {
      const record = { ...route.request().postDataJSON(), id: String(nextAccountId++) };
      accountRecords.push(record);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ record }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: accountRecords }) });
  });
  await page.route('**/api/data/accounts/*', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.fallback();
      return;
    }
    const id = route.request().url().split('/').at(-1);
    const index = accountRecords.findIndex((account) => account.id === id);
    const record = { ...accountRecords[index], ...route.request().postDataJSON() };
    accountRecords[index] = record;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ record }) });
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

async function mockAccountHierarchyRepair(page) {
  const repairRequests = [];
  const issues = [
    {
      kind: 'missing_parent',
      accountId: 901,
      accountCode: '1910',
      accountName: 'حساب بأب مفقود',
      accountType: 'asset',
      parentId: 9999,
    },
    {
      kind: 'cycle',
      accountId: 902,
      accountCode: '1920',
      accountName: 'حساب داخل دورة',
      accountType: 'asset',
      parentId: 903,
      cycleAccountIds: [902, 904, 903],
      cycleAccounts: [
        { accountId: 902, accountCode: '1920', accountName: 'حساب داخل دورة' },
        { accountId: 904, accountCode: '1940', accountName: 'الطرف الثاني للمعرّف 904' },
        { accountId: 903, accountCode: '1930', accountName: 'الطرف الثالث للمعرّف 903' },
      ],
    },
  ];

  await page.route('**/api/accounting/account-hierarchy/issues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ issues }),
    });
  });
  await page.route('**/api/accounting/account-hierarchy/repair', async (route) => {
    const request = route.request().postDataJSON();
    repairRequests.push(request);
    const repairedIssueIndex = issues.findIndex((issue) => issue.accountId === request.accountId);
    if (repairedIssueIndex !== -1) issues.splice(repairedIssueIndex, 1);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ repairedAccountIds: [request.accountId] }),
    });
  });

  return repairRequests;
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

test('يحفظ الحساب الفرعي تحت أبيه ويمنع اختيار نفسه أو فروعه كأب', async ({ page }) => {
  await mockSharedAccounting(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/accounts', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  await page.getByTestId('button-add-account').click();
  await page.getByTestId('input-account-code').fill('1900');
  await page.getByTestId('input-account-name').fill('أصل اختباري أساسي');
  await expect(page.getByTestId('button-account-primary')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('button-submit-account').click();
  await expect(page.getByTestId('input-account-code')).toBeHidden();
  await expect(page.getByTestId('row-account-100')).toBeVisible();

  await page.getByTestId('button-add-account').click();
  await expect(page.getByTestId('input-account-code')).toBeVisible();
  await page.getByTestId('input-account-code').fill('1910');
  await page.getByTestId('input-account-name').fill('أصل اختباري فرعي');
  await page.getByTestId('button-account-subaccount').click();
  await expect(page.getByTestId('button-account-subaccount')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('select-account-parent').selectOption('100');
  await page.getByTestId('button-submit-account').click();

  await expect(page.getByTestId('row-account-100')).toHaveAttribute('data-account-depth', '0');
  await expect(page.getByTestId('row-account-101')).toHaveAttribute('data-account-depth', '1');
  await expect(page.getByTestId('row-account-100')).toContainText('أساسي');
  await expect(page.getByTestId('row-account-101')).toContainText('فرعي');
  expect(await page.getByTestId('row-account-100').evaluate((parent, child) =>
    Boolean(parent.compareDocumentPosition(document.querySelector(`[data-testid="${child}"]`)) & Node.DOCUMENT_POSITION_FOLLOWING),
  'row-account-101')).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('row-account-100')).toHaveAttribute('data-account-depth', '0');
  await expect(page.getByTestId('row-account-101')).toHaveAttribute('data-account-depth', '1');

  await page.getByTestId('button-edit-account-101').click();
  await expect(page.getByTestId('button-account-subaccount')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('select-account-parent')).toHaveValue('100');
  await page.getByTestId('input-account-name').fill('أصل اختباري فرعي معدل');
  const updateRequestPromise = page.waitForRequest((request) =>
    request.method() === 'PATCH' && request.url().endsWith('/api/data/accounts/101'));
  await page.getByTestId('button-submit-account').click();
  const updateRequest = await updateRequestPromise;
  expect(updateRequest.postDataJSON()).toEqual(expect.objectContaining({
    name: 'أصل اختباري فرعي معدل',
    type: 'asset',
    parent: '100',
  }));
  await expect(page.getByTestId('row-account-101')).toContainText('أصل اختباري فرعي معدل');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('row-account-100')).toHaveAttribute('data-account-depth', '0');
  await expect(page.getByTestId('row-account-101')).toHaveAttribute('data-account-depth', '1');
  await expect(page.getByTestId('row-account-101')).toContainText('أصل اختباري فرعي معدل');
  expect(await page.getByTestId('row-account-100').evaluate((parent, child) =>
    Boolean(parent.compareDocumentPosition(document.querySelector(`[data-testid="${child}"]`)) & Node.DOCUMENT_POSITION_FOLLOWING),
  'row-account-101')).toBe(true);

  await page.getByTestId('button-edit-account-100').click();
  await expect(page.getByText('لا يمكن تغيير التصنيف ما دام للحساب فروع')).toBeVisible();
  await page.getByTestId('select-account-type').selectOption('liability');
  const parentTypePatchRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/api/data/accounts/100')) {
      parentTypePatchRequests.push(request);
    }
  });
  await page.getByTestId('button-submit-account').click();
  await expect(page.getByRole('alert')).toContainText('لا يمكن تغيير تصنيف الحساب الأب');
  await expect(page.getByTestId('input-account-code')).toBeVisible();
  expect(parentTypePatchRequests).toHaveLength(0);
  await page.keyboard.press('Escape');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('row-account-100')).toHaveAttribute('data-account-depth', '0');
  await expect(page.getByTestId('row-account-101')).toHaveAttribute('data-account-depth', '1');

  await page.getByTestId('button-edit-account-100').click();
  await expect(page.getByTestId('select-account-type')).toHaveValue('asset');
  await page.getByTestId('button-account-subaccount').click();
  const parentOptions = page.getByTestId('select-account-parent').locator('option');
  await expect(parentOptions.filter({ hasText: '1900 — أصل اختباري أساسي' })).toHaveCount(0);
  await expect(parentOptions.filter({ hasText: '1910 — أصل اختباري فرعي' })).toHaveCount(0);
});

test('يعرض مشاكل شجرة الحسابات ويصلح الأب المفقود والدورة دون إرسال تعديل عند الإلغاء', async ({ page }) => {
  await mockSharedAccounting(page);
  const repairRequests = await mockAccountHierarchyRepair(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/accounts', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const issuesCard = page.getByTestId('account-hierarchy-issues');
  const missingParentIssue = page.getByTestId('account-hierarchy-issue-missing_parent-901');
  const cycleIssue = page.getByTestId('account-hierarchy-issue-cycle-902');
  await expect(issuesCard).toContainText('تحتاج شجرة الحسابات إلى مراجعة');
  await expect(missingParentIssue).toContainText('يشير إلى حساب أب محذوف (المعرّف 9999). اختر فصله أو نقله إلى أب صالح.');
  await expect(cycleIssue).toContainText('توجد دورة بين: 1920 — حساب داخل دورة، 1940 — الطرف الثاني للمعرّف 904، 1930 — الطرف الثالث للمعرّف 903. افصل أحدها أو انقله لكسر الدورة.');

  await page.getByTestId('button-repair-account-hierarchy-901').click();
  await expect(page.getByTestId('dialog-repair-account-hierarchy')).toBeVisible();
  await expect(page.getByTestId('select-account-hierarchy-parent')).toHaveValue('');
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(page.getByTestId('dialog-repair-account-hierarchy')).toBeHidden();
  expect(repairRequests).toHaveLength(0);
  await expect(missingParentIssue).toBeVisible();

  await page.getByTestId('button-repair-account-hierarchy-901').click();
  await page.getByTestId('button-confirm-account-hierarchy-repair').click();
  await expect(missingParentIssue).toBeHidden();
  expect(repairRequests).toEqual([{
    accountId: 901,
    parentId: null,
    confirmation: 'REPARENT_ACCOUNT',
  }]);

  await page.getByTestId('button-repair-account-hierarchy-902').click();
  const parentSelect = page.getByTestId('select-account-hierarchy-parent');
  await expect(parentSelect.locator('option').filter({ hasText: '1000 — الصندوق' })).toHaveCount(1);
  await parentSelect.selectOption('1');
  await page.getByTestId('button-confirm-account-hierarchy-repair').click();
  await expect(cycleIssue).toBeHidden();
  await expect(issuesCard).toBeHidden();
  expect(repairRequests).toEqual([
    { accountId: 901, parentId: null, confirmation: 'REPARENT_ACCOUNT' },
    { accountId: 902, parentId: 1, confirmation: 'REPARENT_ACCOUNT' },
  ]);
});
