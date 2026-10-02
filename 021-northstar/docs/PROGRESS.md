# PROGRESS.md — 進捗（2026-10-02）

## Phase 状況
| Phase | 状態 | 成果物 |
|---|---|---|
| 0 調査・設計 | 完了 | docs/SOURCE_NOTES.md, PLAN.md, DECISIONS.md, DATA_MODEL.md, AI_PRIVACY.md 他 |
| 1 Auth/Workspace/Goals/Projects/Capture | 完了 | server/auth, modules/goals・projects・captures, web Goals/Projects/Capture/Inbox |
| 2 North Star/Big3/Daily Focus/Actions | 完了 | modules/focus・actions, web Today/Focus/Actions/Dashboard |
| 3 Decision Journal | 完了 | modules/decisions, web Decisions/DecisionDetail |
| 4 Review Engine | 完了 | modules/reviews・reviewTemplates, web Reviews/ReviewForm（CEO Meeting） |
| 5 Personal CRM | 完了 | modules/people, web People/PersonDetail（Brief） |
| 6 Knowledge/Import | 完了 | modules/knowledge・transfer(import), ai/chatImport, web Knowledge/KnowledgeDetail/Settings Import |
| 7 Search/Relations | 完了 | modules/search (FTS5 trigram + embeddings), relations, web Search |
| 8 AI Chief of Staff | 完了 | ai/gateway・retrieval・chief・drafts・providers, web Chief/Settings AI |
| 9 Connector/MCP | 完了 | connectors/registry (ICS 実装、他 interface), mcp/tools・http・stdio |
| 10 Export/Backup/Offline/Notifications/Security | 完了 | modules/transfer・notifications, web offline queue, secureHeaders/CSRF/rate limit |
| 11 E2E/Perf/A11y | E2E 実施（Chromium エミュレーション）、Perf 実施、A11y は手動基準 | e2e/, scripts/perf.ts, TEST_REPORT.md |
| 12 Branding/Docs/Deploy | 完了（deploy は手順のみ、実公開なし） | branding/, docs/, Dockerfile, render.yaml, 購入者向け資料/ |

## 完成条件（46 章）チェック
1 PC/iPhone/Android/iPad UX ✓（実機は未検証）／2 PWA ✓／3 Privacy-first ✓／4 Vision/Goal hierarchy ✓／5 Outcome/Task 分離 ✓／6 North Star ✓／7 Big3/Daily Focus ✓／8 Quick Capture ✓／9 Decision Journal/Review ✓／10 Daily〜Quarterly Review ✓／11 CEO Meeting 相当 ✓／12 Personal CRM ✓／13 Follow-up/Promise ✓／14 Knowledge→Action ✓／15 Projects/Open Loops ✓／16 Principles/Anti-goals/Experiments ✓／17 Full-text Search ✓／18 Semantic Search 任意 ✓／19 AI Chief + citations ✓／20 AI OFF/sensitive exclusion ✓／21 Import/Export ✓／22 Backup/Restore ✓／23 Offline capture ✓／24 Notifications ✓（Push は VAPID 設定時）／25 Connector architecture ✓（ICS のみ実装）／26 Plugin/MCP foundation ✓／27 Security/privacy tests ✓／28 必須/E2E/perf tests ✓（TEST_REPORT）／29 Branding/PWA assets ✓／30 購入者資料/運用費 ✓

## 未検証 / 人間確認
- iPhone Safari・Android Chrome・iPad 実機（本環境は Chromium のみ）
- 実 AI provider での課金・疎通（mock で検証）
- Docker build（本環境に Docker なし）、本番公開
- 名称・商標、OpenAI 価格、ChatGPT Apps 提出要件（SOURCE_NOTES / RELEASE_CHECKLIST）
