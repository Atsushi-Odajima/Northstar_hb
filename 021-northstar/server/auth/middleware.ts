import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Env } from "../context";
import { findSession, SESSION_COOKIE } from "./sessions";
import { workspaceForUser } from "../modules/workspace";
import { unauthorized, forbidden } from "../lib/errors";
import { sha256, nowIso, parseJson } from "../lib/util";
import { config } from "../config";

/** Resolves a session cookie or Bearer API token into c.var.auth. */
export const authenticate: MiddlewareHandler<Env> = async (c, next) => {
  const db = c.get("db");
  const bearer = c.req.header("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice(7).trim();
    const row = db.get<{ id: string; workspace_id: string; user_id: string; scopes_json: string; revoked_at: string | null }>(
      "SELECT id, workspace_id, user_id, scopes_json, revoked_at FROM api_tokens WHERE token_hash = ?", sha256(token),
    );
    if (!row || row.revoked_at) throw unauthorized("API token が無効です");
    db.run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", nowIso(), row.id);
    c.set("auth", { userId: row.user_id, workspaceId: row.workspace_id, via: "token", scopes: parseJson<string[]>(row.scopes_json, ["read"]) });
    return next();
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) throw unauthorized();
  const session = findSession(db, token);
  if (!session) throw unauthorized("セッションの有効期限が切れました");
  const ws = workspaceForUser(db, session.userId);
  if (!ws) throw unauthorized("workspace がありません");
  c.set("sessionToken", token);
  c.set("auth", { userId: session.userId, workspaceId: ws.id, via: "session", scopes: ["read", "write"] });
  return next();
};

export const requireWrite: MiddlewareHandler<Env> = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (!c.get("auth").scopes.includes("write")) throw forbidden("この API token には write 権限がありません");
  }
  return next();
};

/**
 * CSRF defence for cookie sessions: mutating requests must carry a custom header (forces CORS preflight,
 * which we never allow) and, when an Origin header is present, it must match the app origin / request host.
 */
export const csrfGuard: MiddlewareHandler<Env> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (c.req.header("authorization")?.toLowerCase().startsWith("bearer ")) return next(); // token auth is not cookie-based
  if (c.req.header("x-requested-with") !== "Northstar") throw forbidden("CSRF check failed (missing X-Requested-With)");
  const origin = c.req.header("origin");
  if (origin) {
    const allowed = new Set<string>();
    if (config.appOrigin) allowed.add(config.appOrigin.replace(/\/$/, ""));
    const host = c.req.header("host");
    if (host) { allowed.add(`http://${host}`); allowed.add(`https://${host}`); }
    if (!allowed.has(origin.replace(/\/$/, ""))) throw forbidden("CSRF check failed (origin)");
  }
  return next();
};
