import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Action, ActionKind, ActionStatus } from "@shared/types";
import { ActionCreateSchema, ActionUpdateSchema } from "@shared/schemas";
import { todayIn, weekPeriod } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { badRequest, conflict, notFound } from "../lib/errors";
import { newId, nowIso } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { logActivity } from "./activity";
import { getWorkspace } from "./workspace";
import { stripUndefined } from "./goals";

interface ActionRow {
  id: string; workspace_id: string; title: string; notes: string; kind: ActionKind; status: ActionStatus; due_date: string | null; scheduled_date: string | null; done_at: string | null;
  goal_id: string | null; outcome_id: string | null; project_id: string | null; person_id: string | null; decision_id: string | null; knowledge_id: string | null; waiting_on: string;
  created_at: string; updated_at: string; version: number;
}
export function mapAction(r: ActionRow): Action {
  return {
    id: r.id, workspaceId: r.workspace_id, title: r.title, notes: r.notes, kind: r.kind, status: r.status, dueDate: r.due_date, scheduledDate: r.scheduled_date, doneAt: r.done_at,
    goalId: r.goal_id, outcomeId: r.outcome_id, projectId: r.project_id, personId: r.person_id, decisionId: r.decision_id, knowledgeId: r.knowledge_id, waitingOn: r.waiting_on,
    createdAt: r.created_at, updatedAt: r.updated_at, version: r.version,
  };
}

export interface ActionView extends Action { goalTitle: string | null; projectTitle: string | null; personName: string | null }

export function getAction(db: Db, wsId: string, id: string): Action {
  const r = db.get<ActionRow>("SELECT * FROM actions WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Action");
  return mapAction(r);
}

export function actionView(db: Db, a: Action): ActionView {
  const goalTitle = a.goalId ? db.get<{ title: string }>("SELECT title FROM goals WHERE id = ?", a.goalId)?.title ?? null : null;
  const projectTitle = a.projectId ? db.get<{ title: string }>("SELECT title FROM projects WHERE id = ?", a.projectId)?.title ?? null : null;
  const personName = a.personId ? db.get<{ name: string }>("SELECT name FROM people WHERE id = ?", a.personId)?.name ?? null : null;
  return { ...a, goalTitle, projectTitle, personName };
}

const FK_CHECKS: [keyof Action, string, string][] = [
  ["goalId", "goals", "Goal"], ["outcomeId", "outcomes", "Outcome"], ["projectId", "projects", "Project"], ["personId", "people", "Person"], ["decisionId", "decisions", "Decision"], ["knowledgeId", "knowledge_items", "Knowledge"],
];
function checkRefs(db: Db, wsId: string, a: Partial<Action>) {
  for (const [key, table, label] of FK_CHECKS) {
    const v = a[key];
    if (typeof v === "string" && v && !db.get(`SELECT 1 FROM ${table} WHERE id = ? AND workspace_id = ?`, v, wsId)) throw badRequest(`${label} が見つかりません`);
  }
}

function reindex(db: Db, a: Action) {
  indexEntity(db, a.workspaceId, "action", a.id, a.title, [a.notes, a.waitingOn].filter(Boolean).join("\n"), a.dueDate ?? a.createdAt.slice(0, 10));
}

export function createAction(db: Db, wsId: string, input: z.infer<typeof ActionCreateSchema>): Action {
  checkRefs(db, wsId, input as Partial<Action>);
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    db.run(
      `INSERT INTO actions(id, workspace_id, title, notes, kind, status, due_date, scheduled_date, done_at, goal_id, outcome_id, project_id, person_id, decision_id, knowledge_id, waiting_on, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id, wsId, input.title, input.notes, input.kind, input.status, input.dueDate, input.scheduledDate, input.status === "done" ? now : null,
      input.goalId, input.outcomeId, input.projectId, input.personId, input.decisionId, input.knowledgeId, input.waitingOn, now, now,
    );
    const a = getAction(db, wsId, id);
    reindex(db, a);
    if (a.status === "done") logActivity(db, wsId, "action", id, "action.done", a.title);
  });
  return getAction(db, wsId, id);
}

export function updateAction(db: Db, wsId: string, id: string, patch: z.infer<typeof ActionUpdateSchema>): Action {
  const cur = getAction(db, wsId, id);
  if (patch.version !== undefined && patch.version !== cur.version) throw conflict("他の端末で更新されています", { current: cur });
  const next: Action = { ...cur, ...stripUndefined(patch), version: cur.version + 1, updatedAt: nowIso() } as Action;
  checkRefs(db, wsId, next);
  if (next.status === "done" && cur.status !== "done") next.doneAt = nowIso();
  if (next.status !== "done") next.doneAt = null;
  db.transaction(() => {
    db.run(
      `UPDATE actions SET title=?, notes=?, kind=?, status=?, due_date=?, scheduled_date=?, done_at=?, goal_id=?, outcome_id=?, project_id=?, person_id=?, decision_id=?, knowledge_id=?, waiting_on=?, updated_at=?, version=? WHERE id=? AND workspace_id=?`,
      next.title, next.notes, next.kind, next.status, next.dueDate, next.scheduledDate, next.doneAt, next.goalId, next.outcomeId, next.projectId, next.personId, next.decisionId, next.knowledgeId, next.waitingOn, next.updatedAt, next.version, id, wsId,
    );
    reindex(db, next);
    if (next.status === "done" && cur.status !== "done") logActivity(db, wsId, "action", id, "action.done", next.title);
    // keep Big3 item status in sync if linked
    if (next.status !== cur.status) db.run("UPDATE big3_items SET status = ?, updated_at = ? WHERE action_id = ? AND workspace_id = ?", next.status === "done" ? "done" : next.status === "dropped" ? "dropped" : "open", nowIso(), id, wsId);
  });
  return getAction(db, wsId, id);
}

export function deleteAction(db: Db, wsId: string, id: string): void {
  getAction(db, wsId, id);
  db.transaction(() => {
    cleanupEntity(db, wsId, "action", id);
    db.run("DELETE FROM actions WHERE id = ? AND workspace_id = ?", id, wsId);
  });
}

export interface ActionFilter { status?: ActionStatus[]; kind?: ActionKind[]; goalId?: string; projectId?: string; personId?: string; due?: "overdue" | "today" | "week" | "none"; limit?: number }

export function listActions(db: Db, wsId: string, f: ActionFilter, today: string): Action[] {
  const where = ["workspace_id = ?"];
  const params: (string | number)[] = [wsId];
  if (f.status?.length) { where.push(`status IN (${f.status.map(() => "?").join(",")})`); params.push(...f.status); }
  if (f.kind?.length) { where.push(`kind IN (${f.kind.map(() => "?").join(",")})`); params.push(...f.kind); }
  if (f.goalId) { where.push("goal_id = ?"); params.push(f.goalId); }
  if (f.projectId) { where.push("project_id = ?"); params.push(f.projectId); }
  if (f.personId) { where.push("person_id = ?"); params.push(f.personId); }
  if (f.due === "overdue") { where.push("due_date < ?"); params.push(today); }
  if (f.due === "today") { where.push("(due_date = ? OR scheduled_date = ?)"); params.push(today, today); }
  if (f.due === "week") { const p = weekPeriod(today); where.push("((due_date BETWEEN ? AND ?) OR (scheduled_date BETWEEN ? AND ?))"); params.push(p.start, p.end, p.start, p.end); }
  if (f.due === "none") where.push("due_date IS NULL AND scheduled_date IS NULL");
  const limit = Math.min(f.limit ?? 500, 2000);
  return db.all<ActionRow>(`SELECT * FROM actions WHERE ${where.join(" AND ")} ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_date IS NULL, due_date ASC, created_at DESC LIMIT ${limit}`, ...params).map(mapAction);
}

export const actionRoutes = new Hono<Env>();
const Q = z.object({ status: z.string().optional(), kind: z.string().optional(), goalId: z.string().optional(), projectId: z.string().optional(), personId: z.string().optional(), due: z.enum(["overdue", "today", "week", "none"]).optional(), limit: z.coerce.number().int().optional() });

actionRoutes.get("/actions", (c) => {
  const q = parseQuery(c, Q);
  const db = c.get("db"); const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  const list = listActions(db, wsId, {
    status: q.status?.split(",") as ActionStatus[] | undefined, kind: q.kind?.split(",") as ActionKind[] | undefined,
    goalId: q.goalId, projectId: q.projectId, personId: q.personId, due: q.due, limit: q.limit,
  }, today);
  return c.json({ actions: list.map((a) => actionView(db, a)) });
});
actionRoutes.post("/actions", async (c) => c.json({ action: createAction(c.get("db"), ws(c), await parseBody(c, ActionCreateSchema)) }, 201));
actionRoutes.get("/actions/:id", (c) => c.json({ action: actionView(c.get("db"), getAction(c.get("db"), ws(c), c.req.param("id"))) }));
actionRoutes.patch("/actions/:id", async (c) => c.json({ action: updateAction(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, ActionUpdateSchema)) }));
actionRoutes.delete("/actions/:id", (c) => { deleteAction(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });

/** Open loops = unresolved items (open_loop/waiting actions, projects waiting, promises waiting on others). */
actionRoutes.get("/open-loops", (c) => {
  const db = c.get("db"); const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  const loops = listActions(db, wsId, { status: ["open"], kind: ["open_loop", "waiting"] }, today).map((a) => actionView(db, a));
  const waitingProjects = db.all<{ id: string; title: string; next_action: string; updated_at: string }>("SELECT id, title, next_action, updated_at FROM projects WHERE workspace_id = ? AND status = 'waiting'", wsId)
    .map((p) => ({ id: p.id, title: p.title, nextAction: p.next_action, updatedAt: p.updated_at }));
  const theirs = db.all<{ id: string; text: string; due_date: string | null; person_id: string; name: string }>(
    "SELECT pr.id, pr.text, pr.due_date, pr.person_id, p.name FROM promises pr JOIN people p ON p.id = pr.person_id WHERE pr.workspace_id = ? AND pr.status = 'open' AND pr.direction = 'theirs' ORDER BY pr.due_date", wsId,
  ).map((r) => ({ id: r.id, text: r.text, dueDate: r.due_date, personId: r.person_id, personName: r.name }));
  return c.json({ openLoops: loops.filter((a) => a.kind === "open_loop"), waiting: loops.filter((a) => a.kind === "waiting"), waitingProjects, waitingOnOthers: theirs });
});
