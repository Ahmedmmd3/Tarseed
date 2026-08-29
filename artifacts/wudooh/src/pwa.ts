export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`;
  void navigator.serviceWorker.register(serviceWorkerUrl, {
    scope: import.meta.env.BASE_URL,
  }).catch((error: unknown) => {
    console.warn('تعذر تفعيل وضع التطبيق التقدمي.', error);
  });
}