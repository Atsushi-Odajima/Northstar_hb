# SOURCE_NOTES.md — 実装時点の公式情報確認メモ（商品 #021 Northstar）

確認日: 2026-10-02（この開発セッション）。
方針: 公式 source（公式ドキュメント／公式リポジトリ／パッケージ本体）を優先。この開発環境は egress proxy により一部ドメインがブロックされたため、到達できなかった項目は「未確認（人間確認要）」として明示する。**販売前に人間が必ず再確認すること**（RELEASE_CHECKLIST.md 参照）。

## 1. 技術スタック

| 項目 | 確認結果 | Source | 状態 |
|---|---|---|---|
| Node.js | 開発環境 v22.22.0。`node:sqlite` は v22.5.0 追加、v22.13.0/v23.4.0 でフラグ不要化、v25.7.0 で Release candidate (Stability 1.2)。v22 では ExperimentalWarning が出る。FTS5 は Node 同梱 SQLite 3.50.4 で `ENABLE_FTS5` を確認（`PRAGMA compile_options` 実測） | https://nodejs.org/api/sqlite.html（取得済）+ 実測 | 確認済 |
| SQLite FTS5 trigram tokenizer | 日本語（空白区切りなし）を部分一致検索するため trigram を採用。3文字未満の query は LIKE fallback | SQLite 公式 FTS5 doc（記憶ベース。実測で動作確認） | 実測確認 |
| React 19.3 / Vite 7.3.6 / @vitejs/plugin-react 5.2 | Vite 8 は 2026-10 時点で最新だが、周辺プラグインの peer 範囲を確認し **Vite 7** を採用（安定優先） | npm registry (`npm view`) | 確認済 |
| vite-plugin-pwa 1.3.0 | peer: vite ^3.1〜^8.0、workbox 7.4。MIT License。Node 20.19+ | GitHub README (vite-pwa/vite-plugin-pwa) | 確認済（公式サイト vite-pwa-org.netlify.app はブロック） |
| Hono 4.13 + @hono/node-server 1.19 | Node >=16.9 | npm registry | 確認済 |
| zod 4.6.5 | zod v4 API（`z.email()`, `z.iso.date()`等） | npm registry | 確認済 |
| TypeScript 5.9.3 | TS 7.0 (native) は最新だがツールチェーン互換性のため 5.9 系固定 | npm registry | 確認済 |
| Vitest 3.2.7 / Playwright 1.63.0 | 環境に Chromium 1194 (Playwright 1.63 対応) のみ同梱。WebKit/Firefox は未インストール → iOS Safari は **エミュレーション**のみ | 実測 | 確認済 |
| Inter フォント | SIL Open Font License 1.1。商用利用・同梱・再配布可、ライセンス文の同梱が必要。本製品は font file を同梱せず system font stack + 任意で self-host を案内（THIRD_PARTY_NOTICES に記載） | https://github.com/rsms/inter/blob/master/LICENSE.txt | 確認済 |

## 2. AI provider

| 項目 | 確認結果 | Source | 状態 |
|---|---|---|---|
| Anthropic Claude API | SDK `@anthropic-ai/sdk` 0.131.0。モデル/価格（2026-09-25 cache）: Opus 5.5 `claude-opus-5-5` $4/$20 per MTok、Sonnet 5.5 `claude-sonnet-5-5` $2/$10、Haiku 4.5 `claude-haiku-4-5` $1/$5。adaptive thinking、prefill 不可、`output_config.effort` | Claude Code 同梱 claude-api skill（公式 doc キャッシュ）+ npm | 確認済（価格は販売前に https://platform.claude.com/docs で再確認） |
| OpenAI API | openai.com / developers.openai.com は egress block。価格・モデル名は未確認 → OPERATING_COSTS.md では「要再確認」と明記。実装は OpenAI 互換 REST（`/v1/chat/completions`, `/v1/embeddings`）を fetch で呼ぶ provider abstraction とし、モデル名は設定値 | — | **未確認（人間確認要）** |
| Embedding | Anthropic は embedding API を提供しない（Voyage 等を推奨）。本製品の semantic search は OpenAI 互換 embedding または **local-lite**（ハッシュ bag-of-words、外部送信なし・精度は限定）を選択可能 | claude-api skill / 一般知識 | 要再確認 |

## 3. MCP / ChatGPT Plugin

| 項目 | 確認結果 | Source | 状態 |
|---|---|---|---|
| MCP 仕様 | 公式 repo に `2024-11-05 / 2025-03-26 / 2025-06-18 / 2025-11-25 / 2026-07-28 / draft`。最新 **2026-07-28** | https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/docs/specification | 確認済（modelcontextprotocol.io はブロック） |
| MCP TypeScript SDK | **v2 が stable**: `@modelcontextprotocol/server` 2.2.0（2026-07-28 spec 実装）。旧 `@modelcontextprotocol/sdk` 1.31.0 は v1 系。`createMcpHandler(factory)` → web-standard `fetch`、`McpServer.registerTool(name, {inputSchema: z.object, annotations}, cb)`、Streamable HTTP、`@modelcontextprotocol/hono` 2.0.1 adapter | パッケージ同梱 README/d.ts | 確認済 |
| ChatGPT Apps SDK | MCP ベース。Streamable HTTP/SSE。tools は JSON Schema + annotations（readOnlyHint 等）。ChatGPT 側は Developer mode → Settings > Connectors で接続。OAuth 例あり。旧 ChatGPT Plugins は廃止済（一般知識、公式 doc は未到達） | https://github.com/openai/openai-apps-sdk-examples | 一部確認（公式 docs developers.openai.com はブロック → **人間確認要**） |
| Claude (claude.ai / Claude Code) MCP 接続 | Streamable HTTP の remote MCP を Connectors として追加可能 | 一般知識 | 要再確認 |

## 4. Connector 候補（初版は実接続しない。interface と ICS import のみ）

| Connector | 確認結果 | 状態 |
|---|---|---|
| Google Calendar / Gmail | OAuth 検証（sensitive/restricted scope、CASA 評価）が必要。developers.google.com はブロック | **未確認（人間確認要）** |
| Microsoft Graph Calendar | `Calendars.Read` 等 delegated permission。learn.microsoft.com はブロック | **未確認** |
| Notion | SDK default API version `2025-09-03`、新 `2026-03-11`。Integration token / OAuth。MIT | 確認済（公式 docs はブロック、SDK README で確認） |
| Readwise | readwise.io はブロック | **未確認** |
| GitHub | REST API / OAuth App（一般知識） | 要再確認 |
| Web Push | `web-push` 3.6.7。VAPID 鍵生成・`setVapidDetails`・`sendNotification`。Safari 16+/macOS 13+、iOS は Home Screen 追加後のみ | GitHub README | 確認済 |

## 5. 製品名称・商標（Phase0 調査）

- WebSearch（2026-10-02）で「Northstar / North Star」を名称に含む類似サービスを複数確認:
  - "Northstar personal development" (iOS App Store, Manny/Angus Baron) — 習慣・タスク・長期目標
  - "North Star: Goals & Habits" (Krisper AB, iOS) — 目標・習慣トラッカー
  - "NorthStar Notebooks"（紙の planner/journal）、"North Star Journals"（12 Week planner）
  - "North Star Metric" は業界一般用語
- 結論: **「Northstar」単体は目標管理分野で既存名称と重複度が高い**。プロンプトの指示通り名称は変更せず、販売前に人間が商標DB（J-PlatPat / USPTO / EUIPO）を確認すること。
- 候補名（人間確認用の提案、自動変更はしない）: **Northstar OS**, **Northstar Strategy**, **Polaris Desk**, **Meridian Self**, **Truenorth Ledger**。
- 「CEO Meeting with Yourself」は一般的な表現だが、販売前に商標確認推奨（RELEASE_CHECKLIST）。

## 6. この環境でブロックされ到達できなかった公式ドメイン

`modelcontextprotocol.io`, `developers.openai.com`, `openai.com`, `vite-pwa-org.netlify.app`, `developers.google.com`, `readwise.io`, `developers.notion.com`, `learn.microsoft.com`, `developer.mozilla.org`。
いずれも GitHub 上の公式リポジトリ／パッケージ同梱ドキュメントで代替確認したか、未確認として記録した。
