// Domain rules shared by server and web. Pure functions, unit-tested.
import { GOAL_LEVELS, BIG3_MAX, NORTH_STAR_MAX } from "./types";
import type { Goal, GoalLevel, Outcome, Action, Big3Item } from "./types";
import { rangesOverlap, diffDays } from "./period";

export const STALL_DAYS = 21;

export function levelIndex(level: GoalLevel): number {
  return GOAL_LEVELS.indexOf(level);
}

/** A goal may be attached to any goal of a strictly higher level (vision > year > quarter > month > week). */
export function canBeChildOf(childLevel: GoalLevel, parentLevel: GoalLevel): boolean {
  return levelIndex(childLevel) > levelIndex(parentLevel);
}

export function parentLevelOf(level: GoalLevel): GoalLevel | null {
  const i = levelIndex(level);
  return i <= 0 ? null : GOAL_LEVELS[i - 1];
}

/** Warn (not block) when a child's dates fall outside its parent's dates. */
export function periodWarning(child: Pick<Goal, "startDate" | "endDate">, parent: Pick<Goal, "startDate" | "endDate">): string | null {
  if (!child.startDate && !child.endDate) return null;
  if (!parent.startDate && !parent.endDate) return null;
  const cs = child.startDate ?? child.endDate!;
  const ce = child.endDate ?? child.startDate!;
  if (!rangesOverlap(parent.startDate, parent.endDate, cs, ce)) return "子Goalの期間が親Goalの期間と重なっていません";
  if (parent.startDate && cs < parent.startDate) return "子Goalの開始日が親Goalより前です";
  if (parent.endDate && ce > parent.endDate) return "子Goalの終了日が親Goalより後です";
  return null;
}

export interface ProgressResult {
  percent: number | null; // null = not computable (no outcomes yet) — never invented
  basis: string;
}

/**
 * Progress is never derived from the number of completed tasks.
 * manual: user-entered percent. binary: achieved or not. milestone: share of achieved outcomes.
 * linked_outcomes: share of achieved outcomes, capped at 99 until every outcome is achieved.
 */
export function computeProgress(goal: Pick<Goal, "progressMode" | "progressManual" | "status">, outcomes: Pick<Outcome, "status">[]): ProgressResult {
  if (goal.status === "achieved") return { percent: 100, basis: "status=achieved" };
  switch (goal.progressMode) {
    case "manual":
      return { percent: clampPercent(goal.progressManual), basis: "manual" };
    case "binary":
      return { percent: 0, basis: "binary (not yet achieved)" };
    case "milestone": {
      const live = outcomes.filter((o) => o.status !== "dropped");
      if (live.length === 0) return { percent: null, basis: "no outcomes defined" };
      const done = live.filter((o) => o.status === "achieved").length;
      return { percent: Math.round((done / live.length) * 100), basis: `${done}/${live.length} outcomes achieved` };
    }
    case "linked_outcomes": {
      const live = outcomes.filter((o) => o.status !== "dropped");
      if (live.length === 0) return { percent: null, basis: "no outcomes linked" };
      const done = live.filter((o) => o.status === "achieved").length;
      const pct = Math.round((done / live.length) * 100);
      return { percent: done === live.length ? 100 : Math.min(pct, 99), basis: `${done}/${live.length} outcomes achieved` };
    }
  }
}

export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export type GoalHealth = "achieved" | "on_track" | "activity_without_outcome" | "stalled" | "no_signal" | "inactive";

export interface HealthResult { health: GoalHealth; reason: string; lastSignalAt: string | null }

/**
 * Health is about *outcomes*, not activity. Completed tasks without achieved outcomes are
 * reported as "activity_without_outcome" — never as "on track".
 */
export function assessHealth(
  goal: Pick<Goal, "status" | "progressMode" | "progressManual">,
  outcomes: Pick<Outcome, "status" | "achievedAt">[],
  actions: Pick<Action, "status" | "doneAt">[],
  lastProgressLogDate: string | null,
  today: string,
): HealthResult {
  if (goal.status === "achieved") return { health: "achieved", reason: "達成済み", lastSignalAt: null };
  if (goal.status !== "active") return { health: "inactive", reason: `status=${goal.status}`, lastSignalAt: null };
  const outcomeDates = outcomes.filter((o) => o.status === "achieved" && o.achievedAt).map((o) => o.achievedAt!.slice(0, 10));
  const outcomeSignal = outcomeDates.sort().at(-1) ?? null;
  const progressSignal = lastProgressLogDate;
  const outcomeOrProgress = [outcomeSignal, progressSignal].filter(Boolean).sort().at(-1) ?? null;
  const actionDates = actions.filter((a) => a.status === "done" && a.doneAt).map((a) => a.doneAt!.slice(0, 10)).sort();
  const actionSignal = actionDates.at(-1) ?? null;

  if (outcomeOrProgress && diffDays(outcomeOrProgress, today) <= STALL_DAYS) {
    return { health: "on_track", reason: "直近にOutcome達成または進捗記録あり", lastSignalAt: outcomeOrProgress };
  }
  if (actionSignal && diffDays(actionSignal, today) <= STALL_DAYS) {
    return { health: "activity_without_outcome", reason: "タスクは完了しているがOutcome/進捗の記録がありません", lastSignalAt: actionSignal };
  }
  const anySignal = [outcomeOrProgress, actionSignal].filter(Boolean).sort().at(-1) ?? null;
  if (anySignal) return { health: "stalled", reason: `${diffDays(anySignal, today)}日間シグナルなし`, lastSignalAt: anySignal };
  return { health: "no_signal", reason: "進捗・Outcome・完了Actionの記録がまだありません", lastSignalAt: null };
}

export function big3CanAdd(existing: Pick<Big3Item, "status">[]): { ok: boolean; reason?: string } {
  const live = existing.filter((b) => b.status !== "dropped");
  if (live.length >= BIG3_MAX) return { ok: false, reason: `Weekly Big 3は最大${BIG3_MAX}件です。入れ替えるか、1件を外してください。` };
  return { ok: true };
}

export function nextFreeRank(existing: Pick<Big3Item, "rank" | "status">[]): 1 | 2 | 3 | null {
  const used = new Set(existing.filter((b) => b.status !== "dropped").map((b) => b.rank));
  for (const r of [1, 2, 3] as const) if (!used.has(r)) return r;
  return null;
}

export function northStarWarning(activeNorthStars: number, activeGoals: number): string | null {
  if (activeNorthStars > NORTH_STAR_MAX) return `North Starが${activeNorthStars}件あります。最重要は1〜${NORTH_STAR_MAX}件に絞ることを推奨します。`;
  if (activeGoals >= 12) return `Active Goalが${activeGoals}件あります。多すぎると「今重要なこと」が見えなくなります。Pause/Archiveを検討してください。`;
  return null;
}
