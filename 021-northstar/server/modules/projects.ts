import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Project, ProjectStatus } from "@shared/types";
import { ProjectCreateSchema, ProjectUpdateSchema } from "@shared/schemas";
import { parseBody, parseQuery, ws } from "../lib/http";
import { conflict, notFound } from "../lib/errors";
import { newId, nowIso } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { logActivity } from "./activity";
import { relationsOf, setLinks, linkedIds } from "./relations";
import { stripUndefined } from "./goals";
import { mapAction } from "./actions";

interface ProjectRow { id: string; workspace_id: string; title: string; outcome: string; description: string; status: ProjectStatus; next_action: string; deadline: string | null; created_at: string; updated_at: string; version: number }
export function mapProject(r: ProjectRow): Project {
  return { id: r.id, workspaceId: r.workspace_id, title: r.title, outcome: r.outcome, description: r.description, status: r.status, nextAction: r.next_action, deadline: r.deadline, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version };
}
export interface ProjectView extends Project { goalIds: string[]; goalTitles: string[]; openActionCount: number }

export function getProject(db: Db, wsId: string, id: string): Project {
  const r = db.get<ProjectRow>("SELECT * FROM projects WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Project");
  return mapProject(r);
}
export function projectView(db: Db, p: Project): ProjectView {
  const goalIds = linkedIds(db, p.workspaceId, "project", p.id, "goal");
  const goalTitles = goalIds.map((g) => db.get<{ title: string }>("SELECT title FROM goals WHERE id = ?", g)?.title ?? "").filter(Boolean);
  const openActionCount = db.get<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE project_id = ? AND status = 'open'", p.id)?.n ?? 0;
  return { ...p, goalIds, goalTitles, openActionCount };
}
function reindex(db: Db, p: Project) {
  indexEntity(db, p.workspaceId, "project", p.id, p.title, [p.outcome, p.description, p.nextAction].filter(Boolean).join("\n"), p.deadline ?? p.createdAt.slice(0, 10));
}
export function listProjects(db: Db, wsId: string, status?: ProjectStatus[]): Project[] {
  const where = ["workspace_id = ?"]; const params: string[] = [wsId];
  if (status?.length) { where.push(`status IN (${status.map(() => "?").join(",")})`); params.push(...status); }
  return db.all<ProjectRow>(`SELECT * FROM projects WHERE ${where.join(" AND ")} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'waiting' THEN 1 WHEN 'idea' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END, deadline IS NULL, deadline, created_at DESC`, ...params).map(mapProject);
}
export function createProject(db: Db, wsId: string, input: z.infer<typeof ProjectCreateSchema>): Project {
  const id = newId(); const now = nowIso();
  db.transaction(() => {
    db.run("INSERT INTO projects(id, workspace_id, title, outcome, description, status, next_action, deadline, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      id, wsId, input.title, input.outcome, input.description, input.status, input.nextAction, input.deadline, now, now);
    setLinks(db, wsId, "project", id, "goal", input.goalIds, "supports");
    reindex(db, getProject(db, wsId, id));
  });
  return getProject(db, wsId, id);
}
export function updateProject(db: Db, wsId: string, id: string, patch: z.infer<typeof ProjectUpdateSchema>): Project {
  const cur = getProject(db, wsId, id);
  if (patch.version !== undefined && patch.version !== cur.version) throw conflict("他の端末で更新されています", { current: cur });
  const { goalIds, version: _v, ...rest } = patch;
  const next: Project = { ...cur, ...stripUndefined(rest), version: cur.version + 1, updatedAt: nowIso() } as Project;
  db.transaction(() => {
    db.run("UPDATE projects SET title=?, outcome=?, description=?, status=?, next_action=?, deadline=?, updated_at=?, version=? WHERE id=? AND workspace_id=?",
      next.title, next.outcome, next.description, next.status, next.nextAction, next.deadline, next.updatedAt, next.version, id, wsId);
    if (goalIds) setLinks(db, wsId, "project", id, "goal", goalIds, "supports");
    reindex(db, next);
    if (patch.status && patch.status !== cur.status) logActivity(db, wsId, "project", id, "project.status", `${cur.status}→${patch.status}`);
  });
  return getProject(db, wsId, id);
}
export function deleteProject(db: Db, wsId: string, id: string): void {
  getProject(db, wsId, id);
  db.transaction(() => { cleanupEntity(db, wsId, "project", id); db.run("DELETE FROM projects WHERE id = ? AND workspace_id = ?", id, wsId); });
}

export const projectRoutes = new Hono<Env>();
projectRoutes.get("/projects", (c) => {
  const q = parseQuery(c, z.object({ status: z.string().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  return c.json({ projects: listProjects(db, wsId, q.status?.split(",") as ProjectStatus[] | undefined).map((p) => projectView(db, p)) });
});
projectRoutes.post("/projects", async (c) => c.json({ project: projectView(c.get("db"), createProject(c.get("db"), ws(c), await parseBody(c, ProjectCreateSchema))) }, 201));
projectRoutes.get("/projects/:id", (c) => {
  const db = c.get("db"); const wsId = ws(c);
  const p = getProject(db, wsId, c.req.param("id"));
  const actions = db.all("SELECT * FROM actions WHERE project_id = ? AND workspace_id = ? ORDER BY status, due_date", p.id, wsId).map((r) => mapAction(r as never));
  return c.json({ project: projectView(db, p), actions, relations: relationsOf(db, wsId, "project", p.id) });
});
projectRoutes.patch("/projects/:id", async (c) => c.json({ project: projectView(c.get("db"), updateProject(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, ProjectUpdateSchema))) }));
projectRoutes.delete("/projects/:id", (c) => { deleteProject(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
