import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Big3Item, DailyFocus } from "@shared/types";
import { BIG3_MAX } from "@shared/types";
import { Big3CreateSchema, Big3UpdateSchema, DailyFocusSchema } from "@shared/schemas";
import { big3CanAdd, nextFreeRank } from "@shared/rules";
import { todayIn, weekStart, weekPeriod, addDays, periodBounds } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { badRequest, conflict, notFound } from "../lib/errors";
import { newId, nowIso } from "../lib/util";
import { logActivity } from "./activity";
import { getWorkspace } from "./workspace";
import { listGoals, goalView, northStars, ancestors, getGoal } from "./goals";
import { listActions, actionView, getAction } from "./actions";
import { listFollowUps, listPromises } from "./people";
import { listDecisions } from "./decisions";
import { relationsOf } from "./relations";
import { stripUndefined } from "./goals";

interface Big3Row { id: string; workspace_id: string; week_start: string; rank: number; title: string; goal_id: string | null; project_id: string | null; action_id: string | null; status: Big3Item["status"]; created_at: string; updated_at: string }
const mapBig3 = (r: Big3Row): Big3Item => ({ id: r.id, workspaceId: r.workspace_id, weekStart: r.week_start, rank: r.rank as 1 | 2 | 3, title: r.title, goalId: r.goal_id, projectId: r.project_id, actionId: r.action_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
export interface Big3View extends Big3Item { goalTitle: string | null; projectTitle: string | null }

export function big3ForWeek(db: Db, wsId: string, week: string): Big3View[] {
  return db.all<Big3Row>("SELECT * FROM big3_items WHERE workspace_id = ? AND week_start = ? ORDER BY rank", wsId, week).map(mapBig3).map((b) => ({
    ...b,
    goalTitle: b.goalId ? db.get<{ title: string }>("SELECT title FROM goals WHERE id = ?", b.goalId)?.title ?? null : null,
    projectTitle: b.projectId ? db.get<{ title: string }>("SELECT title FROM projects WHERE id = ?", b.projectId)?.title ?? null : null,
  }));
}
function getBig3(db: Db, wsId: string, id: string): Big3Item {
  const r = db.get<Big3Row>("SELECT * FROM big3_items WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Big 3 item");
  return mapBig3(r);
}
export function addBig3(db: Db, wsId: string, input: z.infer<typeof Big3CreateSchema>): Big3Item {
  const week = weekStart(input.weekStart);
  const existing = big3ForWeek(db, wsId, week);
  const can = big3CanAdd(existing);
  if (!can.ok) throw conflict(can.reason!, { max: BIG3_MAX });
  const rank = input.rank && !existing.some((e) => e.rank === input.rank && e.status !== "dropped") ? input.rank : nextFreeRank(existing);
  if (!rank) throw conflict(`Weekly Big 3 は最大${BIG3_MAX}件です`);
  if (input.goalId && !db.get("SELECT 1 FROM goals WHERE id = ? AND workspace_id = ?", input.goalId, wsId)) throw badRequest("Goal が見つかりません");
  if (input.projectId && !db.get("SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?", input.projectId, wsId)) throw badRequest("Project が見つかりません");
  if (input.actionId) getAction(db, wsId, input.actionId);
  const id = newId(); const now = nowIso();
  db.transaction(() => {
    // free the rank if a dropped item holds it
    db.run("DELETE FROM big3_items WHERE workspace_id = ? AND week_start = ? AND rank = ? AND status = 'dropped'", wsId, week, rank);
    db.run("INSERT INTO big3_items(id, workspace_id, week_start, rank, title, goal_id, project_id, action_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)", id, wsId, week, rank, input.title, input.goalId, input.projectId, input.actionId, now, now);
  });
  return getBig3(db, wsId, id);
}
export function updateBig3(db: Db, wsId: string, id: string, patch: z.infer<typeof Big3UpdateSchema>): Big3Item {
  const cur = getBig3(db, wsId, id);
  const next = { ...cur, ...stripUndefined(patch) } as Big3Item;
  if (patch.rank && patch.rank !== cur.rank) {
    const clash = db.get<{ id: string }>("SELECT id FROM big3_items WHERE workspace_id = ? AND week_start = ? AND rank = ? AND id <> ?", wsId, cur.weekStart, patch.rank, id);
    if (clash) db.run("UPDATE big3_items SET rank = ? WHERE id = ?", cur.rank, clash.id); // swap
  }
  db.transaction(() => {
    db.run("UPDATE big3_items SET title=?, goal_id=?, project_id=?, action_id=?, rank=?, status=?, updated_at=? WHERE id=?", next.title, next.goalId, next.projectId, next.actionId, next.rank, next.status, nowIso(), id);
    if (next.status === "done" && cur.status !== "done") {
      logActivity(db, wsId, "action", id, "big3.done", next.title);
      if (next.actionId) db.run("UPDATE actions SET status = 'done', done_at = COALESCE(done_at, ?), updated_at = ? WHERE id = ? AND status <> 'done'", nowIso(), nowIso(), next.actionId);
    }
  });
  return getBig3(db, wsId, id);
}
export function deleteBig3(db: Db, wsId: string, id: string): void {
  getBig3(db, wsId, id);
  db.run("DELETE FROM big3_items WHERE id = ? AND workspace_id = ?", id, wsId);
}

interface DailyRow { id: string; workspace_id: string; date: string; one_thing_title: string; action_id: string | null; goal_id: string | null; why: string; notes: string; created_at: string; updated_at: string }
const mapDaily = (r: DailyRow): DailyFocus => ({ id: r.id, workspaceId: r.workspace_id, date: r.date, oneThingTitle: r.one_thing_title, actionId: r.action_id, goalId: r.goal_id, why: r.why, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at });
export function dailyFocus(db: Db, wsId: string, date: string): DailyFocus | null {
  const r = db.get<DailyRow>("SELECT * FROM daily_focus WHERE workspace_id = ? AND date = ?", wsId, date);
  return r ? mapDaily(r) : null;
}
export function setDailyFocus(db: Db, wsId: string, input: z.infer<typeof DailyFocusSchema>): DailyFocus {
  if (input.goalId) getGoal(db, wsId, input.goalId);
  if (input.actionId) getAction(db, wsId, input.actionId);
  const now = nowIso();
  db.run(
    `INSERT INTO daily_focus(id, workspace_id, date, one_thing_title, action_id, goal_id, why, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, date) DO UPDATE SET one_thing_title = excluded.one_thing_title, action_id = excluded.action_id, goal_id = excluded.goal_id, why = excluded.why, notes = excluded.notes, updated_at = excluded.updated_at`,
    newId(), wsId, input.date, input.oneThingTitle, input.actionId, input.goalId, input.why, input.notes, now, now,
  );
  return dailyFocus(db, wsId, input.date)!;
}

/** Today view: next things to look at, not everything. */
export function todayView(db: Db, wsId: string, date: string) {
  const settings = getWorkspace(db, wsId).settings;
  const week = weekStart(date);
  const big3 = big3ForWeek(db, wsId, week);
  const focus = dailyFocus(db, wsId, date);
  const dueActions = listActions(db, wsId, { status: ["open"], kind: ["task", "follow_up"], due: "today" }, date).map((a) => actionView(db, a));
  const overdue = listActions(db, wsId, { status: ["open"], kind: ["task", "follow_up"], due: "overdue" }, date).map((a) => actionView(db, a)).slice(0, 10);
  const big3Actions = big3.filter((b) => b.actionId && b.status === "open").map((b) => actionView(db, getAction(db, wsId, b.actionId!)));
  const followUps = listFollowUps(db, wsId, { status: "open", dueBy: date });
  const promisesMine = listPromises(db, wsId, { status: "open", direction: "mine" }).filter((p) => !p.dueDate || p.dueDate <= addDays(date, 3));
  const waiting = listActions(db, wsId, { status: ["open"], kind: ["waiting"] }, date).map((a) => actionView(db, a)).slice(0, 10);
  const decisionReviews = listDecisions(db, wsId, { dueBy: date }).map((d) => ({ id: d.id, title: d.title, reviewDate: d.reviewDate, decidedAt: d.decidedAt }));
  const ns = northStars(db, wsId).map((g) => goalView(db, wsId, g, date));
  const stalledNorthStars = ns.filter((g) => ["stalled", "no_signal", "activity_without_outcome"].includes(g.health.health));
  const bounds = periodBounds({ start: date, end: date }, settings.timezone);
  const calendar = db.all<{ id: string; title: string; start_at: string; end_at: string; all_day: number; category: string }>("SELECT id, title, start_at, end_at, all_day, category FROM calendar_events WHERE workspace_id = ? AND start_at >= ? AND start_at < ? ORDER BY start_at", wsId, bounds.startIso, bounds.endIso)
    .map((e) => ({ id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at, allDay: !!e.all_day, category: e.category }));
  const inboxCount = db.get<{ n: number }>("SELECT COUNT(*) n FROM captures WHERE workspace_id = ? AND status = 'inbox'", wsId)?.n ?? 0;
  const knowledgeToApply = db.all<{ id: string; title: string; next_action: string }>("SELECT id, title, next_action FROM knowledge_items WHERE workspace_id = ? AND status IN ('captured','processed') AND next_action <> '' ORDER BY captured_at DESC LIMIT 3", wsId)
    .map((k) => ({ id: k.id, title: k.title, nextAction: k.next_action }));
  const antiGoals = db.all<{ id: string; text: string }>("SELECT id, text FROM principles WHERE workspace_id = ? AND kind = 'anti_goal' AND active = 1 AND (period_start IS NULL OR period_start <= ?) AND (period_end IS NULL OR period_end >= ?)", wsId, date, date);
  return {
    date, weekStart: week, weekPeriod: weekPeriod(date),
    oneThing: focus, big3, big3Actions, dueActions, overdue, followUps, promisesMine, waiting, decisionReviews,
    northStars: ns.map((g) => ({ id: g.id, title: g.title, level: g.level, progress: g.progress, health: g.health })),
    stalledNorthStars: stalledNorthStars.map((g) => ({ id: g.id, title: g.title, health: g.health })),
    calendar, inboxCount, knowledgeToApply, antiGoals,
  };
}

/** Focus Mode: only what is needed to execute the One Thing. */
export function focusMode(db: Db, wsId: string, date: string) {
  const focus = dailyFocus(db, wsId, date);
  if (!focus) return { focus: null };
  const action = focus.actionId ? actionView(db, getAction(db, wsId, focus.actionId)) : null;
  const goalId = focus.goalId ?? action?.goalId ?? null;
  const goal = goalId ? goalView(db, wsId, getGoal(db, wsId, goalId), date) : null;
  const chain = goalId ? ancestors(db, wsId, goalId) : [];
  const rel = goalId ? relationsOf(db, wsId, "goal", goalId) : [];
  const knowledge = rel.filter((r) => r.type === "knowledge").slice(0, 5);
  const people = rel.filter((r) => r.type === "person").slice(0, 5);
  const nextActions = goalId ? listActions(db, wsId, { status: ["open"], goalId, limit: 5 }, date).map((a) => actionView(db, a)) : [];
  return { focus, action, goal, why: focus.why || goal?.why || "", chain, knowledge, people, nextActions };
}

export const focusRoutes = new Hono<Env>();
focusRoutes.get("/focus/week", (c) => {
  const q = parseQuery(c, z.object({ date: z.string().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  const week = weekStart(q.date ?? today);
  const prev = big3ForWeek(db, wsId, addDays(week, -7)).filter((b) => b.status === "open");
  const ns = northStars(db, wsId).map((g) => ({ id: g.id, title: g.title, level: g.level }));
  const activeGoals = listGoals(db, wsId, { status: ["active"] }).filter((g) => g.level !== "vision").map((g) => ({ id: g.id, title: g.title, level: g.level }));
  return c.json({ weekStart: week, period: weekPeriod(week), items: big3ForWeek(db, wsId, week), carryOver: prev, northStars: ns, goals: activeGoals, max: BIG3_MAX });
});
focusRoutes.post("/focus/big3", async (c) => c.json({ item: addBig3(c.get("db"), ws(c), await parseBody(c, Big3CreateSchema)) }, 201));
focusRoutes.patch("/focus/big3/:id", async (c) => c.json({ item: updateBig3(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, Big3UpdateSchema)) }));
focusRoutes.delete("/focus/big3/:id", (c) => { deleteBig3(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
focusRoutes.get("/focus/day", (c) => {
  const q = parseQuery(c, z.object({ date: z.string().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  const date = q.date ?? todayIn(getWorkspace(db, wsId).settings.timezone);
  return c.json({ date, focus: dailyFocus(db, wsId, date), big3: big3ForWeek(db, wsId, weekStart(date)).filter((b) => b.status === "open") });
});
focusRoutes.put("/focus/day", async (c) => c.json({ focus: setDailyFocus(c.get("db"), ws(c), await parseBody(c, DailyFocusSchema)) }));
focusRoutes.get("/focus/mode", (c) => {
  const q = parseQuery(c, z.object({ date: z.string().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  return c.json(focusMode(db, wsId, q.date ?? todayIn(getWorkspace(db, wsId).settings.timezone)));
});
focusRoutes.get("/today", (c) => {
  const q = parseQuery(c, z.object({ date: z.string().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  return c.json(todayView(db, wsId, q.date ?? todayIn(getWorkspace(db, wsId).settings.timezone)));
});
