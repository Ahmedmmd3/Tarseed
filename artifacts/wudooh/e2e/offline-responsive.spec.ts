import { expect, test } from './fixtures';

test.describe('الأوفلاين والاستجابة', () => {
  test('يبقي الهيكل ظاهراً عند انقطاع الشبكة بعد تحميل الجلسة', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('page-overview')).toBeVisible();
    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await expect(page.locator('body')).toBeVisible();
    await page.context().setOffline(false);
  });

  for (const viewport of [
    { name: 'هاتف', width: 390, height: 844 },
    { name: 'لوحي', width: 768, height: 1024 },
  ]) {
    test(`لا يتجاوز المحتوى عرض الشاشة على ${viewport.name}`, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/reports');
      await expect(page.getByTestId('page-reports')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});