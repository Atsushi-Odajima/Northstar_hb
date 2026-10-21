# Northstar — 目標を日々の行動につなぐ

長期目標、今週の重点、意思決定、人とのフォロー、学びと振り返りを一つにつなぐ個人向け管理アプリです。

> **実装ブランチ：`claude/northstar-strategy-os-unyfds`**。この既定ブランチのREADMEは製品の案内です。以下のソース・資料リンクと起動手順は、実装ブランチを参照します。

## できること

- 目標階層、Weekly Big 3、Daily Focus、レビュー
- 意思決定の記録、Personal CRM、Knowledgeからの行動化
- 出典付きAI支援、MCP、検索、インポート・バックアップ

## 現在の範囲・制限

- AIは既定OFFです。送信カテゴリを選んで接続する構成で、実プロバイダでの品質・料金確認は別途必要です。
- iPhone / Android / iPadの実機・Push・PWA同期の確認は残っています。画面エミュレーションと実機検証を区別しています。

## 実装の見どころ

**構成：** React / TypeScript / Vite、Node.js、SQLite、PWA、MCP、pnpm。

- [021-northstar/server](https://github.com/Atsushi-Odajima/Northstar_hb/tree/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/server)
- [021-northstar/web/src/pages](https://github.com/Atsushi-Odajima/Northstar_hb/tree/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/web/src/pages)
- [021-northstar/tests](https://github.com/Atsushi-Odajima/Northstar_hb/tree/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/tests)

## ローカルで試す

Node.js 22.13以上、リポジトリで指定されたpnpm。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/northstar-strategy-os-unyfds https://github.com/Atsushi-Odajima/Northstar_hb.git
cd Northstar_hb/021-northstar
pnpm install
cp .env.example .env
```

.envのSESSION_SECRETを生成した値へ変更してから pnpm dev を実行します。APIは8787、Webは5173です。

環境設定・初期化の詳細：[セットアップ手順](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/DEVELOPMENT.md)。
WindowsでBash形式の補助スクリプトを使う場合は、WSL等の対応環境で実行してください。

## 検証方法

`021-northstar/` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
pnpm run typecheck
pnpm run test
pnpm run test:e2e
pnpm run build
pnpm run build:web
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [021-northstar/docs/DEVELOPMENT.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/DEVELOPMENT.md)
- [021-northstar/docs/NEXT_STEPS.txt](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/NEXT_STEPS.txt)
- [021-northstar/README.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/README.md)
- [021-northstar/docs/TEST_REPORT.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/TEST_REPORT.md)
- [021-northstar/docs/RELEASE_CHECKLIST.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/RELEASE_CHECKLIST.md)
- [021-northstar/docs/DATA_MODEL.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/DATA_MODEL.md)
- [021-northstar/docs/DECISIONS.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/DECISIONS.md)
- [021-northstar/docs/SECURITY.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/SECURITY.md)
- [021-northstar/docs/OPERATIONS.md](https://github.com/Atsushi-Odajima/Northstar_hb/blob/claude%2Fnorthstar-strategy-os-unyfds/021-northstar/docs/OPERATIONS.md)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
