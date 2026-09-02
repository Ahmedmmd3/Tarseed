import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, test } from './fixtures';

const execFileAsync = promisify(execFile);
const MIN_NON_WHITE_PIXEL_RATIO = 0.01;

test('يعرض صفحة التصدير ويتيح اختيار الفترة والحساب وتنزيل تقرير', async ({ authenticatedPage: page }, testInfo) => {
  await page.goto('/export');

  await expect(page.getByTestId('page-export')).toBeVisible();
  await expect(page.locator('.production-shell[dir="rtl"]').filter({ has: page.getByTestId('page-export') })).toHaveCount(1);
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
  const pdfPath = testInfo.outputPath('export-pdf-check.pdf');
  const firstPageImagePath = testInfo.outputPath('export-pdf-check-page-1.png');
  await pdfDownload.saveAs(pdfPath);
  expect((await stat(pdfPath)).size).toBeGreaterThan(0);

  await execFileAsync('pdftoppm', [
    '-f', '1',
    '-l', '1',
    '-png',
    '-singlefile',
    pdfPath,
    firstPageImagePath.replace(/\.png$/, ''),
  ]);
  const { stdout } = await execFileAsync('magick', [
    firstPageImagePath,
    '-alpha', 'off',
    '-colorspace', 'gray',
    '-threshold', '98%',
    '-format', '%[fx:1-mean]',
    'info:',
  ]);
  const nonWhitePixelRatio = Number(stdout.trim());
  expect(Number.isFinite(nonWhitePixelRatio)).toBe(true);
  expect(
    nonWhitePixelRatio,
    `الصفحة الأولى من PDF تحتوي على ${nonWhitePixelRatio * 100}% فقط من البكسلات غير البيضاء.`,
  ).toBeGreaterThanOrEqual(MIN_NON_WHITE_PIXEL_RATIO);
});
