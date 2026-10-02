// Date / period helpers. All dates are YYYY-MM-DD strings; arithmetic uses UTC so results
// never depend on the host timezone. Week starts on Monday (v1 fixed).
import type { ReviewKind } from "./types";

export interface Period { start: string; end: string } // inclusive

const pad = (n: number) => String(n).padStart(2, "0");

export function isDateString(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

export function toUTC(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** Today's date in a given IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return fromUTC(now);
  }
}

/** Current HH:MM in a timezone. */
export function timeIn(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
  } catch {
    return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  }
}

export function weekStart(date: string): string {
  const d = toUTC(date);
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return fromUTC(d);
}

export function weekPeriod(date: string): Period {
  const start = weekStart(date);
  return { start, end: addDays(start, 6) };
}

export function monthPeriod(date: string): Period {
  const d = toUTC(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: fromUTC(start), end: fromUTC(end) };
}

export function quarterPeriod(date: string): Period {
  const d = toUTC(date);
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0));
  return { start: fromUTC(start), end: fromUTC(end) };
}

export function yearPeriod(date: string): Period {
  const y = toUTC(date).getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function periodFor(kind: ReviewKind, date: string): Period {
  switch (kind) {
    case "daily": return { start: date, end: date };
    case "weekly": return weekPeriod(date);
    case "monthly": return monthPeriod(date);
    case "quarterly": return quarterPeriod(date);
    case "yearly": return yearPeriod(date);
  }
}

export function previousPeriod(kind: ReviewKind, period: Period): Period {
  return periodFor(kind, addDays(period.start, -1));
}

export function isWithin(date: string, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

/** Overlap check for optional date ranges (null = unbounded). */
export function rangesOverlap(aStart: string | null, aEnd: string | null, bStart: string, bEnd: string): boolean {
  if (aStart && aStart > bEnd) return false;
  if (aEnd && aEnd < bStart) return false;
  return true;
}

export function quarterLabel(date: string): string {
  const d = toUTC(date);
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export function monthLabel(date: string): string {
  return date.slice(0, 7);
}

/** ISO timestamp → YYYY-MM-DD in a timezone (for bucketing created_at etc.). */
export function dateOf(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return todayIn(timezone, d);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** UTC offset (minutes) of a timezone at a given instant. */
export function tzOffsetMinutes(timezone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") === 24 ? 0 : get("hour"), get("minute"), get("second"));
    return Math.round((asUTC - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** ISO instant of local midnight at the start of `date` in `timezone`. */
export function zonedDayStartIso(date: string, timezone: string): string {
  const guess = toUTC(date);
  const offset = tzOffsetMinutes(timezone, guess);
  return new Date(guess.getTime() - offset * 60_000).toISOString();
}

/** [startIso, endIsoExclusive) bounds of an inclusive date period in a timezone. */
export function periodBounds(period: Period, timezone: string): { startIso: string; endIso: string } {
  return { startIso: zonedDayStartIso(period.start, timezone), endIso: zonedDayStartIso(addDays(period.end, 1), timezone) };
}
