import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { config } from "./config";
import { openDatabase } from "./db/connection";
import { createApp } from "./app";
import { log } from "./lib/log";
import type { Env } from "./context";
import { runNotificationJob } from "./modules/notifications";
import { purgeExpiredSessions } from "./auth/sessions";

const db = openDatabase(config.dbFile, { reset: config.resetDb });
const app = createApp(db);

// ---- static web app (production / E2E) ----
const webDist = config.webDist;
if (fs.existsSync(path.join(webDist, "index.html"))) {
  const indexHtml = fs.readFileSync(path.join(webDist, "index.html"), "utf8");
  const relRoot = path.relative(process.cwd(), webDist) || ".";
  const staticApp = new Hono<Env>();
  staticApp.use(
    "/*",
    serveStatic({
      root: relRoot,
      onFound: (p, c) => {
        if (p.includes("/assets/")) c.header("Cache-Control", "public, max-age=31536000, immutable");
        else c.header("Cache-Control", "no-cache");
      },
    }),
  );
  // SPA fallback for navigations
  staticApp.get("*", (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/mcp")) return c.notFound();
    if (/\.[a-z0-9]{2,8}$/i.test(c.req.path)) return c.notFound(); // missing asset → 404, not index.html
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });
  app.route("/", staticApp);
} else {
  log("warn", "web dist not found; API only", { webDist });
}

// ---- background jobs (single process) ----
if (!config.isTest || process.env.NORTHSTAR_JOBS === "true") {
  const tick = () => {
    try { const r = runNotificationJob(db); if (r.created) log("info", "notifications.generated", r); } catch (e) { log("error", "job.notifications", { message: (e as Error).message }); }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, 60_000).unref();
  setInterval(() => { try { purgeExpiredSessions(db); } catch { /* ignore */ } }, 6 * 3_600_000).unref();
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log("info", "northstar.listening", { host: info.address, port: info.port, db: config.dbFile, env: config.env });
});

const shutdown = () => {
  log("info", "northstar.shutdown");
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
