# REVIEW_ENGINE.md

## 種類と期間
Daily / Weekly（月曜始まり）/ Monthly / Quarterly（暦四半期）/ Yearly。`periodFor(kind, date)`（shared/period.ts）。全部必須ではない。

## 期間厳守
`computeReviewSummary()` は期間 [start, end] に入る record のみ集計する。日付列（decided_at, captured_at, contact date, reviewed_at）は文字列比較、timestamp 列（done_at, achieved_at, applied_at, activity_log.at）は workspace timezone で `periodBounds()` に変換した ISO 範囲で比較（必須テスト11）。

## 集計内容（summary_json）
northStars（progress/health）, goals（progressed / achievedOutcomes / stalled）, big3（週ごと, done/total）, actions（doneCount; 進捗の根拠にはしない）, openLoops, decisions（made / reviewed / dueForReview）, people（contacts / followUpsDone / followUpsOverdue / promisesMineOpen / promisesTheirsOpen / importantNotContacted）, knowledge（captured / applied / toApply）, time（Goal/Meeting/Focus/Unclassified の時間。単一スコアは出さない）, projects, experiments, antiGoals, principles, metrics（ユーザー選択のみ）。
Quarterly/Yearly は月別 breakdown と期間 Goal の結果（必須テスト12）。Monthly は期間内の Weekly Review の Stop/Continue/Start を集約。

## CEO Meeting with Yourself（Weekly）
THIS WEEK = North Star Progress / Decisions / Follow-ups / Knowledge Applied / Stalled Goals / Open Loops（データ側）。NEXT WEEK = Stop / Continue / Start / Big 3（回答側。Big 3 は翌週の `big3_items` を直接作成）。※ 名称の商標確認は RELEASE_CHECKLIST。

## テンプレート
`reviewTemplates.ts`: general / founder / freelancer / creator / manager / investor（投資家向けも金融助言はしない旨を質問文に明記）。Review 作成時に `template_id` を固定するので、設定を変えても過去の Review は変わらない（テスト済み）。

## 完了と Export
`complete=true` で summary を計算して凍結、`review.completed` を activity_log に記録。Markdown export（`/api/reviews/:id/export.md`、全件 `/api/export/reviews.md`）。PDF はブラウザ印刷で生成（追加ライブラリなし）。
