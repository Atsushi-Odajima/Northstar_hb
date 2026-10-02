import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Review, ReviewKind } from "@shared/types";
import { REVIEW_KINDS } from "@shared/types";
import { ReviewUpsertSchema } from "@shared/schemas";
import { periodFor, periodBounds, todayIn, type Period, weekStart, addDays, monthPeriod, isWithin } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { notFound } from "../lib/errors";
import { newId, nowIso, parseJson } from "../lib/util";
import { logActivity, activityBetween } from "./activity";
import { getWorkspace } from "./workspace";
import { listGoals, goalView, northStars } from "./goals";
import { questionsFor, TEMPLATE_IDS, TEMPLATE_LABELS } from "./reviewTemplates";
import { indexEntity, cleanupEntity } from "./search/indexer";

interface ReviewRow { id: string; workspace_id: string; kind: ReviewKind; period_start: string; period_end: string; template_id: string; answers_json: string; summary_json: string | null; status: Review["status"]; completed_at: string | null; created_at: string; updated_at: string }
export function mapReview(r: ReviewRow): Review {
  return { id: r.id, workspaceId: r.workspace_id, kind: r.kind, periodStart: r.period_start, periodEnd: r.period_end, templateId: r.template_id, answers: parseJson(r.answers_json, {}), summary: r.summary_json ? parseJson(r.summary_json, null) : null, status: r.status, completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function getReview(db: Db, wsId: string, id: string): Review {
  const r = db.get<ReviewRow>("SELECT * FROM reviews WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Review");
  return mapReview(r);
}
export function findReview(db: Db, wsId: string, kind: ReviewKind, periodStart: string): Review | null {
  const r = db.get<ReviewRow>("SELECT * FROM reviews WHERE workspace_id = ? AND kind = ? AND period_start = ?", wsId, kind, periodStart);
  return r ? mapReview(r) : null;
}
export function listReviews(db: Db, wsId: string, f: { kind?: ReviewKind; limit?: number; from?: string; to?: string } = {}): Review[] {
  const where = ["workspace_id = ?"]; const params: (string | number)[] = [wsId];
  if (f.kind) { where.push("kind = ?"); params.push(f.kind); }
  if (f.from) { where.push("period_start >= ?"); params.push(f.from); }
  if (f.to) { where.push("period_end <= ?"); params.push(f.to); }
  return db.all<ReviewRow>(`SELECT * FROM reviews WHERE ${where.join(" AND ")} ORDER BY period_start DESC LIMIT ${Math.min(f.limit ?? 50, 2000)}`, ...params).map(mapReview);
}

// ---------- period-scoped summary ----------
export function computeReviewSummary(db: Db, wsId: string, kind: ReviewKind, period: Period, timezone: string, today: string): Record<string, unknown> {
  const { startIso, endIso } = periodBounds(period, timezone);
  const inPeriod = (date: string | null) => !!date && isWithin(date.slice(0, 10), period);
  const titleOf = (table: string, id: string, col = "title") => db.get<{ t: string }>(`SELECT ${col} AS t FROM ${table} WHERE id = ?`, id)?.t ?? "(削除済み)";

  // Goals & North Star
  const activeGoals = listGoals(db, wsId, { status: ["active"] }).map((g) => goalView(db, wsId, g, period.end <= today ? period.end : today));
  const ns = northStars(db, wsId).map((g) => goalView(db, wsId, g, period.end <= today ? period.end : today));
  const activity = activityBetween(db, wsId, startIso, endIso);
  const progressed = activity.filter((a) => a.event === "goal.progress" || a.event === "goal.status").map((a) => ({ goalId: a.entityId, title: titleOf("goals", a.entityId), detail: a.detail, at: a.at }));
  const achievedOutcomes = db.all<{ id: string; title: string; goal_id: string; achieved_at: string }>("SELECT id, title, goal_id, achieved_at FROM outcomes WHERE workspace_id = ? AND status = 'achieved' AND achieved_at >= ? AND achieved_at < ?", wsId, startIso, endIso)
    .map((o) => ({ id: o.id, title: o.title, goalTitle: titleOf("goals", o.goal_id), achievedAt: o.achieved_at }));
  const stalled = activeGoals.filter((g) => g.health.health === "stalled" || g.health.health === "no_signal" || g.health.health === "activity_without_outcome").map((g) => ({ id: g.id, title: g.title, level: g.level, health: g.health.health, reason: g.health.reason, lastSignalAt: g.health.lastSignalAt }));

  // Big 3 for weeks overlapping the period
  const weeks: string[] = [];
  for (let w = weekStart(period.start); w <= period.end; w = addDays(w, 7)) weeks.push(w);
  const big3 = weeks.map((w) => ({
    weekStart: w,
    items: db.all<{ id: string; title: string; status: string; goal_id: string | null }>("SELECT id, title, status, goal_id FROM big3_items WHERE workspace_id = ? AND week_start = ? ORDER BY rank", wsId, w)
      .map((b) => ({ id: b.id, title: b.title, status: b.status, goalTitle: b.goal_id ? titleOf("goals", b.goal_id) : null })),
  })).filter((w) => w.items.length > 0);
  const big3Done = big3.flatMap((w) => w.items).filter((i) => i.status === "done").length;
  const big3Total = big3.flatMap((w) => w.items).filter((i) => i.status !== "dropped").length;

  // Actions
  const actionsDone = db.all<{ id: string; title: string; done_at: string; goal_id: string | null }>("SELECT id, title, done_at, goal_id FROM actions WHERE workspace_id = ? AND status = 'done' AND done_at >= ? AND done_at < ? ORDER BY done_at", wsId, startIso, endIso);
  const openLoops = db.all<{ id: string; title: string; kind: string; waiting_on: string; due_date: string | null }>("SELECT id, title, kind, waiting_on, due_date FROM actions WHERE workspace_id = ? AND status = 'open' AND kind IN ('open_loop','waiting') ORDER BY due_date", wsId)
    .map((a) => ({ id: a.id, title: a.title, kind: a.kind, waitingOn: a.waiting_on, dueDate: a.due_date }));

  // Decisions
  const decisionsMade = db.all<{ id: string; title: string; decided_at: string; confidence: number; review_date: string | null; status: string }>("SELECT id, title, decided_at, confidence, review_date, status FROM decisions WHERE workspace_id = ? AND decided_at BETWEEN ? AND ? ORDER BY decided_at", wsId, period.start, period.end)
    .map((d) => ({ id: d.id, title: d.title, decidedAt: d.decided_at, confidence: d.confidence, reviewDate: d.review_date, status: d.status }));
  const decisionsReviewed = db.all<{ id: string; decision_id: string; outcome: string; reviewed_at: string; lessons: string }>("SELECT id, decision_id, outcome, reviewed_at, lessons FROM decision_reviews WHERE workspace_id = ? AND reviewed_at BETWEEN ? AND ? ORDER BY reviewed_at", wsId, period.start, period.end)
    .map((r) => ({ id: r.id, decisionId: r.decision_id, title: titleOf("decisions", r.decision_id), outcome: r.outcome, reviewedAt: r.reviewed_at, lessons: r.lessons }));
  const decisionsDue = db.all<{ id: string; title: string; review_date: string }>("SELECT id, title, review_date FROM decisions WHERE workspace_id = ? AND status = 'open' AND review_date IS NOT NULL AND review_date <= ? ORDER BY review_date", wsId, period.end)
    .map((d) => ({ id: d.id, title: d.title, reviewDate: d.review_date }));

  // People
  const contacts = db.all<{ id: string; person_id: string; date: string; type: string; summary: string }>("SELECT id, person_id, date, type, summary FROM contacts WHERE workspace_id = ? AND date BETWEEN ? AND ? ORDER BY date", wsId, period.start, period.end)
    .map((c) => ({ id: c.id, personId: c.person_id, personName: titleOf("people", c.person_id, "name"), date: c.date, type: c.type, summary: c.summary.slice(0, 120) }));
  const followUpsDone = activity.filter((a) => a.event === "follow_up.done").length;
  const followUpsOverdue = db.all<{ id: string; person_id: string; due_date: string; reason: string }>("SELECT id, person_id, due_date, reason FROM follow_ups WHERE workspace_id = ? AND status = 'open' AND due_date <= ? ORDER BY due_date", wsId, period.end)
    .map((f) => ({ id: f.id, personName: titleOf("people", f.person_id, "name"), dueDate: f.due_date, reason: f.reason }));
  const promisesOpen = db.all<{ id: string; person_id: string; direction: string; text: string; due_date: string | null }>("SELECT id, person_id, direction, text, due_date FROM promises WHERE workspace_id = ? AND status = 'open' ORDER BY due_date IS NULL, due_date", wsId)
    .map((p) => ({ id: p.id, personName: titleOf("people", p.person_id, "name"), direction: p.direction, text: p.text, dueDate: p.due_date }));
  const importantNotContacted = db.all<{ id: string; name: string; last_contact_at: string | null; importance: number }>("SELECT id, name, last_contact_at, importance FROM people WHERE workspace_id = ? AND importance <= 2 AND (last_contact_at IS NULL OR last_contact_at < ?) ORDER BY last_contact_at", wsId, addDays(period.end, -45))
    .map((p) => ({ id: p.id, name: p.name, lastContactAt: p.last_contact_at, importance: p.importance }));

  // Knowledge
  const knowledgeCaptured = db.all<{ id: string; title: string; source_type: string; status: string }>("SELECT id, title, source_type, status FROM knowledge_items WHERE workspace_id = ? AND captured_at BETWEEN ? AND ? ORDER BY captured_at", wsId, period.start, period.end)
    .map((k) => ({ id: k.id, title: k.title, sourceType: k.source_type, status: k.status }));
  const knowledgeApplied = db.all<{ id: string; title: string; applied_at: string; applied_note: string }>("SELECT id, title, applied_at, applied_note FROM knowledge_items WHERE workspace_id = ? AND status = 'applied' AND applied_at >= ? AND applied_at < ?", wsId, startIso, endIso)
    .map((k) => ({ id: k.id, title: k.title, appliedAt: k.applied_at, note: k.applied_note }));
  const knowledgeToApply = db.all<{ id: string; title: string; next_action: string }>("SELECT id, title, next_action FROM knowledge_items WHERE workspace_id = ? AND status IN ('captured','processed') AND next_action <> '' ORDER BY captured_at DESC LIMIT 20", wsId)
    .map((k) => ({ id: k.id, title: k.title, nextAction: k.next_action }));

  // Calendar / time
  const events = db.all<{ title: string; start_at: string; end_at: string; all_day: number; category: string }>("SELECT title, start_at, end_at, all_day, category FROM calendar_events WHERE workspace_id = ? AND start_at >= ? AND start_at < ?", wsId, startIso, endIso);
  const byCategory: Record<string, number> = { goal: 0, meeting: 0, focus: 0, unclassified: 0 };
  for (const e of events) {
    if (e.all_day) continue;
    const h = Math.max(0, (Date.parse(e.end_at) - Date.parse(e.start_at)) / 3_600_000);
    byCategory[e.category] = (byCategory[e.category] ?? 0) + h;
  }
  const totalHours = Object.values(byCategory).reduce((a, b) => a + b, 0);

  // Projects / experiments / anti-goals / principles
  const projects = db.all<{ id: string; title: string; status: string; next_action: string; deadline: string | null }>("SELECT id, title, status, next_action, deadline FROM projects WHERE workspace_id = ? AND status IN ('active','waiting') ORDER BY status", wsId)
    .map((p) => ({ id: p.id, title: p.title, status: p.status, nextAction: p.next_action, deadline: p.deadline }));
  const projectChanges = activity.filter((a) => a.event === "project.status").map((a) => ({ id: a.entityId, title: titleOf("projects", a.entityId), detail: a.detail }));
  const experiments = db.all<{ id: string; title: string; status: string; result: string; lesson: string; period_end: string | null }>("SELECT id, title, status, result, lesson, period_end FROM experiments WHERE workspace_id = ? AND (status = 'running' OR (period_end BETWEEN ? AND ?))", wsId, period.start, period.end)
    .map((e) => ({ id: e.id, title: e.title, status: e.status, result: e.result, lesson: e.lesson, periodEnd: e.period_end }));
  const antiGoals = db.all<{ id: string; text: string; period_start: string | null; period_end: string | null }>("SELECT id, text, period_start, period_end FROM principles WHERE workspace_id = ? AND kind = 'anti_goal' AND active = 1 AND (period_start IS NULL OR period_start <= ?) AND (period_end IS NULL OR period_end >= ?)", wsId, period.end, period.start)
    .map((p) => ({ id: p.id, text: p.text }));
  const principles = db.all<{ id: string; text: string }>("SELECT id, text FROM principles WHERE workspace_id = ? AND kind = 'principle' AND active = 1", wsId);

  // Metrics (user-selected only)
  const settings = getWorkspace(db, wsId).settings;
  const metrics = settings.selectedMetricIds.map((mid) => {
    const m = db.get<{ id: string; name: string; unit: string; source: string }>("SELECT id, name, unit, source FROM metrics WHERE id = ? AND workspace_id = ?", mid, wsId);
    if (!m) return null;
    const auto = autoMetricValue(db, wsId, m.source, startIso, endIso, period);
    const manual = db.get<{ s: number | null }>("SELECT SUM(value) s FROM metric_entries WHERE metric_id = ? AND date BETWEEN ? AND ?", mid, period.start, period.end)?.s ?? null;
    return { id: m.id, name: m.name, unit: m.unit, source: m.source, value: auto ?? manual ?? 0 };
  }).filter(Boolean);

  const summary: Record<string, unknown> = {
    kind, period, computedAt: nowIso(),
    northStars: ns.map((g) => ({ id: g.id, title: g.title, level: g.level, progress: g.progress, health: g.health })),
    goals: { activeCount: activeGoals.length, progressed, achievedOutcomes, stalled },
    big3: { weeks: big3, done: big3Done, total: big3Total },
    actions: { doneCount: actionsDone.length, done: actionsDone.slice(0, 30).map((a) => ({ id: a.id, title: a.title, doneAt: a.done_at, goalTitle: a.goal_id ? titleOf("goals", a.goal_id) : null })) },
    openLoops,
    decisions: { made: decisionsMade, reviewed: decisionsReviewed, dueForReview: decisionsDue },
    people: { contactCount: contacts.length, contacts: contacts.slice(0, 30), followUpsDone, followUpsOverdue, promisesMineOpen: promisesOpen.filter((p) => p.direction === "mine"), promisesTheirsOpen: promisesOpen.filter((p) => p.direction === "theirs"), importantNotContacted },
    knowledge: { capturedCount: knowledgeCaptured.length, captured: knowledgeCaptured.slice(0, 30), applied: knowledgeApplied, toApply: knowledgeToApply },
    time: { totalHours: Math.round(totalHours * 10) / 10, byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, Math.round(v * 10) / 10])), eventCount: events.length },
    projects: { active: projects, changes: projectChanges },
    experiments, antiGoals, principles, metrics,
  };

  if (kind === "quarterly" || kind === "yearly") {
    const months: Record<string, unknown>[] = [];
    for (let m = monthPeriod(period.start); m.start <= period.end; m = monthPeriod(addDays(m.end, 1))) {
      const b = periodBounds(m, timezone);
      months.push({
        month: m.start.slice(0, 7),
        decisions: db.get<{ n: number }>("SELECT COUNT(*) n FROM decisions WHERE workspace_id = ? AND decided_at BETWEEN ? AND ?", wsId, m.start, m.end)?.n ?? 0,
        decisionReviews: db.get<{ n: number }>("SELECT COUNT(*) n FROM decision_reviews WHERE workspace_id = ? AND reviewed_at BETWEEN ? AND ?", wsId, m.start, m.end)?.n ?? 0,
        knowledgeApplied: db.get<{ n: number }>("SELECT COUNT(*) n FROM knowledge_items WHERE workspace_id = ? AND applied_at >= ? AND applied_at < ?", wsId, b.startIso, b.endIso)?.n ?? 0,
        actionsDone: db.get<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE workspace_id = ? AND done_at >= ? AND done_at < ?", wsId, b.startIso, b.endIso)?.n ?? 0,
        outcomesAchieved: db.get<{ n: number }>("SELECT COUNT(*) n FROM outcomes WHERE workspace_id = ? AND achieved_at >= ? AND achieved_at < ?", wsId, b.startIso, b.endIso)?.n ?? 0,
        contacts: db.get<{ n: number }>("SELECT COUNT(*) n FROM contacts WHERE workspace_id = ? AND date BETWEEN ? AND ?", wsId, m.start, m.end)?.n ?? 0,
        monthlyReviewDone: !!findReview(db, wsId, "monthly", m.start)?.completedAt,
      });
    }
    summary.monthlyBreakdown = months;
    const quarterGoals = listGoals(db, wsId, { level: kind === "quarterly" ? ["quarter"] : ["year"] }).filter((g) => (!g.startDate || g.startDate <= period.end) && (!g.endDate || g.endDate >= period.start))
      .map((g) => goalView(db, wsId, g, today)).map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress, health: g.health, isNorthStar: g.isNorthStar }));
    summary.periodGoals = quarterGoals;
  }
  if (kind === "monthly") {
    summary.weeklyReviews = listReviews(db, wsId, { kind: "weekly", from: period.start, to: addDays(period.end, 6) })
      .filter((r) => r.periodStart <= period.end)
      .map((r) => ({ id: r.id, weekStart: r.periodStart, status: r.status, stop: r.answers.stop ?? "", continue: r.answers.continue ?? "", start: r.answers.start ?? "" }));
  }
  return summary;
}

function autoMetricValue(db: Db, wsId: string, source: string, startIso: string, endIso: string, period: Period): number | null {
  switch (source) {
    case "knowledge_applied": return db.get<{ n: number }>("SELECT COUNT(*) n FROM knowledge_items WHERE workspace_id = ? AND applied_at >= ? AND applied_at < ?", wsId, startIso, endIso)?.n ?? 0;
    case "decision_reviews": return db.get<{ n: number }>("SELECT COUNT(*) n FROM decision_reviews WHERE workspace_id = ? AND reviewed_at BETWEEN ? AND ?", wsId, period.start, period.end)?.n ?? 0;
    case "decisions_made": return db.get<{ n: number }>("SELECT COUNT(*) n FROM decisions WHERE workspace_id = ? AND decided_at BETWEEN ? AND ?", wsId, period.start, period.end)?.n ?? 0;
    case "important_followups": return db.get<{ n: number }>("SELECT COUNT(*) n FROM follow_ups f JOIN people p ON p.id = f.person_id WHERE f.workspace_id = ? AND f.status = 'done' AND f.done_at >= ? AND f.done_at < ? AND p.importance <= 2", wsId, startIso, endIso)?.n ?? 0;
    case "actions_done": return db.get<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE workspace_id = ? AND done_at >= ? AND done_at < ?", wsId, startIso, endIso)?.n ?? 0;
    case "outcomes_achieved": return db.get<{ n: number }>("SELECT COUNT(*) n FROM outcomes WHERE workspace_id = ? AND achieved_at >= ? AND achieved_at < ?", wsId, startIso, endIso)?.n ?? 0;
    case "focus_hours": { const r = db.all<{ s: string; e: string }>("SELECT start_at s, end_at e FROM calendar_events WHERE workspace_id = ? AND category = 'focus' AND all_day = 0 AND start_at >= ? AND start_at < ?", wsId, startIso, endIso); return Math.round(r.reduce((a, x) => a + (Date.parse(x.e) - Date.parse(x.s)) / 3_600_000, 0) * 10) / 10; }
    case "contacts_logged": return db.get<{ n: number }>("SELECT COUNT(*) n FROM contacts WHERE workspace_id = ? AND date BETWEEN ? AND ?", wsId, period.start, period.end)?.n ?? 0;
    default: return null;
  }
}
export const AUTO_METRIC_SOURCES = ["manual", "knowledge_applied", "decision_reviews", "decisions_made", "important_followups", "actions_done", "outcomes_achieved", "focus_hours", "contacts_logged"] as const;

export interface UpsertInput { kind: ReviewKind; date: string; templateId?: string; answers: Record<string, string>; complete: boolean; appendAnswers?: boolean }

export function upsertReview(db: Db, wsId: string, input: UpsertInput): Review {
  const settings = getWorkspace(db, wsId).settings;
  const period = periodFor(input.kind, input.date);
  const existing = findReview(db, wsId, input.kind, period.start);
  const now = nowIso();
  const today = todayIn(settings.timezone);
  let id = existing?.id ?? newId();
  db.transaction(() => {
    if (!existing) {
      db.run("INSERT INTO reviews(id, workspace_id, kind, period_start, period_end, template_id, answers_json, summary_json, status, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'draft', NULL, ?, ?)",
        id, wsId, input.kind, period.start, period.end, input.templateId ?? settings.reviewTemplate, "{}", now, now);
    }
    const cur = getReview(db, wsId, id);
    let answers = { ...cur.answers };
    for (const [k, v] of Object.entries(input.answers)) {
      answers[k] = input.appendAnswers && answers[k] ? `${answers[k]}\n${v}` : v;
    }
    let summary = cur.summary;
    let status = cur.status;
    let completedAt = cur.completedAt;
    if (input.complete) {
      summary = computeReviewSummary(db, wsId, input.kind, period, settings.timezone, today);
      if (status !== "completed") { status = "completed"; completedAt = now; logActivity(db, wsId, "review", id, "review.completed", `${input.kind} ${period.start}`, now); }
    }
    db.run("UPDATE reviews SET answers_json = ?, summary_json = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ?", JSON.stringify(answers), summary ? JSON.stringify(summary) : null, status, completedAt, now, id);
    indexEntity(db, wsId, "review", id, `${input.kind} review ${period.start}`, Object.values(answers).join("\n"), period.start);
  });
  return getReview(db, wsId, id);
}

export function deleteReview(db: Db, wsId: string, id: string): void {
  getReview(db, wsId, id);
  db.transaction(() => { cleanupEntity(db, wsId, "review", id); db.run("DELETE FROM reviews WHERE id = ?", id); });
}

export function reviewToMarkdown(review: Review): string {
  const qs = questionsFor(review.templateId, review.kind);
  const lines: string[] = [`# ${labelKind(review.kind)} Review — ${review.periodStart}${review.periodEnd !== review.periodStart ? ` 〜 ${review.periodEnd}` : ""}`, "", `Template: ${review.templateId} / Status: ${review.status}${review.completedAt ? ` / Completed: ${review.completedAt.slice(0, 10)}` : ""}`, ""];
  let section = "";
  for (const q of qs) {
    if (q.section !== section) { section = q.section; lines.push(`## ${section}`, ""); }
    lines.push(`**${q.text}**`, "", review.answers[q.id]?.trim() || "_(未記入)_", "");
  }
  for (const [k, v] of Object.entries(review.answers)) if (!qs.some((q) => q.id === k) && v) lines.push(`**${k}**`, "", v, "");
  const s = review.summary as Record<string, any> | null;
  if (s) {
    lines.push("## Data (期間内の記録)", "");
    if (Array.isArray(s.northStars) && s.northStars.length) { lines.push("### North Star"); for (const g of s.northStars) lines.push(`- ${g.title} — progress ${g.progress?.percent ?? "n/a"}% (${g.health?.health})`); lines.push(""); }
    if (s.big3?.weeks?.length) { lines.push(`### Big 3 (${s.big3.done}/${s.big3.total})`); for (const w of s.big3.weeks) for (const i of w.items) lines.push(`- [${i.status === "done" ? "x" : " "}] ${w.weekStart}: ${i.title}`); lines.push(""); }
    if (s.goals?.stalled?.length) { lines.push("### Stalled Goals"); for (const g of s.goals.stalled) lines.push(`- ${g.title} (${g.reason})`); lines.push(""); }
    if (s.decisions) { lines.push(`### Decisions — made ${s.decisions.made.length}, reviewed ${s.decisions.reviewed.length}, due ${s.decisions.dueForReview.length}`); for (const d of s.decisions.made) lines.push(`- ${d.decidedAt} ${d.title} (confidence ${d.confidence}%)`); for (const r of s.decisions.reviewed) lines.push(`- reviewed: ${r.title} → ${r.outcome}${r.lessons ? ` — ${r.lessons}` : ""}`); lines.push(""); }
    if (s.people) { lines.push(`### People — contacts ${s.people.contactCount}, follow-ups done ${s.people.followUpsDone}`); for (const p of s.people.promisesMineOpen ?? []) lines.push(`- 自分の約束: ${p.personName} — ${p.text}`); for (const p of s.people.promisesTheirsOpen ?? []) lines.push(`- 返事待ち: ${p.personName} — ${p.text}`); lines.push(""); }
    if (s.knowledge) { lines.push(`### Knowledge — captured ${s.knowledge.capturedCount}, applied ${s.knowledge.applied.length}`); for (const k of s.knowledge.applied) lines.push(`- applied: ${k.title}`); lines.push(""); }
    if (s.openLoops?.length) { lines.push("### Open Loops"); for (const o of s.openLoops) lines.push(`- ${o.kind === "waiting" ? "⏳" : "◯"} ${o.title}${o.waitingOn ? ` (waiting on ${o.waitingOn})` : ""}`); lines.push(""); }
    if (s.time) lines.push(`### Time — ${s.time.totalHours}h (goal ${s.time.byCategory.goal}h / meeting ${s.time.byCategory.meeting}h / focus ${s.time.byCategory.focus}h / unclassified ${s.time.byCategory.unclassified}h)`, "");
    if (Array.isArray(s.monthlyBreakdown)) { lines.push("### Monthly breakdown", "", "| Month | Decisions | Reviews | Knowledge applied | Actions done | Outcomes | Contacts |", "|---|---|---|---|---|---|---|"); for (const m of s.monthlyBreakdown) lines.push(`| ${m.month} | ${m.decisions} | ${m.decisionReviews} | ${m.knowledgeApplied} | ${m.actionsDone} | ${m.outcomesAchieved} | ${m.contacts} |`); lines.push(""); }
  }
  lines.push("---", "Generated by Northstar — 人生にも、経営戦略を。");
  return lines.join("\n");
}
const labelKind = (k: ReviewKind) => ({ daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" })[k];

export const reviewRoutes = new Hono<Env>();
reviewRoutes.get("/review-templates", (c) => c.json({ templates: TEMPLATE_IDS.map((id) => ({ id, label: TEMPLATE_LABELS[id], questions: Object.fromEntries(REVIEW_KINDS.map((k) => [k, questionsFor(id, k)])) })) }));
reviewRoutes.get("/reviews", (c) => {
  const q = parseQuery(c, z.object({ kind: z.enum(REVIEW_KINDS).optional(), limit: z.coerce.number().int().optional(), from: z.string().optional(), to: z.string().optional() }));
  return c.json({ reviews: listReviews(c.get("db"), ws(c), q).map((r) => ({ ...r, summary: undefined })) });
});
reviewRoutes.get("/reviews/recent", (c) => c.json({ reviews: listReviews(c.get("db"), ws(c), { limit: 10 }).map((r) => ({ ...r, summary: undefined })) }));
/** Returns the saved review for the period, or a prepared (unsaved) draft with questions and a live data preview. */
reviewRoutes.get("/reviews/current", (c) => {
  const q = parseQuery(c, z.object({ kind: z.enum(REVIEW_KINDS), date: z.string().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  const settings = getWorkspace(db, wsId).settings;
  const today = todayIn(settings.timezone);
  const date = q.date ?? today;
  const period = periodFor(q.kind, date);
  const existing = findReview(db, wsId, q.kind, period.start);
  const templateId = existing?.templateId ?? settings.reviewTemplate;
  const preview = existing?.summary ?? computeReviewSummary(db, wsId, q.kind, period, settings.timezone, today);
  return c.json({ review: existing, period, templateId, questions: questionsFor(templateId, q.kind), preview });
});
reviewRoutes.put("/reviews", async (c) => c.json({ review: upsertReview(c.get("db"), ws(c), await parseBody(c, ReviewUpsertSchema)) }));
reviewRoutes.get("/reviews/:id", (c) => {
  const review = getReview(c.get("db"), ws(c), c.req.param("id"));
  return c.json({ review, questions: questionsFor(review.templateId, review.kind) });
});
reviewRoutes.get("/reviews/:id/export.md", (c) => {
  const review = getReview(c.get("db"), ws(c), c.req.param("id"));
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="review-${review.kind}-${review.periodStart}.md"`);
  return c.body(reviewToMarkdown(review));
});
reviewRoutes.delete("/reviews/:id", (c) => { deleteReview(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
