# OPERATING_COSTS.md — 運用コスト試算（2026-10-02 時点、販売保証値ではない）

## 固定費（インフラ）
| 構成 | 月額目安 | 備考 |
|---|---|---|
| 自宅/手持ちサーバー + Docker | 0 円 | 電気代・ドメイン別 |
| Render Starter（Docker, 5GB disk） | 約 $7 + disk $1.25 | render.yaml 参照。価格は公式で再確認 |
| Fly.io shared-cpu 1x + 3GB volume | 約 $3〜5 | 要再確認 |
| VPS 1 vCPU/1GB | 約 500〜1,000 円 | 任意 |
SQLite 単一ファイルのため DB 料金なし。Object Storage は未使用（添付機能なし）。

## 変動費（AI、ユーザーが ON にした場合のみ）
前提: Chief of Staff 1 問 ≒ 入力 3,000 tokens（facts 40 件 + system）/ 出力 500 tokens。Knowledge draft 1 件 ≒ 入力 4,000 / 出力 600。
| Provider / Model | 入力 $/MTok | 出力 $/MTok | 1 問あたり | 月 100 問 + draft 30 件 |
|---|---|---|---|---|
| Anthropic claude-opus-5-5（既定） | 4 | 20 | ≈ $0.022 | ≈ $3.4 |
| Anthropic claude-sonnet-5-5 | 2 | 10 | ≈ $0.011 | ≈ $1.7 |
| Anthropic claude-haiku-4-5 | 1 | 5 | ≈ $0.0055 | ≈ $0.85 |
| OpenAI 互換 | **未確認**（公式価格ページに本環境から到達不可） | | 環境変数 OPENAI_PRICE_IN/OUT で設定 | |
Anthropic 価格は Claude Code 同梱の公式 doc キャッシュ（2026-09-25）に基づく。販売前に https://platform.claude.com/docs で再確認（RELEASE_CHECKLIST）。

Embedding: local-lite は 0 円（外部送信なし）。OpenAI text-embedding-3-small は約 $0.02/MTok と**仮置き**（未確認）。10 万 record × 300 tokens ≈ 30M tokens ≈ $0.6（初回のみ、以後差分）。

既定の月間上限は $10（Settings で変更）。上限到達で AI 呼び出し停止、usage は Settings/AI ページに表示。

## 想定ユーザー月額まとめ
- AI OFF: インフラ費のみ（0〜約 $8）
- AI ON（Sonnet、月 100 問）: + 約 $2
- AI ON（Opus、月 300 問 + draft 100 件）: + 約 $12（上限設定推奨）
