// Connector architecture. v1 ships ICS import (file / user-configured URL). Others are interface stubs with scope notes.
import type { Db } from "../db/connection";
import { newId, nowIso, parseJson } from "../lib/util";

export type ConnectorType = "ics" | "google_calendar" | "microsoft_calendar" | "gmail" | "github" | "notion" | "readwise";
export type ConnectorStatus = "not_configured" | "configured" | "connected" | "error" | "planned";

export interface ConnectorDefinition {
  type: ConnectorType;
  label: string;
  description: string;
  /** Minimal scopes the connector would request. Nothing is fetched without explicit user action. */
  scopes: string[];
  implemented: boolean;
  /** Human-readable status of our verification of the vendor's terms (see SOURCE_NOTES.md). */
  verification: string;
  configFields: { key: string; label: string; secret: boolean }[];
}

export const CONNECTORS: ConnectorDefinition[] = [
  { type: "ics", label: "Calendar (ICS)", description: "ICS ファイルの取り込み、または利用者が設定した ICS URL からの手動同期。予定は『時間利用の文脈』としてのみ使い、予定=実行済みとは扱いません。", scopes: ["読み取り（ユーザーが渡したファイル/URL のみ）"], implemented: true, verification: "外部規約なし（標準フォーマット）", configFields: [{ key: "url", label: "ICS URL（任意）", secret: true }] },
  { type: "google_calendar", label: "Google Calendar", description: "OAuth で予定を読み取り（将来）。", scopes: ["calendar.readonly（最小）"], implemented: false, verification: "Google OAuth 検証要件は未確認（developers.google.com 到達不可）。販売前に人間確認", configFields: [] },
  { type: "microsoft_calendar", label: "Microsoft 365 Calendar", description: "Microsoft Graph で予定を読み取り（将来）。", scopes: ["Calendars.Read（delegated）"], implemented: false, verification: "learn.microsoft.com 到達不可のため未確認", configFields: [] },
  { type: "gmail", label: "Gmail", description: "Follow-up 候補の検出（将来）。メール全件は取得しません。", scopes: ["gmail.metadata または readonly の最小範囲（要検討）"], implemented: false, verification: "restricted scope のため CASA 等の審査が必要になる可能性（未確認）", configFields: [] },
  { type: "github", label: "GitHub", description: "Project 進捗の文脈（commit/PR）を参照（将来）。", scopes: ["repo:read 相当（最小）"], implemented: false, verification: "GitHub OAuth App 規約は販売前に確認", configFields: [] },
  { type: "notion", label: "Notion", description: "Knowledge の取り込み（将来）。初版は export ファイル import で代替。", scopes: ["Integration token / OAuth（読み取りのみ）"], implemented: false, verification: "SDK README で API version 2025-09-03 / 2026-03-11 を確認（公式 docs 本体は未到達）", configFields: [] },
  { type: "readwise", label: "Readwise", description: "ハイライトの取り込み（将来）。", scopes: ["access token（読み取り）"], implemented: false, verification: "readwise.io 到達不可のため未確認", configFields: [] },
];

export interface ConnectorState { type: ConnectorType; status: ConnectorStatus; config: Record<string, unknown>; lastSyncAt: string | null }

export function connectorStates(db: Db, wsId: string): (ConnectorDefinition & ConnectorState & { hasSecret: boolean })[] {
  const rows = db.all<{ type: ConnectorType; status: ConnectorStatus; config_json: string; last_sync_at: string | null }>("SELECT type, status, config_json, last_sync_at FROM connectors WHERE workspace_id = ?", wsId);
  return CONNECTORS.map((def) => {
    const r = rows.find((x) => x.type === def.type);
    const cfg = parseJson<Record<string, unknown>>(r?.config_json, {});
    const publicCfg: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg)) publicCfg[k] = def.configFields.find((f) => f.key === k)?.secret ? (v ? "•••••" : "") : v;
    return { ...def, status: r?.status ?? (def.implemented ? "not_configured" : "planned"), config: publicCfg, lastSyncAt: r?.last_sync_at ?? null, hasSecret: Object.keys(cfg).length > 0 };
  });
}

export function configureConnector(db: Db, wsId: string, type: ConnectorType, config: Record<string, unknown>): void {
  const def = CONNECTORS.find((c) => c.type === type);
  if (!def || !def.implemented) throw new Error("この Connector は初版では利用できません");
  db.run("INSERT INTO connectors(id, workspace_id, type, status, config_json, last_sync_at, created_at, updated_at) VALUES (?, ?, ?, 'configured', ?, NULL, ?, ?) ON CONFLICT(workspace_id, type) DO UPDATE SET status = 'configured', config_json = excluded.config_json, updated_at = excluded.updated_at",
    newId(), wsId, type, JSON.stringify(config), nowIso(), nowIso());
}

export function connectorConfig(db: Db, wsId: string, type: ConnectorType): Record<string, unknown> {
  return parseJson(db.get<{ config_json: string }>("SELECT config_json FROM connectors WHERE workspace_id = ? AND type = ?", wsId, type)?.config_json, {});
}

export function removeConnector(db: Db, wsId: string, type: ConnectorType): void {
  db.run("DELETE FROM connectors WHERE workspace_id = ? AND type = ?", wsId, type);
}
