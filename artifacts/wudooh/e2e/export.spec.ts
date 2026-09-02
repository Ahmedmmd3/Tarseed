import { expect, test } from './fixtures';

test('يعرض صفحة التصدير ويتيح اختيار الفترة والحساب وتنزيل تقرير', async ({ authenticatedPage: page }) => {
  await page.goto('/export');

  await expect(page.getByTestId('page-export')).toBeVisible();
  await expect(page.getByTestId('section-export-reports')).toBeVisible();
  await expect(page.getByTestId('card-export-journals')).toBeVisible();
  await expect(page.getByTestId('button-export-journals-excel')).toBeVisible();
  await expect(page.getByTestId('button-export-journals-pdf')).toBeVisible();
  await expect(page.getByTestId('button-export-zip')).toHaveText(/تصدير الكل/);

  await page.getByTestId('input-export-from').fill('2025-01-01');
  await page.getByTestId('input-export-to').fill('2025-12-31');
  await expect(page.getByTestId('text-export-period')).toContainText('2025-01-01');
  await expect(page.getByTestId('text-export-period')).toContainText('2025-12-31');
  await expect(page.getByTestId('status-export-loading')).toHaveCount(0);

  await page.getByTestId('select-export-ledger-account').click();
  await page.getByRole('option', { name: 'كل الحسابات' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-export-balance-excel').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('الميزانية_العمومية');

  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-export-balance-pdf').click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toContain('الميزانية_العمومية');
});