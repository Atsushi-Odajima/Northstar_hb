import { describe, it, expect } from "vitest";
import { ctx, api, ok, signup, makeApp } from "./helpers";
import { aiCallCounter } from "../server/ai/counter";

describe("Export / Backup / Restore (required tests 23, 24)", () => {
  it("export → restore into an empty workspace keeps data and relations", async () => {
    const t = await ctx();
    const vision = ok(await api(t.app, "POST", "/api/goals", { title: "V", level: "vision", status: "active" }, t.cookie), 201).goal;
    const q = ok(await api(t.app, "POST", "/api/goals", { title: "Q4 3商品", level: "quarter", parentId: vision.id, status: "active", isNorthStar: true }, t.cookie), 201).goal;
    const proj = ok(await api(t.app, "POST", "/api/projects", { title: "ProofFlow", goalIds: [q.id], status: "active" }, t.cookie), 201).project;
    const p = ok(await api(t.app, "POST", "/api/people", { name: "Sample CTO" }, t.cookie), 201).person;
    const d = ok(await api(t.app, "POST", "/api/decisions", { title: "先行販売", decidedAt: "2026-09-01", goalIds: [q.id], personIds: [p.id] }, t.cookie), 201).decision;
    ok(await api(t.app, "POST", `/api/decisions/${d.id}/review`, { outcome: "as_expected", lessons: "ok" }, t.cookie), 201);
    const k = ok(await api(t.app, "POST", "/api/knowledge", { title: "MCP記事", goalIds: [q.id], projectIds: [proj.id] }, t.cookie), 201).knowledge;
    ok(await api(t.app, "POST", "/api/contacts", { personId: p.id, date: "2026-09-29", summary: "mtg", promises: [{ direction: "mine", text: "資料", dueDate: null }], followUp: { dueDate: "2026-10-02", reason: "r" } }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/focus/big3", { weekStart: "2026-10-05", title: "LP", goalId: q.id }, t.cookie), 201);
    ok(await api(t.app, "PUT", "/api/reviews", { kind: "weekly", date: "2026-09-30", answers: { stop: "x" }, complete: true }, t.cookie));
    ok(await api(t.app, "POST", "/api/principles", { kind: "anti_goal", text: "新SNSなし" }, t.cookie), 201);
    const m = ok(await api(t.app, "POST", "/api/metrics", { name: "deep work", unit: "h" }, t.cookie), 201).metric;
    ok(await api(t.app, "POST", `/api/metrics/${m.id}/entries`, { date: "2026-10-01", value: 3 }, t.cookie), 201);

    const exp = await t.app.request("/api/export/all.json", { headers: { Cookie: t.cookie } });
    expect(exp.status).toBe(200);
    const file = JSON.parse(await exp.text());
    expect(file.format).toBe("northstar-backup");
    expect(file.counts.goals).toBe(2);
    expect(file.counts.relations).toBeGreaterThanOrEqual(5);
    expect(file.checksum).toMatch(/^sha256:/);
    expect(file.tables.goals.every((g: any) => g.workspace_id === undefined)).toBe(true);

    // restore into an EMPTY environment (fresh app + DB) → identical content, same ids
    const fresh = makeApp();
    const other = await signup(fresh.app);
    const validate = ok(await api(fresh.app, "POST", "/api/restore/validate", { backup: file }, other.cookie));
    expect(validate.ok).toBe(true);
    const restored = ok(await api(fresh.app, "POST", "/api/restore", { backup: file, mode: "replace", confirmReplace: true }, other.cookie));
    expect(restored.inserted.goals).toBe(2);
    expect(restored.inserted.relations).toBe(file.counts.relations);
    expect(restored.inserted.metric_entries).toBe(1);
    expect(restored.remapped).toBe(0);
    const exp2 = JSON.parse(await (await fresh.app.request("/api/export/all.json", { headers: { Cookie: other.cookie } })).text());
    for (const table of Object.keys(file.tables)) expect(exp2.tables[table].length, table).toBe(file.tables[table].length);
    expect(exp2.checksum).toBe(file.checksum); // identical content incl. ids/relations
    const kd = ok(await api(fresh.app, "GET", `/api/knowledge/${k.id}`, undefined, other.cookie));
    expect(kd.knowledge.goalIds).toEqual([q.id]);
    expect(kd.knowledge.projectIds).toEqual([proj.id]);
    const dd = ok(await api(fresh.app, "GET", `/api/decisions/${d.id}`, undefined, other.cookie));
    expect(dd.decision.personIds).toEqual([p.id]);
    expect(dd.reviews).toHaveLength(1);
    expect(ok(await api(fresh.app, "GET", "/api/search?q=ProofFlow", undefined, other.cookie)).hits.length).toBeGreaterThan(0);
    // restore into ANOTHER workspace of the SAME database → ids are remapped, relations still resolve
    const sameDb = await signup(t.app);
    const r2 = ok(await api(t.app, "POST", "/api/restore", { backup: file, mode: "replace", confirmReplace: true }, sameDb.cookie));
    expect(r2.remapped).toBeGreaterThan(0);
    expect(r2.inserted.goals).toBe(2);
    expect(r2.inserted.relations).toBe(file.counts.relations);
    const goals2 = ok(await api(t.app, "GET", "/api/goals", undefined, sameDb.cookie)).goals;
    expect(goals2.map((g: any) => g.title).sort()).toEqual(["Q4 3商品", "V"]);
    const k2 = ok(await api(t.app, "GET", "/api/knowledge", undefined, sameDb.cookie)).knowledge[0];
    expect(k2.goalTitles).toEqual(["Q4 3商品"]);
    // the original workspace cannot read the other's copy
    expect(ok(await api(t.app, "GET", "/api/goals", undefined, t.cookie)).goals).toHaveLength(2);
  });

  it("rejects corrupted or newer backups without touching current data", async () => {
    const t = await ctx();
    ok(await api(t.app, "POST", "/api/goals", { title: "keep me", level: "year" }, t.cookie), 201);
    const file = JSON.parse(await (await t.app.request("/api/export/all.json", { headers: { Cookie: t.cookie } })).text());
    const broken = { ...file, tables: { ...file.tables, outcomes: [{ id: "o1", goal_id: "missing", title: "x", description: "", status: "open", due_date: null, achieved_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" }] } };
    const res = await api(t.app, "POST", "/api/restore", { backup: broken, mode: "replace", confirmReplace: true }, t.cookie);
    expect(res.status).toBe(400);
    expect(res.json.error.details.join(" ")).toMatch(/checksum|goal_id/);
    expect(ok(await api(t.app, "GET", "/api/goals", undefined, t.cookie)).goals[0].title).toBe("keep me");
    const future = { ...file, schemaVersion: 999 };
    expect((await api(t.app, "POST", "/api/restore/validate", { backup: future }, t.cookie)).json.ok).toBe(false);
    // server-side backup files
    const b = ok(await api(t.app, "POST", "/api/backup", undefined, t.cookie), 201);
    expect(b.name).toMatch(/northstar-backup-/);
    expect(ok(await api(t.app, "GET", "/api/backup", undefined, t.cookie)).backups.map((x: any) => x.name)).toContain(b.name);
  });
});

describe("Import (required tests 21, 22)", () => {
  it("previews CSV with mapping + duplicates and never auto-merges people", async () => {
    const t = await ctx();
    ok(await api(t.app, "POST", "/api/people", { name: "Sample CTO" }, t.cookie), 201);
    const csv = "名前,会社,役職,重要度,タグ\nSample CTO,Sample Inc,CTO,1,tech;mcp\nSample Designer,Studio,Designer,2,design\n";
    const prev = ok(await api(t.app, "POST", "/api/import/preview", { kind: "people_csv", content: csv, fileName: "people.csv" }, t.cookie));
    expect(prev.rowCount).toBe(2);
    expect(prev.suggestedMapping).toMatchObject({ name: "名前", organization: "会社", role: "役職", importance: "重要度", tags: "タグ" });
    expect(prev.duplicates).toHaveLength(1);
    expect(prev.duplicates[0].row).toBe(0);
    // nothing imported yet
    expect(ok(await api(t.app, "GET", "/api/people", undefined, t.cookie)).people).toHaveLength(1);
    const done = ok(await api(t.app, "POST", "/api/import/confirm", { importId: prev.importId, duplicateAction: "skip" }, t.cookie));
    expect(done.created.people).toBe(1);
    expect(done.skipped).toBe(1);
    const people = ok(await api(t.app, "GET", "/api/people", undefined, t.cookie)).people;
    expect(people).toHaveLength(2);
    expect(people.find((p: any) => p.name === "Sample Designer").tags).toEqual(["design"]);
    // goals import never activates
    const gcsv = "title,level,parent,start,end\n2026 Year,year,,2026-01-01,2026-12-31\nQ4 商品3個,quarter,2026 Year,2026-10-01,2026-12-31\n";
    const gp = ok(await api(t.app, "POST", "/api/import/preview", { kind: "goals_csv", content: gcsv }, t.cookie));
    const gd = ok(await api(t.app, "POST", "/api/import/confirm", { importId: gp.importId }, t.cookie));
    expect(gd.created.goals).toBe(2);
    const goals = ok(await api(t.app, "GET", "/api/goals", undefined, t.cookie)).goals;
    expect(goals.every((g: any) => g.status === "draft")).toBe(true);
    expect(goals.find((g: any) => g.level === "quarter").parentTitle).toBe("2026 Year");
    // markdown import
    const md = "# Note A\nbody a\n## Note B\nbody b\n";
    const mp = ok(await api(t.app, "POST", "/api/import/preview", { kind: "markdown", content: md, fileName: "notes.md" }, t.cookie));
    expect(mp.rowCount).toBe(2);
    ok(await api(t.app, "POST", "/api/import/confirm", { importId: mp.importId, selectedRows: [1] }, t.cookie));
    expect(ok(await api(t.app, "GET", "/api/knowledge", undefined, t.cookie)).knowledge.map((k: any) => k.title)).toEqual(["Note B"]);
  });

  it("chat export → candidates → human confirmation → saved (E2E-5 logic, AI OFF heuristic)", async () => {
    const t = await ctx();
    aiCallCounter.reset();
    const chat = "user: ProofFlowは先行販売にすることに決めた\nassistant: 先行販売では、販売ページ・返金ポリシー・納期の明記が信頼につながります。期待値のコントロールが重要です。\nuser: 価格はいくらにすべき？\n";
    const prev = ok(await api(t.app, "POST", "/api/import/preview", { kind: "chat_export", content: chat, fileName: "chat.txt" }, t.cookie));
    expect(prev.notes[0]).toContain("heuristic");
    expect(prev.candidates.map((c: any) => c.kind)).toEqual(["decision", "knowledge", "question"]);
    expect(aiCallCounter.total + aiCallCounter.mock).toBe(0);
    expect(ok(await api(t.app, "GET", "/api/decisions", undefined, t.cookie)).decisions).toHaveLength(0);
    const done = ok(await api(t.app, "POST", "/api/import/confirm", { importId: prev.importId, selectedRows: [0, 1] }, t.cookie));
    expect(done.created).toEqual({ decisions: 1, knowledge: 1 });
    const d = ok(await api(t.app, "GET", "/api/decisions", undefined, t.cookie)).decisions[0];
    const detail = ok(await api(t.app, "GET", `/api/decisions/${d.id}`, undefined, t.cookie));
    expect(detail.decision.context).toContain("出典");
  });
});

describe("Notifications (required test 20)", () => {
  it("never duplicates a notification for the same key and respects due dates", async () => {
    const t = await ctx();
    ok(await api(t.app, "PATCH", "/api/settings", { notifications: { morningBriefTime: "00:00", quietHoursStart: "03:00", quietHoursEnd: "03:00", followUps: true, decisionReviews: true } }, t.cookie));
    const p = ok(await api(t.app, "POST", "/api/people", { name: "A" }, t.cookie), 201).person;
    ok(await api(t.app, "POST", "/api/follow-ups", { personId: p.id, dueDate: "2020-01-01", reason: "overdue" }, t.cookie), 201);
    ok(await api(t.app, "POST", "/api/decisions", { title: "d", decidedAt: "2020-01-01", reviewDate: "2020-02-01" }, t.cookie), 201);
    const r1 = ok(await api(t.app, "POST", "/api/notifications/run", undefined, t.cookie));
    expect(r1.created).toBeGreaterThanOrEqual(3); // morning + follow-up + decision review
    const r2 = ok(await api(t.app, "POST", "/api/notifications/run", undefined, t.cookie));
    expect(r2.created).toBe(0);
    const list = ok(await api(t.app, "GET", "/api/notifications", undefined, t.cookie));
    expect(list.unread).toBe(r1.created);
    const keys = list.notifications.map((n: any) => n.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    ok(await api(t.app, "POST", "/api/notifications/read-all", undefined, t.cookie));
    expect(ok(await api(t.app, "GET", "/api/notifications", undefined, t.cookie)).unread).toBe(0);
  });
});

describe("Calendar / connectors", () => {
  it("imports ICS, suggests links, and lists connector states without fetching anything", async () => {
    const t = await ctx();
    ok(await api(t.app, "POST", "/api/goals", { title: "ProofFlow 販売", level: "month", status: "active" }, t.cookie), 201);
    const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1@test\r\nSUMMARY:ProofFlow LP 作業\r\nDTSTART:20261006T010000Z\r\nDTEND:20261006T030000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:e2@test\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261010\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    const r = ok(await api(t.app, "POST", "/api/calendar/import-ics", { content: ics }, t.cookie));
    expect(r.imported).toBe(2);
    const again = ok(await api(t.app, "POST", "/api/calendar/import-ics", { content: ics }, t.cookie));
    expect(again.updated).toBe(2);
    const cal = ok(await api(t.app, "GET", "/api/calendar?from=2026-10-05T00:00:00Z&to=2026-10-12T00:00:00Z", undefined, t.cookie));
    expect(cal.events).toHaveLength(2);
    expect(cal.suggestions[0].suggestions[0].title).toBe("ProofFlow 販売");
    const cons = ok(await api(t.app, "GET", "/api/connectors", undefined, t.cookie)).connectors;
    expect(cons.find((c: any) => c.type === "ics").status).toBe("connected");
    expect(cons.find((c: any) => c.type === "google_calendar").status).toBe("planned");
    expect((await api(t.app, "PUT", "/api/connectors/google_calendar", { config: {} }, t.cookie)).status).toBe(400);
  });
});
