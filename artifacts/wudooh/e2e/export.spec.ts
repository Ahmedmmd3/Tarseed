import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, test } from './fixtures';

const execFileAsync = promisify(execFile);
const MIN_NON_WHITE_PIXEL_RATIO = 0.01;
const PDF_ROWS_PER_PAGE = 12;

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
    code: `ACCT-LONG-${String(index + 1).padStart(4, '0')}`,
    name: `حساب اختباري طويل ACCT-LONG-${String(index + 1).padStart(4, '0')}`,
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
      number: `JE-LONG-${String(index + 1).padStart(4, '0')}`,
      date,
      description: `وصف قيد اختباري طويل JE-LONG-${String(index + 1).padStart(4, '0')}`,
      status: 'posted',
      lines: [
        { id: `long-report-line-${index + 1}-debit`, accountId: debitAccount.id, debit: (index + 1) * 100, credit: 0 },
        { id: `long-report-line-${index + 1}-credit`, accountId: creditAccount.id, debit: 0, credit: (index + 1) * 100 },
      ],
    };
  });
  const invoices = Array.from({ length: 30 }, (_, index) => ({
    id: `long-report-invoice-${index + 1}`,
    number: `INV-LONG-${String(index + 1).padStart(4, '0')}`,
    date: `2025-${String((index % 12) + 1).padStart(2, '0')}-16`,
    customer: `عميل اختباري طويل INV-LONG-${String(index + 1).padStart(4, '0')}`,
    subtotal: (index + 1) * 200,
    tax: (index + 1) * 30,
    total: (index + 1) * 230,
    status: 'paid',
  }));
  const expenses = Array.from({ length: 30 }, (_, index) => ({
    id: `long-report-expense-${index + 1}`,
    date: `2025-${String((index % 12) + 1).padStart(2, '0')}-17`,
    description: `EXP-LONG-${String(index + 1).padStart(4, '0')} — مصروف اختباري طويل`,
    category: `فئة ${((index % 6) + 1).toString()}`,
    vendor: `مورد اختباري طويل EXP-LONG-${String(index + 1).padStart(4, '0')}`,
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
    name: `REV-LONG-${String(index + 1).padStart(4, '0')} — إيراد اختباري طويل`,
    amount: (index + 1) * 250,
  }));
  const expense = Array.from({ length: 20 }, (_, index) => ({
    id: `long-report-income-expense-${index + 1}`,
    name: `INC-EXP-LONG-${String(index + 1).padStart(4, '0')} — مصروف قائمة دخل طويل`,
    amount: (index + 1) * 90,
  }));
  const assets = Array.from({ length: 20 }, (_, index) => ({
    id: `long-report-asset-${index + 1}`,
    name: `ASSET-LONG-${String(index + 1).padStart(4, '0')} — أصل اختباري طويل`,
    amount: (index + 1) * 100,
  }));
  const liabilities = Array.from({ length: 15 }, (_, index) => ({
    id: `long-report-liability-${index + 1}`,
    name: `LIABILITY-LONG-${String(index + 1).padStart(4, '0')} — التزام اختباري طويل`,
    amount: (index + 1) * 60,
  }));
  const equity = Array.from({ length: 15 }, (_, index) => ({
    id: `long-report-equity-${index + 1}`,
    name: `EQUITY-LONG-${String(index + 1).padStart(4, '0')} — حقوق ملكية اختبارية طويلة`,
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
  const ledgerMarkers = [...journals]
    .sort((left, right) => String(left.date).localeCompare(String(right.date)) || String(left.id).localeCompare(String(right.id), undefined, { numeric: true }))
    .flatMap((journal) => [journal.number, journal.number]);
  const reportMarkers = {
    journals: journals.flatMap((journal) => [journal.number, journal.number]),
    trial: accounts.map((account) => account.code),
    ledger: ledgerMarkers,
    invoices: invoices.map((invoice) => invoice.number),
    expenses: expenses.map((expense) => expense.description.split(' — ')[0]),
    income: [...revenue, ...expense].map((row) => row.name.split(' — ')[0]),
    balance: [...assets, ...liabilities, ...equity].map((row) => row.name.split(' — ')[0]),
  };
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
    await expectPdfRowsRetained(pdfPath, reportId, reportMarkers[reportId], pageCount, testInfo);
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

async function expectPdfRowsRetained(
  pdfPath: string,
  reportId: string,
  rowMarkers: string[],
  pageCount: number,
  testInfo: { outputPath: (path: string) => string },
) {
  const textPath = testInfo.outputPath(`long-export-${reportId}-text.txt`);
  await execFileAsync('pdftotext', ['-layout', pdfPath, textPath]);
  const pdfText = await readFile(textPath, 'utf8');
  const pageTexts = pdfText.split('\f').slice(0, pageCount);

  expect(pageTexts, `${reportId} PDF يجب أن يحتوي على نص قابل للفحص لكل صفحة.`).toHaveLength(pageCount);
  for (const [rowIndex, marker] of rowMarkers.entries()) {
    const pageNumber = Math.floor(rowIndex / PDF_ROWS_PER_PAGE) + 1;
    const pageText = pageTexts[pageNumber - 1] ?? '';
    expect(
      pageText,
      `${reportId} — الصفحة ${pageNumber} يجب أن تحتوي على علامة الصف المفقودة: ${marker}`,
    ).toContain(marker);
  }
}
