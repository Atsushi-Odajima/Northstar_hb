import type { Db } from "../db/connection";
import type { EntityType } from "@shared/types";
import { newId, nowIso } from "../lib/util";

export type ActivityEvent =
  | "goal.created" | "goal.progress" | "goal.status" | "outcome.achieved" | "action.done" | "big3.done"
  | "decision.created" | "decision.reviewed" | "contact.logged" | "promise.done" | "follow_up.done"
  | "knowledge.captured" | "knowledge.processed" | "knowledge.applied" | "review.completed" | "project.status" | "experiment.completed";

export function logActivity(db: Db, workspaceId: string, type: EntityType, id: string, event: ActivityEvent, detail = "", at = nowIso()): void {
  db.run("INSERT INTO activity_log(id, workspace_id, entity_type, entity_id, event, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId(), workspaceId, type, id, event, detail.slice(0, 500), at);
}

export interface ActivityRow { id: string; entityType: EntityType; entityId: string; event: ActivityEvent; detail: string; at: string }

export function activityBetween(db: Db, workspaceId: string, fromIso: string, toIsoExclusive: string, events?: ActivityEvent[]): ActivityRow[] {
  const rows = db.all<{ id: string; entity_type: EntityType; entity_id: string; event: ActivityEvent; detail: string; at: string }>(
    "SELECT id, entity_type, entity_id, event, detail, at FROM activity_log WHERE workspace_id = ? AND at >= ? AND at < ? ORDER BY at ASC", workspaceId, fromIso, toIsoExclusive,
  );
  return rows
    .filter((r) => !events || events.includes(r.event))
    .map((r) => ({ id: r.id, entityType: r.entity_type, entityId: r.entity_id, event: r.event, detail: r.detail, at: r.at }));
}
