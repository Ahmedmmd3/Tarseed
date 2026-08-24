import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { createHash } from "node:crypto";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", 1);
const trustedOrigins = new Set(
  [process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_DOMAINS]
    .filter(Boolean)
    .flatMap((domains) => String(domains).split(","))
    .map((domain) => `https://${domain.trim()}`),
);
type RateLimitRule = { limit: number; windowMs: number };
type RateLimitBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
const loginRule: RateLimitRule = { limit: 10, windowMs: 15 * 60 * 1000 };
const passwordResetRule: RateLimitRule = { limit: 5, windowMs: 15 * 60 * 1000 };

function consumeRateLimit(key: string, rule: RateLimitRule): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (rateLimitBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
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
  const emailHint = email ? createHash("sha256").update(email).digest("hex").slice(0, 16) : "none";
  const byIp = consumeRateLimit(`${request.path}:ip:${request.ip}`, rule);
  const byEmail = consumeRateLimit(`${request.path}:email:${emailHint}`, rule);
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

export default app;
