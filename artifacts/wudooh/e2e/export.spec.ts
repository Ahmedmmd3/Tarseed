import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, test } from './fixtures';
import { read as readXlsx, utils as xlsxUtils } from 'xlsx';
import JSZip from 'jszip';

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

test('يتحقق من سلامة تقارير PDF الطويلة منفردة وداخل ZIP', async ({ authenticatedPage: page }, testInfo) => {
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
  const arabicMarkers = {
    journals: journals.flatMap(() => ['وصف قيد اختباري طويل', 'وصف قيد اختباري طويل']),
    trial: accounts.map(() => 'حساب اختباري طويل'),
    ledger: journals.flatMap(() => ['وصف قيد اختباري طويل', 'وصف قيد اختباري طويل']),
    invoices: invoices.map(() => 'عميل اختباري طويل'),
    expenses: expenses.map(() => 'مصروف اختباري طويل'),
    income: [
      ...revenue.map(() => 'إيراد اختباري طويل'),
      ...expense.map(() => 'مصروف قائمة دخل طويل'),
    ],
    balance: [
      ...assets.map(() => 'أصل اختباري طويل'),
      ...liabilities.map(() => 'التزام اختباري طويل'),
      ...equity.map(() => 'حقوق ملكية اختبارية طويلة'),
    ],
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
    await expectPdfRowsRetained(pdfPath, reportId, reportMarkers[reportId], arabicMarkers[reportId], pageCount, testInfo);
    await expect(page.getByTestId(`button-export-${reportId}-pdf`)).toBeEnabled();
  }

  const zipDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-export-zip').click();
  const zipDownload = await zipDownloadPromise;
  expect(zipDownload.suggestedFilename()).toContain('ترصيد_تصدير');
  const zipPath = testInfo.outputPath('long-export-reports.zip');
  await zipDownload.saveAs(zipPath);
  expect((await stat(zipPath)).size).toBeGreaterThan(0);

  const pdfReports = reportIds.map((id) => ({
    id,
    fileName: {
      journals: 'القيود_اليومية',
      trial: 'ميزان_المراجعة',
      ledger: 'دفتر_الأستاذ',
      invoices: 'الفواتير',
      expenses: 'المصاريف',
      income: 'قائمة_الدخل',
      balance: 'الميزانية_العمومية',
    }[id],
    rowMarkers: reportMarkers[id],
    arabicMarkers: arabicMarkers[id],
  }));
  await expectZipPdfReportsComplete(zipPath, pdfReports, testInfo);
});

test('يتحقق من اكتمال كل ملفات Excel الطويلة عند فتحها', async ({ authenticatedPage: page }, testInfo) => {
  const accounts = Array.from({ length: 120 }, (_, index) => ({
    id: `long-excel-account-${index + 1}`,
    code: `ACCT-EXCEL-${String(index + 1).padStart(4, '0')}`,
    name: `حساب Excel اختباري طويل ACCT-EXCEL-${String(index + 1).padStart(4, '0')}`,
    type: (['asset', 'liability', 'equity', 'revenue', 'expense'] as const)[index % 5],
    parent: null,
    openingBalance: 0,
    balance: 0,
    status: 'active',
  }));
  const journals = Array.from({ length: 120 }, (_, index) => {
    const sequence = String(index + 1).padStart(4, '0');
    const date = `2025-${String((index % 12) + 1).padStart(2, '0')}-18`;
    const debitAccount = accounts[index % accounts.length];
    const creditAccount = accounts[(index + 1) % accounts.length];
    return {
      id: `long-excel-journal-${index + 1}`,
      number: `JE-EXCEL-${sequence}`,
      date,
      description: `وصف قيد Excel اختباري طويل JE-EXCEL-${sequence}`,
      status: 'posted',
      lines: [
        { id: `long-excel-line-${index + 1}-debit`, accountId: debitAccount.id, debit: (index + 1) * 110, credit: 0 },
        { id: `long-excel-line-${index + 1}-credit`, accountId: creditAccount.id, debit: 0, credit: (index + 1) * 110 },
      ],
    };
  });
  const invoices = Array.from({ length: 120 }, (_, index) => {
    const sequence = String(index + 1).padStart(4, '0');
    return {
      id: `long-excel-invoice-${index + 1}`,
      number: `INV-EXCEL-${sequence}`,
      date: `2025-${String((index % 12) + 1).padStart(2, '0')}-19`,
      customer: `عميل Excel اختباري طويل INV-EXCEL-${sequence}`,
      subtotal: (index + 1) * 210,
      tax: (index + 1) * 31.5,
      total: (index + 1) * 241.5,
      status: 'paid',
    };
  });
  const expenses = Array.from({ length: 120 }, (_, index) => {
    const sequence = String(index + 1).padStart(4, '0');
    return {
      id: `long-excel-expense-${index + 1}`,
      date: `2025-${String((index % 12) + 1).padStart(2, '0')}-20`,
      description: `EXP-EXCEL-${sequence} — مصروف Excel اختباري طويل`,
      category: `فئة Excel ${((index % 8) + 1).toString()}`,
      vendor: `مورد Excel اختباري طويل EXP-EXCEL-${sequence}`,
      amount: (index + 1) * 82,
      paymentMethod: 'bank',
    };
  });
  const trialBalance = accounts.map((account, index) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    debit: (index + 1) * 110,
    credit: (index + 1) * 90,
  }));
  const revenue = Array.from({ length: 80 }, (_, index) => ({
    id: `long-excel-revenue-${index + 1}`,
    name: `REV-EXCEL-${String(index + 1).padStart(4, '0')} — إيراد Excel اختباري طويل`,
    amount: (index + 1) * 260,
  }));
  const expense = Array.from({ length: 80 }, (_, index) => ({
    id: `long-excel-income-expense-${index + 1}`,
    name: `INC-EXP-EXCEL-${String(index + 1).padStart(4, '0')} — مصروف قائمة دخل Excel طويل`,
    amount: (index + 1) * 95,
  }));
  const assets = Array.from({ length: 80 }, (_, index) => ({
    id: `long-excel-asset-${index + 1}`,
    name: `ASSET-EXCEL-${String(index + 1).padStart(4, '0')} — أصل Excel اختباري طويل`,
    amount: (index + 1) * 105,
  }));
  const liabilities = Array.from({ length: 40 }, (_, index) => ({
    id: `long-excel-liability-${index + 1}`,
    name: `LIABILITY-EXCEL-${String(index + 1).padStart(4, '0')} — التزام Excel اختباري طويل`,
    amount: (index + 1) * 65,
  }));
  const equity = Array.from({ length: 40 }, (_, index) => ({
    id: `long-excel-equity-${index + 1}`,
    name: `EQUITY-EXCEL-${String(index + 1).padStart(4, '0')} — حقوق ملكية Excel طويلة`,
    amount: (index + 1) * 45,
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
        totals: { revenue: 1_000_000, expense: 420_000, netIncome: 580_000 },
        trialBalance,
        incomeStatement: { revenue, expense, netIncome: 580_000 },
        balanceSheet: {
          assets,
          liabilities,
          equity,
          baseEquity: 300_000,
          unclosedEarnings: 280_000,
          totalAssets: 1_000_000,
          totalLiabilitiesAndEquity: 1_000_000,
        },
      }),
    });
  });

  await page.goto('/export');
  await expect(page.getByTestId('page-export')).toBeVisible();
  await page.getByTestId('input-export-from').fill('2025-01-01');
  await page.getByTestId('input-export-to').fill('2025-12-31');
  await expect(page.getByTestId('status-export-loading')).toHaveCount(0);

  const excelReports = [
    { id: 'journals', sheetName: 'القيود اليومية', rowCount: 240, columnCount: 7, lastMarker: 'JE-EXCEL-0120' },
    { id: 'trial', sheetName: 'ميزان المراجعة', rowCount: 120, columnCount: 6, lastMarker: 'ACCT-EXCEL-0120' },
    { id: 'ledger', sheetName: 'دفتر الأستاذ', rowCount: 240, columnCount: 6, lastMarker: 'JE-EXCEL-0120' },
    { id: 'invoices', sheetName: 'الفواتير', rowCount: 120, columnCount: 7, lastMarker: 'INV-EXCEL-0120' },
    { id: 'expenses', sheetName: 'المصاريف', rowCount: 120, columnCount: 5, lastMarker: 'EXP-EXCEL-0120' },
    { id: 'income', sheetName: 'قائمة الدخل', rowCount: 161, columnCount: 3, lastMarker: 'صافي الربح' },
    { id: 'balance', sheetName: 'الميزانية العمومية', rowCount: 164, columnCount: 3, lastMarker: 'إجمالي الالتزامات وحقوق الملكية' },
  ] as const;

  for (const report of excelReports) {
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId(`button-export-${report.id}-excel`).click();
    const download = await downloadPromise;
    const excelPath = testInfo.outputPath(`long-export-${report.id}.xlsx`);
    await download.saveAs(excelPath);
    expect((await stat(excelPath)).size).toBeGreaterThan(0);
    await expectExcelRowsRetained(excelPath, report);
    await expect(page.getByTestId(`button-export-${report.id}-excel`)).toBeEnabled();
  }
});

async function expectExcelRowsRetained(
  excelPath: string,
  report: {
    id: string;
    sheetName: string;
    rowCount: number;
    columnCount: number;
    lastMarker: string;
  },
) {
  const workbook = readXlsx(await readFile(excelPath), { type: 'buffer' });
  expect(workbook.SheetNames, `${report.id} Excel يجب أن يحتوي على ورقة العمل المتوقعة.`).toEqual([report.sheetName]);
  const worksheet = workbook.Sheets[report.sheetName];
  expect(worksheet, `${report.id} Excel يجب أن يفتح ورقة العمل.`).toBeDefined();
  const rows = xlsxUtils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });

  expect(rows, `${report.id} Excel يجب أن يحتفظ بكل الصفوف.`).toHaveLength(report.rowCount + 1);
  expect(rows[0], `${report.id} Excel يجب أن يحتفظ بكل الأعمدة.`).toHaveLength(report.columnCount);
  for (const [rowIndex, row] of rows.slice(1).entries()) {
    expect(row, `${report.id} Excel — الصف ${rowIndex + 1} يجب أن يحتفظ بعدد الأعمدة المتوقع.`).toHaveLength(report.columnCount);
  }

  const lastRow = rows.at(-1) ?? [];
  expect(
    lastRow.map((value) => String(value)).join(' | '),
    `${report.id} Excel يجب أن يحتوي على علامة آخر صف: ${report.lastMarker}`,
  ).toContain(report.lastMarker);
}

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
  arabicMarkers: string[],
  pageCount: number,
  testInfo: { outputPath: (path: string) => string },
  outputPrefix = `long-export-${reportId}`,
) {
  const textPath = testInfo.outputPath(`${outputPrefix}-text.txt`);
  await execFileAsync('pdftotext', ['-layout', pdfPath, textPath]);
  const pdfText = normalizePdfTextForAssertion(await readFile(textPath, 'utf8'));
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
  for (const [rowIndex, marker] of arabicMarkers.entries()) {
    const pageNumber = Math.floor(rowIndex / PDF_ROWS_PER_PAGE) + 1;
    const pageText = pageTexts[pageNumber - 1] ?? '';
    expect(
      pageText,
      `${reportId} — الصفحة ${pageNumber} يجب أن تحتوي على العبارة العربية المفقودة: ${marker}`,
    ).toContain(marker);
  }
}

function normalizePdfTextForAssertion(text: string): string {
  return text.normalize('NFC').replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}

async function expectZipPdfReportsComplete(
  zipPath: string,
  reports: Array<{
    id: string;
    fileName: string;
    rowMarkers: string[];
    arabicMarkers: string[];
  }>,
  testInfo: { outputPath: (path: string) => string },
) {
  const archive = await JSZip.loadAsync(await readFile(zipPath));
  const pdfEntries = Object.values(archive.files).filter((entry) => entry.name.startsWith('PDF/') && entry.name.endsWith('.pdf') && !entry.dir);
  const expectedNames = reports.map((report) => `PDF/${report.fileName}.pdf`).sort();

  expect(pdfEntries, 'ملف ZIP يجب أن يحتوي على ملفات PDF السبعة المتوقعة فقط.').toHaveLength(reports.length);
  expect(pdfEntries.map((entry) => entry.name).sort(), 'ملف ZIP يجب أن يحتوي على أسماء تقارير PDF المتوقعة.').toEqual(expectedNames);

  for (const report of reports) {
    const entry = archive.files[`PDF/${report.fileName}.pdf`];
    expect(entry, `${report.id} يجب أن يكون موجوداً داخل مجلد PDF في ZIP.`).toBeDefined();
    const pdfPath = testInfo.outputPath(`long-export-zip-${report.id}.pdf`);
    await writeFile(pdfPath, await entry.async('nodebuffer'));
    expect((await stat(pdfPath)).size, `${report.id} داخل ZIP يجب ألا يكون فارغاً.`).toBeGreaterThan(0);

    const { stdout: pdfInfo } = await execFileAsync('pdfinfo', [pdfPath]);
    const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)$/m)?.[1]);
    const expectedPageCount = Math.ceil(Math.max(report.rowMarkers.length, report.arabicMarkers.length) / PDF_ROWS_PER_PAGE);
    expect(Number.isFinite(pageCount), `${report.id} داخل ZIP يجب أن يعرض عدد الصفحات.`).toBe(true);
    expect(pageCount, `${report.id} داخل ZIP يجب أن يحتوي على ${expectedPageCount} صفحات.`).toBe(expectedPageCount);

    await expectPdfRowsRetained(
      pdfPath,
      report.id,
      report.rowMarkers,
      report.arabicMarkers,
      pageCount,
      testInfo,
      `long-export-zip-${report.id}`,
    );
  }
}
