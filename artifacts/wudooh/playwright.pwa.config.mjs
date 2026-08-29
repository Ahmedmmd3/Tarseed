import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

function findSystemChromium() {
  try {
    return execFileSync('sh', ['-lc', 'command -v chromium'], {
      encoding: 'utf8',
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const systemChromium = findSystemChromium();

export default defineConfig({
  testDir: './test',
  testMatch: '**/pwa.e2e.mjs',
  outputDir: '../../.cache/wudooh-pwa-playwright',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:25937',
    trace: 'retain-on-failure',
    ...(systemChromium
      ? { launchOptions: { executablePath: systemChromium } }
      : {}),
  },
  webServer: {
    command: 'PORT=25937 BASE_PATH=/ pnpm run serve',
    url: 'http://127.0.0.1:25937',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});