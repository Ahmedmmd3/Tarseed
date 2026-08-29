import { expect, test } from '@playwright/test';

const testEmail = process.env.PROD_TEST_EMAIL?.trim();
const testPassword = process.env.PROD_TEST_PASSWORD;
const credentialsAvailable = Boolean(testEmail && testPassword);
const credentialsRequired = process.env.PROD_TEST_REQUIRED === '1';

test.skip(!credentialsAvailable && !credentialsRequired, 'Replit browser test account secrets are not available in this environment.');

function requireCredential(value, name) {
  if (!value) {
    throw new Error(`${name} is missing. Configure the browser test account in Replit Secrets.`);
  }
  return value;
}

async function loginThroughUi(page) {
  const email = requireCredential(testEmail, 'PROD_TEST_EMAIL');
  const password = requireCredential(testPassword, 'PROD_TEST_PASSWORD');

  await page.goto('/');
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await page.getByRole('button', { name: 'فتح القائمة' }).click();
    await page.getByTestId('button-mobile-login').click();
  } else {
    await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
  }
  await page.getByTestId('input-auth-email').fill(email);
  await page.getByTestId('input-auth-password').fill(password);
  await page.getByRole('button', { name: 'دخول إلى لوحة التحكم' }).click();

  try {
    await page.waitForURL('**/manager', { timeout: 10_000 });
  } catch {
    const error = await page.getByTestId('auth-error').textContent().catch(() => null);
    throw new Error(`Browser test account could not log in through the UI${error ? `: ${error}` : '.'}`);
  }

  await page.goto('/reports', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('page-reports')).toBeVisible();
}

async function verifyAccountingReportTabs(page) {
  await expect(page.getByTestId('tab-report-reconciliation')).toBeVisible();
  await expect(page.getByTestId('tab-report-aging')).toBeVisible();

  await page.getByTestId('tab-report-aging').click();
  await expect(page.getByText('أعمار الذمم المدينة (العملاء)')).toBeVisible();
  await expect(page.getByTestId('input-aging-date')).toBeVisible();

  await page.getByTestId('tab-report-reconciliation').click();
  await expect(page.getByText('إنشاء جلسة تسوية جديدة')).toBeVisible();
}

test('يسجل الدخول بحساب الاختبار ويفتح تقارير التسوية والأعمار على سطح المكتب', async ({ page }) => {
  await loginThroughUi(page);
  await verifyAccountingReportTabs(page);
});

test.describe('عرض تقارير المحاسبة على الهاتف', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('يعرض تبويبي التسوية والأعمار دون خروج عن الشاشة', async ({ page }) => {
    await loginThroughUi(page);
    await verifyAccountingReportTabs(page);

    const reportsPage = page.getByTestId('page-reports');
    const reportsBox = await reportsPage.boundingBox();
    expect(reportsBox?.width).toBeLessThanOrEqual(390);
  });
});