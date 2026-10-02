# DEVELOPMENT.md

## 技術構成
| 層 | 技術 | 備考 |
|---|---|---|
| Web | React 19.3 / TypeScript 5.9 / Vite 7.3 / react-router 7 / TanStack Query 5 / vite-plugin-pwa 1.3 (Workbox 7) / idb 8 | CSS は単一ファイル（design tokens, light/dark） |
| Server | Node 22 / Hono 4.13 / @hono/node-server / zod 4 | 同一プロセスで API + 静的配信 + /mcp |
| DB | `node:sqlite`（SQLite 3.50, FTS5 trigram） | 依存ゼロ・単一ファイル。WAL。migration は `server/db/schema.ts` |
| AI | @anthropic-ai/sdk 0.131 / OpenAI 互換 REST(fetch) / mock / local-lite embedding | provider 抽象 `server/ai/types.ts` |
| MCP | @modelcontextprotocol/server 2.2 + @modelcontextprotocol/hono | Streamable HTTP + stdio |
| Test | Vitest 3 / Playwright 1.63（Chromium） | tests/ と e2e/ |
| Build | esbuild（server → dist/server/*.mjs）/ vite（web → dist/web） | `pnpm build` |

## ディレクトリ
```
021-northstar/
  server/      API (app.ts), auth/, modules/ (goals, actions, projects, captures, decisions, reviews, people, knowledge, focus, misc, transfer, notifications, calendar, search/), ai/, mcp/, connectors/, db/
  shared/      types.ts, schemas.ts (zod), rules.ts (domain rules), period.ts
  web/         Vite root: index.html, src/ (App.tsx, pages/, components/, api/, offline/)
  tests/       Vitest API/unit tests
  e2e/         Playwright specs (E2E-1..9)
  scripts/     dev.mjs, seed-sample.ts, perf.ts, render-icons.mjs
  docs/        設計・運用ドキュメント
  branding/    logo / icons / OG
  購入者向け資料/
```

## コマンド
`pnpm dev` / `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm start` / `pnpm test:e2e` / `pnpm test:perf` / `pnpm seed:sample` / `pnpm db:migrate` / `pnpm mcp`（stdio）/ `pnpm brand:icons`。

## 規約
- API 入力は `shared/schemas.ts` で定義し、PATCH は `patchOf()` で派生（zod v4 の `.partial()` は default を注入するため使わない）。
- モジュール = service 関数（db, wsId, input）+ Hono routes。すべての SELECT/UPDATE/DELETE は `workspace_id` 条件付き。
- 削除は `cleanupEntity()` を同一 transaction で呼ぶ。検索対象の record 変更時は `indexEntity()`。
- 期間・日付計算は `shared/period.ts` のみを使う（timezone は workspace 設定）。
- 進捗・健康・Big3 ルールは `shared/rules.ts`（web と共有）。
- ログに本文を出さない（`lib/log.ts`）。

## 環境変数
`.env.example` 参照。production では `SESSION_SECRET`（32 文字以上）必須、`SECURE_COOKIES=true`、`APP_ORIGIN` を公開 origin に。

## 既知の技術的制限
- node:sqlite は Node 22 で ExperimentalWarning（動作には影響なし）。Node 25 で RC。
- rate limit / jobs は in-memory・単一プロセス前提。
- semantic search は JS cosine（数万件規模向け）。50 万件規模の semantic は sqlite-vec 等への移行を想定（PLAN.md）。
