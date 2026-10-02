# CONNECTORS.md — Connector Architecture

## 方針
Connector が無くても単体で成立する。初版で**実装済みは ICS のみ**（ファイル取込 + 利用者が設定した URL の手動同期）。メール・連絡先・予定の全件自動取得はしない。scope 最小化。

## インターフェース（`server/connectors/registry.ts`）
`ConnectorDefinition { type, label, description, scopes[], implemented, verification, configFields[] }` と状態 `connectors` テーブル（status: not_configured / configured / connected / error / planned）。
Routes: `GET /api/connectors`（定義+状態、secret は伏せ字）, `PUT /api/connectors/:type`（実装済みのみ）, `POST /api/connectors/:type/sync`, `DELETE`。

## ICS
`parseIcs()`：VEVENT の UID / SUMMARY / DTSTART / DTEND、終日（VALUE=DATE）、UTC/浮動時刻。**TZID のオフセットは適用せず、RRULE は展開しない（1 回分として取込）** — 既知の制限として UI/docs に明記。uid で upsert。Goal/Project へのリンクは単語一致の**候補提示のみ**。

## 計画中（未実装・公式条件未確認）
| Connector | 想定 scope | 状態 |
|---|---|---|
| Google Calendar | calendar.readonly | OAuth 検証要件（sensitive/restricted, CASA）未確認 |
| Microsoft 365 Calendar | Calendars.Read | 未確認 |
| Gmail | 最小 metadata/readonly | restricted scope 審査の可能性。全件取得はしない設計 |
| GitHub | repo read | OAuth App 規約を販売前確認 |
| Notion | integration token / OAuth read | SDK README で API version 2025-09-03 / 2026-03-11 を確認 |
| Readwise | access token | 未確認 |
Pro 版候補（PLAN.md）。
