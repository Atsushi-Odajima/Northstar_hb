import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { KnowledgeItem, KnowledgeSourceType, KnowledgeStatus } from "@shared/types";
import { KnowledgeCreateSchema, KnowledgeUpdateSchema, ActionCreateSchema } from "@shared/schemas";
import { todayIn } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { badRequest, conflict, notFound } from "../lib/errors";
import { newId, nowIso, parseJson } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { logActivity } from "./activity";
import { relationsOf, setLinks, linkedIds } from "./relations";
import { getWorkspace } from "./workspace";
import { stripUndefined } from "./goals";
import { createAction, mapAction } from "./actions";

interface KRow { id: string; workspace_id: string; title: string; source_type: KnowledgeSourceType; source_url: string; source_title: string; captured_at: string; summary: string; key_ideas_json: string; personal_meaning: string; next_action: string; status: KnowledgeStatus; applied_at: string | null; applied_note: string; raw_content: string; created_at: string; updated_at: string; version: number }
export function mapKnowledge(r: KRow): KnowledgeItem {
  return { id: r.id, workspaceId: r.workspace_id, title: r.title, sourceType: r.source_type, sourceUrl: r.source_url, sourceTitle: r.source_title, capturedAt: r.captured_at, summary: r.summary, keyIdeas: parseJson<string[]>(r.key_ideas_json, []), personalMeaning: r.personal_meaning, nextAction: r.next_action, status: r.status, appliedAt: r.applied_at, appliedNote: r.applied_note, rawContent: r.raw_content, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version };
}
export interface KnowledgeView extends KnowledgeItem { goalIds: string[]; goalTitles: string[]; projectIds: string[]; personIds: string[]; actionCount: number }

export function getKnowledge(db: Db, wsId: string, id: string): KnowledgeItem {
  const r = db.get<KRow>("SELECT * FROM knowledge_items WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Knowledge");
  return mapKnowledge(r);
}
export function knowledgeView(db: Db, k: KnowledgeItem): KnowledgeView {
  const goalIds = linkedIds(db, k.workspaceId, "knowledge", k.id, "goal");
  return {
    ...k, goalIds,
    goalTitles: goalIds.map((g) => db.get<{ title: string }>("SELECT title FROM goals WHERE id = ?", g)?.title ?? "").filter(Boolean),
    projectIds: linkedIds(db, k.workspaceId, "knowledge", k.id, "project"),
    personIds: linkedIds(db, k.workspaceId, "knowledge", k.id, "person"),
    actionCount: db.get<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE knowledge_id = ?", k.id)?.n ?? 0,
  };
}
function reindex(db: Db, k: KnowledgeItem) {
  indexEntity(db, k.workspaceId, "knowledge", k.id, k.title, [k.sourceTitle, k.summary, ...k.keyIdeas, k.personalMeaning, k.nextAction, k.rawContent.slice(0, 20000)].filter(Boolean).join("\n"), k.capturedAt);
}
export function listKnowledge(db: Db, wsId: string, f: { status?: KnowledgeStatus[]; sourceType?: KnowledgeSourceType; toApply?: boolean; from?: string; to?: string; limit?: number } = {}): KnowledgeItem[] {
  const where = ["workspace_id = ?"]; const params: (string | number)[] = [wsId];
  if (f.status?.length) { where.push(`status IN (${f.status.map(() => "?").join(",")})`); params.push(...f.status); }
  if (f.sourceType) { where.push("source_type = ?"); params.push(f.sourceType); }
  if (f.toApply) where.push("status IN ('captured','processed') AND next_action <> ''");
  if (f.from) { where.push("captured_at >= ?"); params.push(f.from); }
  if (f.to) { where.push("captured_at <= ?"); params.push(f.to); }
  return db.all<KRow>(`SELECT * FROM knowledge_items WHERE ${where.join(" AND ")} ORDER BY captured_at DESC, created_at DESC LIMIT ${Math.min(f.limit ?? 200, 5000)}`, ...params).map(mapKnowledge);
}
export function createKnowledge(db: Db, wsId: string, input: z.infer<typeof KnowledgeCreateSchema>): KnowledgeItem {
  const id = newId(); const now = nowIso();
  const capturedAt = input.capturedAt ?? todayIn(getWorkspace(db, wsId).settings.timezone);
  db.transaction(() => {
    db.run(
      `INSERT INTO knowledge_items(id, workspace_id, title, source_type, source_url, source_title, captured_at, summary, key_ideas_json, personal_meaning, next_action, status, applied_at, applied_note, raw_content, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 1)`,
      id, wsId, input.title, input.sourceType, input.sourceUrl, input.sourceTitle, capturedAt, input.summary, JSON.stringify(input.keyIdeas), input.personalMeaning, input.nextAction, input.status, input.status === "applied" ? now : null, input.rawContent, now, now,
    );
    setLinks(db, wsId, "knowledge", id, "goal", input.goalIds, "applies_to");
    setLinks(db, wsId, "knowledge", id, "project", input.projectIds, "applies_to");
    setLinks(db, wsId, "knowledge", id, "person", input.personIds, "from");
    reindex(db, getKnowledge(db, wsId, id));
    logActivity(db, wsId, "knowledge", id, "knowledge.captured", input.title, now);
  });
  return getKnowledge(db, wsId, id);
}
export function updateKnowledge(db: Db, wsId: string, id: string, patch: z.infer<typeof KnowledgeUpdateSchema>): KnowledgeItem {
  const cur = getKnowledge(db, wsId, id);
  if (patch.version !== undefined && patch.version !== cur.version) throw conflict("他の端末で更新されています", { current: cur });
  const { goalIds, projectIds, personIds, version: _v, ...rest } = patch;
  const next: KnowledgeItem = { ...cur, ...stripUndefined(rest), version: cur.version + 1, updatedAt: nowIso() } as KnowledgeItem;
  if (next.status === "applied" && cur.status !== "applied") next.appliedAt = nowIso();
  if (next.status !== "applied") { next.appliedAt = null; }
  db.transaction(() => {
    db.run(
      `UPDATE knowledge_items SET title=?, source_type=?, source_url=?, source_title=?, captured_at=?, summary=?, key_ideas_json=?, personal_meaning=?, next_action=?, status=?, applied_at=?, applied_note=?, raw_content=?, updated_at=?, version=? WHERE id=? AND workspace_id=?`,
      next.title, next.sourceType, next.sourceUrl, next.sourceTitle, next.capturedAt, next.summary, JSON.stringify(next.keyIdeas), next.personalMeaning, next.nextAction, next.status, next.appliedAt, next.appliedNote, next.rawContent, next.updatedAt, next.version, id, wsId,
    );
    if (goalIds) setLinks(db, wsId, "knowledge", id, "goal", goalIds, "applies_to");
    if (projectIds) setLinks(db, wsId, "knowledge", id, "project", projectIds, "applies_to");
    if (personIds) setLinks(db, wsId, "knowledge", id, "person", personIds, "from");
    reindex(db, next);
    if (next.status === "applied" && cur.status !== "applied") logActivity(db, wsId, "knowledge", id, "knowledge.applied", next.appliedNote || next.title);
    else if (next.status === "processed" && cur.status === "captured") logActivity(db, wsId, "knowledge", id, "knowledge.processed", next.title);
  });
  return getKnowledge(db, wsId, id);
}
export function deleteKnowledge(db: Db, wsId: string, id: string): void {
  getKnowledge(db, wsId, id);
  db.transaction(() => { cleanupEntity(db, wsId, "knowledge", id); db.run("DELETE FROM knowledge_items WHERE id = ? AND workspace_id = ?", id, wsId); });
}
/** Knowledge → Action: creates an action linked to the item (and its first goal) and moves the item to processed. */
export function createActionFromKnowledge(db: Db, wsId: string, id: string, input: { title?: string; dueDate?: string | null; goalId?: string | null }) {
  const k = getKnowledge(db, wsId, id);
  const title = (input.title ?? k.nextAction).trim();
  if (!title) throw badRequest("Action のタイトルが必要です");
  const goalId = input.goalId ?? linkedIds(db, wsId, "knowledge", id, "goal")[0] ?? null;
  let action;
  db.transaction(() => {
    action = createAction(db, wsId, ActionCreateSchema.parse({ title, knowledgeId: id, goalId, dueDate: input.dueDate ?? null, notes: `From knowledge: ${k.title}` }));
    if (k.status === "captured") updateKnowledge(db, wsId, id, { status: "processed", nextAction: k.nextAction || title });
    else if (!k.nextAction) updateKnowledge(db, wsId, id, { nextAction: title });
  });
  return { action: action!, knowledge: getKnowledge(db, wsId, id) };
}

export const knowledgeRoutes = new Hono<Env>();
const Q = z.object({ status: z.string().optional(), sourceType: z.string().optional(), toApply: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().int().optional() });
knowledgeRoutes.get("/knowledge", (c) => {
  const q = parseQuery(c, Q); const db = c.get("db"); const wsId = ws(c);
  const list = listKnowledge(db, wsId, { status: q.status?.split(",") as KnowledgeStatus[] | undefined, sourceType: q.sourceType as KnowledgeSourceType | undefined, toApply: q.toApply === "1", from: q.from, to: q.to, limit: q.limit });
  return c.json({ knowledge: list.map((k) => knowledgeView(db, { ...k, rawContent: "" })) });
});
knowledgeRoutes.post("/knowledge", async (c) => c.json({ knowledge: knowledgeView(c.get("db"), createKnowledge(c.get("db"), ws(c), await parseBody(c, KnowledgeCreateSchema))) }, 201));
knowledgeRoutes.get("/knowledge/:id", (c) => {
  const db = c.get("db"); const wsId = ws(c);
  const k = getKnowledge(db, wsId, c.req.param("id"));
  const actions = db.all("SELECT * FROM actions WHERE knowledge_id = ? AND workspace_id = ? ORDER BY status, due_date", k.id, wsId).map((r) => mapAction(r as never));
  return c.json({ knowledge: knowledgeView(db, k), actions, relations: relationsOf(db, wsId, "knowledge", k.id) });
});
knowledgeRoutes.patch("/knowledge/:id", async (c) => c.json({ knowledge: knowledgeView(c.get("db"), updateKnowledge(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, KnowledgeUpdateSchema))) }));
knowledgeRoutes.delete("/knowledge/:id", (c) => { deleteKnowledge(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
knowledgeRoutes.post("/knowledge/:id/action", async (c) => {
  const body = await parseBody(c, z.object({ title: z.string().max(300).optional(), dueDate: z.string().nullable().optional(), goalId: z.string().nullable().optional() }));
  return c.json(createActionFromKnowledge(c.get("db"), ws(c), c.req.param("id"), body), 201);
});
