import { expect, test } from '@playwright/test';

async function activateServiceWorker(page) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'سجّل الدخول للوصول إلى مساحة العمل' })).toBeVisible();

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

async function getCachedUrls(page) {
  return page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cachedRequests = await Promise.all(
      cacheNames.map(async (cacheName) => {
        const cache = await caches.open(cacheName);
        return cache.keys();
      }),
    );
    return cachedRequests.flat().map((request) => request.url);
  });
}

test('يتحكم Service Worker بنسخة الإنتاج ويعيد shell لوحة التحكم دون شبكة', async ({ page }) => {
  await activateServiceWorker(page);

  const serviceWorkerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      registrationScope: registration.scope,
    };
  });
  expect(serviceWorkerState.controller).toMatch(/\/sw\.js$/);
  expect(serviceWorkerState.registrationScope).toBe(new URL('/', page.url()).href);

  const cachedUrlsBeforeOffline = await getCachedUrls(page);
  expect(cachedUrlsBeforeOffline.some((url) => new URL(url).pathname.startsWith('/api/'))).toBe(false);

  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: 'سجّل الدخول للوصول إلى مساحة العمل' })).toBeVisible();
});

test('يتحقق من manifest وstart_url وأيقونات نسخة الإنتاج', async ({ page, request }) => {
  await activateServiceWorker(page);

  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');

  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe('ترصيد — إدارة أعمالك بوضوح');
  expect(manifest.short_name).toBe('ترصيد');
  expect(manifest.display).toBe('standalone');
  expect(manifest.scope).toBe('./');
  expect(new URL(manifest.start_url, manifestResponse.url()).pathname).toBe('/dashboard');
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

  for (const icon of manifest.icons) {
    expect(icon.src).toBeTruthy();
    expect(icon.type).toBe('image/png');
    expect(icon.sizes).toMatch(/^\d+x\d+$/);

    const iconResponse = await request.get(new URL(icon.src, manifestResponse.url()).href);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()['content-type']).toContain('image/png');
  }

  const cachedUrls = await getCachedUrls(page);
  expect(cachedUrls.some((url) => new URL(url).pathname.startsWith('/api/'))).toBe(false);
});