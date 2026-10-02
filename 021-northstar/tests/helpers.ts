import { openDatabase, type Db } from "../server/db/connection";
import { createApp } from "../server/app";
import type { Hono } from "hono";
import type { Env } from "../server/context";

export interface TestCtx { db: Db; app: Hono<Env>; cookie: string; workspaceId: string; userId: string }

export function makeApp(): { db: Db; app: Hono<Env> } {
  const db = openDatabase(":memory:");
  return { db, app: createApp(db) };
}

export async function api(app: Hono<Env>, method: string, path: string, body?: unknown, cookie = "", extraHeaders: Record<string, string> = {}): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { "X-Requested-With": "Northstar", ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

let counter = 0;
export async function signup(app: Hono<Env>, email?: string): Promise<{ cookie: string; workspaceId: string; userId: string }> {
  counter++;
  const res = await api(app, "POST", "/api/auth/signup", { email: email ?? `user${counter}-${Date.now()}@example.com`, password: "correct-horse-battery", displayName: `User ${counter}` });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.json)}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  return { cookie, workspaceId: res.json.workspace.id, userId: res.json.user.id };
}

export async function ctx(): Promise<TestCtx> {
  const { db, app } = makeApp();
  const s = await signup(app);
  return { db, app, ...s };
}

export const ok = (res: { status: number; json: any }, expected = 200) => {
  if (res.status !== expected) throw new Error(`expected ${expected} got ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json;
};
