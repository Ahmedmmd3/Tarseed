import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, test } from './fixtures';

const execFileAsync = promisify(execFile);

test('ينشئ PDF قابلاً لنسخ العربية من مسار طباعة أمر الشراء', async ({ authenticatedPage: page }, testInfo) => {
  const order = {
    id: 77,
    orderNumber: 'PO-AR-0001',
    supplierId: 12,
    supplierName: 'مورد الجملة العربية',
    issueDate: '2026-09-03',
    expectedDate: '2026-09-10',
    warehouseId: 1,
    warehouseName: 'المستودع الرئيسي',
    status: 'sent',
    paymentStatus: 'unpaid',
    paymentMethod: 'credit',
    items: [
      {
        productId: 11,
        productName: 'قهوة عربية فاخرة',
        quantity: 2,
        receivedQuantity: 0,
        unitCost: 100,
        vatRate: 15,
        lineNet: 200,
        vatAmount: 30,
        total: 230,
      },
    ],
    subtotal: 200,
    vat: 30,
    total: 230,
    notes: 'يرجى التسليم إلى المستودع الرئيسي',
    createdAt: '2026-09-03T08:00:00.000Z',
  };

  await page.route('**/api/data/purchaseOrders', (route) => route.fulfill({
    json: { records: [order] },
  }));
  for (const resource of ['products', 'suppliers', 'warehouses']) {
    await page.route(`**/api/data/${resource}`, (route) => route.fulfill({
      json: { records: [] },
    }));
  }
  await page.route('**/api/data/purchaseOrderShares/expiring', (route) => route.fulfill({
    json: { alerts: [] },
  }));
  await page.route('**/api/data/purchaseOrders/77/share', (route) => route.fulfill({
    json: { share: null, decision: null },
  }));
  await page.route('**/api/data/purchaseOrders/77/print', (route) => route.fulfill({
    json: { document: order },
  }));

  await page.goto('/purchase-orders');
  await expect(page.getByTestId('page-purchase-orders')).toBeVisible();
  await expect(page.getByTestId('po-row-77')).toContainText('مورد الجملة العربية');

  await page.getByTestId('po-btn-view-77').click();
  await expect(page.getByRole('dialog')).toContainText('أمر شراء PO-AR-0001');
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
  await page.getByTestId('po-btn-print-77').click();
  const printWindow = await printWindowPromise;
  await printWindow.waitForLoadState('domcontentloaded');
  await expect(printWindow).toHaveTitle(/أمر شراء/);
  await expect(printWindow.locator('body')).toContainText('قهوة عربية فاخرة');
  expect(await printWindow.locator('style').textContent()).toContain('@page { size: A4;');

  const pdfPath = testInfo.outputPath('purchase-order-print-arabic.pdf');
  await printWindow.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  expect((await stat(pdfPath)).size, 'أمر الشراء المطبوع يجب ألا يكون فارغاً.').toBeGreaterThan(0);
  await expectArabicPdfValues(
    pdfPath,
    'أمر الشراء',
    ['أمر شراء', 'مورد الجملة العربية', 'قهوة عربية فاخرة', 'تفاصيل', 'ضريبة القيمة المضافة', 'يرجى التسليم إلى المستودع الرئيسي'],
    testInfo,
  );
  await printWindow.close();
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