import { request, type FullConfig } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const authStatePath = path.resolve(process.cwd(), '../../.cache/wudooh-e2e-auth.json');

export default async function globalSetup(config: FullConfig) {
  await mkdir(path.dirname(authStatePath), { recursive: true });
  const email = process.env.PROD_TEST_EMAIL?.trim();
  const password = process.env.PROD_TEST_PASSWORD;
  if (!email || !password) {
    await writeFile(authStatePath, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  const baseURL = String(config.projects[0]?.use.baseURL);
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, Referer: `${baseURL}/` },
  });
  const response = await api.post('/api/auth/login', {
    data: { identifier: email, password },
  });
  if (!response.ok()) {
    throw new Error(`تعذر تجهيز جلسة E2E: ${await response.text()}`);
  }
  await api.storageState({ path: authStatePath });
  await api.dispose();
}