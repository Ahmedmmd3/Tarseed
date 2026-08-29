import { pathToFileURL } from 'node:url';
import { request } from '@playwright/test';

function requireCredential(value, name, required) {
  if (value) return value;
  if (required) {
    throw new Error(`${name} is missing. Configure the browser test account secret before running this check.`);
  }
  return null;
}

function configuredBaseUrl(config) {
  const explicit = process.env.BROWSER_ACCOUNT_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const projectBaseUrl = config?.projects?.find((project) => project.use?.baseURL)?.use?.baseURL;
  return typeof projectBaseUrl === 'string' ? projectBaseUrl.replace(/\/+$/, '') : 'http://127.0.0.1:25936';
}

export async function verifyBrowserTestAccount(config) {
  const required = process.env.PROD_TEST_REQUIRED === '1';
  const email = requireCredential(process.env.PROD_TEST_EMAIL?.trim(), 'PROD_TEST_EMAIL', required);
  const password = requireCredential(process.env.PROD_TEST_PASSWORD, 'PROD_TEST_PASSWORD', required);
  if (!email || !password) return;

  const baseURL = configuredBaseUrl(config);
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: new URL(baseURL).origin },
  });
  let loggedIn = false;
  try {
    const login = await api.post('/api/auth/login', {
      data: { identifier: email, password },
    });
    if (!login.ok()) {
      throw new Error(`Browser test account login preflight failed with HTTP ${login.status()}.`);
    }
    loggedIn = true;

    const session = await api.get('/api/auth/me');
    if (!session.ok()) {
      throw new Error(`Browser test account session preflight failed with HTTP ${session.status()}.`);
    }
    const payload = await session.json();
    if (!payload?.user || payload.user.status !== 'active') {
      throw new Error('Browser test account is not active.');
    }
    if (payload.user.subscription?.accessActive !== true) {
      throw new Error('Browser test account subscription is not active.');
    }
    process.stdout.write('Browser test account login preflight passed.\n');
  } finally {
    if (loggedIn) {
      await api.post('/api/auth/logout').catch(() => undefined);
    }
    await api.dispose();
  }
}

export default verifyBrowserTestAccount;

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await verifyBrowserTestAccount();
}