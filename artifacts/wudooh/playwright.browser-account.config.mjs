import { defineConfig } from '@playwright/test';

const baseURL = process.env.BROWSER_ACCOUNT_BASE_URL?.trim();
if (!baseURL) {
  throw new Error('BROWSER_ACCOUNT_BASE_URL is required for the published browser-account smoke test.');
}

export default defineConfig({
  testDir: './test',
  testMatch: 'browser-test-account.e2e.mjs',
  outputDir: '../../.cache/wudooh-browser-account-playwright',
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
});