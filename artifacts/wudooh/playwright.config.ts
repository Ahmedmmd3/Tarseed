import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  outputDir: '../../.cache/wudooh-playwright-e2e',
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: '../../.cache/wudooh-playwright-report', open: 'never' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:25938',
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @workspace/db run push && pnpm --filter @workspace/api-server run build && if [ -n "$PROD_TEST_EMAIL" ] && [ -n "$PROD_TEST_PASSWORD" ]; then pnpm --filter @workspace/api-server run setup:browser-test-account; fi && NODE_ENV=test EMAIL_VERIFICATION_TEST_CODE=654321 PHONE_VERIFICATION_TEST_CODE=246810 PORT=18081 pnpm --filter @workspace/api-server run start',
      url: 'http://127.0.0.1:18081/api/healthz',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'PORT=25938 BASE_PATH=/ API_PROXY_TARGET=http://127.0.0.1:18081 pnpm --filter @workspace/wudooh run dev',
      url: 'http://127.0.0.1:25938',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});