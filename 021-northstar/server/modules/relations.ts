import type { Db } from "../db/connection";
import type { EntityType, Relation } from "@shared/types";
import { newId, nowIso } from "../lib/util";
import { badRequest } from "../lib/errors";

const TABLE: Record<EntityType, string> = {
  goal: "goals", outcome: "outcomes", project: "projects", action: "actions", decision: "decisions", review: "reviews",
  person: "people", contact: "contacts", knowledge: "knowledge_items", capture: "captures", principle: "principles",
  experiment: "experiments", calendar_event: "calendar_events", promise: "promises", follow_up: "follow_ups",
};

export function entityExists(db: Db, workspaceId: string, type: EntityType, id: string): boolean {
  const t = TABLE[type];
  if (!t) return false;
  return !!db.get(`SELECT 1 FROM ${t} WHERE id = ? AND workspace_id = ?`, id, workspaceId);
}

export function entityTitle(db: Db, workspaceId: string, type: EntityType, id: string): string | null {
  const t = TABLE[type];
  const col = type === "person" ? "name" : type === "promise" || type === "principle" ? "text" : type === "review" ? "kind || ' ' || period_start" : type === "capture" ? "substr(raw_text, 1, 80)" : type === "contact" ? "date || ' ' || substr(summary, 1, 60)" : type === "follow_up" ? "reason" : "title";
  const r = db.get<{ t: string }>(`SELECT ${col} AS t FROM ${t} WHERE id = ? AND workspace_id = ?`, id, workspaceId);
  return r?.t ?? null;
}

export function link(db: Db, workspaceId: string, fromType: EntityType, fromId: string, toType: EntityType, toId: string, kind = "linked"): Relation | null {
  if (!entityExists(db, workspaceId, fromType, fromId)) throw badRequest(`${fromType} が見つかりません`);
  if (!entityExists(db, workspaceId, toType, toId)) throw badRequest(`${toType} が見つかりません`);
  const id = newId();
  const createdAt = nowIso();
  const r = db.run(
    "INSERT OR IGNORE INTO relations(id, workspace_id, from_type, from_id, to_type, to_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, workspaceId, fromType, fromId, toType, toId, kind, createdAt,
  );
  if (r.changes === 0) return null;
  return { id, workspaceId, fromType, fromId, toType, toId, kind, createdAt };
}

export function unlink(db: Db, workspaceId: string, relationId: string): void {
  db.run("DELETE FROM relations WHERE id = ? AND workspace_id = ?", relationId, workspaceId);
}

export interface RelatedRef { relationId: string; type: EntityType; id: string; kind: string; title: string | null; direction: "out" | "in" }

/** All relations touching an entity (both directions) with titles resolved. */
export function relationsOf(db: Db, workspaceId: string, type: EntityType, id: string): RelatedRef[] {
  const rows = db.all<{ id: string; from_type: EntityType; from_id: string; to_type: EntityType; to_id: string; kind: string }>(
    "SELECT id, from_type, from_id, to_type, to_id, kind FROM relations WHERE workspace_id = ? AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)) ORDER BY created_at",
    workspaceId, type, id, type, id,
  );
  return rows.map((r) => {
    const out = r.from_type === type && r.from_id === id;
    const otherType = out ? r.to_type : r.from_type;
    const otherId = out ? r.to_id : r.from_id;
    return { relationId: r.id, type: otherType, id: otherId, kind: r.kind, title: entityTitle(db, workspaceId, otherType, otherId), direction: out ? "out" : "in" };
  });
}

export function linkedIds(db: Db, workspaceId: string, type: EntityType, id: string, otherType: EntityType): string[] {
  return relationsOf(db, workspaceId, type, id).filter((r) => r.type === otherType).map((r) => r.id);
}

/** Replace the set of links from (type,id) to entities of otherType. */
export function setLinks(db: Db, workspaceId: string, type: EntityType, id: string, otherType: EntityType, otherIds: string[], kind = "linked"): void {
  db.run("DELETE FROM relations WHERE workspace_id = ? AND ((from_type = ? AND from_id = ? AND to_type = ?) OR (to_type = ? AND to_id = ? AND from_type = ?)) AND kind = ?", workspaceId, type, id, otherType, type, id, otherType, kind);
  for (const other of new Set(otherIds)) link(db, workspaceId, type, id, otherType, other, kind);
}
