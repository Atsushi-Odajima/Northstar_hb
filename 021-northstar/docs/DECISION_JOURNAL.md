# DECISION_JOURNAL.md

## 記録項目
title, decidedAt, context, options[], decision, reason, assumptions[], expectedOutcome, risks, confidence(0..100), reviewDate（省略時 +30日）, linkedGoals, linkedPeople。

## レビュー（Decision Review）
- `reviewDate <= today AND status=open` のものを Today / Decisions「見直し時期」/ 通知 / MCP `review_decision` で提示。
- レビュー時は**当時の Decision / Reason / Assumptions / Expected / Confidence をそのまま表示**し、Outcome（Better than expected / As expected / Worse / Too early / Abandoned）, result, lessons を記録。
- 記録は `decision_reviews` に追加し、当時の内容を `snapshot_json` に複製（必須テスト4）。
- `too_early` は status を open のまま reviewDate を +30 日。`abandoned` は status=abandoned。それ以外は status=reviewed。
- レビュー後、decidedAt / context / options / decision / reason / assumptions / expectedOutcome / confidence の変更は 400 で拒否（必須テスト5）。title / risks / reviewDate / link は変更可。

## 姿勢
- 「結果が悪い＝判断が悪い」と断定しない（UI 文言・AI system prompt に明記）。
- **判断パターン候補**（`/api/ai/decision-patterns`）は AI ではなく決定的な集計: レビュー済み 5 件以上で、確信度と結果の関係、too_early 比率、レビュー遅延、前提明文化の効果などを「候補」として提示。必ず根拠 Decision へリンク。人格・能力・心理の評価語は使わない。
