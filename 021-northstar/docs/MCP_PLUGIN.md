# MCP_PLUGIN.md — ChatGPT / Claude / Codex 連携（MCP）

## 実装
- `@modelcontextprotocol/server` v2.2.0（MCP spec 2026-07-28）。`createMcpHandler()` による Streamable HTTP を `/mcp` にマウント（`server/mcp/http.ts`）。stdio 版 `server/mcp/stdio.ts`（`pnpm mcp`）。
- 認証: Settings → Plugin/MCP で発行した API token を `Authorization: Bearer ns_…` で送る。scopes `read` / `write`。失効・最終利用時刻あり。rate limit 120/min/token。
- 2025 世代クライアント（stateless）と 2026-07-28 世代の両方を同一 factory で提供。

## tools
| tool | 種別 | 備考 |
|---|---|---|
| get_today_focus | read | One Thing / Big 3 / 期限 / Follow-up / Decision Review / 停滞 North Star |
| get_weekly_big3 | read | 週指定可 |
| search_northstar | read | FTS5 横断検索 |
| get_person_brief | read | 名前または id。曖昧なら候補を返す。事実のみ |
| find_related_knowledge | read | テーマに関連する Knowledge と未 applied 一覧 |
| list_goals | read | health 付き |
| ask_chief_of_staff | read | AI ON のときのみ。citations 付き |
| review_decision | read/write | id なし→期限一覧、outcome なし→スナップショット表示、outcome あり→**confirm=true が無いと記録しない** |
| capture_item | write | confirm 必須 |
| create_goal | write | **status=draft** で作成。confirm 必須 |
| record_decision | write | confirm 必須 |
| create_followup | write | confirm 必須。人物メモ本文は作成しない |
| set_weekly_big3 | write | 最大3件ルール適用。confirm 必須 |
| start_weekly_review | read/write | 質問 + 期間内データ。answers 保存は confirm 必須（下書きのみ） |

意図確認: 書き込み tool は `confirm` 無しの場合 `{status:"confirmation_required", preview}` を返し、クライアント（ChatGPT/Claude）が利用者に確認してから `confirm:true` で再実行する。`write` scope のない token は `forbidden`。Goal 削除・Decision 結果の無確認確定・Person note 作成の tool は存在しない。

## 接続例
- Claude Desktop / Claude Code（stdio）: `{"command":"pnpm","args":["--dir","<repo>/021-northstar","mcp"],"env":{"NORTHSTAR_DB":"<db>","NORTHSTAR_MCP_TOKEN":"ns_…"}}`
- Remote（ChatGPT Developer mode → Connectors / Claude Remote MCP）: `https://<host>/mcp` + Bearer。公開 HTTPS が必要。ChatGPT Apps SDK の提出要件・OAuth 要件は公式 docs が本環境から到達できず**未確認**（SOURCE_NOTES.md）。OAuth（RFC 9728 metadata）は SDK の `requireBearerAuth` で拡張可能だが初版は Bearer token のみ。

## テスト
`tests/mcp.test.ts`: initialize / tools/list / read tool / write 拒否（read token）/ confirm 無しは preview のみ / confirm で作成 / create_goal は draft / 失効 token は 401。
