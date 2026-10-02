import type { Db } from "../db/connection";
import type { EntityType } from "@shared/types";
import type { AiRuntime } from "./gateway";
import { searchFullText, linkFor, type SearchHit } from "../modules/search/search";
import { searchSemantic, syncEmbeddings } from "../modules/search/embeddings";
import { todayIn, weekStart, addDays } from "@shared/period";
import { getWorkspace } from "../modules/workspace";
import { northStars, goalView, listGoals } from "../modules/goals";
import { linkedIds } from "../modules/relations";

export interface RetrievedRecord { n: number; type: EntityType; id: string; title: string; snippet: string; date: string; link: string; source: "facts" | "search" | "semantic" }
export interface Scope { types?: EntityType[]; from?: string; to?: string; goalId?: string; personId?: string }

const STOP = new Set(["について", "ですか", "ください", "何", "どれ", "最近", "今週", "今月", "今日", "べき", "いる", "ある", "する", "した", "こと", "もの", "the", "what", "which", "should", "is", "are", "my", "me", "to", "of", "and", "for", "on", "in", "with"]);

/** Extract keyword candidates from a (Japanese/English) question for full-text search. */
export function keywordsFrom(question: string): string[] {
  const raw = question.replace(/[?？。、,.!！「」『』()（）]/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const tok of raw) {
    // split Japanese particles crudely to surface nouns like ProofFlow / 目標 / 人物名
    const parts = tok.split(/(?:について|に関して|とは|ための|から|まで|など|の|は|が|を|に|で|と|も|へ|や)/).filter(Boolean);
    for (const p of parts) if ([...p].length >= 2 && !STOP.has(p)) out.push(p);
  }
  return [...new Set(out)].slice(0, 8);
}

function withinScope(r: { type: EntityType; date: string }, scope: Scope): boolean {
  if (scope.types?.length && !scope.types.includes(r.type)) return false;
  if (scope.from && r.date && r.date < scope.from) return false;
  if (scope.to && r.date && r.date > scope.to) return false;
  return true;
}

/** Structured facts (always deterministic) — the backbone of every Chief of Staff answer. */
export function structuredFacts(db: Db, wsId: string, excluded: EntityType[], scope: Scope): Omit<RetrievedRecord, "n">[] {
  const tz = getWorkspace(db, wsId).settings.timezone;
  const today = todayIn(tz);
  const out: Omit<RetrievedRecord, "n">[] = [];
  const allow = (t: EntityType) => !excluded.includes(t);
  const push = (type: EntityType, id: string, title: string, snippet: string, date: string) => { if (allow(type)) out.push({ type, id, title, snippet, date, link: linkFor(type, id), source: "facts" }); };

  if (allow("goal")) {
    for (const g of northStars(db, wsId).map((g) => goalView(db, wsId, g, today))) push("goal", g.id, g.title, `North Star (${g.level}) progress=${g.progress.percent ?? "n/a"}% health=${g.health.health}: ${g.health.reason}`, g.endDate ?? today);
    for (const g of listGoals(db, wsId, { status: ["active"] }).map((g) => goalView(db, wsId, g, today)).filter((g) => !g.isNorthStar && ["stalled", "no_signal", "activity_without_outcome"].includes(g.health.health)).slice(0, 8))
      push("goal", g.id, g.title, `Active goal (${g.level}) health=${g.health.health}: ${g.health.reason}`, g.endDate ?? today);
    const week = weekStart(today);
    for (const b of db.all<{ id: string; title: string; status: string; goal_id: string | null; action_id: string | null }>("SELECT id, title, status, goal_id, action_id FROM big3_items WHERE workspace_id = ? AND week_start = ? ORDER BY rank", wsId, week))
      if (b.goal_id) push("goal", b.goal_id, b.title, `This week's Big 3 item "${b.title}" status=${b.status}`, week);
      else if (b.action_id) push("action", b.action_id, b.title, `This week's Big 3 item status=${b.status}`, week);
    for (const a of db.all<{ id: string; title: string; kind: string; waiting_on: string; due_date: string | null }>("SELECT id, title, kind, waiting_on, due_date FROM actions WHERE workspace_id = ? AND status = 'open' AND kind IN ('open_loop','waiting') ORDER BY due_date LIMIT 8", wsId))
      push("action", a.id, a.title, `${a.kind === "waiting" ? `Waiting on ${a.waiting_on}` : "Open loop"}${a.due_date ? ` due ${a.due_date}` : ""}`, a.due_date ?? today);
  }
  if (allow("decision")) {
    for (const d of db.all<{ id: string; title: string; review_date: string; decided_at: string; confidence: number }>("SELECT id, title, review_date, decided_at, confidence FROM decisions WHERE workspace_id = ? AND status = 'open' AND review_date IS NOT NULL AND review_date <= ? ORDER BY review_date LIMIT 8", wsId, addDays(today, 7)))
      push("decision", d.id, d.title, `Decision made ${d.decided_at} (confidence ${d.confidence}%), review due ${d.review_date}`, d.decided_at);
  }
  if (allow("promise")) {
    for (const p of db.all<{ id: string; text: string; direction: string; due_date: string | null; name: string }>("SELECT pr.id, pr.text, pr.direction, pr.due_date, p.name FROM promises pr JOIN people p ON p.id = pr.person_id WHERE pr.workspace_id = ? AND pr.status = 'open' ORDER BY pr.due_date IS NULL, pr.due_date LIMIT 10", wsId))
      push("promise", p.id, p.text, `${p.direction === "mine" ? `I promised ${p.name}` : `Waiting for ${p.name}`}${p.due_date ? ` (due ${p.due_date})` : ""}`, p.due_date ?? today);
  }
  if (allow("follow_up")) {
    for (const f of db.all<{ id: string; reason: string; due_date: string; name: string }>("SELECT f.id, f.reason, f.due_date, p.name FROM follow_ups f JOIN people p ON p.id = f.person_id WHERE f.workspace_id = ? AND f.status = 'open' AND f.due_date <= ? ORDER BY f.due_date LIMIT 8", wsId, addDays(today, 3)))
      push("follow_up", f.id, `${f.name}: ${f.reason}`, `Follow-up due ${f.due_date}`, f.due_date);
  }
  if (allow("person")) {
    for (const p of db.all<{ id: string; name: string; last_contact_at: string | null; importance: number }>("SELECT id, name, last_contact_at, importance FROM people WHERE workspace_id = ? AND importance <= 2 AND (last_contact_at IS NULL OR last_contact_at < ?) ORDER BY last_contact_at LIMIT 6", wsId, addDays(today, -30)))
      push("person", p.id, p.name, `Important person (importance ${p.importance}), last contact ${p.last_contact_at ?? "never"}`, p.last_contact_at ?? today);
  }
  if (allow("knowledge")) {
    for (const k of db.all<{ id: string; title: string; next_action: string; captured_at: string }>("SELECT id, title, next_action, captured_at FROM knowledge_items WHERE workspace_id = ? AND status IN ('captured','processed') AND next_action <> '' ORDER BY captured_at DESC LIMIT 6", wsId))
      push("knowledge", k.id, k.title, `Knowledge not yet applied; next action: ${k.next_action}`, k.captured_at);
  }
  return out.filter((r) => withinScope(r, scope));
}

export async function retrieve(db: Db, wsId: string, question: string, scope: Scope, rt: AiRuntime): Promise<RetrievedRecord[]> {
  const excluded = rt.excluded;
  const seen = new Set<string>();
  const records: RetrievedRecord[] = [];
  const add = (r: Omit<RetrievedRecord, "n">) => {
    if (excluded.includes(r.type)) return;
    if (!withinScope(r, scope)) return;
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push({ ...r, n: records.length + 1 });
  };
  for (const f of structuredFacts(db, wsId, excluded, scope)) add(f);

  const fromHit = (h: SearchHit, source: "search" | "semantic"): Omit<RetrievedRecord, "n"> => ({ type: h.type, id: h.id, title: h.title, snippet: h.snippet.replace(/[\[\]]/g, "").slice(0, 240), date: h.date, link: h.link, source });
  const types = scope.types;
  for (const kw of [question, ...keywordsFrom(question)]) {
    for (const h of searchFullText(db, wsId, kw, { types, limit: 8 })) add(fromHit(h, "search"));
    if (records.length >= 40) break;
  }
  if (rt.embedder && rt.settings.features.semantic_search && records.length < 40) {
    try {
      await syncEmbeddings(db, wsId, rt.embedder, { excludeTypes: excluded, limit: 200 });
      for (const h of await searchSemantic(db, wsId, question, rt.embedder, { types, excludeTypes: excluded, limit: 10, minScore: 0.15 })) add(fromHit(h, "semantic"));
    } catch { /* semantic is optional; full-text results still stand */ }
  }
  // Scope by goal / person via relations and direct FK columns.
  if (scope.goalId) {
    const related = new Set<string>([scope.goalId, ...db.all<{ id: string }>("SELECT id FROM actions WHERE goal_id = ?", scope.goalId).map((r) => r.id)]);
    for (const t of ["knowledge", "decision", "project", "person"] as EntityType[]) for (const id of linkedIds(db, wsId, "goal", scope.goalId, t)) related.add(id);
    return records.filter((r) => related.has(r.id) || r.type === "goal" && r.id === scope.goalId).map((r, i) => ({ ...r, n: i + 1 }));
  }
  if (scope.personId) {
    const related = new Set<string>([scope.personId]);
    for (const row of db.all<{ id: string }>("SELECT id FROM promises WHERE person_id = ? UNION SELECT id FROM follow_ups WHERE person_id = ? UNION SELECT id FROM contacts WHERE person_id = ? UNION SELECT id FROM actions WHERE person_id = ?", scope.personId, scope.personId, scope.personId, scope.personId)) related.add(row.id);
    for (const t of ["knowledge", "decision", "project", "goal"] as EntityType[]) for (const id of linkedIds(db, wsId, "person", scope.personId, t)) related.add(id);
    return records.filter((r) => related.has(r.id)).map((r, i) => ({ ...r, n: i + 1 }));
  }
  return records.slice(0, 40);
}

/** Journal text is never included even when reviews are allowed. */
export function stripJournal(snippet: string): string { return snippet; }
