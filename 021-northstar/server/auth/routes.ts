import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { Env } from "../context";
import { SignupSchema, LoginSchema } from "@shared/schemas";
import { parseBody } from "../lib/http";
import { hashPassword, verifyPassword } from "./password";
import { createSession, deleteSession, SESSION_COOKIE, deleteAllSessions } from "./sessions";
import { createWorkspace, workspaceForUser, getUser } from "../modules/workspace";
import { newId, nowIso } from "../lib/util";
import { AppError, badRequest, forbidden, tooMany, unauthorized } from "../lib/errors";
import { rateLimit } from "./rateLimit";
import { config } from "../config";
import { authenticate } from "./middleware";
import { log } from "../lib/log";

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  secure: config.secureCookies,
  path: "/",
  maxAge: config.sessionDays * 86400,
});

export const authRoutes = new Hono<Env>();

const ipOf = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "local";

authRoutes.post("/signup", async (c) => {
  if (!config.allowSignup) throw forbidden("新規登録は無効化されています");
  const rl = rateLimit(`signup:${ipOf(c)}`, config.authRateLimitPerMin, 60_000);
  if (!rl.ok) throw tooMany();
  const body = await parseBody(c, SignupSchema);
  const db = c.get("db");
  const exists = db.get("SELECT 1 FROM users WHERE email = ?", body.email);
  if (exists) throw new AppError(409, "email_taken", "このメールアドレスは既に登録されています");
  const passwordHash = await hashPassword(body.password);
  const userId = newId();
  const now = nowIso();
  db.transaction(() => {
    db.run("INSERT INTO users(id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", userId, body.email, passwordHash, body.displayName ?? "", now, now);
    createWorkspace(db, userId, body.displayName ? `${body.displayName} の Northstar` : "My Northstar");
  });
  const { token } = createSession(db, userId, c.req.header("user-agent") ?? "");
  setCookie(c, SESSION_COOKIE, token, cookieOpts());
  log("info", "user.signup", { userId });
  return c.json({ user: getUser(db, userId), workspace: workspaceForUser(db, userId) }, 201);
});

authRoutes.post("/login", async (c) => {
  const rl = rateLimit(`login:${ipOf(c)}`, config.authRateLimitPerMin, 60_000);
  if (!rl.ok) throw tooMany("ログイン試行が多すぎます。1分後に再試行してください");
  const body = await parseBody(c, LoginSchema);
  const db = c.get("db");
  const row = db.get<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", body.email);
  const ok = row ? await verifyPassword(body.password, row.password_hash) : await verifyPassword(body.password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  if (!row || !ok) throw unauthorized("メールアドレスまたはパスワードが違います");
  const { token } = createSession(db, row.id, c.req.header("user-agent") ?? "");
  setCookie(c, SESSION_COOKIE, token, cookieOpts());
  return c.json({ user: getUser(db, row.id), workspace: workspaceForUser(db, row.id) });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) deleteSession(c.get("db"), token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.post("/change-password", authenticate, async (c) => {
  const body = await c.req.json().catch(() => null) as { currentPassword?: string; newPassword?: string } | null;
  if (!body?.currentPassword || !body?.newPassword || body.newPassword.length < 10) throw badRequest("新しいパスワードは10文字以上");
  const db = c.get("db");
  const auth = c.get("auth");
  const row = db.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", auth.userId);
  if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) throw unauthorized("現在のパスワードが違います");
  db.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", await hashPassword(body.newPassword), nowIso(), auth.userId);
  deleteAllSessions(db, auth.userId);
  const { token } = createSession(db, auth.userId, c.req.header("user-agent") ?? "");
  setCookie(c, SESSION_COOKIE, token, cookieOpts());
  return c.json({ ok: true });
});
