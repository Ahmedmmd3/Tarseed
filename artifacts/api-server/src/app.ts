import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { createHash } from "node:crypto";
import router from "./routes";
import { logger, recordExpiredStripeWebhookSignature } from "./lib/logger";
import { isExpiredStripeSignatureError, processStripeWebhook } from "./lib/stripe-webhooks";

const app: Express = express();
app.set("trust proxy", 1);
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
        await recordExpiredStripeWebhookSignature();
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
  [process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_DOMAINS]
    .filter(Boolean)
    .flatMap((domains) => String(domains).split(","))
    .map((domain) => `https://${domain.trim()}`),
);
type RateLimitRule = { limit: number; windowMs: number };
type PublicAuthRateLimitRule = { byIp: RateLimitRule; byEmail: RateLimitRule };
type RateLimitBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
const loginRule: PublicAuthRateLimitRule = {
  byIp: { limit: 10, windowMs: 15 * 60 * 1000 },
  byEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
};
const passwordResetRule: PublicAuthRateLimitRule = {
  byIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  byEmail: { limit: 3, windowMs: 15 * 60 * 1000 },
};

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
  const rule = request.path === "/auth/login"
    ? loginRule
    : request.path === "/auth/password-reset/request"
      ? passwordResetRule
      : null;
  if (!rule) {
    next();
    return;
  }
  const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
  const byIp = consumeRateLimit(`${request.path}:ip:${request.ip}`, rule.byIp);
  const emailHint = email ? createHash("sha256").update(email).digest("hex").slice(0, 16) : null;
  const byEmail = emailHint
    ? consumeRateLimit(`${request.path}:email:${emailHint}`, rule.byEmail)
    : { limited: false, retryAfterSeconds: 0 };
  if (!byIp.limited && !byEmail.limited) {
    next();
    return;
  }
  response.setHeader("Retry-After", String(Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds)));
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
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || trustedOrigins.has(origin)) {
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
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || !request.cookies?.wudooh_session) {
    next();
    return;
  }
  const origin = request.get("origin");
  if (!origin) {
    response.status(403).json({ error: "يلزم إرسال الطلب من واجهة التطبيق الموثوقة." });
    return;
  }
  const originHost = new URL(origin).host;
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
