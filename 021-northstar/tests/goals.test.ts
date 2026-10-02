import { describe, it, expect } from "vitest";
import { ctx, api, ok, signup } from "./helpers";

describe("auth + workspace", () => {
  it("signup creates a private workspace and rejects CSRF-less mutations", async () => {
    const t = await ctx();
    const me = ok(await api(t.app, "GET", "/api/me", undefined, t.cookie));
    expect(me.workspace.id).toBe(t.workspaceId);
    expect(me.workspace.settings.ai.enabled).toBe(false);
    // missing X-Requested-With header → 403
    const res = await t.app.request("/api/goals", { method: "POST", headers: { Cookie: t.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", level: "year" }) });
    expect(res.status).toBe(403);
    // unauthenticated → 401
    expect((await api(t.app, "GET", "/api/goals")).status).toBe(401);
  });
});

describe("goal hierarchy (required test 1)", () => {
  it("Vision → Year → Quarter → Month → Week relation", async () => {
    const t = await ctx();
    const vision = ok(await api(t.app, "POST", "/api/goals", { title: "自分の商品で生きる", level: "vision", status: "active" }, t.cookie), 201).goal;
    const year = ok(await api(t.app, "POST", "/api/goals", { title: "2026 デジタル商品で年商1000万", level: "year", parentId: vision.id, startDate: "2026-01-01", endDate: "2026-12-31", status: "active" }, t.cookie), 201).goal;
    const quarter = ok(await api(t.app, "POST", "/api/goals", { title: "Q4 デジタル商品3個公開", level: "quarter", parentId: year.id, startDate: "2026-10-01", endDate: "2026-12-31", status: "active", isNorthStar: true }, t.cookie), 201).goal;
    const month = ok(await api(t.app, "POST", "/api/goals", { title: "10月 ProofFlow販売開始", level: "month", parentId: quarter.id, startDate: "2026-10-01", endDate: "2026-10-31", status: "active", isNorthStar: true }, t.cookie), 201).goal;
    const week = ok(await api(t.app, "POST", "/api/goals", { title: "販売ページ公開", level: "week", parentId: month.id, startDate: "2026-10-05", endDate: "2026-10-11", status: "active" }, t.cookie), 201).goal;
    // wrong direction is rejected
    expect((await api(t.app, "POST", "/api/goals", { title: "bad", level: "year", parentId: month.id }, t.cookie)).status).toBe(400);
    const detail = ok(await api(t.app, "GET", `/api/goals/${week.id}`, undefined, t.cookie));
    expect(detail.ancestors.map((g: any) => g.level)).toEqual(["month", "quarter", "year", "vision"]);
    const tree = ok(await api(t.app, "GET", "/api/goals/tree", undefined, t.cookie)).tree;
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].children[0].children[0].id).toBe(week.id);
    const ns = ok(await api(t.app, "GET", "/api/northstar", undefined, t.cookie));
    expect(ns.northStars.map((g: any) => g.id).sort()).toEqual([quarter.id, month.id].sort());
    // cycle protection
    expect((await api(t.app, "PATCH", `/api/goals/${vision.id}`, { parentId: week.id }, t.cookie)).status).toBe(400);
  });

  it("completing tasks alone never marks a goal achieved / on track (required test 2)", async () => {
    const t = await ctx();
    const goal = ok(await api(t.app, "POST", "/api/goals", { title: "ProofFlow販売開始", level: "month", status: "active", progressMode: "linked_outcomes" }, t.cookie), 201).goal;
    const outcome = ok(await api(t.app, "POST", `/api/goals/${goal.id}/outcomes`, { title: "販売ページ公開/初回購入" }, t.cookie), 201).outcome;
    // 5 tasks done
    for (let i = 0; i < 5; i++) {
      const a = ok(await api(t.app, "POST", "/api/actions", { title: `画像作成 ${i}`, goalId: goal.id }, t.cookie), 201).action;
      ok(await api(t.app, "PATCH", `/api/actions/${a.id}`, { status: "done" }, t.cookie));
    }
    let view = ok(await api(t.app, "GET", `/api/goals/${goal.id}`, undefined, t.cookie)).goal;
    expect(view.status).toBe("active");
    expect(view.progress.percent).toBe(0);
    expect(view.health.health).toBe("activity_without_outcome");
    // outcome achieved → progress 100 but status still requires explicit user action
    ok(await api(t.app, "PATCH", `/api/outcomes/${outcome.id}`, { status: "achieved" }, t.cookie));
    view = ok(await api(t.app, "GET", `/api/goals/${goal.id}`, undefined, t.cookie)).goal;
    expect(view.progress.percent).toBe(100);
    expect(view.status).toBe("active");
    expect(view.health.health).toBe("on_track");
  });

  it("isolates workspaces (required test 25)", async () => {
    const t = await ctx();
    const goal = ok(await api(t.app, "POST", "/api/goals", { title: "secret", level: "year" }, t.cookie), 201).goal;
    const other = await signup(t.app);
    expect((await api(t.app, "GET", `/api/goals/${goal.id}`, undefined, other.cookie)).status).toBe(404);
    expect((await api(t.app, "PATCH", `/api/goals/${goal.id}`, { title: "hacked" }, other.cookie)).status).toBe(404);
    expect((await api(t.app, "DELETE", `/api/goals/${goal.id}`, undefined, other.cookie)).status).toBe(404);
    expect(ok(await api(t.app, "GET", "/api/goals", undefined, other.cookie)).goals).toHaveLength(0);
    // optimistic concurrency
    const g1 = ok(await api(t.app, "PATCH", `/api/goals/${goal.id}`, { title: "v2", version: 1 }, t.cookie)).goal;
    expect(g1.version).toBe(2);
    expect((await api(t.app, "PATCH", `/api/goals/${goal.id}`, { title: "stale", version: 1 }, t.cookie)).status).toBe(409);
  });
});
