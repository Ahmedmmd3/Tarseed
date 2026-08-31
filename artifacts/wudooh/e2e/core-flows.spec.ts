import { expect, test } from './fixtures';

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

  test('يعرض المخزون والحسابات وإجراءات الإنشاء', async ({ authenticatedPage: page }) => {
    await page.goto('/inventory');
    await expect(page.getByTestId('page-inventory')).toBeVisible();
    await expect(page.getByTestId('button-add-products')).toBeVisible();
    await page.getByRole('tab', { name: 'التحويلات' }).click();
    await expect(page.getByTestId('button-create-transfer')).toBeVisible();
    await page.getByRole('tab', { name: 'التسويات' }).click();
    await expect(page.getByTestId('button-create-adjustment')).toBeVisible();

    await page.goto('/accounts');
    await expect(page.getByTestId('page-accounts')).toBeVisible();
    await expect(page.getByTestId('button-add-account')).toBeVisible();
  });
});