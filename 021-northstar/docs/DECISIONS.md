# DECISIONS.md — 設計判断の記録

| # | 判断 | 理由 | 代替案 / 見直し条件 |
|---|---|---|---|
| D1 | DB は SQLite（`node:sqlite`, FTS5） | 高機密個人データ・1 user=1 workspace・単一ファイルで backup/restore が単純・native 依存ゼロでインストール失敗しない | Postgres（マルチテナント SaaS 化時）。Node 22 では Experimental 警告（Node 25 で RC） |
| D2 | FTS5 tokenizer は trigram | 日本語（空白なし）の部分一致が必要。3 文字未満は LIKE fallback | unicode61 + 形態素は依存増 |
| D3 | 進捗は Outcome/手動のみ、Task 数は使わない | 中心思想（Task Completion を成功指標にしない）。health に `activity_without_outcome` を導入 | — |
| D4 | Decision はレビュー後ロック + review に snapshot 複製 | 当時の判断を保全（必須テスト 4/5） | 全面 immutable + 改訂履歴（複雑） |
| D5 | Review summary は完了時に凍結保存 | テンプレート変更や後のデータ編集で過去 Review が変わらない | 都度再計算（履歴性が失われる） |
| D6 | AI 既定 OFF、retrieval は facts + FTS (+semantic)、記録ゼロなら provider を呼ばない | Privacy first・捏造防止・コスト | — |
| D7 | 除外カテゴリ → entity type 単位で retrieval/embedding から除外 | 単純で検証可能（テスト 16） | field 単位の細粒度除外（将来） |
| D8 | Anthropic は公式 SDK、既定 model `claude-opus-5-5`、OpenAI は REST fetch | Anthropic はツールチェーン指針通り SDK。OpenAI 互換は gateway 差し替え容易 | OpenAI 公式 SDK（依存増、公式 docs 未到達） |
| D9 | Semantic search は JS cosine + local-lite / OpenAI embedding | 依存ゼロで任意機能として成立。数万件規模向け | sqlite-vec 拡張（Node の allowExtension 要）、Pro 版 |
| D10 | MCP は v2 SDK（spec 2026-07-28）+ Bearer API token + confirm 必須 | 最新 stable。書き込みの意図確認を tool 設計で強制 | OAuth（RFC 9728）は SDK で拡張可能、初版は見送り |
| D11 | CSRF は custom header + Origin 照合、CORS 無効 | SPA 同一 origin 配信。実装が単純で検証容易 | double-submit cookie |
| D12 | PATCH schema は default を剥がした `patchOf()` | zod v4 `.partial()` は default を注入し既存値を上書きする（実際にバグ化したため） | — |
| D13 | Backup = Export（同一 JSON 形式）、restore は validate → 単一 transaction、id 衝突は remap | 空環境ではバイト同一、同一 DB 内の別 workspace でも安全 | — |
| D14 | 通知は dedupe_key UNIQUE で冪等、quiet hours 中は生成しない | 重複防止（テスト 20）、通知過多の回避 | 遅延配送キュー |
| D15 | Rate limit / jobs は in-memory 単一プロセス | 個人利用規模。クラスタ時は Redis へ | — |
| D16 | フロントは React + 単一 CSS（Tailwind 不採用） | 依存最小、PWA/ダークモード/印刷を素直に制御 | — |
| D17 | 画像アセットは Chromium で SVG を PNG 化（sharp 等不使用） | native 依存を避ける。環境の Chromium を利用 | — |
| D18 | iOS Safari 実機は未検証（Chromium エミュレーション） | 本環境に WebKit なし | 販売前に実機確認（RELEASE_CHECKLIST） |
| D19 | 名称は「Northstar」のまま、候補名を SOURCE_NOTES に提示 | 指示通り勝手に変更しない。類似名称が多数存在するため人間確認 | — |
