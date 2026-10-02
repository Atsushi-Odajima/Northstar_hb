import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { CalendarEvent } from "@shared/types";
import { CalendarEventCreateSchema, CalendarEventUpdateSchema } from "@shared/schemas";
import { parseBody, parseQuery, ws } from "../lib/http";
import { badRequest, notFound } from "../lib/errors";
import { newId, nowIso, bool } from "../lib/util";
import { stripUndefined } from "./goals";

interface Row { id: string; workspace_id: string; source: "ics" | "manual"; uid: string | null; title: string; start_at: string; end_at: string; all_day: number; category: CalendarEvent["category"]; goal_id: string | null; project_id: string | null; created_at: string; updated_at: string }
const map = (r: Row): CalendarEvent => ({ id: r.id, workspaceId: r.workspace_id, source: r.source, uid: r.uid, title: r.title, startAt: r.start_at, endAt: r.end_at, allDay: bool(r.all_day), category: r.category, goalId: r.goal_id, projectId: r.project_id, createdAt: r.created_at, updatedAt: r.updated_at });

export function listEvents(db: Db, wsId: string, fromIso: string, toIso: string): CalendarEvent[] {
  return db.all<Row>("SELECT * FROM calendar_events WHERE workspace_id = ? AND start_at < ? AND end_at >= ? ORDER BY start_at", wsId, toIso, fromIso).map(map);
}
export function createEvent(db: Db, wsId: string, input: z.infer<typeof CalendarEventCreateSchema>, source: "ics" | "manual" = "manual", uid: string | null = null): CalendarEvent {
  if (Number.isNaN(Date.parse(input.startAt)) || Number.isNaN(Date.parse(input.endAt))) throw badRequest("日時が不正です");
  const id = newId(); const now = nowIso();
  db.run("INSERT INTO calendar_events(id, workspace_id, source, uid, title, start_at, end_at, all_day, category, goal_id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, wsId, source, uid, input.title, new Date(input.startAt).toISOString(), new Date(input.endAt).toISOString(), input.allDay, input.category, input.goalId, input.projectId, now, now);
  return map(db.get<Row>("SELECT * FROM calendar_events WHERE id = ?", id)!);
}
export function updateEvent(db: Db, wsId: string, id: string, patch: z.infer<typeof CalendarEventUpdateSchema>): CalendarEvent {
  const r = db.get<Row>("SELECT * FROM calendar_events WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Event");
  const next = { ...map(r), ...stripUndefined(patch) };
  db.run("UPDATE calendar_events SET title=?, start_at=?, end_at=?, all_day=?, category=?, goal_id=?, project_id=?, updated_at=? WHERE id=?", next.title, next.startAt, next.endAt, next.allDay, next.category, next.goalId, next.projectId, nowIso(), id);
  return map(db.get<Row>("SELECT * FROM calendar_events WHERE id = ?", id)!);
}
export function deleteEvent(db: Db, wsId: string, id: string): void {
  if (!db.get("SELECT 1 FROM calendar_events WHERE id = ? AND workspace_id = ?", id, wsId)) throw notFound("Event");
  db.run("DELETE FROM calendar_events WHERE id = ?", id);
}

/** Minimal ICS parser: VEVENT with UID/SUMMARY/DTSTART/DTEND (UTC, floating, TZID or all-day VALUE=DATE). RRULE is not expanded (imported as a single occurrence). */
export function parseIcs(text: string): { uid: string | null; title: string; start: string; end: string; allDay: boolean; recurring: boolean }[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const out: ReturnType<typeof parseIcs> = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const get = (name: string) => { const m = new RegExp(`^${name}(;[^:]*)?:(.*)$`, "m").exec(body); return m ? { params: m[1] ?? "", value: m[2].trim() } : null; };
    const dtstart = get("DTSTART"); const dtend = get("DTEND");
    if (!dtstart) continue;
    const allDay = /VALUE=DATE(?!-TIME)/.test(dtstart.params) || /^\d{8}$/.test(dtstart.value);
    const toIso = (v: string) => {
      if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00.000Z`;
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(v);
      if (!m) return null;
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))).toISOString(); // TZID offsets are not applied (documented limitation)
    };
    const start = toIso(dtstart.value); if (!start) continue;
    const end = dtend ? toIso(dtend.value) ?? start : allDay ? new Date(Date.parse(start) + 86_400_000).toISOString() : new Date(Date.parse(start) + 3_600_000).toISOString();
    out.push({ uid: get("UID")?.value ?? null, title: (get("SUMMARY")?.value ?? "(no title)").replace(/\\,/g, ",").replace(/\\n/g, " "), start, end, allDay, recurring: !!get("RRULE") });
  }
  return out;
}

export function importIcs(db: Db, wsId: string, text: string): { imported: number; updated: number; recurringNotExpanded: number } {
  const events = parseIcs(text);
  if (events.length === 0) throw badRequest("VEVENT が見つかりません");
  let imported = 0, updated = 0, recurring = 0;
  db.transaction(() => {
    for (const e of events) {
      if (e.recurring) recurring++;
      const existing = e.uid ? db.get<{ id: string }>("SELECT id FROM calendar_events WHERE workspace_id = ? AND uid = ?", wsId, e.uid) : null;
      if (existing) { db.run("UPDATE calendar_events SET title=?, start_at=?, end_at=?, all_day=?, updated_at=? WHERE id=?", e.title, e.start, e.end, e.allDay, nowIso(), existing.id); updated++; }
      else { createEvent(db, wsId, { title: e.title, startAt: e.start, endAt: e.end, allDay: e.allDay, category: "unclassified", goalId: null, projectId: null }, "ics", e.uid); imported++; }
    }
    db.run("INSERT INTO connectors(id, workspace_id, type, status, config_json, last_sync_at, created_at, updated_at) VALUES (?, ?, 'ics', 'connected', '{}', ?, ?, ?) ON CONFLICT(workspace_id, type) DO UPDATE SET status = 'connected', last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at", newId(), wsId, nowIso(), nowIso(), nowIso());
  });
  return { imported, updated, recurringNotExpanded: recurring };
}

/** Suggest goal/project links for unclassified events by title word overlap. Suggestions only — never auto-linked. */
export function linkSuggestions(db: Db, wsId: string, events: CalendarEvent[]) {
  const goals = db.all<{ id: string; title: string }>("SELECT id, title FROM goals WHERE workspace_id = ? AND status = 'active'", wsId);
  const projects = db.all<{ id: string; title: string }>("SELECT id, title FROM projects WHERE workspace_id = ? AND status IN ('active','waiting')", wsId);
  const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => [...w].length >= 2));
  return events.filter((e) => e.category === "unclassified").map((e) => {
    const ew = words(e.title);
    const g = goals.filter((x) => [...words(x.title)].some((w) => ew.has(w))).slice(0, 2).map((x) => ({ type: "goal", id: x.id, title: x.title }));
    const p = projects.filter((x) => [...words(x.title)].some((w) => ew.has(w))).slice(0, 2).map((x) => ({ type: "project", id: x.id, title: x.title }));
    return { eventId: e.id, suggestions: [...g, ...p] };
  }).filter((s) => s.suggestions.length);
}

export const calendarRoutes = new Hono<Env>();
calendarRoutes.get("/calendar", (c) => {
  const q = parseQuery(c, z.object({ from: z.string(), to: z.string() }));
  const db = c.get("db"); const wsId = ws(c);
  const events = listEvents(db, wsId, new Date(q.from).toISOString(), new Date(q.to).toISOString());
  return c.json({ events, suggestions: linkSuggestions(db, wsId, events) });
});
calendarRoutes.post("/calendar", async (c) => c.json({ event: createEvent(c.get("db"), ws(c), await parseBody(c, CalendarEventCreateSchema)) }, 201));
calendarRoutes.patch("/calendar/:id", async (c) => c.json({ event: updateEvent(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, CalendarEventUpdateSchema)) }));
calendarRoutes.delete("/calendar/:id", (c) => { deleteEvent(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
calendarRoutes.post("/calendar/import-ics", async (c) => {
  const body = await parseBody(c, z.object({ content: z.string().min(1).max(10_000_000) }));
  return c.json(importIcs(c.get("db"), ws(c), body.content));
});
