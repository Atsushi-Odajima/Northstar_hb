# AI_PRIVACY.md — AI とプライバシー

## 既定
- AI は **OFF**。有効化は利用者が Settings → AI & Privacy で行う。
- provider の API key はサーバー環境変数のみ。ブラウザ・export・backup・log に含めない。

## 送信される範囲
- 質問ごとに retrieval した **抜粋のみ**（title + 240 文字程度の snippet + 日付）。workspace 全体は送らない。
- 送信前に UI の AI ページで「AI 対象外カテゴリ」「provider/model」「今月の利用額」を常時表示。
- **除外カテゴリ**（settings.ai.excludedCategories）: journal（Capture 全般）, people（Person/Contact/Promise/Follow-up）, decisions, reviews, knowledge, goals。既定で journal を除外。除外カテゴリは facts / full-text / semantic のすべてから除かれ、embedding も作らない。
- Knowledge draft は対象 item の本文（最大 12,000 文字）と Active Goal のタイトル一覧。Capture 分類はその Capture 本文のみ。Chat 抽出は利用者が貼り付けた会話（最大 400 メッセージ × 600 文字）。

## 送信されないもの
- パスワード、セッション、API token、他 user のデータ、除外カテゴリ、削除済み record（index / embedding も同時削除）。

## Prompt injection
import した Knowledge / Capture 内の命令文はデータとして扱う旨を system prompt で明示。AI には書き込み tool がなく、回答テキストから自動で record を作成・変更・削除することはない（MCP の書き込み tool も人間の confirm 必須）。テスト 30 で goal 不変を検証。

## ログ / Analytics
`server/lib/log.ts` は id・件数・エラーのみを出力し、Goal / Decision / People / Journal の本文は出力しない。Analytics への本文送信は実装していない。

## 利用者の権利
- record 単位の削除（index / embedding / relations も削除）
- AI index の一括削除（Settings → AI）
- 会話履歴の削除（AI ページ）
- アカウント全データ export（JSON）と削除（パスワード確認 + DELETE 入力）

## 将来の限定共有
Coach / Assistant への限定共有は未実装（初版は Team product 化しない）。api_tokens の scopes 構造はその余地として用意。
