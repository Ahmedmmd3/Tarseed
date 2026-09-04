import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { createHash } from "node:crypto";
import router from "./routes";
import { dispatchStripeWebhookSecurityAlert, logger, recordExpiredStripeWebhookSignature } from "./lib/logger";
import { isExpiredStripeSignatureError, processStripeWebhook } from "./lib/stripe-webhooks";
import { normalizeSaudiPhone } from "./lib/team-auth";

const app: Express = express();
app.use(
  helmet({
    // The API does not serve executable browser resources. Keep the existing
    // restrictive API CSP below instead of Helmet's browser-oriented defaults.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    frameguard: { action: "deny" },
    hsts: process.env.NODE_ENV === "production"
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
  }),
);
// The API service is reached by Replit's shared proxy over the local loopback
// connection configured by artifact.toml. Trust only that exact peer; a hop
// count would also trust a client that connects directly and supplies its own
// X-Forwarded-For header. Requests from any other peer use the socket address,
// so forged forwarding headers cannot evade the auth rate limit.
const trustedProxyAddresses = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);
app.set("trust proxy", (address: string) => trustedProxyAddresses.has(address));
app.disable("x-powered-by");

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (request, response) => {
  const signature = request.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: "طلب webhook غير صالح." });
    return;
  }
  try {
    await processStripeWebhook(request.body, signature);
    response.json({ received: true });
  } catch (error) {
    const expiredSignature = isExpiredStripeSignatureError(error);
    if (expiredSignature) {
      try {
        const metric = await recordExpiredStripeWebhookSignature();
        if (metric.alertTriggered) {
          dispatchStripeWebhookSecurityAlert({
            rejectionReason: "expired_signature",
            attemptsInWindow: metric.attemptsInWindow,
            windowSeconds: metric.windowSeconds,
            windowStartedAt: metric.windowStartedAt,
          });
        }
      } catch {
        logger.error(
          { errorType: "ExpiredSignatureMetricPersistenceError" },
          "Unable to persist expired Stripe webhook signature metric",
        );
      }
    }
    logger.warn(
      { errorType: expiredSignature ? "ExpiredSignature" : "WebhookProcessingError" },
      "Stripe webhook processing failed",
    );
    response.status(400).json({ error: "تعذر التحقق من حدث الدفع." });
  }
});
const trustedOrigins = new Set(
  [process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_DOMAINS, process.env.REPLIT_EXPO_DEV_DOMAIN]
    .filter(Boolean)
    .flatMap((domains) => String(domains).split(","))
    .map((domain) => `https://${domain.trim()}`),
);
type RateLimitRule = { limit: number; windowMs: number };
type PublicAuthRateLimitRule = { byIp: RateLimitRule; byIdentity: RateLimitRule };
type RateLimitBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
const loginRule: PublicAuthRateLimitRule = {
  byIp: { limit: 10, windowMs: 15 * 60 * 1000 },
  byIdentity: { limit: 5, windowMs: 15 * 60 * 1000 },
};
const passwordResetRule: PublicAuthRateLimitRule = {
  byIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  byIdentity: { limit: 3, windowMs: 15 * 60 * 1000 },
};
const verificationRule: PublicAuthRateLimitRule = {
  byIp: { limit: 10, windowMs: 15 * 60 * 1000 },
  byIdentity: { limit: 5, windowMs: 15 * 60 * 1000 },
};
const purchaseOrderShareDecisionRule: PublicAuthRateLimitRule = {
  byIp: { limit: 20, windowMs: 15 * 60 * 1000 },
  byIdentity: { limit: 10, windowMs: 15 * 60 * 1000 },
};
const preSessionAuthPaths = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/email-verification/verify",
  "/api/auth/email-verification/resend",
  "/api/auth/phone-verification/verify",
  "/api/auth/phone-verification/resend",
  "/api/platform-auth/login",
]);

function consumeRateLimit(key: string, rule: RateLimitRule): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (rateLimitBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
    if (rateLimitBuckets.size > 10_000) {
      rateLimitBuckets.delete(rateLimitBuckets.keys().next().value as string);
    }
  }
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return { limited: bucket.count > rule.limit, retryAfterSeconds };
}

function publicAuthRateLimit(request: express.Request, response: express.Response, next: express.NextFunction): void {
  if (request.method !== "POST") {
    next();
    return;
  }
  const isPurchaseOrderShareDecision = /^\/purchase-order-shares\/[A-Za-z0-9_-]{40,64}\/decision$/.test(request.path);
  const rule = isPurchaseOrderShareDecision
    ? purchaseOrderShareDecisionRule
    : request.path === "/auth/login" || request.path === "/platform-auth/login"
    ? loginRule
    : request.path === "/auth/register"
      ? verificationRule
    : request.path === "/auth/phone-change/request"
      ? verificationRule
    : request.path === "/auth/password-reset/request"
      ? passwordResetRule
    : request.path === "/auth/email-verification/verify"
        || request.path === "/auth/email-verification/resend"
        || request.path === "/auth/phone-verification/verify"
        || request.path === "/auth/phone-verification/resend"
        ? verificationRule
      : null;
  if (!rule) {
    next();
    return;
  }
  const identityValues = [
    typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "",
    typeof request.body?.phone === "string" ? normalizeSaudiPhone(request.body.phone) ?? "" : "",
    typeof request.body?.identifier === "string" ? request.body.identifier.trim().toLowerCase() : "",
    typeof request.body?.username === "string" ? request.body.username.trim().toLowerCase() : "",
    typeof request.params?.token === "string" ? request.params.token : "",
  ];
  const byIp = consumeRateLimit(`${request.path}:ip:${request.ip}`, rule.byIp);
  const identityLimits = [...new Set(identityValues.filter(Boolean))].map((identity) => {
    const identityHint = createHash("sha256").update(identity).digest("hex").slice(0, 16);
    return consumeRateLimit(`${request.path}:identity:${identityHint}`, rule.byIdentity);
  });
  const byIdentity = identityLimits.reduce(
    (current, next) => ({
      limited: current.limited || next.limited,
      retryAfterSeconds: Math.max(current.retryAfterSeconds, next.retryAfterSeconds),
    }),
    { limited: false, retryAfterSeconds: 0 },
  );
  if (!byIp.limited && !byIdentity.limited) {
    next();
    return;
  }
  response.setHeader("Retry-After", String(Math.max(byIp.retryAfterSeconds, byIdentity.retryAfterSeconds)));
  response.status(429).json({ error: "تم تجاوز عدد المحاولات المسموح. انتظر قليلاً ثم أعد المحاولة." });
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((_request, response, next) => {
  response.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  response.setHeader("Cache-Control", "no-store");
  next();
});
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    const isLocalDevelopmentOrigin = process.env.NODE_ENV !== "production"
      && /^http:\/\/localhost(?::\d+)?$/.test(origin ?? "");
    if (!origin || trustedOrigins.has(origin) || isLocalDevelopmentOrigin) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  const hasSession = Boolean(request.cookies?.wudooh_session || request.cookies?.wudooh_super_admin_session);
  const normalizedPath = request.path.replace(/\/+$/, "") || "/";
  const isPublicPurchaseOrderSharePath = /^\/api\/purchase-order-shares\/[A-Za-z0-9_-]{40,64}(?:\/decision)?$/.test(normalizedPath);
  if (!hasSession && !preSessionAuthPaths.has(normalizedPath) && !isPublicPurchaseOrderSharePath) {
    next();
    return;
  }
  const origin = request.get("origin");
  if (!origin) {
    response.status(403).json({ error: "يلزم إرسال الطلب من واجهة التطبيق الموثوقة." });
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    response.status(403).json({ error: "مصدر الطلب غير موثوق." });
    return;
  }
  if (originHost !== request.get("host")) {
    response.status(403).json({ error: "مصدر الطلب غير موثوق." });
    return;
  }
  next();
});

app.use("/api", publicAuthRateLimit, router);

app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction): void => {
  logger.error({ err: error }, "Unhandled API request error");
  if (response.headersSent) {
    next(error);
    return;
  }
  response.status(500).json({ error: "تعذر إتمام الطلب حالياً. حاول لاحقاً." });
});

export default app;
