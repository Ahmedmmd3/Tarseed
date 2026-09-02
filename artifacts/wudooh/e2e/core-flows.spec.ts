import { expect, test, unique } from './fixtures';
import type { Page } from '@playwright/test';

function parseArabicNumber(value: string) {
  const normalized = value
    .replace(/[٬,]/g, '')
    .replace(/[٫]/g, '.')
    .replace(/[−﹣－]/g, '-')
    .replace(/[\u061c\u200e\u200f]/g, '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const number = Number(normalized.match(/-?\d+(?:\.\d+)?/)?.[0] ?? '');
  expect(Number.isFinite(number), `تعذر قراءة الرقم: ${value}`).toBeTruthy();
  return number;
}

async function visitDashboardAndWaitForAccounting(page: Page) {
  const summaryResponse = page.waitForResponse((response: Response) =>
    response.request().method() === 'GET'
    && response.url().includes('/api/accounting/summary')
    && response.ok());
  const journalsResponse = page.waitForResponse((response: Response) =>
    response.request().method() === 'GET'
    && response.url().includes('/api/data/journalEntries')
    && response.ok());
  await page.goto('/dashboard');
  const [summary] = await Promise.all([summaryResponse, journalsResponse]);
  const summaryPayload = await summary.json() as {
    totals?: { expense?: number; netIncome?: number };
  };
  await expect.poll(async () => parseArabicNumber(await page.getByTestId('text-total-expenses').innerText()))
    .toBeCloseTo(Number(summaryPayload.totals?.expense), 2);
  await expect.poll(async () => parseArabicNumber(await page.getByTestId('text-net-profit').innerText()))
    .toBeCloseTo(Number(summaryPayload.totals?.netIncome), 2);
}

test.describe('المسارات التشغيلية الأساسية', () => {
  test('يعرض لوحة المعلومات ومؤشرات العمل', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('page-overview')).toBeVisible();
    await expect(page.getByTestId('text-dashboard-heading')).toBeVisible();
    await expect(page.getByTestId('link-open-pos')).toBeVisible();
    await expect(page.getByTestId('link-open-reports')).toBeVisible();
  });

  test('يفتح العملاء والفواتير والمصروفات', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await expect(page.getByTestId('page-sales')).toBeVisible();
    await expect(page.getByTestId('button-add-customers')).toBeVisible();
    await page.getByRole('tab', { name: 'فواتير المبيعات' }).click();
    await expect(page.getByText('فواتير المبيعات', { exact: true }).last()).toBeVisible();
    await expect(page.getByRole('link', { name: /فتح نقطة البيع/ })).toBeVisible();

    await page.goto('/expenses');
    await expect(page.getByTestId('page-expenses')).toBeVisible();
    await expect(page.getByTestId('button-add-expenses')).toBeVisible();
    await expect(page.getByTestId('button-add-expense-receipt')).toBeVisible();
  });

  test('يعرض نقطة البيع وحساب الضريبة والإجمالي', async ({ authenticatedPage: page }) => {
    await page.goto('/pos');
    await expect(page.getByTestId('page-pos')).toBeVisible();
    await expect(page.getByTestId('input-search-products')).toBeVisible();
    await expect(page.getByTestId('text-cart-subtotal')).toBeVisible();
    await expect(page.getByTestId('text-cart-tax')).toBeVisible();
    await expect(page.getByTestId('text-cart-total')).toBeVisible();
    await expect(page.getByTestId('btn-checkout')).toBeDisabled();
  });

  test('يحدّث إجمالي المصروفات وصافي الربح ويعرض القيد المرحّل في لوحة التحكم', async ({ authenticatedPage: page }) => {
    const description = unique('مصروف لوحة التحكم');
    const amount = 1375.25;

    await visitDashboardAndWaitForAccounting(page);
    const expensesBefore = parseArabicNumber(await page.getByTestId('text-total-expenses').innerText());
    const netProfitBefore = parseArabicNumber(await page.getByTestId('text-net-profit').innerText());

    await page.goto('/expenses');
    await expect(page.getByTestId('page-expenses')).toBeVisible();
    await page.getByTestId('button-add-expenses').click();
    await page.getByLabel('البيان').fill(description);
    await page.getByLabel('المبلغ').fill(String(amount));
    await page.getByLabel('التاريخ').fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel('التصنيف').selectOption('إيجار');
    await page.getByLabel('طريقة الدفع').selectOption('cash');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByTestId('page-expenses')).toContainText(description);

    await visitDashboardAndWaitForAccounting(page);
    const expensesAfter = parseArabicNumber(await page.getByTestId('text-total-expenses').innerText());
    const netProfitAfter = parseArabicNumber(await page.getByTestId('text-net-profit').innerText());
    expect(expensesAfter).toBeGreaterThanOrEqual(expensesBefore + amount);
    expect(netProfitAfter).toBeLessThanOrEqual(netProfitBefore - amount);

    const activityPanel = page.getByTestId('panel-recent-activity');
    const activityRow = activityPanel.getByText(description, { exact: true }).locator('..').locator('..');
    await expect(activityRow).toContainText('مصروف');
    await expect(activityRow).toContainText('مرحل');
  });

  test('يعكس إلغاء المصروف المرحّل مؤشرات اللوحة ويعرض القيد العكسي المرحّل', async ({ authenticatedPage: page }) => {
    const description = unique('مصروف إلغاء مؤشرات اللوحة');
    const reason = unique('سبب إلغاء مصروف اللوحة');
    const amount = 928.4;

    await visitDashboardAndWaitForAccounting(page);
    const expensesBefore = parseArabicNumber(await page.getByTestId('text-total-expenses').innerText());
    const netProfitBefore = parseArabicNumber(await page.getByTestId('text-net-profit').innerText());

    await page.goto('/expenses');
    await expect(page.getByTestId('page-expenses')).toBeVisible();
    await page.getByTestId('button-add-expenses').click();
    await page.getByLabel('البيان').fill(description);
    await page.getByLabel('المبلغ').fill(String(amount));
    await page.getByLabel('التاريخ').fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel('التصنيف').selectOption('إيجار');
    await page.getByLabel('طريقة الدفع').selectOption('cash');
    await page.getByRole('button', { name: 'حفظ' }).click();

    const expenseRow = page.getByRole('row').filter({ hasText: description });
    await expect(expenseRow).toBeVisible();
    await expenseRow.getByRole('button', { name: 'إلغاء من المصدر' }).click();
    await expect(page.getByTestId('dialog-source-adjustment')).toBeVisible();
    await page.getByTestId('input-source-adjustment-reason').fill(reason);

    const adjustmentResponse = page.waitForResponse((response: Response) =>
      response.request().method() === 'POST'
      && response.url().includes('/api/accounting/sources/expenses/')
      && response.url().endsWith('/cancel')
      && response.ok());
    await page.getByTestId('button-submit-source-adjustment').click();
    await adjustmentResponse;
    await expect(page.getByTestId('dialog-source-adjustment')).toBeHidden();
    await expect(expenseRow.getByRole('button', { name: 'إلغاء من المصدر' })).toHaveCount(0);

    await visitDashboardAndWaitForAccounting(page);
    const expensesAfter = parseArabicNumber(await page.getByTestId('text-total-expenses').innerText());
    const netProfitAfter = parseArabicNumber(await page.getByTestId('text-net-profit').innerText());
    expect(expensesAfter).toBeCloseTo(expensesBefore, 2);
    expect(netProfitAfter).toBeCloseTo(netProfitBefore, 2);

    const activityPanel = page.getByTestId('panel-recent-activity');
    const reversalRow = activityPanel.getByText(reason, { exact: false }).locator('..').locator('..');
    await expect(reversalRow).toContainText('عكس مصروف');
    await expect(reversalRow).toContainText('مرحل');
  });

  test('يعرض المخزون والحسابات وإجراءات الإنشاء', async ({ authenticatedPage: page }) => {
    await page.goto('/inventory');
    await expect(page.getByTestId('page-inventory')).toBeVisible();
    await expect(page.getByTestId('button-add-products')).toBeVisible();
     await expect(page.getByRole('columnheader', { name: 'عدد المخزون' })).toBeVisible();
     await expect(page.getByRole('columnheader', { name: 'مستودع التخزين' })).toBeVisible();
    await page.getByRole('tab', { name: 'التحويلات' }).click();
    await expect(page.getByTestId('button-create-transfer')).toBeVisible();
    await page.getByRole('tab', { name: 'التسويات' }).click();
    await expect(page.getByTestId('button-create-adjustment')).toBeVisible();

    await page.goto('/accounts');
    await expect(page.getByTestId('page-accounts')).toBeVisible();
    await expect(page.getByTestId('button-add-account')).toBeVisible();
  });
});