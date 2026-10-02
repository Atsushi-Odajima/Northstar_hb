import { defineConfig, devices } from "@playwright/test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;

// Only Chromium is installed in this environment; iOS Safari / Android Chrome are emulated
// (viewport, UA, touch). Real-device verification is tracked in docs/TEST_REPORT.md.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--no-sandbox"], executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (require("node:fs").existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined) },
  },
  webServer: {
    command: `node dist/server/index.mjs`,
    url: `${BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      NORTHSTAR_DB: "./data/e2e.db",
      NORTHSTAR_RESET_DB: "true",
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234567890",
      APP_ORIGIN: BASE,
      ALLOW_SIGNUP: "true",
      AI_PROVIDER_DEFAULT: "mock",
      AUTH_RATE_LIMIT_PER_MIN: "1000", // the E2E matrix signs up ~40 accounts from one IP
    },
  },
  projects: [
    { name: "pc-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 850 } } },
    { name: "iphone", use: { ...devices["iPhone 14"], browserName: "chromium" } },
    { name: "android", use: { ...devices["Pixel 7"], browserName: "chromium" }, testIgnore: /a11y/ },
    { name: "ipad", use: { ...devices["iPad (gen 7)"], browserName: "chromium" }, testIgnore: /a11y/ },
  ],
});
