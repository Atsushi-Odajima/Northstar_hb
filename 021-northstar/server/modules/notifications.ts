import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Notification, NotificationSettings } from "@shared/types";
import { PushSubscriptionSchema } from "@shared/schemas";
import { todayIn, timeIn, weekStart, addDays } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { newId, nowIso } from "../lib/util";
import { getWorkspace } from "./workspace";
import { config } from "../config";
import { log } from "../lib/log";

interface NRow { id: string; workspace_id: string; kind: string; dedupe_key: string; title: string; body: string; link: string; scheduled_for: string; delivered_at: string | null; read_at: string | null; created_at: string }
const mapN = (r: NRow): Notification => ({ id: r.id, workspaceId: r.workspace_id, kind: r.kind, dedupeKey: r.dedupe_key, title: r.title, body: r.body, link: r.link, scheduledFor: r.scheduled_for, deliveredAt: r.delivered_at, readAt: r.read_at, createdAt: r.created_at });

export function inQuietHours(hhmm: string, s: Pick<NotificationSettings, "quietHoursStart" | "quietHoursEnd">): boolean {
  const { quietHoursStart: a, quietHoursEnd: b } = s;
  if (a === b) return false;
  return a < b ? hhmm >= a && hhmm < b : hhmm >= a || hhmm < b;
}

/** Creates a notification once per dedupe key (UNIQUE constraint → INSERT OR IGNORE). Returns true when newly created. */
export function enqueue(db: Db, wsId: string, n: { kind: string; dedupeKey: string; title: string; body?: string; link?: string; scheduledFor?: string }): boolean {
  const r = db.run("INSERT OR IGNORE INTO notifications(id, workspace_id, kind, dedupe_key, title, body, link, scheduled_for, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    newId(), wsId, n.kind, n.dedupeKey, n.title, n.body ?? "", n.link ?? "", n.scheduledFor ?? nowIso(), nowIso());
  return r.changes > 0;
}

/** Generates due notifications for one workspace at `now`. Idempotent. */
export function generateForWorkspace(db: Db, wsId: string, now = new Date()): number {
  const settings = getWorkspace(db, wsId).settings;
  const s = settings.notifications;
  const tz = settings.timezone;
  const date = todayIn(tz, now);
  const hhmm = timeIn(tz, now);
  const quiet = inQuietHours(hhmm, s);
  const scheduledFor = quiet ? "quiet" : now.toISOString();
  let created = 0;
  const add = (kind: string, key: string, title: string, body = "", link = "") => { if (enqueue(db, wsId, { kind, dedupeKey: key, title, body, link, scheduledFor: scheduledFor === "quiet" ? now.toISOString() : scheduledFor })) created++; };
  if (quiet) return 0; // nothing is generated during quiet hours; it will be generated at the first tick afterwards (same dedupe keys)

  if (s.morningBrief && hhmm >= s.morningBriefTime) {
    const focus = db.get<{ one_thing_title: string }>("SELECT one_thing_title FROM daily_focus WHERE workspace_id = ? AND date = ?", wsId, date);
    const big3 = db.get<{ n: number }>("SELECT COUNT(*) n FROM big3_items WHERE workspace_id = ? AND week_start = ? AND status = 'open'", wsId, weekStart(date))?.n ?? 0;
    add("morning_brief", `morning:${date}`, "Morning Brief", focus?.one_thing_title ? `今日の One Thing: ${focus.one_thing_title}` : `今日の One Thing を決めましょう（Big 3 残り ${big3}）`, "/today");
  }
  if (s.eveningReflection && hhmm >= s.eveningReflectionTime) add("evening_reflection", `evening:${date}`, "Evening Reflection", "今日、North Star に向けて進んだことを30秒で記録", "/reviews/daily");
  if (s.weeklyReview) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === s.weeklyReviewDay && hhmm >= s.weeklyReviewTime) add("weekly_review", `weekly:${weekStart(date)}`, "CEO Meeting with Yourself", "今週の Weekly Review の時間です", "/reviews/weekly");
  }
  if (s.decisionReviews) {
    for (const d of db.all<{ id: string; title: string; review_date: string }>("SELECT id, title, review_date FROM decisions WHERE workspace_id = ? AND status = 'open' AND review_date IS NOT NULL AND review_date <= ?", wsId, date))
      add("decision_review", `decision:${d.id}:${d.review_date}`, "Decision Review の時期です", d.title, `/decisions/${d.id}`);
  }
  if (s.followUps) {
    for (const f of db.all<{ id: string; reason: string; due_date: string; name: string }>("SELECT f.id, f.reason, f.due_date, p.name FROM follow_ups f JOIN people p ON p.id = f.person_id WHERE f.workspace_id = ? AND f.status = 'open' AND f.due_date <= ?", wsId, date))
      add("follow_up", `followup:${f.id}:${f.due_date}`, `Follow-up: ${f.name}`, f.reason, `/people/${f.id}`);
  }
  if (s.promises) {
    for (const p of db.all<{ id: string; text: string; due_date: string; name: string }>("SELECT pr.id, pr.text, pr.due_date, p.name FROM promises pr JOIN people p ON p.id = pr.person_id WHERE pr.workspace_id = ? AND pr.status = 'open' AND pr.direction = 'mine' AND pr.due_date IS NOT NULL AND pr.due_date <= ?", wsId, addDays(date, 1)))
      add("promise", `promise:${p.id}:${p.due_date}`, `約束の期限: ${p.name}`, p.text, "/people");
  }
  return created;
}

export function runNotificationJob(db: Db, now = new Date()): { workspaces: number; created: number; pushed: number } {
  let created = 0, pushed = 0;
  const wsIds = db.all<{ id: string }>("SELECT id FROM workspaces").map((r) => r.id);
  for (const wsId of wsIds) {
    try {
      created += generateForWorkspace(db, wsId, now);
      pushed += deliverPending(db, wsId);
    } catch (e) { log("error", "notification.job.failed", { wsId, message: (e as Error).message }); }
  }
  return { workspaces: wsIds.length, created, pushed };
}

/** Marks pending notifications delivered (in-app) and sends Web Push when configured. */
export function deliverPending(db: Db, wsId: string): number {
  const pending = db.all<NRow>("SELECT * FROM notifications WHERE workspace_id = ? AND delivered_at IS NULL AND scheduled_for <= ?", wsId, nowIso());
  if (pending.length === 0) return 0;
  const settings = getWorkspace(db, wsId).settings.notifications;
  let pushed = 0;
  for (const n of pending) {
    db.run("UPDATE notifications SET delivered_at = ? WHERE id = ?", nowIso(), n.id);
    if (settings.webPush && config.vapidPublicKey && config.vapidPrivateKey) {
      void sendWebPush(db, wsId, mapN(n)).then((k) => { pushed += k; });
    }
  }
  return pushed;
}

async function sendWebPush(db: Db, wsId: string, n: Notification): Promise<number> {
  const subs = db.all<{ id: string; endpoint: string; keys_json: string }>("SELECT id, endpoint, keys_json FROM push_subscriptions WHERE workspace_id = ?", wsId);
  if (subs.length === 0) return 0;
  const webpush = await import("web-push");
  webpush.default.setVapidDetails(config.vapidSubject || "mailto:admin@example.com", config.vapidPublicKey, config.vapidPrivateKey);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.default.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, JSON.stringify({ title: n.title, body: n.body.slice(0, 120), link: n.link }), { TTL: 3600 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) db.run("DELETE FROM push_subscriptions WHERE id = ?", s.id);
      log("warn", "push.failed", { status });
    }
  }
  return sent;
}

export function listNotifications(db: Db, wsId: string, unreadOnly = false, limit = 50): Notification[] {
  return db.all<NRow>(`SELECT * FROM notifications WHERE workspace_id = ? AND delivered_at IS NOT NULL ${unreadOnly ? "AND read_at IS NULL" : ""} ORDER BY scheduled_for DESC LIMIT ?`, wsId, limit).map(mapN);
}

export const notificationRoutes = new Hono<Env>();
notificationRoutes.get("/notifications", (c) => {
  const q = parseQuery(c, z.object({ unread: z.string().optional(), limit: z.coerce.number().int().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  deliverPending(db, wsId);
  const list = listNotifications(db, wsId, q.unread === "1", q.limit ?? 50);
  const unread = db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE workspace_id = ? AND delivered_at IS NOT NULL AND read_at IS NULL", wsId)?.n ?? 0;
  return c.json({ notifications: list, unread });
});
notificationRoutes.post("/notifications/run", (c) => { const db = c.get("db"); const wsId = ws(c); const created = generateForWorkspace(db, wsId); deliverPending(db, wsId); return c.json({ created }); });
notificationRoutes.post("/notifications/:id/read", (c) => { c.get("db").run("UPDATE notifications SET read_at = ? WHERE id = ? AND workspace_id = ? AND read_at IS NULL", nowIso(), c.req.param("id"), ws(c)); return c.json({ ok: true }); });
notificationRoutes.post("/notifications/read-all", (c) => { c.get("db").run("UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL", nowIso(), ws(c)); return c.json({ ok: true }); });
notificationRoutes.get("/push/vapid-public-key", (c) => c.json({ publicKey: config.vapidPublicKey || null, configured: !!(config.vapidPublicKey && config.vapidPrivateKey) }));
notificationRoutes.post("/push/subscribe", async (c) => {
  const body = await parseBody(c, PushSubscriptionSchema);
  c.get("db").run("INSERT INTO push_subscriptions(id, workspace_id, endpoint, keys_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json, workspace_id = excluded.workspace_id", newId(), ws(c), body.endpoint, JSON.stringify(body.keys), nowIso());
  return c.json({ ok: true }, 201);
});
notificationRoutes.delete("/push/subscribe", async (c) => {
  const body = await parseBody(c, z.object({ endpoint: z.string() }));
  c.get("db").run("DELETE FROM push_subscriptions WHERE endpoint = ? AND workspace_id = ?", body.endpoint, ws(c));
  return c.json({ ok: true });
});
