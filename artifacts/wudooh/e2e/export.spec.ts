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
  const accounts = Array.from({ length: 30 }, (_, index) => ({
    id: `long-report-account-${index + 1}`,
    code: `1${String(index + 1).padStart(3, '0')}`,
    name: `حساب اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    type: (['asset', 'liability', 'equity', 'revenue', 'expense'] as const)[index % 5],
    parent: null,
    openingBalance: 0,
    balance: 0,
    status: 'active',
  }));
  const journals = Array.from({ length: 30 }, (_, index) => {
    const date = `2025-${String((index % 12) + 1).padStart(2, '0')}-15`;
    const debitAccount = accounts[index % accounts.length];
    const creditAccount = accounts[(index + 1) % accounts.length];
    return {
      id: `long-report-journal-${index + 1}`,
      number: `JE-${String(index + 1).padStart(4, '0')}`,
      date,
      description: `وصف قيد اختباري طويل ${String(index + 1).padStart(2, '0')}`,
      status: 'posted',
      lines: [
        { id: `long-report-line-${index + 1}-debit`, accountId: debitAccount.id, debit: (index + 1) * 100, credit: 0 },
        { id: `long-report-line-${index + 1}-credit`, accountId: creditAccount.id, debit: 0, credit: (index + 1) * 100 },
      ],
    };
  });
  const invoices = Array.from({ length: 30 }, (_, index) => ({
    id: `long-report-invoice-${index + 1}`,
    number: `INV-${String(index + 1).padStart(4, '0')}`,
    date: `2025-${String((index % 12) + 1).padStart(2, '0')}-16`,
    customer: `عميل اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    subtotal: (index + 1) * 200,
    tax: (index + 1) * 30,
    total: (index + 1) * 230,
    status: 'paid',
  }));
  const expenses = Array.from({ length: 30 }, (_, index) => ({
    id: `long-report-expense-${index + 1}`,
    date: `2025-${String((index % 12) + 1).padStart(2, '0')}-17`,
    description: `مصروف اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    category: `فئة ${((index % 6) + 1).toString()}`,
    vendor: `مورد اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    amount: (index + 1) * 75,
    paymentMethod: 'bank',
  }));
  const trialBalance = accounts.map((account, index) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    debit: (index + 1) * 100,
    credit: (index + 1) * 80,
  }));
  const revenue = Array.from({ length: 20 }, (_, index) => ({
    id: `long-report-revenue-${index + 1}`,
    name: `إيراد اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    amount: (index + 1) * 250,
  }));
  const expense = Array.from({ length: 20 }, (_, index) => ({
    id: `long-report-income-expense-${index + 1}`,
    name: `مصروف قائمة دخل طويل ${String(index + 1).padStart(2, '0')}`,
    amount: (index + 1) * 90,
  }));
  const assets = Array.from({ length: 20 }, (_, index) => ({
    id: `long-report-asset-${index + 1}`,
    name: `أصل اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    amount: (index + 1) * 100,
  }));
  const liabilities = Array.from({ length: 15 }, (_, index) => ({
    id: `long-report-liability-${index + 1}`,
    name: `التزام اختباري طويل ${String(index + 1).padStart(2, '0')}`,
    amount: (index + 1) * 60,
  }));
  const equity = Array.from({ length: 15 }, (_, index) => ({
    id: `long-report-equity-${index + 1}`,
    name: `حقوق ملكية اختبارية طويلة ${String(index + 1).padStart(2, '0')}`,
    amount: (index + 1) * 40,
  }));

  const apiPayloads: Record<string, unknown> = {
    accounts,
    journalEntries: journals,
    invoices,
    expenses,
  };
  for (const [resource, payload] of Object.entries(apiPayloads)) {
    await page.route(`**/api/data/${resource}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });
  }
  await page.route('**/api/accounting/summary?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totals: { revenue: 52_500, expense: 18_900, netIncome: 33_600 },
        trialBalance,
        incomeStatement: { revenue, expense, netIncome: 33_600 },
        balanceSheet: {
          assets,
          liabilities,
          equity,
          baseEquity: 25_000,
          unclosedEarnings: 8_600,
          totalAssets: 48_000,
          totalLiabilitiesAndEquity: 48_000,
        },
      }),
    });
  });

  await page.goto('/export');
  await expect(page.getByTestId('page-export')).toBeVisible();
  await page.getByTestId('input-export-from').fill('2025-01-01');
  await page.getByTestId('input-export-to').fill('2025-12-31');
  await expect(page.getByTestId('status-export-loading')).toHaveCount(0);

  const reportIds = ['journals', 'trial', 'ledger', 'invoices', 'expenses', 'income', 'balance'] as const;
  for (const reportId of reportIds) {
    const pdfDownloadPromise = page.waitForEvent('download');
    await page.getByTestId(`button-export-${reportId}-pdf`).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = testInfo.outputPath(`long-export-${reportId}.pdf`);
    await pdfDownload.saveAs(pdfPath);
    expect((await stat(pdfPath)).size).toBeGreaterThan(0);

    const { stdout: pdfInfo } = await execFileAsync('pdfinfo', [pdfPath]);
    const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)$/m)?.[1]);
    expect(Number.isFinite(pageCount), `${reportId} PDF should expose a page count.`).toBe(true);
    expect(pageCount, `${reportId} PDF should span more than one page.`).toBeGreaterThan(1);

    const laterPagePrefix = testInfo.outputPath(`long-export-${reportId}-page`);
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
      await expectPdfPageHasContent(pageImagePath, `${reportId} — الصفحة ${pageNumber}`);
    }
    await expect(page.getByTestId(`button-export-${reportId}-pdf`)).toBeEnabled();
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
