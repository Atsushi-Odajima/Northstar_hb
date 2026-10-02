# GOAL_MODEL.md — Vision / Goal Hierarchy / Outcome / Task

## 階層
Vision → Year → Quarter → Month → Week。子 Goal は親より下位のレベルであれば接続可（`canBeChildOf`）。循環・自己参照は拒否。親子の期間が重ならない場合は**警告**（ブロックしない）。親のない Goal も作成可（UI で「未接続」として見える）。

## Goal / Outcome / Task の分離
- **Goal**: 方向（例「ProofFlow 販売開始」）。`successDefinition`（何が起きれば達成）と `why` を持つ。
- **Outcome**: 観測可能な成果（例「販売ページ公開」「初回購入」）。`outcomes` テーブル。
- **Task（Action）**: 手段（例「画像作成」）。`actions` テーブル。

## 進捗（`computeProgress`, shared/rules.ts）
| progressMode | 算出 |
|---|---|
| manual | 利用者が記録した %（`goal_progress_log` に履歴） |
| binary | 達成(100) / 未達(0) |
| milestone | 達成 Outcome / 全 Outcome |
| linked_outcomes | 達成 Outcome / 全 Outcome。**全 Outcome 達成まで 99% 上限** |
Outcome が無い場合は `null`（「未定義」と表示。AI も進捗率を作らない）。**Task 完了数は一切使わない**。

## 健康状態（`assessHealth`）
- `achieved` / `inactive`（status が active でない）
- `on_track`: 21日以内に Outcome 達成 or 進捗記録あり
- `activity_without_outcome`: 21日以内に Task 完了はあるが Outcome/進捗の記録なし → **「順調」とは表示しない**（必須テスト2）
- `stalled`: 21日以上シグナルなし
- `no_signal`: 記録が一度もない
Goal の `status=achieved` への変更は常に利用者の操作。全 Outcome 達成時は UI が提案するだけ。

## North Star
`is_north_star=1 AND status=active`。Vision には付けられない。3件超、または Active Goal 12件以上で警告文を返す（`northStarWarning`）。Today / Dashboard / AI retrieval の最上位に表示。

## Weekly Big 3 / Daily Focus
- `big3_items`: 週（月曜始まり）ごとに rank 1..3（CHECK 制約 + サービス層で dropped を除く live 3 件上限、超過は 409）。Goal/Project/Action に紐付け可。Action に紐づく場合、完了は双方向に同期。
- `daily_focus`: 日ごとに 1 件（UPSERT）。One Thing / why / 関連 Goal / Action。Focus Mode は One Thing・Why・Goal 連鎖・次 Action・関連 Knowledge/People のみ表示。

## 必須テスト対応
1 Year→Quarter→Month→Week relation: `tests/goals.test.ts`。2 Task 完了だけで達成にしない: 同上。3 Big3 上限: `tests/core.test.ts`。
