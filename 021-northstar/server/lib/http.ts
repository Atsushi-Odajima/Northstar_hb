import type { Context } from "hono";
import type { z } from "zod";
import { badRequest } from "./errors";
import type { Env } from "../context";

export async function parseBody<T extends z.ZodTypeAny>(c: Context<Env>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("JSON body が不正です");
  }
  const res = schema.safeParse(raw);
  if (!res.success) throw badRequest("入力内容を確認してください", res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return res.data;
}

export function parseQuery<T extends z.ZodTypeAny>(c: Context<Env>, schema: T): z.infer<T> {
  const q: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.req.query())) q[k] = v;
  const res = schema.safeParse(q);
  if (!res.success) throw badRequest("クエリが不正です", res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return res.data;
}

export const ws = (c: Context<Env>): string => c.get("auth").workspaceId;
