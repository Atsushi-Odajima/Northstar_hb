import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Goal, Outcome, GoalLevel, GoalStatus } from "@shared/types";
import { GOAL_LEVELS, GOAL_STATUSES, NORTH_STAR_MAX } from "@shared/types";
import { GoalCreateSchema, GoalUpdateSchema, GoalProgressLogSchema, OutcomeCreateSchema, OutcomeUpdateSchema } from "@shared/schemas";
import { canBeChildOf, computeProgress, assessHealth, periodWarning, northStarWarning, type HealthResult, type ProgressResult } from "@shared/rules";
import { todayIn } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { badRequest, conflict, notFound } from "../lib/errors";
import { newId, nowIso, bool } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { logActivity } from "./activity";
import { relationsOf } from "./relations";
import { getWorkspace } from "./workspace";

// ---------- mapping ----------
interface GoalRow {
  id: string; workspace_id: string; title: string; description: string; level: GoalLevel; parent_id: string | null;
  start_date: string | null; end_date: string | null; status: GoalStatus; priority: number; success_definition: string; why: string;
  progress_mode: Goal["progressMode"]; progress_manual: number; is_north_star: number; sort_order: number; created_at: string; updated_at: string; version: number;
}
export function mapGoal(r: GoalRow): Goal {
  return {
    id: r.id, workspaceId: r.workspace_id, title: r.title, description: r.description, level: r.level, parentId: r.parent_id,
    startDate: r.start_date, endDate: r.end_date, status: r.status, priority: r.priority, successDefinition: r.success_definition, why: r.why,
    progressMode: r.progress_mode, progressManual: r.progress_manual, isNorthStar: bool(r.is_north_star), sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at, version: r.version,
  };
}
interface OutcomeRow { id: string; workspace_id: string; goal_id: string; title: string; description: string; status: Outcome["status"]; due_date: string | null; achieved_at: string | null; created_at: string; updated_at: string }
export function mapOutcome(r: OutcomeRow): Outcome {
  return { id: r.id, workspaceId: r.workspace_id, goalId: r.goal_id, title: r.title, description: r.description, status: r.status, dueDate: r.due_date, achievedAt: r.achieved_at, createdAt: r.created_at, updatedAt: r.updated_at };
}

export interface GoalView extends Goal { progress: ProgressResult; health: HealthResult; outcomeCount: number; openActionCount: number; parentTitle: string | null }

// ---------- service ----------
export function getGoal(db: Db, wsId: string, id: string): Goal {
  const r = db.get<GoalRow>("SELECT * FROM goals WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Goal");
  return mapGoal(r);
}

export function listGoals(db: Db, wsId: string, filter: { status?: GoalStatus[]; level?: GoalLevel[]; parentId?: string | null } = {}): Goal[] {
  const where: string[] = ["workspace_id = ?"];
  const params: (string | null)[] = [wsId];
  if (filter.status?.length) { where.push(`status IN (${filter.status.map(() => "?").join(",")})`); params.push(...filter.status); }
  if (filter.level?.length) { where.push(`level IN (${filter.level.map(() => "?").join(",")})`); params.push(...filter.level); }
  if (filter.parentId !== undefined) { if (filter.parentId === null) where.push("parent_id IS NULL"); else { where.push("parent_id = ?"); params.push(filter.parentId); } }
  return db.all<GoalRow>(`SELECT * FROM goals WHERE ${where.join(" AND ")} ORDER BY is_north_star DESC, priority ASC, sort_order ASC, created_at ASC`, ...params).map(mapGoal);
}

export function outcomesOf(db: Db, wsId: string, goalId: string): Outcome[] {
  return db.all<OutcomeRow>("SELECT * FROM outcomes WHERE goal_id = ? AND workspace_id = ? ORDER BY created_at", goalId, wsId).map(mapOutcome);
}

export function goalView(db: Db, wsId: string, goal: Goal, today: string): GoalView {
  const outcomes = outcomesOf(db, wsId, goal.id);
  const actions = db.all<{ status: "open" | "done" | "dropped"; done_at: string | null }>("SELECT status, done_at FROM actions WHERE goal_id = ? AND workspace_id = ?", goal.id, wsId)
    .map((a) => ({ status: a.status, doneAt: a.done_at }));
  const lastLog = db.get<{ date: string }>("SELECT date FROM goal_progress_log WHERE goal_id = ? ORDER BY date DESC LIMIT 1", goal.id)?.date ?? null;
  const parentTitle = goal.parentId ? db.get<{ title: string }>("SELECT title FROM goals WHERE id = ?", goal.parentId)?.title ?? null : null;
  return {
    ...goal,
    progress: computeProgress(goal, outcomes),
    health: assessHealth(goal, outcomes, actions, lastLog, today),
    outcomeCount: outcomes.length,
    openActionCount: actions.filter((a) => a.status === "open").length,
    parentTitle,
  };
}

function reindexGoal(db: Db, g: Goal) {
  indexEntity(db, g.workspaceId, "goal", g.id, g.title, [g.description, g.successDefinition, g.why].filter(Boolean).join("\n"), g.startDate ?? g.createdAt.slice(0, 10));
}

export function createGoal(db: Db, wsId: string, input: z.infer<typeof GoalCreateSchema>): { goal: Goal; warnings: string[] } {
  const warnings: string[] = [];
  let parent: Goal | null = null;
  if (input.parentId) {
    parent = getGoal(db, wsId, input.parentId);
    if (!canBeChildOf(input.level, parent.level)) throw badRequest(`${input.level} Goal は ${parent.level} Goal の下に置けません（階層: Vision→Year→Quarter→Month→Week）`);
    const w = periodWarning(input, parent);
    if (w) warnings.push(w);
  }
  if (input.isNorthStar && input.level === "vision") throw badRequest("Vision は North Star に指定できません（Quarter/Month の最重要 Goal を選んでください）");
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    db.run(
      `INSERT INTO goals(id, workspace_id, title, description, level, parent_id, start_date, end_date, status, priority, success_definition, why, progress_mode, progress_manual, is_north_star, sort_order, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id, wsId, input.title, input.description, input.level, input.parentId, input.startDate, input.endDate, input.status, input.priority,
      input.successDefinition, input.why, input.progressMode, input.progressManual, input.isNorthStar, 0, now, now,
    );
    const g = getGoal(db, wsId, id);
    reindexGoal(db, g);
    logActivity(db, wsId, "goal", id, "goal.created", g.title);
  });
  const goal = getGoal(db, wsId, id);
  const nsWarn = northStarWarningFor(db, wsId);
  if (nsWarn) warnings.push(nsWarn);
  return { goal, warnings };
}

export function updateGoal(db: Db, wsId: string, id: string, patch: z.infer<typeof GoalUpdateSchema>): { goal: Goal; warnings: string[] } {
  const current = getGoal(db, wsId, id);
  if (patch.version !== undefined && patch.version !== current.version) throw conflict("他の端末で更新されています。再読み込みしてください", { current });
  const warnings: string[] = [];
  const next: Goal = { ...current, ...stripUndefined(patch), version: current.version + 1, updatedAt: nowIso() } as Goal;
  if (next.parentId) {
    if (next.parentId === id) throw badRequest("自分自身を親にはできません");
    const parent = getGoal(db, wsId, next.parentId);
    if (!canBeChildOf(next.level, parent.level)) throw badRequest(`${next.level} Goal は ${parent.level} Goal の下に置けません`);
    if (isDescendant(db, wsId, next.parentId, id)) throw badRequest("子孫 Goal を親にはできません");
    const w = periodWarning(next, parent);
    if (w) warnings.push(w);
  }
  if (next.isNorthStar && next.level === "vision") throw badRequest("Vision は North Star に指定できません");
  db.transaction(() => {
    db.run(
      `UPDATE goals SET title=?, description=?, level=?, parent_id=?, start_date=?, end_date=?, status=?, priority=?, success_definition=?, why=?, progress_mode=?, progress_manual=?, is_north_star=?, updated_at=?, version=? WHERE id=? AND workspace_id=?`,
      next.title, next.description, next.level, next.parentId, next.startDate, next.endDate, next.status, next.priority, next.successDefinition, next.why,
      next.progressMode, next.progressManual, next.isNorthStar, next.updatedAt, next.version, id, wsId,
    );
    reindexGoal(db, next);
    if (patch.status && patch.status !== current.status) logActivity(db, wsId, "goal", id, "goal.status", `${current.status}→${patch.status}`);
    if (patch.progressManual !== undefined && patch.progressManual !== current.progressManual) {
      db.run("INSERT INTO goal_progress_log(id, workspace_id, goal_id, date, progress, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId(), wsId, id, todayIn(getWorkspace(db, wsId).settings.timezone), patch.progressManual, "", nowIso());
      logActivity(db, wsId, "goal", id, "goal.progress", String(patch.progressManual));
    }
  });
  const nsWarn = northStarWarningFor(db, wsId);
  if (nsWarn) warnings.push(nsWarn);
  return { goal: getGoal(db, wsId, id), warnings };
}

function isDescendant(db: Db, wsId: string, candidateId: string, ancestorId: string): boolean {
  let cur: string | null = candidateId;
  for (let i = 0; i < 50 && cur; i++) {
    const r: { parent_id: string | null } | undefined = db.get<{ parent_id: string | null }>("SELECT parent_id FROM goals WHERE id = ? AND workspace_id = ?", cur, wsId);
    if (!r) return false;
    if (r.parent_id === ancestorId) return true;
    cur = r.parent_id;
  }
  return false;
}

export function deleteGoal(db: Db, wsId: string, id: string): void {
  getGoal(db, wsId, id);
  db.transaction(() => {
    for (const o of outcomesOf(db, wsId, id)) cleanupEntity(db, wsId, "outcome", o.id);
    cleanupEntity(db, wsId, "goal", id);
    db.run("DELETE FROM goals WHERE id = ? AND workspace_id = ?", id, wsId);
  });
}

export function logProgress(db: Db, wsId: string, id: string, input: z.infer<typeof GoalProgressLogSchema>): Goal {
  const g = getGoal(db, wsId, id);
  const date = input.date ?? todayIn(getWorkspace(db, wsId).settings.timezone);
  db.transaction(() => {
    db.run("INSERT INTO goal_progress_log(id, workspace_id, goal_id, date, progress, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId(), wsId, id, date, input.progress, input.note, nowIso());
    if (g.progressMode === "manual") db.run("UPDATE goals SET progress_manual = ?, updated_at = ?, version = version + 1 WHERE id = ?", input.progress, nowIso(), id);
    logActivity(db, wsId, "goal", id, "goal.progress", `${input.progress}% ${input.note}`.trim());
  });
  return getGoal(db, wsId, id);
}

export function progressLog(db: Db, wsId: string, goalId: string) {
  return db.all<{ id: string; date: string; progress: number; note: string; created_at: string }>("SELECT id, date, progress, note, created_at FROM goal_progress_log WHERE goal_id = ? AND workspace_id = ? ORDER BY date DESC, created_at DESC LIMIT 200", goalId, wsId)
    .map((r) => ({ id: r.id, date: r.date, progress: r.progress, note: r.note, createdAt: r.created_at }));
}

export function createOutcome(db: Db, wsId: string, input: z.infer<typeof OutcomeCreateSchema>): Outcome {
  getGoal(db, wsId, input.goalId);
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    db.run("INSERT INTO outcomes(id, workspace_id, goal_id, title, description, status, due_date, achieved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, wsId, input.goalId, input.title, input.description, input.status, input.dueDate, input.status === "achieved" ? now : null, now, now);
    indexEntity(db, wsId, "outcome", id, input.title, input.description, input.dueDate ?? now.slice(0, 10));
    if (input.status === "achieved") logActivity(db, wsId, "outcome", id, "outcome.achieved", input.title);
  });
  return getOutcome(db, wsId, id);
}

export function getOutcome(db: Db, wsId: string, id: string): Outcome {
  const r = db.get<OutcomeRow>("SELECT * FROM outcomes WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Outcome");
  return mapOutcome(r);
}

export function updateOutcome(db: Db, wsId: string, id: string, patch: z.infer<typeof OutcomeUpdateSchema>): Outcome {
  const cur = getOutcome(db, wsId, id);
  const next = { ...cur, ...stripUndefined(patch) };
  const now = nowIso();
  const achievedAt = next.status === "achieved" ? (cur.status === "achieved" ? cur.achievedAt : now) : null;
  db.transaction(() => {
    db.run("UPDATE outcomes SET title=?, description=?, status=?, due_date=?, achieved_at=?, updated_at=? WHERE id=? AND workspace_id=?", next.title, next.description, next.status, next.dueDate, achievedAt, now, id, wsId);
    indexEntity(db, wsId, "outcome", id, next.title, next.description, next.dueDate ?? cur.createdAt.slice(0, 10));
    if (next.status === "achieved" && cur.status !== "achieved") logActivity(db, wsId, "outcome", id, "outcome.achieved", next.title);
    // Binary / linked goals: when all outcomes are achieved, suggest (not force) achievement via health; we never auto-flip status.
  });
  return getOutcome(db, wsId, id);
}

export function deleteOutcome(db: Db, wsId: string, id: string): void {
  getOutcome(db, wsId, id);
  db.transaction(() => {
    cleanupEntity(db, wsId, "outcome", id);
    db.run("DELETE FROM outcomes WHERE id = ? AND workspace_id = ?", id, wsId);
  });
}

export function northStars(db: Db, wsId: string): Goal[] {
  return db.all<GoalRow>("SELECT * FROM goals WHERE workspace_id = ? AND is_north_star = 1 AND status = 'active' ORDER BY priority, created_at", wsId).map(mapGoal);
}

export function northStarWarningFor(db: Db, wsId: string): string | null {
  const ns = db.get<{ n: number }>("SELECT COUNT(*) n FROM goals WHERE workspace_id = ? AND is_north_star = 1 AND status = 'active'", wsId)?.n ?? 0;
  const active = db.get<{ n: number }>("SELECT COUNT(*) n FROM goals WHERE workspace_id = ? AND status = 'active' AND level <> 'vision'", wsId)?.n ?? 0;
  return northStarWarning(ns, active);
}

export interface GoalTreeNode extends GoalView { children: GoalTreeNode[] }

export function goalTree(db: Db, wsId: string, today: string, includeArchived = false): GoalTreeNode[] {
  const all = listGoals(db, wsId).filter((g) => includeArchived || (g.status !== "archived" && g.status !== "dropped"));
  const nodes = new Map<string, GoalTreeNode>();
  for (const g of all) nodes.set(g.id, { ...goalView(db, wsId, g, today), children: [] });
  const roots: GoalTreeNode[] = [];
  for (const n of nodes.values()) {
    if (n.parentId && nodes.has(n.parentId)) nodes.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  const order = (a: GoalTreeNode, b: GoalTreeNode) => GOAL_LEVELS.indexOf(a.level) - GOAL_LEVELS.indexOf(b.level) || a.priority - b.priority || a.createdAt.localeCompare(b.createdAt);
  const sortRec = (list: GoalTreeNode[]) => { list.sort(order); list.forEach((n) => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

/** Ancestors from the goal up to its root (vision). */
export function ancestors(db: Db, wsId: string, goalId: string): Goal[] {
  const out: Goal[] = [];
  let cur: string | null = goalId;
  for (let i = 0; i < 20 && cur; i++) {
    const r = db.get<GoalRow>("SELECT * FROM goals WHERE id = ? AND workspace_id = ?", cur, wsId);
    if (!r) break;
    const g = mapGoal(r);
    if (g.id !== goalId) out.push(g);
    cur = g.parentId;
  }
  return out;
}

export function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

// ---------- routes ----------
export const goalRoutes = new Hono<Env>();

const ListQuery = z.object({
  status: z.string().optional(),
  level: z.string().optional(),
  parentId: z.string().optional(),
});

goalRoutes.get("/goals", (c) => {
  const q = parseQuery(c, ListQuery);
  const db = c.get("db");
  const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  const status = q.status ? (q.status.split(",").filter((s) => (GOAL_STATUSES as readonly string[]).includes(s)) as GoalStatus[]) : undefined;
  const level = q.level ? (q.level.split(",").filter((s) => (GOAL_LEVELS as readonly string[]).includes(s)) as GoalLevel[]) : undefined;
  const parentId = q.parentId === undefined ? undefined : q.parentId === "" ? null : q.parentId;
  const goals = listGoals(db, wsId, { status, level, parentId }).map((g) => goalView(db, wsId, g, today));
  return c.json({ goals, warning: northStarWarningFor(db, wsId) });
});

goalRoutes.get("/goals/tree", (c) => {
  const db = c.get("db");
  const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  return c.json({ tree: goalTree(db, wsId, today, c.req.query("all") === "1"), warning: northStarWarningFor(db, wsId) });
});

goalRoutes.get("/northstar", (c) => {
  const db = c.get("db");
  const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  return c.json({ northStars: northStars(db, wsId).map((g) => goalView(db, wsId, g, today)), max: NORTH_STAR_MAX, warning: northStarWarningFor(db, wsId) });
});

goalRoutes.post("/goals", async (c) => {
  const body = await parseBody(c, GoalCreateSchema);
  const res = createGoal(c.get("db"), ws(c), body);
  return c.json(res, 201);
});

goalRoutes.get("/goals/:id", (c) => {
  const db = c.get("db");
  const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  const goal = getGoal(db, wsId, c.req.param("id"));
  const children = listGoals(db, wsId, { parentId: goal.id }).map((g) => goalView(db, wsId, g, today));
  const actions = db.all("SELECT * FROM actions WHERE goal_id = ? AND workspace_id = ? ORDER BY status, due_date", goal.id, wsId);
  return c.json({
    goal: goalView(db, wsId, goal, today),
    outcomes: outcomesOf(db, wsId, goal.id),
    children,
    ancestors: ancestors(db, wsId, goal.id),
    actions: actions.map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase()), v]))),
    relations: relationsOf(db, wsId, "goal", goal.id),
    progressLog: progressLog(db, wsId, goal.id),
  });
});

goalRoutes.patch("/goals/:id", async (c) => {
  const body = await parseBody(c, GoalUpdateSchema);
  return c.json(updateGoal(c.get("db"), ws(c), c.req.param("id"), body));
});

goalRoutes.delete("/goals/:id", (c) => {
  deleteGoal(c.get("db"), ws(c), c.req.param("id"));
  return c.json({ ok: true });
});

goalRoutes.post("/goals/:id/progress", async (c) => {
  const body = await parseBody(c, GoalProgressLogSchema);
  return c.json({ goal: logProgress(c.get("db"), ws(c), c.req.param("id"), body) });
});

goalRoutes.post("/goals/:id/outcomes", async (c) => {
  const body = await parseBody(c, OutcomeCreateSchema.omit({ goalId: true }));
  return c.json({ outcome: createOutcome(c.get("db"), ws(c), { ...body, goalId: c.req.param("id") }) }, 201);
});

goalRoutes.patch("/outcomes/:id", async (c) => {
  const body = await parseBody(c, OutcomeUpdateSchema);
  return c.json({ outcome: updateOutcome(c.get("db"), ws(c), c.req.param("id"), body) });
});

goalRoutes.delete("/outcomes/:id", (c) => {
  deleteOutcome(c.get("db"), ws(c), c.req.param("id"));
  return c.json({ ok: true });
});
