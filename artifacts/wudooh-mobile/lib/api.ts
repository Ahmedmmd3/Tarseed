export type ApiErrorPayload = { error?: string; code?: string };

const configuredOrigin = process.env.EXPO_PUBLIC_API_ORIGIN?.trim().replace(/\/+$/, '');
const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
export const API_ORIGIN = configuredOrigin || (domain ? `https://${domain}` : '');

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Wudooh-Client', 'mobile');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_ORIGIN}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (!response.ok) {
    const error = new Error(payload.error ?? 'تعذر الاتصال بخدمة ترصيد.');
    Object.assign(error, { status: response.status, code: payload.code });
    throw error;
  }
  return payload;
}

export function operationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}