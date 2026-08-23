import { expect, test } from '@playwright/test';

async function registerSharedSession(page) {
  const uniqueId = crypto.randomUUID().slice(0, 8);
  const email = `source-status-${uniqueId}@example.test`;
  const password = 'Safe-test-password-123';
  const projectName = `منشأة مصدر البيانات ${uniqueId}`;

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const registration = await page.evaluate(async ({ email, password, projectName }) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName,
        name: 'مالك اختبار مصدر البيانات',
        email,
        password,
      }),
    });
    return { status: response.status, body: await response.text() };
  }, { email, password, projectName });

  expect(registration.status, registration.body).toBe(201);
  const payload = JSON.parse(registration.body);
  expect(payload.user).toBeTruthy();
  return { email, projectName };
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

test('يبقي شريط الحساب والسجل المشترك بعد تحديث لوحة التحكم', async ({ page }) => {
  const session = await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('shared-account-bar')).toContainText(session.projectName);
  await expect(page.getByTestId('shared-account-bar')).toContainText(session.email);
  await expect(page.getByTestId('connection-status-remote')).toContainText('متصل بسجل المنشأة المشترك');

  await page.reload({ waitUntil: 'domcontentloaded' });

  const accountBar = page.getByTestId('shared-account-bar');
  const status = page.getByTestId('connection-status-remote');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(accountBar).toBeVisible();
  await expect(accountBar).toContainText(session.projectName);
  await expect(accountBar).toContainText(session.email);
  await expect(status).toBeVisible();
  await expect(status).toContainText('متصل بسجل المنشأة المشترك');
  await expect(status).toContainText('التغييرات محفوظة في الخدمة المشتركة');
});

test('ينتقل إلى الوضع المحلي برسالة عربية عند رفض الجلسة', async ({ page }) => {
  await registerSharedSession(page);

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'غير مصرح لك بالوصول.' }),
    });
  });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  const status = page.getByTestId('connection-status-local');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('shared-account-bar')).toHaveCount(0);
  await expect(status).toBeVisible();
  await expect(status).toContainText('وضع البيانات المحلي');
  await expect(status).toContainText('التغييرات محفوظة في هذا المتصفح فقط');
  await expect(status).toContainText('سجّل الدخول للاتصال بسجل المنشأة المشترك');
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

test('يستعيد السجل المشترك بعد عودة الخدمة دون فقدان القيد السابق', async ({ page }) => {
  const session = await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const apiOrigin = 'http://127.0.0.1:8081';
  const requestHeaders = { Origin: apiOrigin };
  const accountResponse = await page.request.post(`${apiOrigin}/api/data/accounts`, {
      headers: requestHeaders,
      data: {
        code: '1001',
        name: 'حساب اختبار الاستعادة',
        type: 'asset',
        parent: null,
        balance: 0,
        status: 'active',
      },
  });
  const accountPayload = await accountResponse.json();
  if (!accountResponse.ok() || !accountPayload.record) {
    throw new Error(`تعذر إنشاء حساب الاختبار: ${JSON.stringify(accountPayload)}`);
  }

  const accountId = String(accountPayload.record.id);
  const journalResponse = await page.request.post(`${apiOrigin}/api/data/journalEntries`, {
    headers: requestHeaders,
    data: {
        date: '2026-08-23',
        description: 'قيد محفوظ قبل انقطاع الخدمة',
        status: 'draft',
        lines: [
          { id: 'restore-debit', accountId, debit: 125, credit: 0 },
          { id: 'restore-credit', accountId: '1', debit: 0, credit: 125 },
        ],
      },
  });
  const journalPayload = await journalResponse.json();
  if (!journalResponse.ok() || !journalPayload.record) {
    throw new Error(`تعذر إنشاء قيد الاختبار: ${JSON.stringify(journalPayload)}`);
  }
  const journal = { id: String(journalPayload.record.id), description: journalPayload.record.description };

  // Refresh once while the service is healthy so the browser's local snapshot
  // contains the record that must remain available during the outage.
  await page.goto('/journals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId(`card-journal-${journal.id}`)).toContainText(journal.description);

  await page.route('**/api/**', async (route) => {
    await route.abort('failed');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  const localStatus = page.getByTestId('connection-status-local');
  await expect(localStatus).toBeVisible();
  await expect(localStatus).toContainText('تعذر الوصول إلى السجل المشترك');
  await expect(page.getByTestId(`card-journal-${journal.id}`)).toContainText(journal.description);

  await page.unroute('**/api/**');
  await page.getByTestId('button-retry-shared-connection').click();

  await expect(page.getByTestId('connection-status-remote')).toBeVisible();
  await expect(page.getByTestId('connection-status-remote')).toContainText('متصل بسجل المنشأة المشترك');
  await expect(page.getByTestId('shared-account-bar')).toContainText(session.projectName);
  await expect(page.getByTestId('shared-account-bar')).toContainText(session.email);
  await expect(page.getByTestId(`card-journal-${journal.id}`)).toContainText(journal.description);
});