# SECURITY.md

## 認証・セッション
- パスワードは scrypt（N=2^15, r=8, p=1, 16B salt）。ログイン失敗時も同等コストで比較（タイミング差の軽減）。
- セッション token 32B random、DB には sha256 のみ保存。Cookie: HttpOnly, SameSite=Lax, Secure（`SECURE_COOKIES=true`）, 30 日スライド。パスワード変更で全セッション失効。
- API token（MCP）: `ns_` + 32B random、sha256 保存、scopes、失効可、Bearer のみ。

## CSRF
Cookie 認証の変更系リクエストは `X-Requested-With: Northstar` 必須（CORS 未設定のためクロスオリジンからは送れない）。Origin ヘッダがあれば APP_ORIGIN / Host と照合。Bearer 認証は対象外。

## 入力検証・DB
zod v4 で全入力を検証。SQL は全てパラメータ化。`PRAGMA foreign_keys=ON`。PATCH は `.default()` を剥がした patch schema（未指定キーで既存値を上書きしない）。

## レート制限（in-memory, 単一プロセス）
signup/login 10/min/IP、API 1200/min/IP、AI 30/min/workspace、MCP 120/min/token。クラスタ運用時は Redis 等へ差し替え（`auth/rateLimit.ts`）。

## HTTP ヘッダ / CSP
hono `secureHeaders`: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy camera/microphone/geolocation 無効。
body size: API 2MB / import 30MB / backup 200MB。

## XSS
React のエスケープ。検索 snippet のみ `[ ]` → `<mark>` 変換だが事前に HTML エスケープ済み。

## 秘密情報
`.env`（gitignore）。SESSION_SECRET は production で必須（32 文字以上、起動時チェック）。ICS URL は config_json に保存され UI では伏せ字（暗号化はしていない旨を UI に明記）。

## 削除
record 削除は relations / search index / embeddings / activity を同一 transaction で削除。アカウント削除は users 行の CASCADE で workspace 配下を全削除、index/embedding/session も削除。サーバー側 backup ファイルは運用者が削除（docs/OPERATIONS.md）。

## 既知の制限 / 未実施
- 2FA なし。パスワードリセットメール送信なし（運用者が DB で対応、OPERATIONS.md）。
- node:sqlite は Node 22 では Experimental 警告（Node 25 で RC）。
- 外部ペネトレーションテストは未実施（RELEASE_CHECKLIST）。
