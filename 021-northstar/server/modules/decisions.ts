import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Decision, DecisionReview, DecisionOutcome } from "@shared/types";
import { DecisionCreateSchema, DecisionUpdateSchema, DecisionReviewSchema } from "@shared/schemas";
import { todayIn, addDays } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { badRequest, conflict, notFound } from "../lib/errors";
import { newId, nowIso, parseJson } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { logActivity } from "./activity";
import { relationsOf, setLinks, linkedIds } from "./relations";
import { getWorkspace } from "./workspace";
import { stripUndefined } from "./goals";
import { mapAction } from "./actions";

interface DecisionRow { id: string; workspace_id: string; title: string; decided_at: string; context: string; options_json: string; decision: string; reason: string; assumptions_json: string; expected_outcome: string; risks: string; confidence: number; review_date: string | null; status: Decision["status"]; created_at: string; updated_at: string; version: number }
export function mapDecision(r: DecisionRow): Decision {
  return {
    id: r.id, workspaceId: r.workspace_id, title: r.title, decidedAt: r.decided_at, context: r.context, options: parseJson<string[]>(r.options_json, []), decision: r.decision, reason: r.reason,
    assumptions: parseJson<string[]>(r.assumptions_json, []), expectedOutcome: r.expected_outcome, risks: r.risks, confidence: r.confidence, reviewDate: r.review_date, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at, version: r.version,
  };
}
interface ReviewRow { id: string; workspace_id: string; decision_id: string; reviewed_at: string; outcome: DecisionOutcome; result: string; lessons: string; snapshot_json: string; source: "web" | "mcp"; created_at: string }
export function mapDecisionReview(r: ReviewRow): DecisionReview {
  return { id: r.id, workspaceId: r.workspace_id, decisionId: r.decision_id, reviewedAt: r.reviewed_at, outcome: r.outcome, result: r.result, lessons: r.lessons, snapshot: parseJson(r.snapshot_json, {} as DecisionReview["snapshot"]), source: r.source, createdAt: r.created_at };
}

export interface DecisionView extends Decision { goalIds: string[]; goalTitles: string[]; personIds: string[]; personNames: string[]; reviewCount: number; latestOutcome: DecisionOutcome | null }

export function getDecision(db: Db, wsId: string, id: string): Decision {
  const r = db.get<DecisionRow>("SELECT * FROM decisions WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Decision");
  return mapDecision(r);
}
export function reviewsOf(db: Db, wsId: string, decisionId: string): DecisionReview[] {
  return db.all<ReviewRow>("SELECT * FROM decision_reviews WHERE decision_id = ? AND workspace_id = ? ORDER BY reviewed_at, created_at", decisionId, wsId).map(mapDecisionReview);
}
export function decisionView(db: Db, d: Decision): DecisionView {
  const goalIds = linkedIds(db, d.workspaceId, "decision", d.id, "goal");
  const personIds = linkedIds(db, d.workspaceId, "decision", d.id, "person");
  const reviews = reviewsOf(db, d.workspaceId, d.id);
  return {
    ...d, goalIds, personIds,
    goalTitles: goalIds.map((g) => db.get<{ title: string }>("SELECT title FROM goals WHERE id = ?", g)?.title ?? "").filter(Boolean),
    personNames: personIds.map((p) => db.get<{ name: string }>("SELECT name FROM people WHERE id = ?", p)?.name ?? "").filter(Boolean),
    reviewCount: reviews.length, latestOutcome: reviews.at(-1)?.outcome ?? null,
  };
}
function reindex(db: Db, d: Decision) {
  indexEntity(db, d.workspaceId, "decision", d.id, d.title, [d.context, d.decision, d.reason, d.expectedOutcome, d.risks, ...d.options, ...d.assumptions].filter(Boolean).join("\n"), d.decidedAt);
}

export function listDecisions(db: Db, wsId: string, f: { status?: Decision["status"][]; dueBy?: string; from?: string; to?: string; limit?: number } = {}): Decision[] {
  const where = ["workspace_id = ?"]; const params: (string | number)[] = [wsId];
  if (f.status?.length) { where.push(`status IN (${f.status.map(() => "?").join(",")})`); params.push(...f.status); }
  if (f.dueBy) { where.push("review_date IS NOT NULL AND review_date <= ? AND status = 'open'"); params.push(f.dueBy); }
  if (f.from) { where.push("decided_at >= ?"); params.push(f.from); }
  if (f.to) { where.push("decided_at <= ?"); params.push(f.to); }
  return db.all<DecisionRow>(`SELECT * FROM decisions WHERE ${where.join(" AND ")} ORDER BY decided_at DESC, created_at DESC LIMIT ${Math.min(f.limit ?? 500, 5000)}`, ...params).map(mapDecision);
}

export function createDecision(db: Db, wsId: string, input: z.infer<typeof DecisionCreateSchema>): Decision {
  const id = newId(); const now = nowIso();
  const reviewDate = input.reviewDate ?? addDays(input.decidedAt, 30);
  db.transaction(() => {
    db.run(
      `INSERT INTO decisions(id, workspace_id, title, decided_at, context, options_json, decision, reason, assumptions_json, expected_outcome, risks, confidence, review_date, status, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 1)`,
      id, wsId, input.title, input.decidedAt, input.context, JSON.stringify(input.options), input.decision, input.reason, JSON.stringify(input.assumptions), input.expectedOutcome, input.risks, input.confidence, reviewDate, now, now,
    );
    setLinks(db, wsId, "decision", id, "goal", input.goalIds, "informs");
    setLinks(db, wsId, "decision", id, "person", input.personIds, "involves");
    reindex(db, getDecision(db, wsId, id));
    logActivity(db, wsId, "decision", id, "decision.created", input.title, now);
  });
  return getDecision(db, wsId, id);
}

const LOCKED_AFTER_REVIEW: (keyof z.infer<typeof DecisionUpdateSchema>)[] = ["decidedAt", "context", "options", "decision", "reason", "assumptions", "expectedOutcome", "confidence"];

export function updateDecision(db: Db, wsId: string, id: string, patch: z.infer<typeof DecisionUpdateSchema>): Decision {
  const cur = getDecision(db, wsId, id);
  if (patch.version !== undefined && patch.version !== cur.version) throw conflict("他の端末で更新されています", { current: cur });
  const hasReviews = reviewsOf(db, wsId, id).length > 0;
  if (hasReviews) {
    const touched = LOCKED_AFTER_REVIEW.filter((k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify((cur as unknown as Record<string, unknown>)[k]));
    if (touched.length) throw badRequest(`レビュー済みの判断は当時の内容を変更できません（${touched.join(", ")}）。学びは Review の lessons に記録してください`);
  }
  const { goalIds, personIds, version: _v, ...rest } = patch;
  const next: Decision = { ...cur, ...stripUndefined(rest), version: cur.version + 1, updatedAt: nowIso() } as Decision;
  db.transaction(() => {
    db.run(
      `UPDATE decisions SET title=?, decided_at=?, context=?, options_json=?, decision=?, reason=?, assumptions_json=?, expected_outcome=?, risks=?, confidence=?, review_date=?, updated_at=?, version=? WHERE id=? AND workspace_id=?`,
      next.title, next.decidedAt, next.context, JSON.stringify(next.options), next.decision, next.reason, JSON.stringify(next.assumptions), next.expectedOutcome, next.risks, next.confidence, next.reviewDate, next.updatedAt, next.version, id, wsId,
    );
    if (goalIds) setLinks(db, wsId, "decision", id, "goal", goalIds, "informs");
    if (personIds) setLinks(db, wsId, "decision", id, "person", personIds, "involves");
    reindex(db, next);
  });
  return getDecision(db, wsId, id);
}

export function deleteDecision(db: Db, wsId: string, id: string): void {
  getDecision(db, wsId, id);
  db.transaction(() => { cleanupEntity(db, wsId, "decision", id); db.run("DELETE FROM decisions WHERE id = ? AND workspace_id = ?", id, wsId); });
}

/** Records the outcome. The original decision row is never modified except status/reviewDate; a snapshot is stored with the review. */
export function reviewDecision(db: Db, wsId: string, id: string, input: z.infer<typeof DecisionReviewSchema>, source: "web" | "mcp" = "web"): { decision: Decision; review: DecisionReview } {
  const d = getDecision(db, wsId, id);
  const reviewedAt = input.reviewedAt ?? todayIn(getWorkspace(db, wsId).settings.timezone);
  const snapshot: DecisionReview["snapshot"] = { title: d.title, decidedAt: d.decidedAt, context: d.context, options: d.options, decision: d.decision, reason: d.reason, assumptions: d.assumptions, expectedOutcome: d.expectedOutcome, risks: d.risks, confidence: d.confidence };
  const rid = newId(); const now = nowIso();
  db.transaction(() => {
    db.run("INSERT INTO decision_reviews(id, workspace_id, decision_id, reviewed_at, outcome, result, lessons, snapshot_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      rid, wsId, id, reviewedAt, input.outcome, input.result, input.lessons, JSON.stringify(snapshot), source, now);
    if (input.outcome === "too_early") {
      db.run("UPDATE decisions SET review_date = ?, updated_at = ? WHERE id = ?", addDays(reviewedAt, 30), now, id);
    } else {
      db.run("UPDATE decisions SET status = ?, updated_at = ? WHERE id = ?", input.outcome === "abandoned" ? "abandoned" : "reviewed", now, id);
    }
    logActivity(db, wsId, "decision", id, "decision.reviewed", `${input.outcome}: ${d.title}`, now);
  });
  return { decision: getDecision(db, wsId, id), review: mapDecisionReview(db.get<ReviewRow>("SELECT * FROM decision_reviews WHERE id = ?", rid)!) };
}

export const decisionRoutes = new Hono<Env>();
const Q = z.object({ status: z.string().optional(), due: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().int().optional() });
decisionRoutes.get("/decisions", (c) => {
  const q = parseQuery(c, Q); const db = c.get("db"); const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  const list = listDecisions(db, wsId, { status: q.status?.split(",") as Decision["status"][] | undefined, dueBy: q.due === "now" ? today : q.due, from: q.from, to: q.to, limit: q.limit });
  return c.json({ decisions: list.map((d) => decisionView(db, d)) });
});
decisionRoutes.post("/decisions", async (c) => c.json({ decision: decisionView(c.get("db"), createDecision(c.get("db"), ws(c), await parseBody(c, DecisionCreateSchema))) }, 201));
decisionRoutes.get("/decisions/:id", (c) => {
  const db = c.get("db"); const wsId = ws(c);
  const d = getDecision(db, wsId, c.req.param("id"));
  const actions = db.all("SELECT * FROM actions WHERE decision_id = ? AND workspace_id = ?", d.id, wsId).map((r) => mapAction(r as never));
  return c.json({ decision: decisionView(db, d), reviews: reviewsOf(db, wsId, d.id), relations: relationsOf(db, wsId, "decision", d.id), actions });
});
decisionRoutes.patch("/decisions/:id", async (c) => c.json({ decision: decisionView(c.get("db"), updateDecision(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, DecisionUpdateSchema))) }));
decisionRoutes.delete("/decisions/:id", (c) => { deleteDecision(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
decisionRoutes.post("/decisions/:id/review", async (c) => c.json(reviewDecision(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, DecisionReviewSchema), "web"), 201));
