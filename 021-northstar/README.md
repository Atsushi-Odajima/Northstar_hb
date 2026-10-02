# Northstar — Personal Strategy OS

**人生にも、経営戦略を。** 「忙しい。でも何も進んでない。」を終わらせる。

Vision → Year → Quarter → Month → Weekly Big 3 → Daily Focus → Decision Journal → People / Follow-up → Knowledge → Daily/Weekly/Monthly/Quarterly Review → AI Chief of Staff → 次の Focus を一つにつなぐ、個人向けの Personal Strategy OS。

- Web App / PWA（PC / iPhone Safari / Android / iPad）
- Privacy first: 1 user = 1 private workspace、AI は既定 OFF、送信カテゴリを選択可能
- 専門機能: Goal Hierarchy / Decision Journal / Review Engine（CEO Meeting with Yourself）/ Personal CRM / Knowledge → Action / Full-text + Semantic Search / AI Chief of Staff with citations / MCP server / Import / Export / Backup / Restore

## クイックスタート（開発）
```bash
cd 021-northstar
pnpm install
cp .env.example .env     # SESSION_SECRET を変更
pnpm dev                 # API: http://localhost:8787  Web: http://localhost:5173
```
本番ビルド: `pnpm build && pnpm start`（`dist/web` を同一プロセスで配信）。Docker: `docker build -t northstar . && docker run -p 8787:8787 -v northstar-data:/data -e SESSION_SECRET=... northstar`。

サンプル workspace（架空データ）: `pnpm seed:sample` → `data/sample.db`（`NORTHSTAR_DB=./data/sample.db pnpm start`、ログイン `sample@northstar.local / sample-password-123`）。本番 DB とは別ファイル。

## テスト
```bash
pnpm test        # Vitest（API / ルール / AI / MCP / backup）
pnpm build && pnpm test:e2e   # Playwright（PC / iPhone / Android / iPad エミュレーション）
pnpm test:perf   # 生成データで性能測定（docs/PERF_RESULTS.md）
```

## ドキュメント
`docs/`（PLAN / PROGRESS / DECISIONS / DATA_MODEL / GOAL_MODEL / DECISION_JOURNAL / REVIEW_ENGINE / PERSONAL_CRM / KNOWLEDGE_MODEL / AI_CHIEF_OF_STAFF / AI_PRIVACY / CONNECTORS / MCP_PLUGIN / SECURITY / OPERATIONS / OPERATING_COSTS / TEST_REPORT / RELEASE_CHECKLIST / SOURCE_NOTES）、購入者向け資料は `購入者向け資料/`。
