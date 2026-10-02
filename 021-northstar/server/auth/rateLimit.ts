// In-memory sliding-window rate limiter (single-process deployments; swap for Redis if clustered).
interface Bucket { hits: number[] }
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; remaining: number; retryAfterMs: number } {
  if (now - lastSweep > 60_000) sweep(now);
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    buckets.set(key, b);
    return { ok: false, remaining: 0, retryAfterMs: windowMs - (now - b.hits[0]) };
  }
  b.hits.push(now);
  buckets.set(key, b);
  return { ok: true, remaining: limit - b.hits.length, retryAfterMs: 0 };
}

function sweep(now: number) {
  lastSweep = now;
  for (const [k, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < 3_600_000);
    if (b.hits.length === 0) buckets.delete(k);
  }
}

export function resetRateLimits(): void { buckets.clear(); }
