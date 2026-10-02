import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import { ApiTokenCreateSchema } from "@shared/schemas";
import { parseBody, ws } from "../lib/http";
import { badRequest, unauthorized, forbidden } from "../lib/errors";
import { newId, nowIso, randomToken, sha256, parseJson } from "../lib/util";
import { verifyPassword } from "../auth/password";
import { deleteAllSessions } from "../auth/sessions";
import { exportWorkspace } from "./transfer";
import { log } from "../lib/log";

export const accountRoutes = new Hono<Env>();

/** API tokens for MCP / plugin access. The raw token is shown once. */
accountRoutes.get("/tokens", (c) => {
  const rows = c.get("db").all<{ id: string; name: string; scopes_json: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>("SELECT id, name, scopes_json, created_at, last_used_at, revoked_at FROM api_tokens WHERE workspace_id = ? ORDER BY created_at DESC", ws(c));
  return c.json({ tokens: rows.map((r) => ({ id: r.id, name: r.name, scopes: parseJson<string[]>(r.scopes_json, []), createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at })) });
});
accountRoutes.post("/tokens", async (c) => {
  if (c.get("auth").via !== "session") throw forbidden("API token の発行はブラウザからのみ可能です");
  const body = await parseBody(c, ApiTokenCreateSchema);
  const raw = `ns_${randomToken(32)}`;
  const id = newId();
  c.get("db").run("INSERT INTO api_tokens(id, workspace_id, user_id, name, token_hash, scopes_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, ws(c), c.get("auth").userId, body.name, sha256(raw), JSON.stringify(body.scopes), nowIso());
  return c.json({ id, name: body.name, scopes: body.scopes, token: raw, note: "この token は二度と表示されません。安全な場所に保存してください" }, 201);
});
accountRoutes.delete("/tokens/:id", (c) => {
  if (c.get("auth").via !== "session") throw forbidden();
  c.get("db").run("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL", nowIso(), c.req.param("id"), ws(c));
  return c.json({ ok: true });
});

/** Account export = full data export (same format as backup). */
accountRoutes.get("/account/export", (c) => {
  const f = exportWorkspace(c.get("db"), ws(c));
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="northstar-account-export-${f.generatedAt.slice(0, 10)}.json"`);
  return c.body(JSON.stringify(f, null, 2));
});

/** Deletes the account, workspace and every record (cascade), plus sessions, tokens, search index and embeddings. */
accountRoutes.delete("/account", async (c) => {
  if (c.get("auth").via !== "session") throw forbidden("アカウント削除はブラウザからのみ可能です");
  const body = await parseBody(c, z.object({ password: z.string().min(1), confirm: z.literal("DELETE") }));
  const db = c.get("db");
  const { userId, workspaceId } = c.get("auth");
  const row = db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", userId);
  if (!row || !(await verifyPassword(body.password, row.password_hash))) throw unauthorized("パスワードが違います");
  db.transaction(() => {
    db.run("DELETE FROM search_docs WHERE workspace_id = ?", workspaceId);
    db.run("DELETE FROM embeddings WHERE workspace_id = ?", workspaceId);
    deleteAllSessions(db, userId);
    db.run("DELETE FROM users WHERE id = ?", userId); // cascades to workspace and all records
  });
  log("info", "account.deleted", { userId });
  return c.json({ ok: true });
});
export { badRequest };
