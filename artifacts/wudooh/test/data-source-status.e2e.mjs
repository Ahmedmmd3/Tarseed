import { expect, test } from '@playwright/test';

async function registerSharedSession(page) {
  const uniqueId = crypto.randomUUID().slice(0, 8);
  const email = `source-status-${uniqueId}@example.test`;
  const phone = `05${BigInt(`0x${uniqueId}`).toString().slice(-8).padStart(8, '0')}`;
  const password = 'Safe-test-password-123';
  const projectName = `منشأة مصدر البيانات ${uniqueId}`;

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const registration = await page.evaluate(async ({ email, phone, password, projectName }) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName,
        name: 'مالك اختبار مصدر البيانات',
        email,
        phone,
        password,
      }),
    });
    return { status: response.status, body: await response.text() };
  }, { email, phone, password, projectName });

  expect(registration.status, registration.body).toBe(202);
  const emailVerification = await page.evaluate(async ({ email }) => {
    const response = await fetch('/api/auth/email-verification/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '654321' }),
    });
    return { status: response.status, body: await response.text() };
  }, { email });
  expect(emailVerification.status, emailVerification.body).toBe(200);

  const phoneVerification = await page.evaluate(async ({ email }) => {
    const response = await fetch('/api/auth/phone-verification/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '246810' }),
    });
    return { status: response.status, body: await response.text() };
  }, { email });
  expect(phoneVerification.status, phoneVerification.body).toBe(200);
  expect(JSON.parse(phoneVerification.body).user).toBeTruthy();
  return { email, projectName };
}

async function submitJournal(page, { description, debitAccountId, creditAccountId, amount }) {
  await page.getByTestId('button-add-journal').click();
  await page.getByTestId('input-journal-desc').fill(description);
  await page.getByTestId('select-journal-account-0').selectOption(debitAccountId);
  await page.getByTestId('input-journal-debit-0').fill(String(amount));
  await page.getByTestId('select-journal-account-1').selectOption(creditAccountId);
  await page.getByTestId('input-journal-credit-1').fill(String(amount));
  await page.getByTestId('button-submit-journal').click();
}

async function getSharedRequestHeaders(page, apiOrigin) {
  const response = await page.request.get(`${apiOrigin}/api/auth/me`, {
    headers: { Origin: apiOrigin },
  });
  const payload = await response.json();
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
  expect(payload.user?.dataGeneration).toBeTruthy();
  return {
    Origin: apiOrigin,
    'X-Wudooh-Data-Generation': String(payload.user.dataGeneration),
  };
}

async function triggerSharedDataReload(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('wudooh:stale-data-generation'));
  });
}

test('يبقي الزائر المحلي على بيانات المتصفح عند توقف الخدمة المشتركة', async ({ page }) => {
  const apiRequests = [];

  await page.route('**/api/**', async (route) => {
    apiRequests.push(route.request().url());
    await route.abort('failed');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('authentication-required-message')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'سجّل الدخول للوصول إلى مساحة العمل' })).toBeVisible();
  await expect(page.getByTestId('link-sign-in')).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test('يعرض السجل المشترك بعد إنشاء جلسة حقيقية', async ({ page }) => {
  await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  const status = page.getByTestId('connection-status-remote');
  await expect(status).toBeVisible();
  await expect(status).toContainText('متصل بسجل المنشأة المشترك');
  await expect(status).toContainText('التغييرات محفوظة وتظهر للأجهزة وأعضاء الفريق المصرح لهم');
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
  await expect(status).toContainText('التغييرات محفوظة وتظهر للأجهزة وأعضاء الفريق المصرح لهم');
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

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('shared-account-bar')).toHaveCount(0);
  await expect(page.getByTestId('authentication-required-message')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'سجّل الدخول للوصول إلى مساحة العمل' })).toBeVisible();
});

test('يبقي جلسة مشتركة قابلة لإعادة الاتصال عند توقف الخدمة', async ({ page }) => {
  await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const apiRequests = [];

  await page.route('**/api/**', async (route) => {
    apiRequests.push(route.request().url());
    await route.abort('failed');
  });
  await triggerSharedDataReload(page);

  const status = page.getByTestId('connection-status-local');
  await expect(status).toBeVisible();
  await expect(status).toContainText('غير متصل بالسجل المشترك');
  await expect(status).toContainText('نعرض البيانات المحفوظة محلياً');
  await expect(page.getByTestId('button-retry-shared-connection')).toBeVisible();
  expect(apiRequests).toHaveLength(1);
  expect(apiRequests[0]).toContain('/api/auth/me');
});

test('يستعيد السجل المشترك بعد عودة الخدمة دون فقدان القيد السابق', async ({ page }) => {
  const session = await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const apiOrigin = 'http://127.0.0.1:8081';
  const requestHeaders = await getSharedRequestHeaders(page, apiOrigin);
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
  await triggerSharedDataReload(page);

  const localStatus = page.getByTestId('connection-status-local');
  await expect(localStatus).toBeVisible();
  await expect(localStatus).toContainText('غير متصل بالسجل المشترك');
  await expect(page.getByTestId(`card-journal-${journal.id}`)).toContainText(journal.description);

  await page.unroute('**/api/**');
  await page.getByTestId('button-retry-shared-connection').click();

  await expect(page.getByTestId('connection-status-remote')).toBeVisible();
  await expect(page.getByTestId('connection-status-remote')).toContainText('متصل بسجل المنشأة المشترك');
  await expect(page.getByTestId('shared-account-bar')).toContainText(session.projectName);
  await expect(page.getByTestId('shared-account-bar')).toContainText(session.email);
  await expect(page.getByTestId(`card-journal-${journal.id}`)).toContainText(journal.description);
});

test('يرسل القيد الذي أُنشئ أثناء الانقطاع بعد عودة السجل المشترك', async ({ page }) => {
  await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const apiOrigin = 'http://127.0.0.1:8081';
  const requestHeaders = await getSharedRequestHeaders(page, apiOrigin);
  const uniqueId = crypto.randomUUID().slice(0, 8);
  const accounts = await Promise.all([
    { code: `901${uniqueId.slice(0, 3)}`, name: `حساب مدين ${uniqueId}`, type: 'asset' },
    { code: `902${uniqueId.slice(0, 3)}`, name: `حساب دائن ${uniqueId}`, type: 'revenue' },
  ].map(async (account) => {
    const response = await page.request.post(`${apiOrigin}/api/data/accounts`, {
      headers: requestHeaders,
      data: { ...account, parent: null, balance: 0, status: 'active' },
    });
    const payload = await response.json();
    if (!response.ok() || !payload.record) {
      throw new Error(`تعذر إنشاء حساب الاختبار: ${JSON.stringify(payload)}`);
    }
    return String(payload.record.id);
  }));

  await page.goto('/journals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  await page.route('**/api/**', async (route) => {
    await route.abort('failed');
  });
  await triggerSharedDataReload(page);
  await expect(page.getByTestId('connection-status-local')).toContainText('غير متصل بالسجل المشترك');

  const description = `قيد محفوظ أثناء الانقطاع ${uniqueId}`;
  await submitJournal(page, { description, debitAccountId: accounts[0], creditAccountId: accounts[1], amount: 125 });

  await expect(page.getByTestId('page-journals')).toContainText(description);
  await expect(page.getByTestId('sync-queue-status')).toContainText('1 عملية محفوظة محلياً');

  await page.unroute('**/api/**');
  await page.route('**/api/data/journalEntries', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByTestId('button-retry-shared-connection').click();

  await expect(page.getByTestId('connection-status-remote')).toBeVisible();
  await expect(page.getByTestId('page-journals')).toContainText(description);
  await expect(page.getByTestId('sync-queue-status')).toContainText('تعذرت مزامنة 1 من 1 عملية');

  await page.unroute('**/api/data/journalEntries');
  await page.getByTestId('button-retry-sync-queue').click();

  await expect(page.getByTestId('sync-queue-status')).toHaveCount(0);

  const journalsResponse = await page.request.get(`${apiOrigin}/api/data/journalEntries`, { headers: requestHeaders });
  const journalsPayload = await journalsResponse.json();
  expect(journalsResponse.ok(), JSON.stringify(journalsPayload)).toBeTruthy();
  expect(journalsPayload.records.filter((journal) => journal.description === description)).toHaveLength(1);

  const committedBeforeDropDescription = `قيد حفظ قبل فقدان الاستجابة ${uniqueId}`;
  await page.route('**/api/data/journalEntries', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await submitJournal(page, {
    description: committedBeforeDropDescription,
    debitAccountId: accounts[0],
    creditAccountId: accounts[1],
    amount: 50,
  });
  await expect(page.getByTestId('connection-status-local')).toBeVisible();
  await expect(page.getByTestId('page-journals')).toContainText(committedBeforeDropDescription);

  await page.unroute('**/api/data/journalEntries');
  await page.getByTestId('button-retry-shared-connection').click();
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const noResponseRetry = await page.request.get(`${apiOrigin}/api/data/journalEntries`, { headers: requestHeaders });
  const noResponseRetryPayload = await noResponseRetry.json();
  expect(noResponseRetry.ok(), JSON.stringify(noResponseRetryPayload)).toBeTruthy();
  expect(noResponseRetryPayload.records.filter((journal) => journal.description === committedBeforeDropDescription)).toHaveLength(1);

  const droppedRequestDescription = `قيد حفظ بعد إسقاط الطلب ${uniqueId}`;
  await page.route('**/api/data/journalEntries', async (route) => {
    if (route.request().method() === 'POST') {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await submitJournal(page, {
    description: droppedRequestDescription,
    debitAccountId: accounts[0],
    creditAccountId: accounts[1],
    amount: 60,
  });
  await expect(page.getByTestId('connection-status-local')).toBeVisible();
  await expect(page.getByTestId('page-journals')).toContainText(droppedRequestDescription);

  await page.unroute('**/api/data/journalEntries');
  await page.getByTestId('button-retry-shared-connection').click();
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const droppedRequestRetry = await page.request.get(`${apiOrigin}/api/data/journalEntries`, { headers: requestHeaders });
  const droppedRequestRetryPayload = await droppedRequestRetry.json();
  expect(droppedRequestRetry.ok(), JSON.stringify(droppedRequestRetryPayload)).toBeTruthy();
  expect(droppedRequestRetryPayload.records.filter((journal) => journal.description === droppedRequestDescription)).toHaveLength(1);

  const concurrentDescription = `قيد متزامن آمن ${uniqueId}`;
  const clientOperationId = crypto.randomUUID();
  const concurrentPayload = {
    clientOperationId,
    date: '2026-08-23',
    description: concurrentDescription,
    status: 'draft',
    lines: [
      { id: 'concurrent-debit', accountId: accounts[0], debit: 75, credit: 0 },
      { id: 'concurrent-credit', accountId: accounts[1], debit: 0, credit: 75 },
    ],
  };
  const concurrentResponses = await Promise.all([
    page.request.post(`${apiOrigin}/api/data/journalEntries`, { headers: requestHeaders, data: concurrentPayload }),
    page.request.post(`${apiOrigin}/api/data/journalEntries`, { headers: requestHeaders, data: concurrentPayload }),
  ]);
  expect(concurrentResponses.map((response) => response.status()).sort()).toEqual([200, 201]);

  const afterConcurrentResponse = await page.request.get(`${apiOrigin}/api/data/journalEntries`, { headers: requestHeaders });
  const afterConcurrentPayload = await afterConcurrentResponse.json();
  expect(afterConcurrentResponse.ok(), JSON.stringify(afterConcurrentPayload)).toBeTruthy();
  expect(afterConcurrentPayload.records.filter((journal) => journal.description === concurrentDescription)).toHaveLength(1);
});

test('يحفظ ترحيل القيد محلياً ويعيد المحاولة بمعرّف العملية نفسه عند فقدان الاستجابة', async ({ page }) => {
  await registerSharedSession(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();

  const apiOrigin = 'http://127.0.0.1:8081';
  const requestHeaders = await getSharedRequestHeaders(page, apiOrigin);
  const uniqueId = crypto.randomUUID().slice(0, 8);
  const accounts = await Promise.all([
    { code: `911${uniqueId.slice(0, 3)}`, name: `حساب ترحيل مدين ${uniqueId}`, type: 'asset' },
    { code: `912${uniqueId.slice(0, 3)}`, name: `حساب ترحيل دائن ${uniqueId}`, type: 'revenue' },
  ].map(async (account) => {
    const response = await page.request.post(`${apiOrigin}/api/data/accounts`, {
      headers: requestHeaders,
      data: { ...account, parent: null, balance: 0, status: 'active' },
    });
    const payload = await response.json();
    if (!response.ok() || !payload.record) {
      throw new Error(`تعذر إنشاء حساب اختبار الترحيل: ${JSON.stringify(payload)}`);
    }
    return String(payload.record.id);
  }));

  const journalResponse = await page.request.post(`${apiOrigin}/api/data/journalEntries`, {
    headers: requestHeaders,
    data: {
      date: '2026-08-23',
      description: `قيد اختبار الترحيل ${uniqueId}`,
      status: 'draft',
      lines: [
        { id: `post-debit-${uniqueId}`, accountId: accounts[0], debit: 125, credit: 0 },
        { id: `post-credit-${uniqueId}`, accountId: accounts[1], debit: 0, credit: 125 },
      ],
    },
  });
  const journalPayload = await journalResponse.json();
  if (!journalResponse.ok() || !journalPayload.record) {
    throw new Error(`تعذر إنشاء قيد اختبار الترحيل: ${JSON.stringify(journalPayload)}`);
  }
  const journalId = String(journalPayload.record.id);

  await page.goto('/journals', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId(`card-journal-${journalId}`)).toContainText(`قيد اختبار الترحيل ${uniqueId}`);

  const operationIds = [];
  let dropNextResponse = true;
  await page.route(`**/api/data/journalEntries/${journalId}`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    operationIds.push(route.request().headers()['idempotency-key']);
    if (dropNextResponse) {
      dropNextResponse = false;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.getByTestId(`button-post-${journalId}`).click();
  await expect(page.getByTestId('connection-status-local')).toContainText('غير متصل بالسجل المشترك');
  await expect(page.getByTestId(`card-journal-${journalId}`)).toContainText('مرحّل');
  await expect(page.getByTestId('sync-queue-status')).toContainText('تعذرت مزامنة 1 من 1 عملية');

  await page.getByTestId('button-retry-shared-connection').click();
  await expect(page.getByTestId('connection-status-remote')).toBeVisible();
  await expect(page.getByTestId('sync-queue-status')).toHaveCount(0);
  expect(operationIds).toHaveLength(2);
  expect(operationIds[0]).toBeTruthy();
  expect(operationIds[1]).toBe(operationIds[0]);

  const savedJournalResponse = await page.request.get(`${apiOrigin}/api/data/journalEntries`, { headers: requestHeaders });
  const savedJournalPayload = await savedJournalResponse.json();
  expect(savedJournalResponse.ok(), JSON.stringify(savedJournalPayload)).toBeTruthy();
  const savedJournals = savedJournalPayload.records.filter((journal) => String(journal.id) === journalId);
  expect(savedJournals).toHaveLength(1);
  expect(savedJournals[0].status).toBe('posted');
});