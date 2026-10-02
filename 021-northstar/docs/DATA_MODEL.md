# DATA_MODEL.md — Northstar データモデル

実装: `server/db/schema.ts`（SQLite / `node:sqlite`、migration v1）。型: `shared/types.ts`。API 入力: `shared/schemas.ts`（zod v4）。

## 原則
- **1 user = 1 private workspace**。すべての業務テーブルは `workspace_id` を持ち、API は常に `workspace_id` で絞る（他 user の record は 404）。
- **DB が source of truth**。検索 index（`search_docs` + FTS5）と embedding は派生物で、record 削除時に同一 transaction で削除する。
- **Goal / Outcome / Task を分離**。進捗は Outcome（または手動%）からのみ算出し、Task 完了数からは算出しない。
- **Decision は不変のスナップショット**。レビューは `decision_reviews` に当時の内容を `snapshot_json` として複製する。
- **期間はローカル日付**（YYYY-MM-DD）、時刻は ISO 8601 UTC。Review は workspace timezone で期間境界を計算（`shared/period.ts`）。
- **楽観ロック**: 主要 record は `version` を持ち、PATCH で `version` 不一致なら 409（別端末更新の上書き防止）。

## テーブル一覧
| テーブル | 役割 | 主なカラム |
|---|---|---|
| users | 認証ユーザー | email(UNIQUE), password_hash(scrypt) |
| workspaces | private workspace | owner_user_id, settings_json（timezone / reviewTemplate / ai / notifications / selectedMetricIds / onboardingDone） |
| sessions | Cookie セッション | id = sha256(token), expires_at, last_seen_at |
| api_tokens | MCP/Plugin 用 Bearer token | token_hash, scopes_json(["read","write"]), revoked_at |
| goals | Goal 階層 | level(vision/year/quarter/month/week), parent_id, status, priority, success_definition, why, progress_mode(manual/milestone/binary/linked_outcomes), progress_manual, is_north_star, version |
| goal_progress_log | 進捗の記録 | goal_id, date, progress, note |
| outcomes | Goal の成果 | goal_id, status(open/achieved/dropped), achieved_at |
| projects | Project | status(idea/active/waiting/completed/paused/dropped), outcome, next_action, deadline |
| actions | Task / Open Loop / Waiting / Follow-up | kind, status, due_date, scheduled_date, done_at, goal_id, outcome_id, project_id, person_id, decision_id, knowledge_id, waiting_on |
| big3_items | Weekly Big 3 | week_start, rank(1..3 CHECK), title, goal_id, project_id, action_id, status |
| daily_focus | Today's One Thing | UNIQUE(workspace_id, date), one_thing_title, action_id, goal_id, why |
| captures | Quick Capture / Inbox | raw_text, type, suggested_type, status(inbox/processed/dismissed), processed_into_type/id, source(web/pwa/mcp/import), client_id（offline 冪等キー, partial UNIQUE） |
| decisions | Decision Journal | decided_at, context, options_json, decision, reason, assumptions_json, expected_outcome, risks, confidence, review_date, status(open/reviewed/abandoned) |
| decision_reviews | Decision の結果 | decision_id, reviewed_at, outcome(better/as_expected/worse/too_early/abandoned), result, lessons, snapshot_json, source(web/mcp) |
| reviews | Daily/Weekly/Monthly/Quarterly/Yearly | UNIQUE(workspace_id, kind, period_start), template_id, answers_json, summary_json（完了時の期間内データ snapshot）, status |
| people | Personal CRM | name, organization, role, relationship_type, importance(1..5), tags_json, how_met, notes, last_contact_at, next_follow_up_at |
| contacts | 接点 | person_id, date, type, summary, next_step |
| promises | 約束 | person_id, contact_id, direction(mine/theirs), text, due_date, status |
| follow_ups | Follow-up | person_id, contact_id, due_date, reason, status, done_at |
| knowledge_items | Knowledge | source_type, source_url, source_title, captured_at, summary, key_ideas_json, personal_meaning, next_action, status(captured/processed/applied/archived), applied_at, applied_note, raw_content |
| relations | 汎用リンク（Knowledge→Goal 等） | from_type, from_id, to_type, to_id, kind, UNIQUE 制約 |
| principles | Operating Principle / Anti-goal | kind(principle/anti_goal), text, active, period_start/end |
| experiments | 自己実験 | hypothesis, action, period, success_signal, status, result, lesson |
| metrics / metric_entries | ユーザー選択指標 | source(manual または自動 key), value by date |
| calendar_events | 予定（ICS/manual） | uid, start_at, end_at, all_day, category(goal/meeting/focus/unclassified), goal_id, project_id |
| notifications | アプリ内通知 | UNIQUE(workspace_id, dedupe_key), scheduled_for, delivered_at, read_at |
| push_subscriptions | Web Push 購読 | endpoint(UNIQUE), keys_json |
| ai_usage / ai_messages | AI 利用量・Chief 履歴 | feature, provider, model, tokens, cost_usd / role, content, citations_json |
| embeddings | semantic search 用ベクトル | PK(entity_type, entity_id), model, content_hash（差分更新）, vector(Float32 BLOB) |
| imports | import セッション | kind, preview_json, status |
| connectors | Connector 状態 | type, status, config_json（ICS URL 等）, last_sync_at |
| activity_log | Review 用の出来事ログ | entity_type, entity_id, event, at |
| search_docs + search_fts(FTS5 trigram, external content) | 横断全文検索 | entity_type, entity_id, title, body, date |

## リレーション
- 直接 FK: actions → goals/outcomes/projects/people/decisions/knowledge（ON DELETE SET NULL）。outcomes/goal_progress_log → goals（CASCADE）。contacts/promises/follow_ups → people（CASCADE）。
- 汎用 `relations`: project→goal(supports), decision→goal(informs), decision→person(involves), knowledge→goal/project(applies_to), knowledge→person(from)。`relationsOf()` で双方向に解決。
- 削除時は `cleanupEntity()` が relations / search_docs / embeddings / activity_log を同一 transaction で掃除する。

## Backup 形式
`{ format: "northstar-backup", schemaVersion, appVersion, generatedAt, workspace:{name,settings}, counts, checksum: "sha256:…", tables: {<table>: rows[]} }`。
rows は snake_case の生 row（workspace_id を除く）。restore 前に format / schemaVersion / checksum / FK 整合 / relations 参照先を検証し、失敗時は何も変更しない（単一 transaction）。同一 DB 内の別 workspace への restore では id 衝突を自動 remap（参照も追従）。
