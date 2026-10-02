# KNOWLEDGE_MODEL.md

## ライフサイクル
Capture（captured）→ What did I learn?（summary / keyIdeas）→ Why matter?（personalMeaning）→ Which Goal?（relations knowledge→goal）→ What action?（nextAction → `/knowledge/:id/action` で Action 作成、status=processed）→ Did I use it?（status=applied, appliedAt, appliedNote）。

## source
article / book / video / podcast / pdf / chat / course / idea / other。chat は**利用者が明示的に export / upload した会話のみ**（`chatImport.ts`: ChatGPT JSON export, Claude JSON export, `user:/assistant:` テキスト）。候補抽出（decision / knowledge / idea / action / question）は AI ON なら provider、OFF ならルールベース。候補には出典（会話名 / メッセージ番号 / 抜粋）を保持し、確認後に保存（E2E-5）。

## AI 下書き
`/api/ai/knowledge/:id/draft`: summary / keyIdeas / goalCandidates（存在する Goal id のみ）/ nextActionCandidate を返すだけ。保存は利用者が項目ごとに採用。

## Review / Today との接続
`nextAction` が埋まり未 applied の item は「Knowledge to Apply」として Today / Dashboard / Weekly Review / AI facts に出る。applied は期間内 Review の「Knowledge Applied」に出る。必須テスト 9（Goal link）、10（Applied）。
