import { expect, test } from '@playwright/test';
import { authenticatedTestsAvailable, loginThroughUi, testEmail, unique } from './fixtures';

test.describe('المصادقة والأمان', () => {
  test('يرفض بيانات الدخول الخاطئة برسالة واضحة', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
    await page.getByTestId('input-auth-email').fill(`missing-${unique('user')}@example.test`);
    await page.getByTestId('input-auth-password').fill('WrongPass123!');
    await page.getByTestId('button-auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText(/غير صحيحة|تعذر/);
  });

  test('لا يعرض HTML مدخلاً كنص تنفيذي في نموذج الدخول', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
    await page.getByTestId('input-auth-email').fill('<img src=x onerror=alert(1)>');
    await page.getByTestId('input-auth-password').fill('WrongPass123!');
    await page.getByTestId('button-auth-submit').click();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });

  test('يحمي واجهات البيانات من الطلبات غير المصادق عليها', async ({ request }) => {
    const response = await request.get('/api/data/customers');
    expect(response.status()).toBe(401);
  });

  test('يسجل الدخول ويخرج من الجلسة عبر الواجهة', async ({ page }) => {
    test.skip(!authenticatedTestsAvailable, `اعتماد ${testEmail || 'الاختبار'} غير متاح.`);
    await loginThroughUi(page);
    await page.getByTestId('button-sign-out').click();
    await expect.poll(async () => {
      const response = await page.request.get('/api/auth/me');
      const payload = await response.json() as { user?: unknown };
      return payload.user ?? null;
    }).toBeNull();
    await page.goto('/dashboard');
    await expect(page.getByTestId('authentication-required-message')).toBeVisible();
  });
});