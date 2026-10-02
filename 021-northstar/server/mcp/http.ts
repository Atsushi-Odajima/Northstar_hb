import { Hono } from "hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import { sha256, nowIso, parseJson } from "../lib/util";
import { buildMcpServer, type McpAuth } from "./tools";
import { rateLimit } from "../auth/rateLimit";

/** Streamable HTTP MCP endpoint (/mcp). Auth: Bearer API token issued in Settings → Plugin/MCP. */
export function mcpRoutes(db: Db): Hono<Env> {
  const app = new Hono<Env>();
  const handler = createMcpHandler((ctx) => {
    const extra = (ctx.authInfo as { extra?: McpAuth } | undefined)?.extra;
    if (!extra) throw new Error("unauthenticated");
    return buildMcpServer(db, extra);
  }, { legacy: "stateless", responseMode: "auto" });

  app.all("/*", async (c) => {
    const header = c.req.header("authorization") ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) return c.json({ error: "unauthorized", message: "Authorization: Bearer <api token> が必要です" }, 401, { "WWW-Authenticate": 'Bearer realm="northstar"' });
    const token = header.slice(7).trim();
    const row = db.get<{ id: string; workspace_id: string; scopes_json: string; revoked_at: string | null }>("SELECT id, workspace_id, scopes_json, revoked_at FROM api_tokens WHERE token_hash = ?", sha256(token));
    if (!row || row.revoked_at) return c.json({ error: "unauthorized", message: "API token が無効です" }, 401);
    const rl = rateLimit(`mcp:${row.id}`, 120, 60_000);
    if (!rl.ok) return c.json({ error: "rate_limited" }, 429);
    db.run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", nowIso(), row.id);
    const extra: McpAuth = { workspaceId: row.workspace_id, scopes: parseJson<string[]>(row.scopes_json, ["read"]), tokenId: row.id };
    const authInfo = { token, clientId: row.id, scopes: extra.scopes, expiresAt: Math.floor(Date.now() / 1000) + 3600, extra } as unknown as NonNullable<Parameters<typeof handler.fetch>[1]>["authInfo"];
    return handler.fetch(c.req.raw, { authInfo });
  });
  return app;
}
