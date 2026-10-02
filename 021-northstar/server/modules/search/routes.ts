import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../context";
import { ENTITY_TYPES } from "@shared/types";
import type { EntityType } from "@shared/types";
import { parseQuery, ws } from "../../lib/http";
import { searchFullText } from "./search";

export const searchRoutes = new Hono<Env>();
searchRoutes.get("/search", (c) => {
  const q = parseQuery(c, z.object({ q: z.string().trim().min(1).max(200), types: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }));
  const types = q.types?.split(",").filter((t) => (ENTITY_TYPES as readonly string[]).includes(t)) as EntityType[] | undefined;
  const hits = searchFullText(c.get("db"), ws(c), q.q, { types, limit: q.limit });
  return c.json({ query: q.q, hits, mode: "fulltext" });
});
