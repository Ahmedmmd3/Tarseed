import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.e2e.mjs',
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
      command: 'PORT=8081 pnpm --filter @workspace/api-server run dev',
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