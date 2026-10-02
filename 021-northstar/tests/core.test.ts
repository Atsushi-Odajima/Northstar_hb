import { describe, it, expect } from "vitest";
import { ctx, api, ok } from "./helpers";

const today = () => new Date().toISOString().slice(0, 10);

describe("Big 3 (required test 3)", () => {
  it("allows at most 3 live items per week and sorts ranks", async () => {
    const t = await ctx();
    const week = "2026-10-05";
    for (let i = 1; i <= 3; i++) ok(await api(t.app, "POST", "/api/focus/big3", { weekStart: week, title: `Big ${i}` }, t.cookie), 201);
    const fourth = await api(t.app, "POST", "/api/focus/big3", { weekStart: week, title: "Big 4" }, t.cookie);
    expect(fourth.status).toBe(409);
    const wk = ok(await api(t.app, "GET", `/api/focus/week?date=2026-10-07`, undefined, t.cookie));
    expect(wk.items.map((i: any) => i.rank)).toEqual([1, 2, 3]);
    // dropping one frees a slot
    ok(await api(t.app, "PATCH", `/api/focus/big3/${wk.items[1].id}`, { status: "dropped" }, t.cookie));
    const again = ok(await api(t.app, "POST", "/api/focus/big3", { weekStart: week, title: "Big 4" }, t.cookie), 201);
    expect(again.item.rank).toBe(2);
    // different week is independent
    ok(await api(t.app, "POST", "/api/focus/big3", { weekStart: "2026-10-12", title: "Next week" }, t.cookie), 201);
  });
});

describe("Decision Journal (required tests 4, 5)", () => {
  it("review shows the original snapshot and never rewrites the original reason", async () => {
    const t = await ctx();
    const d = ok(await api(t.app, "POST", "/api/decisions", {
      title: "ProofFlow を先行販売する", decidedAt: "2026-09-01", context: "資金繰りと検証を両立したい", options: ["先行販売", "完成後に販売"],
      decision: "先行販売", reason: "早期フィードバックが欲しい", assumptions: ["10人は買う"], expectedOutcome: "初月10件", confidence: 70, reviewDate: "2026-10-01",
    }, t.cookie), 201).decision;
    expect(d.status).toBe("open");
    // due list picks it up
    const due = ok(await api(t.app, "GET", "/api/decisions?due=2026-10-02", undefined, t.cookie)).decisions;
    expect(due.map((x: any) => x.id)).toContain(d.id);
    const reviewed = ok(await api(t.app, "POST", `/api/decisions/${d.id}/review`, { outcome: "worse", result: "3件のみ", lessons: "見込み客の母数を先に測る", reviewedAt: "2026-10-02" }, t.cookie), 201);
    expect(reviewed.decision.status).toBe("reviewed");
    expect(reviewed.review.snapshot.reason).toBe("早期フィードバックが欲しい");
    expect(reviewed.review.snapshot.confidence).toBe(70);
    expect(reviewed.review.snapshot.assumptions).toEqual(["10人は買う"]);
    // the original record is intact
    const detail = ok(await api(t.app, "GET", `/api/decisions/${d.id}`, undefined, t.cookie));
    expect(detail.decision.reason).toBe("早期フィードバックが欲しい");
    expect(detail.decision.expectedOutcome).toBe("初月10件");
    expect(detail.reviews).toHaveLength(1);
    // editing the past reason after a review is refused; adjusting title/risks is allowed
    expect((await api(t.app, "PATCH", `/api/decisions/${d.id}`, { reason: "書き換え" }, t.cookie)).status).toBe(400);
    ok(await api(t.app, "PATCH", `/api/decisions/${d.id}`, { risks: "追記したリスク" }, t.cookie));
    const after = ok(await api(t.app, "GET", `/api/decisions/${d.id}`, undefined, t.cookie));
    expect(after.decision.reason).toBe("早期フィードバックが欲しい");
    expect(after.reviews[0].snapshot.reason).toBe("早期フィードバックが欲しい");
  });
  it("too_early keeps the decision open and pushes the review date", async () => {
    const t = await ctx();
    const d = ok(await api(t.app, "POST", "/api/decisions", { title: "x", decidedAt: "2026-09-01", reviewDate: "2026-10-01" }, t.cookie), 201).decision;
    const r = ok(await api(t.app, "POST", `/api/decisions/${d.id}/review`, { outcome: "too_early", reviewedAt: "2026-10-01" }, t.cookie), 201);
    expect(r.decision.status).toBe("open");
    expect(r.decision.reviewDate).toBe("2026-10-31");
  });
});

describe("Personal CRM (required tests 6, 7, 8, 22)", () => {
  it("contact updates lastContact, follow-up due list, promises appear in weekly review; duplicates are not merged", async () => {
    const t = await ctx();
    const p = ok(await api(t.app, "POST", "/api/people", { name: "Sample CTO", organization: "Sample Inc", importance: 1 }, t.cookie), 201);
    expect(p.possibleDuplicates).toHaveLength(0);
    const dup = ok(await api(t.app, "POST", "/api/people", { name: "sample cto" }, t.cookie), 201);
    expect(dup.possibleDuplicates.map((x: any) => x.id)).toEqual([p.person.id]);
    expect(ok(await api(t.app, "GET", "/api/people", undefined, t.cookie)).people).toHaveLength(2); // never auto-merged
    const contact = ok(await api(t.app, "POST", "/api/contacts", {
      personId: p.person.id, date: "2026-09-29", type: "meeting", summary: "MCP連携の相談", nextStep: "資料送付",
      promises: [{ direction: "mine", text: "資料を送る", dueDate: "2026-10-01" }, { direction: "theirs", text: "見積の返事", dueDate: "2026-10-10" }],
      followUp: { dueDate: "2026-10-02", reason: "資料送付後の感想を聞く" },
    }, t.cookie), 201).contact;
    expect(contact.personId).toBe(p.person.id);
    const person = ok(await api(t.app, "GET", `/api/people/${p.person.id}`, undefined, t.cookie));
    expect(person.person.lastContactAt).toBe("2026-09-29");
    expect(person.person.nextFollowUpAt).toBe("2026-10-02");
    expect(person.promises).toHaveLength(2);
    // older contact does not move lastContact backwards
    ok(await api(t.app, "POST", "/api/contacts", { personId: p.person.id, date: "2026-08-01", summary: "old" }, t.cookie), 201);
    expect(ok(await api(t.app, "GET", `/api/people/${p.person.id}`, undefined, t.cookie)).person.lastContactAt).toBe("2026-09-29");
    // follow-up due
    const due = ok(await api(t.app, "GET", "/api/follow-ups?status=open&due=2026-10-02", undefined, t.cookie)).followUps;
    expect(due).toHaveLength(1);
    expect(due[0].personName).toBe("Sample CTO");
    expect(ok(await api(t.app, "GET", "/api/follow-ups?status=open&due=2026-10-01", undefined, t.cookie)).followUps).toHaveLength(0);
    // weekly review preview contains the promises
    const wk = ok(await api(t.app, "GET", "/api/reviews/current?kind=weekly&date=2026-10-02", undefined, t.cookie));
    expect(wk.preview.people.promisesMineOpen.map((x: any) => x.text)).toEqual(["資料を送る"]);
    expect(wk.preview.people.promisesTheirsOpen.map((x: any) => x.text)).toEqual(["見積の返事"]);
    expect(wk.preview.people.contactCount).toBe(1); // only the contact inside the week
    // brief
    const brief = ok(await api(t.app, "GET", `/api/people/${p.person.id}/brief`, undefined, t.cookie));
    expect(brief.myOpenPromises).toHaveLength(1);
    expect(brief.waitingFromThem).toHaveLength(1);
    expect(brief.openFollowUps).toHaveLength(1);
    expect(brief.topics[0]).toBe("MCP連携の相談");
  });
});

describe("Knowledge (required tests 9, 10)", () => {
  it("links knowledge to a goal and tracks applied", async () => {
    const t = await ctx();
    const goal = ok(await api(t.app, "POST", "/api/goals", { title: "ProofFlow販売開始", level: "month", status: "active" }, t.cookie), 201).goal;
    const k = ok(await api(t.app, "POST", "/api/knowledge", { title: "MCP記事", sourceType: "article", sourceUrl: "https://example.com/mcp", summary: "MCPでツール連携", keyIdeas: ["Streamable HTTP"], nextAction: "Northstar に MCP tool を追加", goalIds: [goal.id] }, t.cookie), 201).knowledge;
    expect(k.goalIds).toEqual([goal.id]);
    expect(k.goalTitles).toEqual(["ProofFlow販売開始"]);
    const act = ok(await api(t.app, "POST", `/api/knowledge/${k.id}/action`, {}, t.cookie), 201);
    expect(act.action.knowledgeId).toBe(k.id);
    expect(act.action.goalId).toBe(goal.id);
    expect(act.knowledge.status).toBe("processed");
    const toApply = ok(await api(t.app, "GET", "/api/knowledge?toApply=1", undefined, t.cookie)).knowledge;
    expect(toApply.map((x: any) => x.id)).toEqual([k.id]);
    const applied = ok(await api(t.app, "PATCH", `/api/knowledge/${k.id}`, { status: "applied", appliedNote: "MCP tool を実装した" }, t.cookie)).knowledge;
    expect(applied.status).toBe("applied");
    expect(applied.appliedAt).toBeTruthy();
    expect(ok(await api(t.app, "GET", "/api/knowledge?toApply=1", undefined, t.cookie)).knowledge).toHaveLength(0);
    const goalDetail = ok(await api(t.app, "GET", `/api/goals/${goal.id}`, undefined, t.cookie));
    expect(goalDetail.relations.some((r: any) => r.type === "knowledge" && r.id === k.id)).toBe(true);
  });
});

describe("Review Engine (required tests 11, 12)", () => {
  it("does not mix data outside the period and aggregates quarters by month", async () => {
    const t = await ctx();
    ok(await api(t.app, "POST", "/api/decisions", { title: "in-week", decidedAt: "2026-10-07" }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/decisions", { title: "out-of-week", decidedAt: "2026-10-20" }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/decisions", { title: "last-quarter", decidedAt: "2026-09-15" }, t.cookie), 201);
    const p = ok(await api(t.app, "POST", "/api/people", { name: "A" }, t.cookie), 201).person;
    ok(await api(t.app, "POST", "/api/contacts", { personId: p.id, date: "2026-10-06", summary: "in" }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/contacts", { personId: p.id, date: "2026-10-13", summary: "out" }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/knowledge", { title: "k-in", capturedAt: "2026-10-08" }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/knowledge", { title: "k-out", capturedAt: "2026-11-08" }, t.cookie), 201);
    const wk = ok(await api(t.app, "GET", "/api/reviews/current?kind=weekly&date=2026-10-07", undefined, t.cookie));
    expect(wk.period).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(wk.preview.decisions.made.map((d: any) => d.title)).toEqual(["in-week"]);
    expect(wk.preview.people.contacts.map((c: any) => c.summary)).toEqual(["in"]);
    expect(wk.preview.knowledge.captured.map((k: any) => k.title)).toEqual(["k-in"]);
    // completing stores a frozen summary
    const saved = ok(await api(t.app, "PUT", "/api/reviews", { kind: "weekly", date: "2026-10-07", answers: { stop: "SNS", continue: "朝Focus", start: "販売ページ" }, complete: true }, t.cookie)).review;
    expect(saved.status).toBe("completed");
    expect(saved.summary.decisions.made).toHaveLength(1);
    // template change afterwards does not alter the saved review
    ok(await api(t.app, "PATCH", "/api/settings", { reviewTemplate: "founder" }, t.cookie));
    const reloaded = ok(await api(t.app, "GET", `/api/reviews/${saved.id}`, undefined, t.cookie));
    expect(reloaded.review.templateId).toBe("general");
    expect(reloaded.questions.some((q: any) => q.id === "customer_signal")).toBe(false);
    const next = ok(await api(t.app, "GET", "/api/reviews/current?kind=weekly&date=2026-10-14", undefined, t.cookie));
    expect(next.templateId).toBe("founder");
    // quarterly aggregation
    const q = ok(await api(t.app, "GET", "/api/reviews/current?kind=quarterly&date=2026-11-15", undefined, t.cookie));
    expect(q.period).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(q.preview.decisions.made).toHaveLength(2);
    const months = q.preview.monthlyBreakdown.map((m: any) => [m.month, m.decisions, m.contacts]);
    expect(months).toEqual([["2026-10", 2, 2], ["2026-11", 0, 0], ["2026-12", 0, 0]]);
    // markdown export
    const md = await t.app.request(`/api/reviews/${saved.id}/export.md`, { headers: { Cookie: t.cookie } });
    expect(md.status).toBe(200);
    expect(await md.text()).toContain("in-week");
  });
});

describe("Quick Capture + Inbox (required tests 18-ish, 21 prep)", () => {
  it("is idempotent by clientId and processes into records", async () => {
    const t = await ctx();
    const a = await api(t.app, "POST", "/api/captures", { rawText: "ProofFlowの販売ページ画像を作る", clientId: "c-1", source: "pwa", createdAt: "2026-10-01T01:00:00Z" }, t.cookie);
    expect(a.status).toBe(201);
    expect(a.json.capture.suggestedType).toBe("task");
    const b = await api(t.app, "POST", "/api/captures", { rawText: "ProofFlowの販売ページ画像を作る", clientId: "c-1", source: "pwa" }, t.cookie);
    expect(b.status).toBe(200);
    expect(b.json.created).toBe(false);
    expect(b.json.capture.id).toBe(a.json.capture.id);
    const sync = ok(await api(t.app, "POST", "/api/captures/sync", { items: [{ rawText: "なぜ売れないのか？", clientId: "c-2" }, { rawText: "dup", clientId: "c-1" }] }, t.cookie));
    expect(sync.results.map((r: any) => r.status)).toEqual(["created", "duplicate"]);
    const inbox = ok(await api(t.app, "GET", "/api/captures", undefined, t.cookie)).captures;
    expect(inbox).toHaveLength(2);
    const q = inbox.find((c: any) => c.clientId === "c-2");
    expect(q.suggestedType).toBe("question");
    const processed = ok(await api(t.app, "POST", `/api/captures/${a.json.capture.id}/process`, { type: "task", payload: { dueDate: "2026-10-03" } }, t.cookie));
    expect(processed.createdType).toBe("action");
    const action = ok(await api(t.app, "GET", `/api/actions/${processed.createdId}`, undefined, t.cookie)).action;
    expect(action.dueDate).toBe("2026-10-03");
    expect(ok(await api(t.app, "GET", "/api/captures", undefined, t.cookie)).captures).toHaveLength(1);
    const today = ok(await api(t.app, "GET", "/api/today?date=2026-10-03", undefined, t.cookie));
    expect(today.dueActions.map((x: any) => x.id)).toContain(action.id);
    expect(today.inboxCount).toBe(1);
  });
});

describe("Search (required tests 13, 17)", () => {
  it("searches across entity types and drops deleted records from the index", async () => {
    const t = await ctx();
    const g = ok(await api(t.app, "POST", "/api/goals", { title: "ProofFlow販売開始", level: "month" }, t.cookie), 201).goal;
    const d = ok(await api(t.app, "POST", "/api/decisions", { title: "ProofFlow先行販売", decidedAt: "2026-09-01" }, t.cookie), 201).decision;
    const p = ok(await api(t.app, "POST", "/api/people", { name: "Sample Designer", notes: "ProofFlowのLP担当" }, t.cookie), 201).person;
    const k = ok(await api(t.app, "POST", "/api/knowledge", { title: "MCP記事", summary: "ProofFlowに応用" }, t.cookie), 201).knowledge;
    const hits = ok(await api(t.app, "GET", "/api/search?q=ProofFlow", undefined, t.cookie)).hits;
    expect(new Set(hits.map((h: any) => h.type))).toEqual(new Set(["goal", "decision", "person", "knowledge"]));
    expect(hits.map((h: any) => h.id)).toEqual(expect.arrayContaining([g.id, d.id, p.id, k.id]));
    // short Japanese query falls back to LIKE
    expect(ok(await api(t.app, "GET", `/api/search?q=${encodeURIComponent("販売")}`, undefined, t.cookie)).hits.length).toBeGreaterThanOrEqual(2);
    // type filter
    expect(ok(await api(t.app, "GET", "/api/search?q=ProofFlow&types=person", undefined, t.cookie)).hits.map((h: any) => h.type)).toEqual(["person"]);
    // deletion removes from index
    ok(await api(t.app, "DELETE", `/api/knowledge/${k.id}`, undefined, t.cookie));
    const after = ok(await api(t.app, "GET", "/api/search?q=MCP", undefined, t.cookie)).hits;
    expect(after.find((h: any) => h.id === k.id)).toBeUndefined();
    expect(t.db.get("SELECT 1 FROM search_docs WHERE entity_id = ?", k.id)).toBeUndefined();
    expect(t.db.get("SELECT 1 FROM relations WHERE from_id = ? OR to_id = ?", k.id, k.id)).toBeUndefined();
  });
});

describe("Projects / Open loops / Principles / Experiments", () => {
  it("covers project links, open loops, anti-goals and experiments", async () => {
    const t = await ctx();
    const goal = ok(await api(t.app, "POST", "/api/goals", { title: "Q4 3商品公開", level: "quarter", status: "active" }, t.cookie), 201).goal;
    const proj = ok(await api(t.app, "POST", "/api/projects", { title: "ProofFlow", status: "active", goalIds: [goal.id], nextAction: "LP公開" }, t.cookie), 201).project;
    expect(proj.goalTitles).toEqual(["Q4 3商品公開"]);
    ok(await api(t.app, "POST", "/api/actions", { title: "デザイナーの返事待ち", kind: "waiting", waitingOn: "Sample Designer", projectId: proj.id }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/actions", { title: "価格をどうするか未決", kind: "open_loop" }, t.cookie), 201);
    const loops = ok(await api(t.app, "GET", "/api/open-loops", undefined, t.cookie));
    expect(loops.openLoops).toHaveLength(1);
    expect(loops.waiting[0].waitingOn).toBe("Sample Designer");
    ok(await api(t.app, "POST", "/api/principles", { kind: "anti_goal", text: "今Quarterは新SNSを始めない", periodStart: "2026-10-01", periodEnd: "2026-12-31" }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/principles", { kind: "principle", text: "新規Projectは同時3件まで" }, t.cookie), 201);
    const exp = ok(await api(t.app, "POST", "/api/experiments", { title: "朝90分Focus", hypothesis: "午前に深い作業を置くと商品制作が進む", periodStart: "2026-10-01", periodEnd: "2026-10-14", status: "running", successSignal: "週5日実施" }, t.cookie), 201).experiment;
    const wk = ok(await api(t.app, "GET", "/api/reviews/current?kind=weekly&date=2026-10-07", undefined, t.cookie)).preview;
    expect(wk.antiGoals.map((a: any) => a.text)).toEqual(["今Quarterは新SNSを始めない"]);
    expect(wk.experiments.map((e: any) => e.id)).toEqual([exp.id]);
    expect(wk.openLoops).toHaveLength(2);
    const today = ok(await api(t.app, "GET", "/api/today?date=2026-10-07", undefined, t.cookie));
    expect(today.antiGoals).toHaveLength(1);
    // metrics: only user-selected ones appear in review summary
    const m = ok(await api(t.app, "POST", "/api/metrics", { name: "Knowledge→Action", source: "knowledge_applied" }, t.cookie), 201).metric;
    ok(await api(t.app, "PATCH", "/api/settings", { selectedMetricIds: [m.id] }, t.cookie));
    const wk2 = ok(await api(t.app, "GET", "/api/reviews/current?kind=weekly&date=2026-10-07", undefined, t.cookie)).preview;
    expect(wk2.metrics.map((x: any) => x.name)).toEqual(["Knowledge→Action"]);
  });
});

describe("Sync conflicts (required test 19)", () => {
  it("stale offline edits are rejected with 409 and never overwrite the server copy", async () => {
    const t = await ctx();
    const g = ok(await api(t.app, "POST", "/api/goals", { title: "original", level: "month", why: "server why" }, t.cookie), 201).goal;
    // device A edits online
    const a = ok(await api(t.app, "PATCH", `/api/goals/${g.id}`, { title: "edited on A", version: 1 }, t.cookie)).goal;
    expect(a.version).toBe(2);
    // device B comes back online with a stale version → conflict, server copy untouched
    const b = await api(t.app, "PATCH", `/api/goals/${g.id}`, { title: "edited offline on B", version: 1 }, t.cookie);
    expect(b.status).toBe(409);
    expect(b.json.error.details.current.title).toBe("edited on A");
    const after = ok(await api(t.app, "GET", `/api/goals/${g.id}`, undefined, t.cookie)).goal;
    expect(after.title).toBe("edited on A");
    expect(after.why).toBe("server why"); // untouched fields are not reset by the PATCH
    // same for people and knowledge
    const p = ok(await api(t.app, "POST", "/api/people", { name: "P" }, t.cookie), 201).person;
    ok(await api(t.app, "PATCH", `/api/people/${p.id}`, { role: "CTO", version: 1 }, t.cookie));
    expect((await api(t.app, "PATCH", `/api/people/${p.id}`, { role: "stale", version: 1 }, t.cookie)).status).toBe(409);
    // offline capture queue: the same clientId replayed twice creates one record and never overwrites the first
    const c1 = await api(t.app, "POST", "/api/captures/sync", { items: [{ rawText: "first text", clientId: "dev-1" }] }, t.cookie);
    const c2 = await api(t.app, "POST", "/api/captures/sync", { items: [{ rawText: "changed text", clientId: "dev-1" }] }, t.cookie);
    expect(c1.json.results[0].status).toBe("created");
    expect(c2.json.results[0].status).toBe("duplicate");
    const inbox = ok(await api(t.app, "GET", "/api/captures", undefined, t.cookie)).captures;
    expect(inbox.find((c: any) => c.clientId === "dev-1").rawText).toBe("first text");
  });
});
