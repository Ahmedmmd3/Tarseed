import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const trustedOrigins = new Set(
  [process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_DOMAINS]
    .filter(Boolean)
    .flatMap((domains) => String(domains).split(","))
    .map((domain) => `https://${domain.trim()}`),
);

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
app.use(express.json());
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

app.use("/api", router);

export default app;
