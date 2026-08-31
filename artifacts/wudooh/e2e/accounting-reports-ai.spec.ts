import { expect, test } from './fixtures';

test.describe('المحاسبة والتقارير والمساعد', () => {
  test('يتنقل بين القوائم المالية الأساسية', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await expect(page.getByTestId('page-reports')).toBeVisible();
    for (const tab of ['trial', 'income', 'balance', 'ledger', 'aging', 'reconciliation']) {
      const locator = page.getByTestId(`tab-report-${tab}`);
      await expect(locator).toBeVisible();
      await locator.click();
    }
    await page.getByTestId('tab-report-income').click();
    await expect(page.getByTestId('report-net-income')).toBeVisible();
    await page.getByTestId('tab-report-balance').click();
    await expect(page.getByTestId('report-total-assets')).toBeVisible();
    await expect(page.getByTestId('report-total-liab-equity')).toBeVisible();
  });

  test('يفتح المساعد المالي ويرسل سؤالاً ضمن حد اختبار معزول', async ({ authenticatedPage: page }) => {
    await page.route('**/api/assistant/financial', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: 'إجابة اختبارية معزولة' }) });
    });
    await page.goto('/dashboard');
    await page.getByTestId('button-financial-assistant').click();
    await expect(page.getByTestId('financial-assistant-drawer')).toBeVisible();
    await page.getByTestId('input-financial-question').fill('ما ملخص الوضع المالي؟');
    await expect(page.getByTestId('button-send-financial-question')).toBeEnabled();
    await page.getByTestId('button-send-financial-question').click();
    await expect(page.getByTestId('assistant-message-user')).toContainText('ما ملخص الوضع المالي؟');
    await expect(page.getByTestId('assistant-message-assistant').last()).toContainText('إجابة اختبارية معزولة');
  });
});