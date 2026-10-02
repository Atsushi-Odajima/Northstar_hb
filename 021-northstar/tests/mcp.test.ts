import { describe, it, expect } from "vitest";
import { ctx, api, ok } from "./helpers";

async function rpc(t: Awaited<ReturnType<typeof ctx>>, token: string, body: unknown) {
  const res = await t.app.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  if (text.startsWith("event:") || text.startsWith("data:")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    json = JSON.parse(data[data.length - 1]);
  } else if (text) json = JSON.parse(text);
  return { status: res.status, json };
}
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } };

describe("MCP foundation (required tests 26, 27)", () => {
  it("read tools work with a read token; write tools need write scope and explicit confirmation", async () => {
    const t = await ctx();
    const goal = ok(await api(t.app, "POST", "/api/goals", { title: "ProofFlow販売開始", level: "month", status: "active", isNorthStar: true }, t.cookie), 201).goal;
    const read = ok(await api(t.app, "POST", "/api/tokens", { name: "chatgpt-read", scopes: ["read"] }, t.cookie), 201);
    const write = ok(await api(t.app, "POST", "/api/tokens", { name: "claude-write", scopes: ["read", "write"] }, t.cookie), 201);
    expect(read.token).toMatch(/^ns_/);
    // unauthenticated
    expect((await t.app.request("/mcp", { method: "POST", body: "{}" })).status).toBe(401);
    const i = await rpc(t, read.token, init);
    expect(i.status).toBe(200);
    expect(i.json.result.serverInfo.name).toBe("northstar");
    const list = await rpc(t, read.token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = list.json.result.tools.map((x: any) => x.name);
    expect(names).toEqual(expect.arrayContaining(["get_today_focus", "get_weekly_big3", "search_northstar", "get_person_brief", "find_related_knowledge", "record_decision", "review_decision", "capture_item", "create_goal", "create_followup", "start_weekly_review", "ask_chief_of_staff"]));
    expect(list.json.result.tools.find((x: any) => x.name === "search_northstar").annotations.readOnlyHint).toBe(true);
    // read tool
    const focus = await rpc(t, read.token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_today_focus", arguments: { date: "2026-10-05" } } });
    const payload = JSON.parse(focus.json.result.content[0].text);
    expect(payload.northStars.map((g: any) => g.id)).toContain(goal.id);
    const search = await rpc(t, read.token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_northstar", arguments: { query: "ProofFlow" } } });
    expect(JSON.parse(search.json.result.content[0].text).hits[0].id).toBe(goal.id);
    // write with read token → forbidden
    const denied = await rpc(t, read.token, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "capture_item", arguments: { text: "memo", confirm: true } } });
    expect(JSON.parse(denied.json.result.content[0].text).status).toBe("forbidden");
    // write without confirm → preview only, nothing saved
    const preview = await rpc(t, write.token, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "record_decision", arguments: { title: "価格は9,800円", decision: "9,800円で開始" } } });
    expect(JSON.parse(preview.json.result.content[0].text).status).toBe("confirmation_required");
    expect(ok(await api(t.app, "GET", "/api/decisions", undefined, t.cookie)).decisions).toHaveLength(0);
    // with confirm → saved
    const saved = await rpc(t, write.token, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "record_decision", arguments: { title: "価格は9,800円", decision: "9,800円で開始", confidence: 60, confirm: true } } });
    expect(JSON.parse(saved.json.result.content[0].text).status).toBe("created");
    const decisions = ok(await api(t.app, "GET", "/api/decisions", undefined, t.cookie)).decisions;
    expect(decisions).toHaveLength(1);
    // review_decision shows snapshot but does not finalize without confirm
    const rv = await rpc(t, write.token, { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "review_decision", arguments: { decisionId: decisions[0].id, outcome: "better" } } });
    expect(JSON.parse(rv.json.result.content[0].text).status).toBe("confirmation_required");
    expect(ok(await api(t.app, "GET", `/api/decisions/${decisions[0].id}`, undefined, t.cookie)).decision.status).toBe("open");
    // create_goal creates a draft only
    const g = await rpc(t, write.token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "create_goal", arguments: { title: "via mcp", level: "month", confirm: true } } });
    expect(JSON.parse(g.json.result.content[0].text).goal.status).toBe("draft");
    // revoked token stops working
    ok(await api(t.app, "DELETE", `/api/tokens/${write.id}`, undefined, t.cookie));
    expect((await rpc(t, write.token, init)).status).toBe(401);
  });
});
