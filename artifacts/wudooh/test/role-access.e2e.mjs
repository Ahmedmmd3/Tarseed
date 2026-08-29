import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, request as playwrightRequest, test } from '@playwright/test';

const ownerEmail = process.env.PROD_TEST_EMAIL?.trim();
const ownerPassword = process.env.PROD_TEST_PASSWORD;
const credentialsAvailable = Boolean(ownerEmail && ownerPassword);
const credentialsRequired = process.env.PROD_TEST_REQUIRED === '1';
const baseURL = (process.env.BROWSER_ACCOUNT_BASE_URL?.trim() || 'http://127.0.0.1:25936').replace(/\/+$/, '');
const evidenceDirectory = path.resolve(process.cwd(), '../../docs/evidence/role-access');
const runId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const roleAccounts = {
  accountant: {
    name: 'محاسب اختبار الصلاحيات',
    roleId: 'accountant',
    permissions: { dashboard: true, accounting: true, reports: true },
    allowedLinks: ['dashboard', 'accounts', 'journals', 'receivables', 'expenses', 'reports', 'e-invoicing'],
    blockedRoute: '/inventory',
  },
  cashier: {
    name: 'كاشير اختبار الصلاحيات',
    roleId: 'sales',
    permissions: { dashboard: true, sales: true },
    allowedLinks: ['dashboard', 'pos', 'sales', 'e-invoicing'],
    blockedRoute: '/accounts',
  },
  warehouse: {
    name: 'مدير مخزن اختبار الصلاحيات',
    roleId: 'inventory',
    permissions: { dashboard: true, inventory: true },
    allowedLinks: ['dashboard', 'inventory', 'purchases'],
    blockedRoute: '/hr',
  },
  hr: {
    name: 'موارد بشرية اختبار الصلاحيات',
    roleId: 'hr',
    permissions: { dashboard: true, hr: true },
    allowedLinks: ['dashboard', 'hr'],
    blockedRoute: '/pos',
  },
};
const rolePasswords = {};
let ownerContext;
let dataGeneration = 1;

test.skip(!credentialsAvailable && !credentialsRequired, 'PROD_TEST_EMAIL و PROD_TEST_PASSWORD غير متاحين لاختبار المتصفح.');

async function jsonRequest(context, endpoint, options = {}) {
  const response = await context.fetch(endpoint, {
    ...options,
    headers: {
      Origin: new URL(baseURL).origin,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function signIn(context, email, password) {
  const result = await jsonRequest(context, '/api/auth/login', {
    method: 'POST',
    data: { identifier: email, password },
  });
  expect(result.response.ok(), JSON.stringify(result.payload)).toBeTruthy();
  return result.payload.user;
}

async function disableRoleAccounts() {
  if (!ownerContext) return;
  for (const role of Object.keys(roleAccounts)) {
    const account = roleAccounts[role];
    if (!account.id) continue;
    const result = await jsonRequest(ownerContext, `/api/team/members/${account.id}`, {
      method: 'PATCH',
      data: {
        name: account.name,
        email: account.email,
        roleId: account.roleId,
        status: 'inactive',
        permissions: account.permissions,
        locationScope: 'none',
        warehouseIds: account.warehouseIds,
      },
    });
    expect(result.response.status(), `${role}: ${JSON.stringify(result.payload)}`).toBe(200);
    expect(result.payload.member.status, `${role} يجب أن يصبح غير نشط`).toBe('inactive');
  }
}

test.beforeAll(async () => {
  await fs.mkdir(evidenceDirectory, { recursive: true });
  ownerContext = await playwrightRequest.newContext({ baseURL });
  const owner = await signIn(ownerContext, ownerEmail, ownerPassword);
  dataGeneration = owner.dataGeneration;

  for (const [role, account] of Object.entries(roleAccounts)) {
    const password = `Role-access-${role}-${runId}-123`;
    rolePasswords[role] = password;
    const result = await jsonRequest(ownerContext, '/api/team/members', {
      method: 'POST',
      data: {
        name: account.name,
        email: `role-${role}-${runId}@example.test`,
        password,
        roleId: account.roleId,
        status: 'active',
        permissions: account.permissions,
        locationScope: 'none',
        warehouseIds: [],
      },
    });
    expect(result.response.status(), `${role}: ${JSON.stringify(result.payload)}`).toBe(201);
    account.id = result.payload.member.id;
    account.email = result.payload.member.email;
    account.warehouseIds = [];
  }
});

test.afterAll(async () => {
  await disableRoleAccounts();
  await ownerContext?.post('/api/auth/logout').catch(() => undefined);
  await ownerContext?.dispose();
});

async function loginThroughUi(page, account) {
  await page.goto('/');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
  await page.getByTestId('input-auth-email').fill(account.email);
  await page.getByTestId('input-auth-password').fill(rolePasswords[account.key]);
  await page.getByRole('button', { name: 'دخول إلى لوحة التحكم' }).click();
  await expect(page).toHaveURL(/\/manager$/);
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('shared-account-bar')).toContainText(account.name);
}

async function assertVisibleNavigation(page, account) {
  for (const linkName of account.allowedLinks) {
    await expect(page.getByTestId(`link-${linkName}`), `${account.key} يجب أن يرى رابط ${linkName}`).toBeVisible();
  }
  for (const linkName of ['team', 'operations-log']) {
    await expect(page.getByTestId(`link-${linkName}`), `${account.key} لا يجب أن يرى رابط ${linkName}`).toHaveCount(0);
  }
}

for (const [key, account] of Object.entries(roleAccounts)) {
  account.key = key;
  test(`واجهة ${key} تعرض القائمة المسموحة وترفض الرابط المباشر`, async ({ page }) => {
    await loginThroughUi(page, account);
    await assertVisibleNavigation(page, account);

    await page.goto(account.blockedRoute, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('restricted-route-message')).toBeVisible();
    await expect(page.getByTestId('restricted-route-message')).toContainText('هذه الوحدة غير متاحة لحسابك');

    await page.screenshot({
      path: path.join(evidenceDirectory, `${key}-direct-link-rejected.png`),
      fullPage: true,
    });

    const session = await page.request.get('/api/auth/me');
    expect(session.ok()).toBeTruthy();
    const sessionPayload = await session.json();
    expect(sessionPayload.user.roleId).toBe(account.roleId);
    expect(sessionPayload.user.organizationId).toBeGreaterThan(0);
    expect(sessionPayload.user.dataGeneration).toBe(dataGeneration);

  });
}

test('بعد التدقيق تصبح الحسابات الأربعة غير نشطة', async () => {
  await disableRoleAccounts();
  const members = await jsonRequest(ownerContext, '/api/team/members');
  expect(members.response.ok(), JSON.stringify(members.payload)).toBeTruthy();
  const auditedIds = new Set(Object.values(roleAccounts).map((account) => account.id));
  const auditedMembers = members.payload.members.filter((member) => auditedIds.has(member.id));
  expect(auditedMembers).toHaveLength(4);
  expect(auditedMembers.every((member) => member.status === 'inactive')).toBeTruthy();
});