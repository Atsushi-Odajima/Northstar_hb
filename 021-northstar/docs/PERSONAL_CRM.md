# PERSONAL_CRM.md

## エンティティ
- Person: name, organization, role, relationshipType, importance(1 最重要), tags, howMet, notes, lastContactAt, nextFollowUpAt
- Contact: date, type(meeting/call/message/email/event/other), summary, nextStep
- Promise: direction（mine = 自分の約束 / theirs = 相手からの返事待ち）, text, dueDate, status
- Follow-up: dueDate, reason, status

## ルール
- Contact 記録で `lastContactAt` を更新（過去日付を後から追加しても後退しない）。Follow-up 作成で `nextFollowUpAt` を最小の期限に更新。
- 同名人物は**作成時に重複候補として返すだけ**で統合しない。CSV import も重複行はスキップ/別人物のどちらかを利用者が選ぶ（必須テスト22）。
- Brief（`/api/people/:id/brief`）: 前回の接点、話題、自分の約束、返事待ち、未完了 Follow-up、関連 Goal/Project/Knowledge/Decision。**性格・意図の推定は含まない**（API 応答に注意書きを同梱）。
- Promise Tracker と Follow-up は Today / Weekly Review に表示（必須テスト6,7,8）。重要人物（importance ≤ 2）で 30〜45 日接点なしは Review / AI facts で提示。
