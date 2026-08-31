import { expect, test as base, type Page } from '@playwright/test';
import { authStatePath } from './global-setup';

export const testEmail = process.env.PROD_TEST_EMAIL?.trim() ?? '';
export const testPassword = process.env.PROD_TEST_PASSWORD ?? '';
export const authenticatedTestsAvailable = Boolean(testEmail && testPassword);

export function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function loginThroughUi(page: Page) {
  await page.goto('/');
  const width = page.viewportSize()?.width ?? 1280;
  if (width < 640) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
    await page.getByTestId('button-mobile-login').click();
  } else {
    await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
  }
  await page.getByTestId('input-auth-email').fill(testEmail);
  await page.getByTestId('input-auth-password').fill(testPassword);
  await page.getByTestId('button-auth-submit').click();
  await expect(page).toHaveURL(/\/manager$/);
}

type Fixtures = { authenticatedPage: Page };

export const test = base.extend<Fixtures>({
  authenticatedPage: async ({ browser }, use) => {
    base.skip(!authenticatedTestsAvailable, 'اعتماد حساب اختبار المتصفح غير متاح.');
    const context = await browser.newContext({ storageState: authStatePath });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };