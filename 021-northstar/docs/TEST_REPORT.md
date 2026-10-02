# TEST_REPORT.md — テスト結果（2026-10-02）

環境: この開発コンテナ（Linux, 4 vCPU, Node 22.22.0, pnpm 10.28, Chromium 1194 via Playwright 1.63）。本番環境・実機ではない。

## 1. 自動テスト（Vitest）— `pnpm test`
**6 files / 35 tests passed.**

| ファイル | 内容 | 必須テスト対応 |
|---|---|---|
| tests/rules.test.ts | 期間計算、階層、進捗（Task 数非依存）、health、Big3 ルール | 1, 2, 3 |
| tests/goals.test.ts | signup/workspace/CSRF、Vision→Week 階層、Task 完了≠達成、workspace 分離（A→B 拒否）、楽観ロック | 1, 2, 25 |
| tests/core.test.ts | Big3 上限、Decision snapshot/ロック/too_early、CRM（lastContact・Follow-up due・Promise→Weekly・重複非統合）、Knowledge→Goal/Applied、Review 期間厳守・Quarterly 月別、Quick Capture 冪等/処理、横断検索・削除 index 除去、Projects/Open Loops/Anti-goals/Experiments/Metrics、sync 競合 | 3,4,5,6,7,8,9,10,11,12,13,17,18,19,22 |
| tests/ai.test.ts | AI OFF→provider 呼出 0、citation 実在、People 除外、semantic + 削除同期、根拠なし→捏造なし、prompt injection 耐性、下書き/Chat 抽出、月間上限 | 14,15,16,17,28,29,30 |
| tests/transfer.test.ts | Export→空環境 Restore（checksum 一致・relations 一致）、同一 DB 別 workspace への id remap、破損/新 schema 拒否（非破壊）、CSV import preview/mapping/重複、Markdown import、Chat export→候補→確認→保存（AI OFF）、通知 dedupe、ICS/Connector | 20, 21, 22, 23, 24 |
| tests/mcp.test.ts | initialize/tools/list、read tool、read token の write 拒否、confirm 無し→preview のみ、confirm で作成、create_goal は draft、失効 token 401 | 26, 27 |

## 2. E2E（Playwright, Chromium）— `pnpm build && pnpm test:e2e`
プロジェクト: pc-chromium（1366×850）/ iphone（iPhone 14 エミュレーション: viewport・UA・touch）/ android（Pixel 7）/ ipad（iPad gen 7）。**WebKit（実 Safari）は本環境に無いためエミュレーションのみ**。

| # | シナリオ | pc | iphone | android | ipad |
|---|---|---|---|---|---|
| E2E-1 | Vision→Quarter→Month North Star→Big3→One Thing→Weekly Review（CEO Meeting） | ✓ | ✓ | ✓ | ✓ |
| E2E-2 | Decision 記録→30日後 Review→Result/Lesson→Monthly Review | ✓ | ✓ | ✓ | ✓ |
| E2E-3 | Person→Contact→Promise→Follow-up→Brief | ✓ | ✓ | ✓ | ✓ |
| E2E-4 | Knowledge→AI 下書き→Goal link→Action→Applied（mock AI） | ✓ | ✓ | ✓ | ✓ |
| E2E-5 | Chat export→候補→人間確認→保存 | ✓ | ✓ | ✓ | ✓ |
| E2E-6 | AI Chief「最近止まっている Goal」→実 record citation | ✓ | ✓ | ✓ | ✓ |
| E2E-7 | PWA Quick Capture（オフライン下書き→同期）→PC Inbox→Goal link、manifest 検証 | ✓ | ✓ | ✓ | ✓ |
| E2E-8 | AI OFF で主要非 AI 機能 | ✓ | ✓ | ✓ | ✓ |
| E2E-9 | 全データ export→空環境 restore→relations 一致 | ✓ | ✓ | ✓ | ✓ |
初回実行で見つかった問題と修正: (a) E2E-7 の同期ボタンが自動同期で消える競合 → テストを auto-sync 待ちに変更、(b) 同一 IP からの 40 件サインアップが認証レート制限（10/分）に到達 → `AUTH_RATE_LIMIT_PER_MIN` を環境変数化（本番既定は 10 のまま）。

## 3. アクセシビリティ（axe-core via @axe-core/playwright）— `e2e/a11y.spec.ts`
対象: ログイン画面 + 主要 15 画面（/today, /, /goals, /decisions, /people, /knowledge, /reviews, /reviews/weekly, /inbox, /capture, /ai, /settings, /principles, /calendar, /search）。基準: serious / critical 違反ゼロ（color-contrast を含む全ルール）。
結果: **pc-chromium 2/2 passed, iphone 2/2 passed**。
初回スキャンで検出し修正した違反: color-contrast（補助テキスト #8a93a6 → #667085、dark は #8f9ab0）、select-name / label（フィルタ・インライン入力に aria-label 追加）、link-in-text-block（本文中リンクに下線）。
手動基準: すべての入力に label、チェックボタンに aria-label、モーダルに role=dialog/aria-modal、タブに role=tab/aria-selected、通知領域に aria-live、キーボードフォーカス可視（:focus-visible）。スクリーンリーダー実機は未検証。

## 4. 性能（生成データ）— `pnpm test:perf`
PLACEHOLDER_PERF

## 5. 実機・外部確認（未実施 / 人間確認）
- iPhone Safari / Android Chrome / iPad 実機（ホーム画面追加、standalone、Push）: **未実施**（本環境に実機・WebKit なし）
- 実 AI provider（Anthropic / OpenAI）疎通・課金: **未実施**（mock provider で論理を検証）
- Docker build: **未検証**（本環境は Docker CLI のみで daemon が起動していない）。Dockerfile は multi-stage（pnpm install → pnpm build → prod deps のみ）で記述済み。販売前に `docker build` と `/api/health` 確認が必要
- 本番公開: 未実施（人間判断）
