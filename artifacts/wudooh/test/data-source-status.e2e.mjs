import { expect, test } from '@playwright/test';

const uniqueEmail = () => `source-status-${crypto.randomUUID().slice(0, 8)}@example.test`;

async function registerSharedSession(page) {
  const email = uniqueEmail();
  const password = 'Safe-test-password-123';

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const registration = await page.evaluate(async ({ email, password }) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: `منشأة مصدر البيانات ${email.slice(-13, -5)}`,
        name: 'مالك اختبار مصدر البيانات',
        email,
        password,
      }),
    });
    return { status: response.status, body: await response.text() };
  }, { email, password });

  expect(registration.status, registration.body).toBe(201);
  const payload = JSON.parse(registration.body);
  expect(payload.user).toBeTruthy();
}

test('يبقي الزائر المحلي على بيانات المتصفح عند توقف الخدمة المشتركة', async ({ page }) => {
  const apiRequests = [];

  await page.route('**/api/**', async (route) => {
    apiRequests.push(route.request().url());
    await route.abort('failed');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  const status = page.getByTestId('connection-status-local');
  await expect(status).toBeVisible();
  await expect(status).toContainText('وضع البيانات المحلي');
  await expect(status).toContainText('لن تظهر على الأجهزة أو لأعضاء الفريق');
  await expect(status).toContainText('سجّل الدخول للاتصال بسجل المنشأة المشترك');
  expect(apiRequests).toEqual([]);
});

test('يعرض السجل المشترك بعد إنشاء جلسة حقيقية', async ({ page }) => {
  await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  const status = page.getByTestId('connection-status-remote');
  await expect(status).toBeVisible();
  await expect(status).toContainText('متصل بسجل المنشأة المشترك');
  await expect(status).toContainText('التغييرات محفوظة في الخدمة المشتركة');
  await expect(status).toContainText('تظهر للأجهزة وأعضاء الفريق المصرح لهم');
});

test('يبقي جلسة مشتركة قابلة لإعادة الاتصال عند توقف الخدمة', async ({ page }) => {
  await registerSharedSession(page);
  const apiRequests = [];

  await page.route('**/api/**', async (route) => {
    apiRequests.push(route.request().url());
    await route.abort('failed');
  });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  const status = page.getByTestId('connection-status-local');
  await expect(status).toBeVisible();
  await expect(status).toContainText('تعذر الوصول إلى السجل المشترك');
  await expect(status).toContainText('لن تتم مزامنة التغييرات حتى إعادة الاتصال بالسجل المشترك');
  await expect(page.getByTestId('button-retry-shared-connection')).toBeVisible();
  expect(apiRequests).toHaveLength(1);
  expect(apiRequests[0]).toContain('/api/auth/me');
});