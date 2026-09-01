import { createHash, randomBytes } from "node:crypto";

export const PURCHASE_ORDER_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PURCHASE_ORDER_SHARE_EXPIRY_WARNING_MS = 48 * 60 * 60 * 1000;

export function createPurchaseOrderShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPurchaseOrderShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function purchaseOrderShareUrl(request: { get(name: string): string | undefined; protocol: string }, token: string): string {
  const configuredOrigin = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const origin = configuredOrigin || `${forwardedProtocol || request.protocol}://${request.get("host")}`;
  return `${origin}/purchase-order-share/${encodeURIComponent(token)}`;
}
