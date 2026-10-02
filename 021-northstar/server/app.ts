import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { Db } from "./db/connection";
import type { Env } from "./context";
import { AppError } from "./lib/errors";
import { log } from "./lib/log";
import { authRoutes } from "./auth/routes";
import { authenticate, csrfGuard, requireWrite } from "./auth/middleware";
import { rateLimit } from "./auth/rateLimit";
import { getUser, getWorkspace, updateWorkspaceSettings } from "./modules/workspace";
import { SettingsUpdateSchema } from "@shared/schemas";
import { parseBody } from "./lib/http";
import { config } from "./config";
import { goalRoutes } from "./modules/goals";
import { registerModuleRoutes } from "./modules/index";
import { mcpRoutes } from "./mcp/http";

export function createApp(db: Db): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: "same-origin",
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    }),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status as 400);
    }
    const anyErr = err as { status?: number; message?: string };
    if (typeof anyErr.status === "number" && anyErr.status >= 400 && anyErr.status < 500) {
      return c.json({ error: { code: "http_error", message: anyErr.message ?? "error", details: null } }, anyErr.status as 400);
    }
    log("error", "unhandled", { path: c.req.path, message: err.message, stack: config.isProd ? undefined : err.stack });
    return c.json({ error: { code: "internal", message: "サーバーエラーが発生しました", details: null } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found", details: null } }, 404));

  app.get("/api/health", (c) => c.json({ ok: true, version: config.appVersion, schema: db.schemaVersion(), time: new Date().toISOString() }));

  // Global per-IP rate limit for the API (generous; protects against runaway clients).
  app.use("/api/*", async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "local";
    const rl = rateLimit(`api:${ip}`, 1200, 60_000);
    if (!rl.ok) return c.json({ error: { code: "rate_limited", message: "リクエストが多すぎます", details: null } }, 429);
    await next();
  });
  app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.use("/api/import/*", bodyLimit({ maxSize: 30 * 1024 * 1024 }));
  app.use("/api/backup/*", bodyLimit({ maxSize: 200 * 1024 * 1024 }));
  app.use("/api/*", csrfGuard);

  app.route("/api/auth", authRoutes);

  const api = new Hono<Env>();
  api.use("*", authenticate, requireWrite);

  api.get("/me", (c) => {
    const auth = c.get("auth");
    return c.json({ user: getUser(db, auth.userId), workspace: getWorkspace(db, auth.workspaceId), via: auth.via, scopes: auth.scopes });
  });

  api.patch("/settings", async (c) => {
    const body = await parseBody(c, SettingsUpdateSchema);
    const { name, ...settings } = body;
    const workspace = updateWorkspaceSettings(db, c.get("auth").workspaceId, { name, settings: settings as never });
    return c.json({ workspace });
  });

  api.route("/", goalRoutes);
  registerModuleRoutes(api);

  app.route("/api", api);
  app.route("/mcp", mcpRoutes(db));
  return app;
}
