import { config } from "../config";
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const threshold = LEVELS[(config.logLevel as Level) in LEVELS ? (config.logLevel as Level) : "info"];

/** Structured logger. Never log record bodies (goals, decisions, people, journal) — ids and counts only. */
export function log(level: Level, msg: string, meta: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;
  if (config.isTest && level !== "error") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line); else console.log(line);
}
