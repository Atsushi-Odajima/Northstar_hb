import type { Db } from "../db/connection";
import type { Workspace, WorkspaceSettings, User } from "@shared/types";
import { DEFAULT_WORKSPACE_SETTINGS, DEFAULT_AI_SETTINGS, DEFAULT_NOTIFICATION_SETTINGS } from "@shared/types";
import { newId, nowIso, parseJson } from "../lib/util";
import { notFound } from "../lib/errors";

export function mergeSettings(raw: unknown): WorkspaceSettings {
  const s = (typeof raw === "object" && raw) ? (raw as Partial<WorkspaceSettings>) : {};
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    ...s,
    weekStartsOn: 1,
    ai: { ...DEFAULT_AI_SETTINGS, ...(s.ai ?? {}), features: { ...DEFAULT_AI_SETTINGS.features, ...(s.ai?.features ?? {}) } },
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, ...(s.notifications ?? {}) },
    selectedMetricIds: s.selectedMetricIds ?? [],
  };
}

interface WsRow { id: string; owner_user_id: string; name: string; settings_json: string; created_at: string; updated_at: string }

function mapWs(r: WsRow): Workspace {
  return { id: r.id, ownerUserId: r.owner_user_id, name: r.name, settings: mergeSettings(parseJson(r.settings_json, {})), createdAt: r.created_at, updatedAt: r.updated_at };
}

export function createWorkspace(db: Db, ownerUserId: string, name: string): Workspace {
  const id = newId();
  const now = nowIso();
  db.run("INSERT INTO workspaces(id, owner_user_id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, ownerUserId, name, JSON.stringify(DEFAULT_WORKSPACE_SETTINGS), now, now);
  return getWorkspace(db, id);
}

export function getWorkspace(db: Db, id: string): Workspace {
  const r = db.get<WsRow>("SELECT * FROM workspaces WHERE id = ?", id);
  if (!r) throw notFound("workspace");
  return mapWs(r);
}

export function workspaceForUser(db: Db, userId: string): Workspace | null {
  const r = db.get<WsRow>("SELECT * FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1", userId);
  return r ? mapWs(r) : null;
}

export function updateWorkspaceSettings(db: Db, id: string, patch: { name?: string; settings?: Partial<WorkspaceSettings> }): Workspace {
  const current = getWorkspace(db, id);
  const merged = mergeSettings({
    ...current.settings,
    ...(patch.settings ?? {}),
    ai: { ...current.settings.ai, ...(patch.settings?.ai ?? {}), features: { ...current.settings.ai.features, ...(patch.settings?.ai?.features ?? {}) } },
    notifications: { ...current.settings.notifications, ...(patch.settings?.notifications ?? {}) },
  });
  db.run("UPDATE workspaces SET name = ?, settings_json = ?, updated_at = ? WHERE id = ?", patch.name ?? current.name, JSON.stringify(merged), nowIso(), id);
  return getWorkspace(db, id);
}

export function getUser(db: Db, id: string): User {
  const r = db.get<{ id: string; email: string; display_name: string; created_at: string }>("SELECT id, email, display_name, created_at FROM users WHERE id = ?", id);
  if (!r) throw notFound("user");
  return { id: r.id, email: r.email, displayName: r.display_name, createdAt: r.created_at };
}
