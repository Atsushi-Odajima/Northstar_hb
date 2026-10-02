# RELEASE_CHECKLIST.md — 販売前チェック（人間確認が必要な項目）

## 名称・権利
- [ ] 「Northstar」の商標・類似サービス確認（J-PlatPat / USPTO / EUIPO、App Store の "Northstar personal development" / "North Star: Goals & Habits" 等）。問題あれば候補名（Northstar OS / Northstar Strategy / Polaris Desk / Meridian Self / Truenorth Ledger）から人間が決定。
- [ ] 「CEO Meeting with Yourself」の表現の商標確認。
- [ ] THIRD_PARTY_NOTICES の最終確認（pnpm licenses で全依存を再列挙）。Inter を同梱する場合は OFL 文の同梱。

## 公式情報の再確認（本環境で到達できなかったもの）
- [ ] OpenAI API 価格・モデル名（openai.com）→ OPERATING_COSTS.md / Settings の placeholder を更新。
- [ ] ChatGPT Apps SDK / Connectors の提出・OAuth 要件（developers.openai.com）。
- [ ] Anthropic 価格の最新確認（platform.claude.com）。
- [ ] Google / Microsoft Calendar OAuth 要件（将来 Connector 用）。
- [ ] MCP 仕様 2026-07-28 の変更点（modelcontextprotocol.io）。

## 技術
- [ ] 本番環境変数: SESSION_SECRET（32+）, SECURE_COOKIES=true, APP_ORIGIN, ALLOW_SIGNUP, BACKUP_DIR, VAPID（任意）, AI key（任意）。
- [ ] HTTPS 終端とリバースプロキシ、/mcp の公開可否。
- [ ] `pnpm test` / `pnpm test:e2e` / `pnpm test:perf` が緑（TEST_REPORT.md）。
- [ ] iPhone Safari / Android Chrome / iPad の実機で: ホーム画面追加、standalone 表示、Quick Capture オフライン→同期、通知（Push は VAPID 設定時）。
- [ ] Node 22 LTS 以降での node:sqlite 警告の扱い（起動ログ）。
- [ ] 外部セキュリティレビュー（任意）: SECURITY.md の既知制限（2FA なし、パスワードリセットメールなし）を販売ページに明記。

## AI
- [ ] 実 provider（Anthropic/OpenAI）での疎通確認と 1 問あたりコスト実測 → OPERATING_COSTS.md 更新。
- [ ] AI_PRIVACY.md の内容を販売ページ/利用規約に反映。

## 資料
- [ ] 購入者向け資料 16 ファイルの最終読み合わせ。
- [ ] ブランドボード（branding/brand-board.html）と OG 画像の確認。
- [ ] 価格（39,800〜79,800 円）と提供形態（Web App / PWA、将来 Plugin）の最終決定。
