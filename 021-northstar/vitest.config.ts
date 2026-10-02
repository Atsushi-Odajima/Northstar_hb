import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@shared": path.resolve(import.meta.dirname, "shared") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
    env: { NODE_ENV: "test", SESSION_SECRET: "test-secret-test-secret-test-secret-123456", NORTHSTAR_DB: ":memory:" },
  },
});
