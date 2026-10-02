import fs from "node:fs";
import path from "node:path";

// Minimal .env loader (no dependency). Real env vars win over .env values.
function loadDotEnv() {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === "production";
const secret = env.SESSION_SECRET ?? "";
if (isProd && secret.length < 32) {
  throw new Error("SESSION_SECRET must be set (>= 32 chars) in production");
}

export const config = {
  env: env.NODE_ENV ?? "development",
  isProd,
  isTest: env.NODE_ENV === "test",
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? "127.0.0.1",
  dbFile: env.NORTHSTAR_DB ?? "./data/northstar.db",
  resetDb: env.NORTHSTAR_RESET_DB === "true",
  sessionSecret: secret || "dev-only-insecure-secret-change-me-0123456789",
  secureCookies: env.SECURE_COOKIES === "true",
  appOrigin: env.APP_ORIGIN ?? "",
  allowSignup: (env.ALLOW_SIGNUP ?? "true") !== "false",
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  aiProviderDefault: env.AI_PROVIDER_DEFAULT ?? "", // "mock" in tests
  vapidPublicKey: env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: env.VAPID_SUBJECT ?? "",
  backupDir: env.BACKUP_DIR ?? "./data/backups",
  logLevel: env.LOG_LEVEL ?? "info",
  sessionDays: 30,
  webDist: env.WEB_DIST ?? path.resolve(process.cwd(), "dist/web"),
  appVersion: "0.1.0",
};
export type Config = typeof config;
