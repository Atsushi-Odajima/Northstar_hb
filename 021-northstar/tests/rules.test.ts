import { describe, it, expect } from "vitest";
import { computeProgress, assessHealth, canBeChildOf, big3CanAdd, nextFreeRank, periodWarning } from "../shared/rules";
import { weekStart, weekPeriod, monthPeriod, quarterPeriod, periodFor, isWithin, addDays, todayIn } from "../shared/period";

describe("period helpers", () => {
  it("week starts on Monday", () => {
    expect(weekStart("2026-10-02")).toBe("2026-09-28"); // Friday → Monday
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sunday belongs to the week starting Monday 28
    expect(weekPeriod("2026-10-02")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
  it("month/quarter/year periods", () => {
    expect(monthPeriod("2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(quarterPeriod("2026-10-02")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterPeriod("2026-05-15")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(periodFor("yearly", "2026-07-01")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(isWithin("2026-10-05", weekPeriod("2026-10-02"))).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(todayIn("Asia/Tokyo", new Date("2026-10-02T16:30:00Z"))).toBe("2026-10-03");
  });
});

describe("goal hierarchy", () => {
  it("allows only lower levels under a parent", () => {
    expect(canBeChildOf("year", "vision")).toBe(true);
    expect(canBeChildOf("quarter", "year")).toBe(true);
    expect(canBeChildOf("week", "month")).toBe(true);
    expect(canBeChildOf("month", "month")).toBe(false);
    expect(canBeChildOf("year", "quarter")).toBe(false);
  });
  it("warns on period mismatch", () => {
    expect(periodWarning({ startDate: "2026-10-01", endDate: "2026-12-31" }, { startDate: "2026-01-01", endDate: "2026-12-31" })).toBeNull();
    expect(periodWarning({ startDate: "2027-01-01", endDate: "2027-03-31" }, { startDate: "2026-01-01", endDate: "2026-12-31" })).toMatch(/重なって/);
  });
});

describe("progress is never derived from tasks", () => {
  it("manual/binary/milestone/linked modes", () => {
    expect(computeProgress({ progressMode: "manual", progressManual: 40, status: "active" }, []).percent).toBe(40);
    expect(computeProgress({ progressMode: "binary", progressManual: 0, status: "active" }, []).percent).toBe(0);
    expect(computeProgress({ progressMode: "binary", progressManual: 0, status: "achieved" }, []).percent).toBe(100);
    expect(computeProgress({ progressMode: "milestone", progressManual: 0, status: "active" }, []).percent).toBeNull();
    expect(computeProgress({ progressMode: "milestone", progressManual: 0, status: "active" }, [{ status: "achieved" }, { status: "open" }]).percent).toBe(50);
    expect(computeProgress({ progressMode: "linked_outcomes", progressManual: 0, status: "active" }, [{ status: "achieved" }, { status: "achieved" }, { status: "open" }]).percent).toBe(67);
    // linked_outcomes never reports 100 until every outcome is achieved
    expect(computeProgress({ progressMode: "linked_outcomes", progressManual: 0, status: "active" }, [{ status: "achieved" }, { status: "achieved" }, { status: "achieved" }]).percent).toBe(100);
  });
  it("many completed tasks with no outcome is not 'on track'", () => {
    const today = "2026-10-02";
    const actions = Array.from({ length: 20 }, () => ({ status: "done" as const, doneAt: "2026-10-01T10:00:00Z" }));
    const h = assessHealth({ status: "active", progressMode: "linked_outcomes", progressManual: 0 }, [{ status: "open", achievedAt: null }], actions, null, today);
    expect(h.health).toBe("activity_without_outcome");
    const h2 = assessHealth({ status: "active", progressMode: "linked_outcomes", progressManual: 0 }, [{ status: "achieved", achievedAt: "2026-09-30T00:00:00Z" }], actions, null, today);
    expect(h2.health).toBe("on_track");
    const h3 = assessHealth({ status: "active", progressMode: "manual", progressManual: 10 }, [], [{ status: "done", doneAt: "2026-08-01T00:00:00Z" }], null, today);
    expect(h3.health).toBe("stalled");
  });
});

describe("Big 3 rule", () => {
  it("max 3 live items", () => {
    expect(big3CanAdd([{ status: "open" }, { status: "open" }]).ok).toBe(true);
    expect(big3CanAdd([{ status: "open" }, { status: "open" }, { status: "done" }]).ok).toBe(false);
    expect(big3CanAdd([{ status: "open" }, { status: "dropped" }, { status: "done" }]).ok).toBe(true);
    expect(nextFreeRank([{ rank: 1, status: "open" }, { rank: 3, status: "open" }])).toBe(2);
    expect(nextFreeRank([{ rank: 1, status: "open" }, { rank: 2, status: "open" }, { rank: 3, status: "done" }])).toBeNull();
  });
});
