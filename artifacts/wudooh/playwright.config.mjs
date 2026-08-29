import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.e2e.mjs',
  testIgnore: '**/pwa.e2e.mjs',
  outputDir: '../../.cache/wudooh-playwright',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:25936',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @workspace/db run push && pnpm --filter @workspace/api-server run build && if [ -n "$PROD_TEST_EMAIL" ] && [ -n "$PROD_TEST_PASSWORD" ]; then pnpm --filter @workspace/api-server run setup:browser-test-account; fi && NODE_ENV=test EMAIL_VERIFICATION_TEST_CODE=654321 PHONE_VERIFICATION_TEST_CODE=246810 PORT=8081 pnpm --filter @workspace/api-server run start',
      url: 'http://127.0.0.1:8081/api/healthz',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'PORT=25936 BASE_PATH=/ API_PROXY_TARGET=http://127.0.0.1:8081 pnpm --filter @workspace/wudooh run dev',
      url: 'http://127.0.0.1:25936',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});