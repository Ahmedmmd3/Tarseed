import { expect, test, unique } from './fixtures';

function parseArabicNumber(value: string) {
  const normalized = value
    .replace(/[٬,]/g, '')
    .replace(/[٫]/g, '.')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const number = Number(normalized.replace(/[^\d.-]/g, ''));
  expect(Number.isFinite(number), `تعذر قراءة الرقم: ${value}`).toBeTruthy();
  return number;
}

test.describe('سلامة التقارير والقيود المحاسبية', () => {
  test('يتساوى مجموع المدين والدائن في ميزان المراجعة', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByTestId('tab-report-trial').click();
    const totalRow = page.getByText('الإجمالي الكلي').locator('..');
    const cells = totalRow.getByRole('cell');
    const debit = parseArabicNumber(await cells.nth(1).innerText());
    const credit = parseArabicNumber(await cells.nth(2).innerText());
    expect(Math.abs(debit - credit)).toBe(0);
  });

  test('يتساوى إجمالي الأصول مع الخصوم وحقوق الملكية', async ({ authenticatedPage: page }) => {
    await page.goto('/reports');
    await page.getByTestId('tab-report-balance').click();
    const assets = parseArabicNumber(await page.getByTestId('report-total-assets').innerText());
    const liabilitiesAndEquity = parseArabicNumber(await page.getByTestId('report-total-liab-equity').innerText());
    expect(Math.abs(assets - liabilitiesAndEquity)).toBe(0);
  });

  test('يبقى التقرير المحلي متوازناً عند تعذر ملخص الخادم', async ({ authenticatedPage: page }) => {
    await page.route('**/api/accounting/summary?**', (route) => route.abort());
    await page.goto('/reports');
    await page.getByTestId('tab-report-balance').click();
    const assets = parseArabicNumber(await page.getByTestId('report-total-assets').innerText());
    const liabilitiesAndEquity = parseArabicNumber(await page.getByTestId('report-total-liab-equity').innerText());
    expect(Math.abs(assets - liabilitiesAndEquity)).toBe(0);
    await expect(page.getByTestId('report-balance-warning')).toHaveCount(0);
  });

  test('يحفظ قيداً يدوياً متوازناً 1000/1000', async ({ authenticatedPage: page }) => {
    await page.goto('/journals');
    await page.getByTestId('button-add-journal').click();
    await page.getByTestId('input-journal-desc').fill(unique('قيد متوازن'));
    await page.getByTestId('select-journal-account-0').selectOption({ index: 1 });
    await page.getByTestId('input-journal-debit-0').fill('1000');
    await page.getByTestId('select-journal-account-1').selectOption({ index: 2 });
    await page.getByTestId('input-journal-credit-1').fill('1000');
    await expect(page.getByTestId('button-submit-journal')).toBeEnabled();
    await page.getByTestId('button-submit-journal').click();
    await expect(page.getByText('تم حفظ القيد', { exact: true })).toBeVisible();
  });

  test('يرفض حفظ قيد غير متوازن 1000/800 برسالة واضحة', async ({ authenticatedPage: page }) => {
    await page.goto('/journals');
    await page.getByTestId('button-add-journal').click();
    await page.getByTestId('input-journal-desc').fill(unique('قيد غير متوازن'));
    await page.getByTestId('select-journal-account-0').selectOption({ index: 1 });
    await page.getByTestId('input-journal-debit-0').fill('1000');
    await page.getByTestId('select-journal-account-1').selectOption({ index: 2 });
    await page.getByTestId('input-journal-credit-1').fill('800');
    await expect(page.getByRole('alert')).toContainText('القيد غير متزن');
    await expect(page.getByTestId('button-submit-journal')).toBeDisabled();
    await expect(page.getByText(/لن يمكنك حفظ القيد حتى يتساوى الطرفان/)).toBeVisible();
  });
});