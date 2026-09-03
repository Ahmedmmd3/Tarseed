import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, test, unique } from './fixtures';

const execFileAsync = promisify(execFile);

test.describe('المبيعات والمخزون والمصروفات والعملاء', () => {
  test('ينشئ فاتورة ببندين وضريبة 15% من نقطة البيع', async ({ authenticatedPage: page }, testInfo) => {
    let checkoutPayload: {
      paymentMethod?: string;
      items?: Array<{ productId: number; quantity: number }>;
    } | undefined;

    await page.route('**/api/data/products', (route) => route.fulfill({
      json: {
        records: [
          { id: 101, name: 'استشارة', barcode: '628100000001', price: 500, vatRate: 15 },
          { id: 102, name: 'تقرير', price: 250, vatRate: 15 },
        ],
      },
    }));
    await page.route('**/api/data/warehouses', (route) => route.fulfill({
      json: { records: [{ id: 1, name: 'الموقع الرئيسي', status: 'active' }] },
    }));
    await page.route('**/api/data/inventoryBalances', (route) => route.fulfill({
      json: {
        records: [
          { productId: 101, warehouseId: 1, quantity: 10 },
          { productId: 102, warehouseId: 1, quantity: 10 },
        ],
      },
    }));
    await page.route('**/api/inventory/settings', (route) => route.fulfill({
      json: { vatRate: 15, pricesIncludeVat: false },
    }));
    await page.route('**/api/inventory/checkout', async (route) => {
      checkoutPayload = route.request().postDataJSON();
      await route.fulfill({
        json: {
          invoice: {
            id: 9001,
            number: unique('INV'),
            subtotal: 1000,
            tax: 150,
            total: 1150,
          },
        },
      });
    });

    await page.goto('/pos');
    await page.getByTestId('select-invoice-print-format').selectOption('a4');
    await expect(page.getByTestId('select-invoice-print-format')).toHaveValue('a4');
    await page.getByTestId('input-search-products').fill('628100000001');
    await expect(page.getByTestId('card-product-101')).toBeVisible();
    await page.getByTestId('input-search-products').press('Enter');
    await expect(page.getByTestId('cart-item-101')).toBeVisible();
    await page.getByTestId('card-product-102').click();
    await page.getByTestId('btn-plus-102').click();
    await page.getByTestId('btn-pay-cash').click();

    await expect(page.getByTestId('text-cart-subtotal')).toContainText(/١٬٠٠٠|1,000/);
    await expect(page.getByTestId('text-cart-tax')).toContainText(/١٥٠|150/);
    await expect(page.getByTestId('text-cart-total')).toContainText(/١٬١٥٠|1,150/);
    await page.getByTestId('btn-checkout').click();

    await expect(page.getByTestId('page-pos-success')).toBeVisible();
    await expect(page.getByTestId('btn-print-invoice')).toBeVisible();
    await page.evaluate(() => {
      const originalOpen = window.open.bind(window);
      (window as any).open = (...args: any[]) => {
        const popup = originalOpen(...args);
        if (popup) {
          const originalAddEventListener = popup.addEventListener.bind(popup);
          (popup as any).addEventListener = (type: string, ...listenerArgs: any[]) => {
            if (type === 'afterprint') return;
            return originalAddEventListener(type, ...listenerArgs);
          };
          popup.print = () => {};
        }
        return popup;
      };
    });
    const printWindowPromise = page.waitForEvent('popup');
    await page.getByTestId('btn-print-invoice').click();
    const printWindow = await printWindowPromise;
    await printWindow.waitForLoadState('domcontentloaded');
    await expect(printWindow).toHaveTitle(/فاتورة/);
    await expect(printWindow.locator('body')).toContainText('استشارة');
    expect(await printWindow.locator('style').textContent()).toContain('A4 portrait');
    const pdfPath = testInfo.outputPath('invoice-print-arabic.pdf');
    await printWindow.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    expect((await stat(pdfPath)).size, 'فاتورة البيع المطبوعة يجب ألا تكون فارغة.').toBeGreaterThan(0);
    await expectArabicPdfValues(
      pdfPath,
      'فاتورة البيع',
      ['فاتورة بيع', 'استشارة', 'المجموع قبل الضريبة', 'ضريبة القيمة المضافة', 'تعاملكم معنا'],
      testInfo,
    );
    await printWindow.close();
    expect(checkoutPayload?.paymentMethod).toBe('cash');
    expect(checkoutPayload?.items).toEqual([
      { productId: 101, quantity: 1 },
      { productId: 102, quantity: 2 },
    ]);
  });

  test('ينشئ إيصالاً صغيراً قابلاً لنسخ العربية من نقطة البيع', async ({ authenticatedPage: page }, testInfo) => {
    await page.route('**/api/data/products', (route) => route.fulfill({
      json: {
        records: [
          { id: 201, name: 'قهوة عربية فاخرة', barcode: '628100000201', price: 100, vatRate: 15 },
        ],
      },
    }));
    await page.route('**/api/data/warehouses', (route) => route.fulfill({
      json: { records: [{ id: 1, name: 'المستودع الرئيسي', status: 'active' }] },
    }));
    await page.route('**/api/data/inventoryBalances', (route) => route.fulfill({
      json: { records: [{ productId: 201, warehouseId: 1, quantity: 10 }] },
    }));
    await page.route('**/api/inventory/settings', (route) => route.fulfill({
      json: { vatRate: 15, pricesIncludeVat: false },
    }));
    await page.route('**/api/inventory/checkout', (route) => route.fulfill({
      json: {
        invoice: {
          id: 9201,
          number: 'INV-AR-80MM-0001',
          subtotal: 200,
          tax: 30,
          total: 230,
        },
      },
    }));

    await page.goto('/pos');
    await page.getByTestId('select-invoice-print-format').selectOption('receipt');
    await expect(page.getByTestId('select-invoice-print-format')).toHaveValue('receipt');
    await page.getByTestId('card-product-201').click();
    await page.getByTestId('btn-plus-201').click();
    await page.getByTestId('input-customer-name').fill('شركة الضيافة العربية');
    await page.getByTestId('btn-pay-cash').click();
    await page.getByTestId('btn-checkout').click();

    await expect(page.getByTestId('page-pos-success')).toBeVisible();
    await page.evaluate(() => {
      const originalOpen = window.open.bind(window);
      (window as any).open = (...args: any[]) => {
        const popup = originalOpen(...args);
        if (popup) {
          const originalAddEventListener = popup.addEventListener.bind(popup);
          (popup as any).addEventListener = (type: string, ...listenerArgs: any[]) => {
            if (type === 'afterprint') return;
            return originalAddEventListener(type, ...listenerArgs);
          };
          popup.print = () => {};
        }
        return popup;
      };
    });
    const printWindowPromise = page.waitForEvent('popup');
    await page.getByTestId('btn-print-invoice').click();
    const printWindow = await printWindowPromise;
    await printWindow.waitForLoadState('domcontentloaded');
    await expect(printWindow).toHaveTitle(/فاتورة/);
    await expect(printWindow.locator('body')).toContainText('شركة الضيافة العربية');
    await expect(printWindow.locator('body')).toContainText('قهوة عربية فاخرة');
    expect(await printWindow.locator('style').textContent()).toContain('@page { size: 80mm auto;');

    const pdfPath = testInfo.outputPath('invoice-receipt-print-arabic.pdf');
    await printWindow.pdf({ path: pdfPath, width: '80mm', printBackground: true });
    expect((await stat(pdfPath)).size, 'إيصال البيع المطبوع يجب ألا يكون فارغاً.').toBeGreaterThan(0);
    await expectArabicPdfValues(
      pdfPath,
      'إيصال البيع 80mm',
      ['فاتورة بيع', 'شركة الضيافة العربية', 'قهوة عربية فاخرة', 'المجموع قبل الضريبة', 'ضريبة القيمة المضافة', 'شامل الضريبة', 'تعاملكم معنا'],
      testInfo,
    );
    await printWindow.close();
  });

  test('يوضح أن الفواتير تُنشأ من نقطة البيع وتظهر حالتها في القائمة', async ({ authenticatedPage: page }) => {
    await page.goto('/sales');
    await page.getByRole('tab', { name: 'فواتير المبيعات' }).click();
    await expect(page.getByTestId('page-sales')).toContainText('تُنشأ فواتير البيع المؤثرة في المخزون من مسار نقطة البيع الذري');
    await expect(page.getByRole('link', { name: 'فتح نقطة البيع' })).toHaveAttribute('href', '/pos');
    await expect(page.getByRole('columnheader', { name: 'الحالة' })).toBeVisible();
  });

  test('يضيف مصروف إيجار ويتحقق من رفض المبلغ الفارغ', async ({ authenticatedPage: page }) => {
    const description = unique('إيجار المكتب');

    await page.goto('/expenses');
    await page.getByTestId('button-add-expenses').click();
    await page.getByLabel('البيان').fill(description);
    await page.getByLabel('المبلغ').fill('3500');
    await page.getByLabel('التاريخ').fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel('التصنيف').selectOption('إيجار');
    await page.getByLabel('طريقة الدفع').selectOption('cash');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByTestId('page-expenses')).toContainText(description);

    await page.getByTestId('button-add-expenses').click();
    await page.getByLabel('البيان').fill(unique('مصروف ناقص'));
    await page.getByLabel('التاريخ').fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel('التصنيف').selectOption('إيجار');
    await page.getByLabel('طريقة الدفع').selectOption('cash');
    const emptyAmount = page.getByLabel('المبلغ');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(emptyAmount).toBeFocused();
    expect(await emptyAmount.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  });

  test('يضيف عميلاً ويتحقق من رفض الاسم الفارغ', async ({ authenticatedPage: page }) => {
    const customerName = unique('عميل');

    await page.goto('/sales');
    await page.getByTestId('button-add-customers').click();
    await page.getByLabel('اسم العميل').fill(customerName);
    await page.getByLabel('رقم الهاتف').fill('0500000000');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(page.getByTestId('page-sales')).toContainText(customerName);

    await page.getByTestId('button-add-customers').click();
    await page.getByLabel('رقم الهاتف').fill('0500000001');
    const emptyName = page.getByLabel('اسم العميل');
    await page.getByRole('button', { name: 'حفظ' }).click();
    await expect(emptyName).toBeFocused();
    expect(await emptyName.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  });

  test('يضيف منتجاً إلى سلة الكاشير ويعيد حساب الإجمالي عند تغيير الكمية', async ({ authenticatedPage: page }) => {
    await page.goto('/pos');
    await expect(page.getByTestId('page-pos')).toBeVisible();
    await page.getByTestId('input-search-products').fill('');

    const product = page.locator('[data-testid^="card-product-"]:not([disabled])').first();
    await expect(product).toBeVisible();
    const productTestId = await product.getAttribute('data-testid');
    expect(productTestId).toBeTruthy();
    const productId = productTestId!.replace('card-product-', '');

    await product.click();
    await expect(page.getByTestId(`cart-item-${productId}`)).toBeVisible();
    await expect(page.getByTestId('btn-checkout')).toBeEnabled();

    const totalBefore = await page.getByTestId('text-cart-total').innerText();
    await page.getByTestId(`btn-plus-${productId}`).click();
    await expect(page.getByTestId(`text-qty-${productId}`)).toHaveText('2');
    await expect(page.getByTestId('text-cart-total')).not.toHaveText(totalBefore);
  });
});

async function expectArabicPdfValues(
  pdfPath: string,
  documentLabel: string,
  values: string[],
  testInfo: { outputPath: (path: string) => string },
) {
  const { stdout: pdfInfo } = await execFileAsync('pdfinfo', [pdfPath]);
  const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)$/m)?.[1]);
  expect(Number.isFinite(pageCount), `${documentLabel} PDF يجب أن يعرض عدد الصفحات.`).toBe(true);
  expect(pageCount, `${documentLabel} PDF يجب أن يحتوي على صفحة واحدة على الأقل.`).toBeGreaterThan(0);

  const textPath = testInfo.outputPath(`${documentLabel}-text.txt`);
  await execFileAsync('pdftotext', ['-layout', pdfPath, textPath]);
  const pageTexts = (await readFile(textPath, 'utf8'))
    .normalize('NFC')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .split('\f')
    .slice(0, pageCount);

  expect(pageTexts, `${documentLabel} PDF يجب أن يحتوي على نص قابل للفحص لكل صفحة.`).toHaveLength(pageCount);
  for (const value of values) {
    expect(
      pageTexts[0] ?? '',
      `${documentLabel} — الصفحة 1 يجب أن تحتوي على القيمة العربية: ${value}`,
    ).toContain(value);
  }
}