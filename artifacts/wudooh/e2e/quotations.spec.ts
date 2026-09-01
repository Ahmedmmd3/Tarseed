import { expect, test } from './fixtures';

test('ينشئ عرض سعر ويفلتره ويحوله إلى فاتورة مع إظهار انتهاء الصلاحية', async ({ authenticatedPage: page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const quotations = [{
    id: 80,
    number: 'QUO-0080',
    customerName: 'عميل منتهي',
    issueDate: '2026-01-01',
    expiryDate: '2026-01-02',
    status: 'draft',
    items: [{ description: 'قديم', quantity: 1, unitPrice: 10, discount: 0, vatRate: 15, lineNet: 10, vatAmount: 1.5, total: 11.5 }],
    subtotal: 10,
    discount: 0,
    tax: 1.5,
    total: 11.5,
    createdAt: '2026-01-01T00:00:00.000Z',
  }];

  await page.route('**/api/data/customers', (route) => route.fulfill({ json: { records: [] } }));
  await page.route('**/api/data/products', (route) => route.fulfill({ json: { records: [] } }));
  await page.route('**/api/data/quotations', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      quotations.push({ ...body, id: 81, number: 'QUO-0081', createdAt: new Date().toISOString() });
      await route.fulfill({ status: 201, json: { record: quotations.at(-1) } });
      return;
    }
    await route.fulfill({ json: { records: quotations } });
  });
  await page.route('**/api/data/quotations/81/convert', async (route) => {
    const quote = quotations.find((item) => item.id === 81)!;
    Object.assign(quote, { status: 'accepted', convertedInvoiceId: 501 });
    await route.fulfill({ status: 201, json: { quotation: quote, invoice: { id: 501, number: 'INV-501', sourceQuotationId: 81 } } });
  });

  await page.goto('/quotations');
  await expect(page.getByTestId('page-quotations')).toBeVisible();
  await expect(page.getByTestId('quotation-expired-80')).toContainText('منتهي الصلاحية');
  await page.getByTestId('btn-create-quotation').click();
  await expect(page.getByTestId('input-quotation-number')).toHaveValue('يُولّد تلقائياً عند الحفظ');
  await page.getByTestId('input-quotation-customer').fill('عميل اختبار');
  await page.getByTestId('input-quotation-issue-date').fill(today);
  await page.getByTestId('input-quotation-expiry-date').fill(future);
  await page.getByTestId('input-quotation-description-0').fill('خدمة اختبار');
  await page.getByTestId('input-quotation-quantity-0').fill('2');
  await page.getByTestId('input-quotation-price-0').fill('100');
  await page.getByTestId('input-quotation-discount-0').fill('10');
  await page.getByTestId('input-quotation-vat-0').fill('15');
  await page.getByTestId('btn-save-quotation').click();
  await expect(page.getByTestId('row-quotation-81')).toContainText('QUO-0081');
  await page.getByRole('tab', { name: /معلق/ }).click();
  await expect(page.getByTestId('row-quotation-81')).toBeVisible();
  await page.getByTestId('btn-convert-81').click();
  await page.getByRole('tab', { name: 'مقبول' }).click();
  await expect(page.getByTestId('row-quotation-81')).toContainText('مقبول');
  await expect(page.getByTestId('btn-convert-81')).toHaveCount(0);
});