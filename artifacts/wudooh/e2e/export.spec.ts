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
  await expectPdfPageHasContent(firstPageImagePath, 'الصفحة الأولى');
});

test('يتحقق من سلامة كل الصفحات اللاحقة في تقرير PDF طويل', async ({ authenticatedPage: page }, testInfo) => {
  const assets = Array.from({ length: 30 }, (_, index) => ({
    id: `long-report-asset-${index + 1}`,
    name: `أصل اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    amount: (index + 1) * 100,
  }));
  const totalAssets = assets.reduce((total, asset) => total + asset.amount, 0);

  await page.route('**/api/accounting/summary?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totals: { revenue: 0, expense: 0, netIncome: 0 },
        trialBalance: [],
        incomeStatement: { revenue: [], expense: [], netIncome: 0 },
        balanceSheet: {
          assets,
          liabilities: [],
          equity: [],
          baseEquity: 0,
          unclosedEarnings: 0,
          totalAssets,
          totalLiabilitiesAndEquity: totalAssets,
        },
      }),
    });
  });

  await page.goto('/export');
  await expect(page.getByTestId('page-export')).toBeVisible();
  await expect(page.getByTestId('status-export-loading')).toHaveCount(0);

  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-export-balance-pdf').click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = testInfo.outputPath('long-export-pdf-check.pdf');
  await pdfDownload.saveAs(pdfPath);
  expect((await stat(pdfPath)).size).toBeGreaterThan(0);

  const { stdout: pdfInfo } = await execFileAsync('pdfinfo', [pdfPath]);
  const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)$/m)?.[1]);
  expect(Number.isFinite(pageCount)).toBe(true);
  expect(pageCount).toBeGreaterThan(1);

  const laterPagePrefix = testInfo.outputPath('long-export-pdf-check-page');
  await execFileAsync('pdftoppm', [
    '-f', '2',
    '-l', String(pageCount),
    '-png',
    pdfPath,
    laterPagePrefix,
  ]);

  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    const pageImagePath = `${laterPagePrefix}-${pageNumber}.png`;
    expect((await stat(pageImagePath)).size).toBeGreaterThan(0);
    await expectPdfPageHasContent(pageImagePath, `الصفحة ${pageNumber}`);
  }
});

async function expectPdfPageHasContent(imagePath: string, pageLabel: string) {
  const { stdout } = await execFileAsync('magick', [
    imagePath,
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
    `${pageLabel} من PDF تحتوي على ${nonWhitePixelRatio * 100}% فقط من البكسلات غير البيضاء.`,
  ).toBeGreaterThanOrEqual(MIN_NON_WHITE_PIXEL_RATIO);
}
