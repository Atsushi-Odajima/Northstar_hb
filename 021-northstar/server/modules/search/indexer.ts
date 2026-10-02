// Keeps search_docs (FTS5 external content) and derived data in sync with entity changes.
import type { Db } from "../../db/connection";
import type { EntityType } from "@shared/types";
import { nowIso } from "../../lib/util";

export function indexEntity(db: Db, workspaceId: string, type: EntityType, id: string, title: string, body: string, date = ""): void {
  const clean = (s: string) => (s ?? "").toString().slice(0, 200_000);
  db.run(
    `INSERT INTO search_docs(workspace_id, entity_type, entity_id, title, body, date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET title = excluded.title, body = excluded.body, date = excluded.date, updated_at = excluded.updated_at`,
    workspaceId, type, id, clean(title), clean(body), date, nowIso(),
  );
  // Embedding becomes stale: mark by deleting the hash match (re-embedded lazily by the embedding job).
  db.run("UPDATE embeddings SET content_hash = '' WHERE entity_type = ? AND entity_id = ?", type, id);
}

export function removeFromIndex(db: Db, type: EntityType, id: string): void {
  db.run("DELETE FROM search_docs WHERE entity_type = ? AND entity_id = ?", type, id);
  db.run("DELETE FROM embeddings WHERE entity_type = ? AND entity_id = ?", type, id);
}

/** Remove everything derived from an entity: relations, search index, embeddings. Call inside the delete transaction. */
export function cleanupEntity(db: Db, workspaceId: string, type: EntityType, id: string): void {
  db.run("DELETE FROM relations WHERE workspace_id = ? AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?))", workspaceId, type, id, type, id);
  removeFromIndex(db, type, id);
  db.run("DELETE FROM activity_log WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?", workspaceId, type, id);
}

/** Rebuilds the full-text index for a workspace from the tables (used after restore). Embeddings are rebuilt lazily. */
export function rebuildSearchIndex(db: Db, workspaceId: string): number {
  db.run("DELETE FROM search_docs WHERE workspace_id = ?", workspaceId);
  db.run("DELETE FROM embeddings WHERE workspace_id = ?", workspaceId);
  const arr = (s: unknown): string[] => { try { const v = JSON.parse(String(s ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
  const join = (...parts: unknown[]) => parts.flat().map((p) => (p ?? "").toString()).filter(Boolean).join("\n");
  let n = 0;
  const idx = (type: EntityType, id: string, title: string, body: string, date: string) => { indexEntity(db, workspaceId, type, id, title, body, date); n++; };
  type R = Record<string, any>;
  for (const g of db.all<R>("SELECT * FROM goals WHERE workspace_id = ?", workspaceId)) idx("goal", g.id, g.title, join(g.description, g.success_definition, g.why), g.start_date ?? String(g.created_at).slice(0, 10));
  for (const o of db.all<R>("SELECT * FROM outcomes WHERE workspace_id = ?", workspaceId)) idx("outcome", o.id, o.title, o.description, o.due_date ?? String(o.created_at).slice(0, 10));
  for (const p of db.all<R>("SELECT * FROM projects WHERE workspace_id = ?", workspaceId)) idx("project", p.id, p.title, join(p.outcome, p.description, p.next_action), p.deadline ?? String(p.created_at).slice(0, 10));
  for (const a of db.all<R>("SELECT * FROM actions WHERE workspace_id = ?", workspaceId)) idx("action", a.id, a.title, join(a.notes, a.waiting_on), a.due_date ?? String(a.created_at).slice(0, 10));
  for (const d of db.all<R>("SELECT * FROM decisions WHERE workspace_id = ?", workspaceId)) idx("decision", d.id, d.title, join(d.context, d.decision, d.reason, d.expected_outcome, d.risks, arr(d.options_json), arr(d.assumptions_json)), d.decided_at);
  for (const r of db.all<R>("SELECT * FROM reviews WHERE workspace_id = ?", workspaceId)) { let answers: Record<string, string> = {}; try { answers = JSON.parse(r.answers_json); } catch { /* ignore */ } idx("review", r.id, `${r.kind} review ${r.period_start}`, Object.values(answers).join("\n"), r.period_start); }
  for (const p of db.all<R>("SELECT * FROM people WHERE workspace_id = ?", workspaceId)) idx("person", p.id, p.name, join(p.organization, p.role, p.how_met, p.notes, arr(p.tags_json).join(" ")), p.last_contact_at ?? String(p.created_at).slice(0, 10));
  for (const c of db.all<R>("SELECT c.*, p.name FROM contacts c JOIN people p ON p.id = c.person_id WHERE c.workspace_id = ?", workspaceId)) idx("contact", c.id, `${c.name} ${c.date}`, join(c.summary, c.next_step), c.date);
  for (const p of db.all<R>("SELECT * FROM promises WHERE workspace_id = ?", workspaceId)) idx("promise", p.id, p.text, p.direction === "mine" ? "自分の約束" : "相手からの返事待ち", p.due_date ?? String(p.created_at).slice(0, 10));
  for (const f of db.all<R>("SELECT f.*, p.name FROM follow_ups f JOIN people p ON p.id = f.person_id WHERE f.workspace_id = ?", workspaceId)) idx("follow_up", f.id, `${f.name} follow-up`, f.reason, f.due_date);
  for (const k of db.all<R>("SELECT * FROM knowledge_items WHERE workspace_id = ?", workspaceId)) idx("knowledge", k.id, k.title, join(k.source_title, k.summary, arr(k.key_ideas_json), k.personal_meaning, k.next_action, String(k.raw_content ?? "").slice(0, 20000)), k.captured_at);
  for (const c of db.all<R>("SELECT * FROM captures WHERE workspace_id = ?", workspaceId)) idx("capture", c.id, String(c.raw_text).slice(0, 80), c.raw_text, String(c.created_at).slice(0, 10));
  for (const p of db.all<R>("SELECT * FROM principles WHERE workspace_id = ?", workspaceId)) idx("principle", p.id, p.text, p.kind, String(p.created_at).slice(0, 10));
  for (const e of db.all<R>("SELECT * FROM experiments WHERE workspace_id = ?", workspaceId)) idx("experiment", e.id, e.title, join(e.hypothesis, e.action, e.success_signal, e.result, e.lesson), e.period_start ?? String(e.created_at).slice(0, 10));
  return n;
}
