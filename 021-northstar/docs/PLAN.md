# PLAN.md — 商品 #021 Northstar 開発計画

## 中心思想
「忙しかったか」ではなく「自分が重要だと決めた方向へ本当に前進したか」。Task Completion を成功指標の中心にしない。Goal と Action をつなぐ。保存より次の Action。AI は重要判断を代行しない。入力負荷を小さくする。

## スコープ（初版）
Vision/Goal Hierarchy・Outcome/Task 分離・North Star・Weekly Big 3・Daily Focus/Focus Mode・Quick Capture/Inbox・Decision Journal/Review・Daily/Weekly/Monthly/Quarterly/Yearly Review（CEO Meeting with Yourself）・Personal CRM（People/Contacts/Promise/Follow-up/Brief）・Knowledge→Action・Projects/Open Loops・Principles/Anti-goals/Experiments・Personal Metrics・Full-text Search・Semantic Search（任意）・AI Chief of Staff（citations, privacy filter, cost control）・Calendar(ICS)/Connector architecture・MCP server（ChatGPT/Claude/Codex）・Import/Export・Backup/Restore・Offline capture・Notifications・Security・PWA・Branding・Docs。

## 広げないもの
会計・銀行・投資売買、医療/心理診断、SNS 自動投稿、汎用 PM、team HR 評価、従業員監視、位置追跡、メール全自動返信、AI による人生決定/人物評価、無断 contact scraping。

## Phase 計画と状態
| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 名称/技術/料金/license 調査、Privacy/AI architecture、PWA PoC | 完了（一部公式 docs は egress 制限で未到達 → SOURCE_NOTES） |
| 1 | Auth, Workspace, Goal hierarchy, Projects, Quick Capture | 完了 |
| 2 | North Star, Big3, Daily Focus, Actions/Open Loops | 完了 |
| 3 | Decision Journal, Review scheduling, Decision Review | 完了 |
| 4 | Daily/Weekly/Monthly/Quarterly Review | 完了 |
| 5 | People, Contacts, Follow-up, Promises, Brief | 完了 |
| 6 | Knowledge, Inbox, Knowledge→Action, Import | 完了 |
| 7 | Full-text/Semantic Search, Relations | 完了（semantic は local-lite / OpenAI 互換 embedding） |
| 8 | AI Chief of Staff, citation, privacy filter, cost control | 完了（実 provider 課金テストは未実施） |
| 9 | Calendar/Connector interface, Plugin/MCP foundation | 完了（Connector は ICS のみ実装、他は interface） |
| 10 | Export/Backup/Restore/Offline/Notifications/Security | 完了（Web Push は VAPID 設定時のみ） |
| 11 | PC/iPhone/Android/iPad E2E, performance, accessibility | E2E は Chromium エミュレーション、実機未検証（TEST_REPORT） |
| 12 | Branding, docs, deploy, 販売前 check | docs/branding 完了、deploy は手順のみ（本番公開は人間判断） |

## Pro 版候補（初版では実装しない）
Calendar/Gmail/GitHub/Notion/Readwise connectors、Voice Capture、ChatGPT/Codex Plugin の正式提出、Coach sharing、encrypted local-first mode、advanced timeline、custom AI provider、automation rules、sqlite-vec による大規模 semantic search、Postgres backend。
