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

async function verifyAttachmentsAndTransfers(page) {
  const marker = crypto.randomUUID().slice(0, 8);
  const description = `فحص متصفح ${marker}`;
  let journalId = null;

  await page.goto('/journals', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('page-journals')).toBeVisible();
  await page.getByTestId('button-add-journal').click();
  await page.getByTestId('input-journal-desc').fill(description);
  await page.getByTestId('select-journal-account-0').selectOption({ index: 1 });
  await page.getByTestId('input-journal-debit-0').fill('1');
  await page.getByTestId('select-journal-account-1').selectOption({ index: 2 });
  await page.getByTestId('input-journal-credit-1').fill('1');
  await page.getByTestId('button-submit-journal').click();

  const journalCard = page.locator('[data-testid^="card-journal-"]').filter({ hasText: description });
  await expect(journalCard).toBeVisible();
  journalId = (await journalCard.getAttribute('data-testid'))?.replace('card-journal-', '') ?? null;
  expect(journalId).toBeTruthy();

  try {
    await page.getByTestId(`button-attachments-journal-${journalId}`).click();
    const attachmentName = `browser-smoke-${marker}.pdf`;
    await page.getByTestId(`input-attachment-journalEntries-${journalId}`).setInputFiles({
      name: attachmentName,
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4\n% browser smoke ${marker}\n%%EOF\n`),
    });
    await expect(page.getByText(attachmentName)).toBeVisible();

    const downloadLink = page.locator('[data-testid^="link-download-attachment-"]');
    const attachmentId = (await downloadLink.getAttribute('data-testid'))?.replace('link-download-attachment-', '');
    expect(attachmentId).toBeTruthy();
    const attachmentDownload = page.waitForEvent('download');
    await downloadLink.click();
    expect((await attachmentDownload).suggestedFilename()).toBe(attachmentName);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`button-delete-attachment-${attachmentId}`).click();
    await expect(page.getByText(attachmentName)).toHaveCount(0);
    const attachmentDialog = page.getByRole('dialog', { name: /مرفقات القيد/ });
    await attachmentDialog.getByRole('button', { name: 'Close' }).click();
    await expect(attachmentDialog).toBeHidden();

    await page.getByTestId('button-transfer-journalEntries').click();
    const exportDownload = page.waitForEvent('download');
    await page.getByTestId('button-export-journalEntries').click();
    expect((await exportDownload).suggestedFilename()).toBe('journalEntries.csv');

    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await page.getByTestId('input-import-journalEntries').setInputFiles({
      name: `journal-preview-${marker}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{
        date: new Date().toISOString().slice(0, 10),
        description: `معاينة استيراد ${marker}`,
        status: 'draft',
        lines: [
          { accountId: 1, debit: 1, credit: 0 },
          { accountId: 2, debit: 0, credit: 1 },
        ],
        clientOperationId: `browser-preview-${marker}`,
      }])),
    });
    await page.getByRole('button', { name: 'تحقق من الملف' }).click();
    await expect(page.getByText('الملف صالح للمراجعة. 1 سجل جاهز للاستيراد.')).toBeVisible();
    await expect(page.getByTestId('button-commit-import-journalEntries')).toBeEnabled();
  } finally {
    if (journalId) {
      const session = await page.request.get('/api/auth/me');
      const payload = await session.json();
      const generation = payload?.user?.dataGeneration;
      const cleanup = await page.request.delete(`/api/data/journalEntries/${journalId}`, {
        headers: {
          Origin: new URL(page.url()).origin,
          ...(generation === undefined ? {} : { 'X-Wudooh-Data-Generation': String(generation) }),
        },
      });
      expect(cleanup.ok()).toBeTruthy();
    }
  }
}

test('يسجل الدخول ويفحص التقارير والمرفقات والاستيراد والتصدير', async ({ page }) => {
  await loginThroughUi(page);
  await verifyAccountingReportTabs(page);
  await verifyAttachmentsAndTransfers(page);
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