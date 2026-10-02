import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import { AiAskSchema, SearchQuerySchema } from "@shared/schemas";
import { ENTITY_TYPES } from "@shared/types";
import type { EntityType } from "@shared/types";
import { parseBody, parseQuery, ws } from "../lib/http";
import { askChief, chiefHistory, clearChiefHistory } from "./chief";
import { draftKnowledge, classifyCapture, extractFromChat, decisionPatterns } from "./drafts";
import { aiStatus, requireAi, usageSummary, excludedTypesFor } from "./gateway";
import { searchSemantic, syncEmbeddings, deleteAllEmbeddings, embeddingStats } from "../modules/search/embeddings";
import { searchFullText } from "../modules/search/search";
import { getWorkspace } from "../modules/workspace";

export const aiRoutes = new Hono<Env>();

aiRoutes.get("/ai/status", (c) => c.json(aiStatus(c.get("db"), ws(c))));
aiRoutes.get("/ai/usage", (c) => c.json(usageSummary(c.get("db"), ws(c))));
aiRoutes.post("/ai/ask", async (c) => {
  const body = await parseBody(c, AiAskSchema);
  return c.json(await askChief(c.get("db"), ws(c), body.question, body.scope));
});
aiRoutes.get("/ai/history", (c) => c.json({ messages: chiefHistory(c.get("db"), ws(c)) }));
aiRoutes.delete("/ai/history", (c) => { clearChiefHistory(c.get("db"), ws(c)); return c.json({ ok: true }); });
aiRoutes.post("/ai/knowledge/:id/draft", async (c) => c.json(await draftKnowledge(c.get("db"), ws(c), c.req.param("id"))));
aiRoutes.post("/ai/captures/:id/classify", async (c) => c.json(await classifyCapture(c.get("db"), ws(c), c.req.param("id"))));
aiRoutes.post("/ai/chat-import/extract", async (c) => {
  const body = await parseBody(c, z.object({ content: z.string().min(1).max(20_000_000), fileName: z.string().max(200).default("") }));
  return c.json(await extractFromChat(c.get("db"), ws(c), body.content, body.fileName));
});
aiRoutes.get("/ai/decision-patterns", (c) => {
  const db = c.get("db"); const wsId = ws(c);
  const settings = getWorkspace(db, wsId).settings.ai;
  if (settings.enabled && !settings.features.decision_patterns) return c.json({ enough: false, disabled: true, patterns: [] });
  if (settings.excludedCategories.includes("decisions")) return c.json({ enough: false, excluded: true, patterns: [] });
  return c.json(decisionPatterns(db, wsId));
});
aiRoutes.get("/ai/embeddings", (c) => c.json(embeddingStats(c.get("db"), ws(c))));
aiRoutes.post("/ai/embeddings/sync", async (c) => {
  const db = c.get("db"); const wsId = ws(c);
  const rt = requireAi(db, wsId, "semantic_search");
  if (!rt.embedder) return c.json({ error: { code: "no_embedder", message: "embedding model が設定されていません", details: null } }, 409);
  const n = await syncEmbeddings(db, wsId, rt.embedder, { excludeTypes: rt.excluded, limit: 500 });
  return c.json({ embedded: n, ...embeddingStats(db, wsId) });
});
aiRoutes.delete("/ai/embeddings", (c) => c.json({ deleted: deleteAllEmbeddings(c.get("db"), ws(c)) }));

/** Semantic search (optional AI feature) with citations to real records. */
aiRoutes.get("/search/semantic", async (c) => {
  const q = parseQuery(c, z.object({ q: z.string().trim().min(1).max(200), types: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }));
  const db = c.get("db"); const wsId = ws(c);
  const rt = requireAi(db, wsId, "semantic_search");
  if (!rt.embedder) return c.json({ error: { code: "no_embedder", message: "embedding model が設定されていません", details: null } }, 409);
  const types = q.types?.split(",").filter((t) => (ENTITY_TYPES as readonly string[]).includes(t)) as EntityType[] | undefined;
  await syncEmbeddings(db, wsId, rt.embedder, { excludeTypes: rt.excluded, limit: 300 });
  const semantic = await searchSemantic(db, wsId, q.q, rt.embedder, { types, excludeTypes: rt.excluded, limit: q.limit ?? 20 });
  const fulltext = searchFullText(db, wsId, q.q, { types, limit: 10 }).filter((h) => !rt.excluded.includes(h.type));
  return c.json({ query: q.q, mode: "semantic", embedding: rt.embedder.model, hits: semantic, fulltextHits: fulltext, excludedTypes: excludedTypesFor(rt.settings) });
});
export { SearchQuerySchema };
