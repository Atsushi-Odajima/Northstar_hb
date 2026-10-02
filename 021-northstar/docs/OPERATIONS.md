# OPERATIONS.md — 運用

## デプロイ（人間が実施。本セッションでは本番公開を行っていない）
1. Docker: `docker build -t northstar .` → `docker run -d -p 8787:8787 -v northstar-data:/data -e SESSION_SECRET=$(openssl rand -base64 48) -e SECURE_COOKIES=true -e APP_ORIGIN=https://your.domain northstar`。HTTPS 終端はリバースプロキシ（Caddy / nginx / PaaS）で。
2. Render: `render.yaml`（Docker, 永続 disk /data）。Fly.io / Railway / 自宅サーバーでも同様。
3. 初回: `/signup` で自分のアカウントを作り、必要なら `ALLOW_SIGNUP=false` にして再起動（private 運用）。

## バックアップ
- アプリ内: Settings → Export/Backup → 「今すぐバックアップ」で `BACKUP_DIR/<workspaceId>/northstar-backup-*.json`（checksum 付き）。ダウンロードも可能。
- ファイルレベル: `/data/northstar.db`（+ `-wal`）を停止時にコピー、または `sqlite3 northstar.db ".backup out.db"`。
- 推奨: 日次で `POST /api/backup` を cron から（Bearer token 不可のため、UI からの手動 or DB ファイルのコピーを推奨）。retention: BACKUP_DIR は無期限保持。運用者が世代管理（例: 30 世代）を行う。
- Restore: Settings → Restore（validate → merge/replace）。失敗時は現行データ非破壊。

## 監視
- `GET /api/health`（version / schema / time）。
- ログは JSON 行（stdout）。本文は出さない。
- 通知ジョブ: 60 秒間隔、expired session 掃除 6 時間ごと。

## Web Push（任意）
`node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"` で鍵を生成し `VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT(mailto:)` を設定。iOS はホーム画面追加後のみ。

## パスワードリセット（メール送信なし）
運用者が `users.password_hash` を更新: `node -e "import('./dist/server/index.mjs')"` ではなく、`pnpm tsx -e "import {hashPassword} from './server/auth/password'; hashPassword('new-pass').then(console.log)"` でハッシュを作り、`sqlite3 data/northstar.db "UPDATE users SET password_hash='...' WHERE email='...'; DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE email='...');"`。

## アップグレード
`git pull && pnpm install && pnpm build && 再起動`。migration は起動時に自動適用（`schema_migrations`）。事前にバックアップ。

## データ削除
利用者: Settings → Account → 削除（cascade）。運用者: BACKUP_DIR の該当 workspace フォルダも削除。
