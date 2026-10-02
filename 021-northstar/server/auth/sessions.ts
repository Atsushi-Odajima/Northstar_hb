import type { Db } from "../db/connection";
import { newId, nowIso, randomToken, sha256 } from "../lib/util";
import { config } from "../config";

export const SESSION_COOKIE = "ns_session";

export interface SessionRecord { id: string; userId: string; expiresAt: string }

export function createSession(db: Db, userId: string, userAgent = ""): { token: string; expiresAt: string } {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
  db.run(
    "INSERT INTO sessions(id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    sha256(token), userId, nowIso(), expiresAt, nowIso(), userAgent.slice(0, 200),
  );
  return { token, expiresAt };
}

export function findSession(db: Db, token: string): SessionRecord | null {
  const row = db.get<{ id: string; user_id: string; expires_at: string; last_seen_at: string }>(
    "SELECT id, user_id, expires_at, last_seen_at FROM sessions WHERE id = ?", sha256(token),
  );
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    db.run("DELETE FROM sessions WHERE id = ?", row.id);
    return null;
  }
  // Sliding expiry: refresh at most once per hour.
  if (Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
    const expiresAt = new Date(Date.now() + config.sessionDays * 86_400_000).toISOString();
    db.run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", nowIso(), expiresAt, row.id);
  }
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

export function deleteSession(db: Db, token: string): void {
  db.run("DELETE FROM sessions WHERE id = ?", sha256(token));
}

export function deleteAllSessions(db: Db, userId: string): void {
  db.run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export function purgeExpiredSessions(db: Db): number {
  return db.run("DELETE FROM sessions WHERE expires_at < ?", nowIso()).changes;
}

export const ids = { newId };
