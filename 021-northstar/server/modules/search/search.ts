import type { Db } from "../../db/connection";
import type { EntityType, Citation } from "@shared/types";
import { ENTITY_TYPES } from "@shared/types";

export interface SearchHit { type: EntityType; id: string; title: string; snippet: string; date: string; score: number; link: string }

export function linkFor(type: EntityType, id: string): string {
  switch (type) {
    case "goal": return `/goals/${id}`;
    case "outcome": return `/goals?outcome=${id}`;
    case "project": return `/projects/${id}`;
    case "action": return `/actions?id=${id}`;
    case "decision": return `/decisions/${id}`;
    case "review": return `/reviews/${id}`;
    case "person": return `/people/${id}`;
    case "contact": return `/people?contact=${id}`;
    case "promise": return `/people?promise=${id}`;
    case "follow_up": return `/people?followUp=${id}`;
    case "knowledge": return `/knowledge/${id}`;
    case "capture": return `/inbox?capture=${id}`;
    case "principle": return `/principles`;
    case "experiment": return `/principles?experiment=${id}`;
    case "calendar_event": return `/calendar?event=${id}`;
  }
}

/** Build an FTS5 query: quote each term (prefix matching), drop terms shorter than 3 chars (trigram tokenizer). */
export function buildFtsQuery(q: string): string | null {
  const terms = q.trim().split(/\s+/).filter(Boolean).filter((t) => [...t].length >= 3);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function searchFullText(db: Db, wsId: string, q: string, opts: { types?: EntityType[]; limit?: number } = {}): SearchHit[] {
  const limit = Math.min(opts.limit ?? 30, 200);
  const types = (opts.types ?? []).filter((t) => (ENTITY_TYPES as readonly string[]).includes(t));
  const typeClause = types.length ? ` AND d.entity_type IN (${types.map(() => "?").join(",")})` : "";
  const fts = buildFtsQuery(q);
  if (fts) {
    const rows = db.all<{ entity_type: EntityType; entity_id: string; title: string; date: string; snippet: string; rank: number }>(
      `SELECT d.entity_type, d.entity_id, d.title, d.date, snippet(search_fts, 1, '[', ']', '…', 14) AS snippet, bm25(search_fts, 2.0, 1.0) AS rank
       FROM search_fts JOIN search_docs d ON d.rowid = search_fts.rowid
       WHERE search_fts MATCH ? AND d.workspace_id = ?${typeClause}
       ORDER BY rank LIMIT ?`,
      fts, wsId, ...types, limit,
    );
    if (rows.length) return rows.map((r) => ({ type: r.entity_type, id: r.entity_id, title: r.title, snippet: r.snippet, date: r.date, score: -r.rank, link: linkFor(r.entity_type, r.entity_id) }));
  }
  // Short query (1–2 chars, common for Japanese) or no FTS hits → LIKE fallback.
  const like = `%${likeEscape(q.trim())}%`;
  const rows = db.all<{ entity_type: EntityType; entity_id: string; title: string; date: string; body: string }>(
    `SELECT entity_type, entity_id, title, date, substr(body, 1, 160) AS body FROM search_docs d WHERE workspace_id = ? AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')${typeClause} ORDER BY updated_at DESC LIMIT ?`,
    wsId, like, like, ...types, limit,
  );
  return rows.map((r) => ({ type: r.entity_type, id: r.entity_id, title: r.title, snippet: r.body, date: r.date, score: 0, link: linkFor(r.entity_type, r.entity_id) }));
}

export function hitToCitation(h: SearchHit): Citation {
  return { type: h.type, id: h.id, title: h.title, snippet: h.snippet.replace(/[\[\]]/g, ""), link: h.link };
}

/** Verify that a citation points at an existing record in this workspace (used by tests and the AI layer). */
export function citationExists(db: Db, wsId: string, c: Pick<Citation, "type" | "id">): boolean {
  return !!db.get("SELECT 1 FROM search_docs WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?", wsId, c.type, c.id);
}
