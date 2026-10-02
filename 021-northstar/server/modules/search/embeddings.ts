import { createHash } from "node:crypto";
import type { Db } from "../../db/connection";
import type { EntityType } from "@shared/types";
import type { EmbeddingProvider } from "../../ai/types";
import { nowIso } from "../../lib/util";
import { linkFor, type SearchHit } from "./search";

export const contentHash = (title: string, body: string) => createHash("sha256").update(title).update("\u0000").update(body).digest("hex").slice(0, 32);

export function toBlob(vec: number[]): Uint8Array { return new Uint8Array(new Float32Array(vec).buffer); }
export function fromBlob(blob: Uint8Array): Float32Array { return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4); }

export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Local-lite embedder: hashed bag-of-character-ngrams. No network, deterministic, limited semantics. */
export class LocalLiteEmbedder implements EmbeddingProvider {
  readonly name = "local-lite" as const;
  readonly model = "local-lite-v1";
  readonly dims = 256;
  async embed(texts: string[]): Promise<number[][]> { return texts.map((t) => localLiteVector(t, this.dims)); }
}
export function localLiteVector(text: string, dims = 256): number[] {
  const v = new Array<number>(dims).fill(0);
  const norm = text.toLowerCase().replace(/\s+/g, " ");
  const tokens: string[] = [];
  for (const w of norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    tokens.push(w);
    if ([...w].length >= 3) { const chars = [...w]; for (let i = 0; i + 2 <= chars.length; i++) tokens.push(chars.slice(i, i + 2).join("")); }
  }
  for (const tok of tokens) {
    const h = createHash("md5").update(tok).digest();
    const idx = h.readUInt32LE(0) % dims;
    const sign = h[4] & 1 ? 1 : -1;
    v[idx] += sign;
  }
  const len = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / len);
}

/** Index documents whose content changed or that have no vector yet (differential update). Returns count embedded. */
export async function syncEmbeddings(db: Db, wsId: string, embedder: EmbeddingProvider, opts: { types?: EntityType[]; excludeTypes?: EntityType[]; limit?: number } = {}): Promise<number> {
  const limit = Math.min(opts.limit ?? 200, 2000);
  const where = ["d.workspace_id = ?"]; const params: (string | number)[] = [wsId];
  if (opts.types?.length) { where.push(`d.entity_type IN (${opts.types.map(() => "?").join(",")})`); params.push(...opts.types); }
  if (opts.excludeTypes?.length) { where.push(`d.entity_type NOT IN (${opts.excludeTypes.map(() => "?").join(",")})`); params.push(...opts.excludeTypes); }
  const rows = db.all<{ entity_type: EntityType; entity_id: string; title: string; body: string; content_hash: string | null; model: string | null }>(
    `SELECT d.entity_type, d.entity_id, d.title, d.body, e.content_hash, e.model FROM search_docs d LEFT JOIN embeddings e ON e.entity_type = d.entity_type AND e.entity_id = d.entity_id WHERE ${where.join(" AND ")} ORDER BY d.updated_at DESC LIMIT ?`,
    ...params, limit * 4,
  );
  const stale = rows.filter((r) => !r.content_hash || r.content_hash !== contentHash(r.title, r.body) || r.model !== embedder.model).slice(0, limit);
  if (stale.length === 0) return 0;
  const batchSize = 32;
  let count = 0;
  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = stale.slice(i, i + batchSize);
    const vectors = await embedder.embed(batch.map((r) => `${r.title}\n${r.body.slice(0, 4000)}`));
    db.transaction(() => {
      batch.forEach((r, j) => {
        db.run(
          `INSERT INTO embeddings(entity_type, entity_id, workspace_id, model, content_hash, dims, vector, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET model = excluded.model, content_hash = excluded.content_hash, dims = excluded.dims, vector = excluded.vector, updated_at = excluded.updated_at`,
          r.entity_type, r.entity_id, wsId, embedder.model, contentHash(r.title, r.body), vectors[j].length, toBlob(vectors[j]), nowIso(),
        );
      });
    });
    count += batch.length;
  }
  return count;
}

export async function searchSemantic(db: Db, wsId: string, q: string, embedder: EmbeddingProvider, opts: { types?: EntityType[]; excludeTypes?: EntityType[]; limit?: number; minScore?: number } = {}): Promise<SearchHit[]> {
  const [qv] = await embedder.embed([q]);
  const where = ["e.workspace_id = ?", "e.model = ?"]; const params: (string | number)[] = [wsId, embedder.model];
  if (opts.types?.length) { where.push(`e.entity_type IN (${opts.types.map(() => "?").join(",")})`); params.push(...opts.types); }
  if (opts.excludeTypes?.length) { where.push(`e.entity_type NOT IN (${opts.excludeTypes.map(() => "?").join(",")})`); params.push(...opts.excludeTypes); }
  // Only records that still exist in the search index are eligible (deleted records are removed from both).
  const rows = db.all<{ entity_type: EntityType; entity_id: string; vector: Uint8Array; title: string; body: string; date: string }>(
    `SELECT e.entity_type, e.entity_id, e.vector, d.title, substr(d.body, 1, 200) AS body, d.date FROM embeddings e JOIN search_docs d ON d.entity_type = e.entity_type AND d.entity_id = e.entity_id WHERE ${where.join(" AND ")}`,
    ...params,
  );
  const scored = rows.map((r) => ({ r, score: cosine(qv, fromBlob(r.vector)) })).filter((x) => x.score >= (opts.minScore ?? 0.05));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(opts.limit ?? 20, 100)).map(({ r, score }) => ({ type: r.entity_type, id: r.entity_id, title: r.title, snippet: r.body, date: r.date, score, link: linkFor(r.entity_type, r.entity_id) }));
}

export function deleteAllEmbeddings(db: Db, wsId: string): number {
  return db.run("DELETE FROM embeddings WHERE workspace_id = ?", wsId).changes;
}
export function embeddingStats(db: Db, wsId: string): { total: number; indexed: number; stale: number } {
  const total = db.get<{ n: number }>("SELECT COUNT(*) n FROM search_docs WHERE workspace_id = ?", wsId)?.n ?? 0;
  const indexed = db.get<{ n: number }>("SELECT COUNT(*) n FROM embeddings WHERE workspace_id = ? AND content_hash <> ''", wsId)?.n ?? 0;
  return { total, indexed, stale: Math.max(0, total - indexed) };
}
