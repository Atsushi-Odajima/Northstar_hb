// Performance measurement with generated data (10-year personal scale). Not a sales guarantee.
// Usage: pnpm test:perf            (full scale: goals 10k, decisions 50k, contacts 100k, knowledge 500k, reviews 10k)
//        PERF_SCALE=0.1 pnpm test:perf   (10% scale, quick)
import fs from "node:fs";
import { openDatabase } from "../server/db/connection";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth/password";
import { createWorkspace, updateWorkspaceSettings } from "../server/modules/workspace";
import { newId, nowIso } from "../server/lib/util";
import { searchFullText } from "../server/modules/search/search";
import { todayView } from "../server/modules/focus";
import { computeReviewSummary } from "../server/modules/reviews";
import { structuredFacts, retrieve } from "../server/ai/retrieval";
import { requireAi } from "../server/ai/gateway";
import { syncEmbeddings, searchSemantic, LocalLiteEmbedder } from "../server/modules/search/embeddings";
import { weekPeriod, quarterPeriod, todayIn, addDays } from "../shared/period";

const scale = Number(process.env.PERF_SCALE ?? 1);
const N = { goals: Math.round(10_000 * scale), decisions: Math.round(50_000 * scale), contacts: Math.round(100_000 * scale), knowledge: Math.round(500_000 * scale), reviews: Math.round(10_000 * scale), people: Math.round(5_000 * scale) };
const file = process.env.PERF_DB ?? "./data/perf.db";
for (const s of ["", "-wal", "-shm"]) fs.rmSync(file + s, { force: true });
const db = openDatabase(file);
const WORDS = ["ProofFlow", "ErrorRelay", "販売", "価格", "顧客", "MCP", "設計", "検証", "学び", "返金", "LP", "公開", "契約", "投資", "採用", "文章", "動画", "講座", "分析", "戦略", "決断", "面談", "提案", "改善"];
const rnd = (n: number) => Math.floor(Math.random() * n);
const sentence = (n: number) => Array.from({ length: n }, () => WORDS[rnd(WORDS.length)]).join(" ");
const dateAgo = (days: number) => addDays("2026-10-02", -days);
const timeit = async <T,>(label: string, fn: () => T | Promise<T>): Promise<{ label: string; ms: number; result: T }> => { const t = performance.now(); const result = await fn(); const ms = Math.round((performance.now() - t) * 10) / 10; console.log(`${label}: ${ms} ms`); return { label, ms, result }; };

async function main() {
  const userId = newId(); const now = nowIso();
  db.run("INSERT INTO users(id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", userId, "perf@northstar.local", await hashPassword("perf-password-123"), "Perf", now, now);
  const ws = createWorkspace(db, userId, "Perf");
  const wsId = ws.id;
  updateWorkspaceSettings(db, wsId, { settings: { onboardingDone: true, ai: { enabled: true, provider: "mock", model: "mock-1", embeddingModel: "local-lite", features: { semantic_search: true } } } as never });
  console.log(`generating: ${JSON.stringify(N)}`);
  const gen = await timeit("generate", () => {
    db.transaction(() => {
      const goalIds: string[] = [];
      const insGoal = db.raw.prepare("INSERT INTO goals(id, workspace_id, title, description, level, parent_id, start_date, end_date, status, priority, success_definition, why, progress_mode, progress_manual, is_north_star, sort_order, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3, '', '', 'manual', 0, 0, 0, ?, ?, 1)");
      const insDoc = db.raw.prepare("INSERT INTO search_docs(workspace_id, entity_type, entity_id, title, body, date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (let i = 0; i < N.goals; i++) { const id = newId(); const level = (["year", "quarter", "month", "week"] as const)[i % 4]; const parent = goalIds.length && level !== "year" ? goalIds[rnd(goalIds.length)] : null; const status = i < 12 ? "active" : "archived"; const d = dateAgo(rnd(3650)); insGoal.run(id, wsId, `Goal ${i} ${sentence(2)}`, sentence(12), level, parent, d, addDays(d, 30), status, now, now); insDoc.run(wsId, "goal", id, `Goal ${i} ${sentence(2)}`, sentence(12), d, now); goalIds.push(id); }
      const insDec = db.raw.prepare("INSERT INTO decisions(id, workspace_id, title, decided_at, context, options_json, decision, reason, assumptions_json, expected_outcome, risks, confidence, review_date, status, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, '[]', ?, '', ?, ?, ?, ?, ?, 1)");
      for (let i = 0; i < N.decisions; i++) { const id = newId(); const d = dateAgo(rnd(3650)); const title = `Decision ${i} ${sentence(2)}`; insDec.run(id, wsId, title, d, sentence(15), sentence(6), sentence(10), sentence(6), 40 + rnd(60), addDays(d, 30), i % 50 === 0 ? "open" : "reviewed", now, now); insDoc.run(wsId, "decision", id, title, sentence(30), d, now); }
      const peopleIds: string[] = [];
      const insP = db.raw.prepare("INSERT INTO people(id, workspace_id, name, organization, role, relationship_type, importance, tags_json, how_met, notes, last_contact_at, next_follow_up_at, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 'other', ?, '[]', '', ?, ?, NULL, ?, ?, 1)");
      for (let i = 0; i < N.people; i++) { const id = newId(); insP.run(id, wsId, `Person ${i}`, `Org ${rnd(500)}`, "Role", 1 + rnd(5), sentence(8), dateAgo(rnd(400)), now, now); insDoc.run(wsId, "person", id, `Person ${i}`, sentence(8), "", now); peopleIds.push(id); }
      const insC = db.raw.prepare("INSERT INTO contacts(id, workspace_id, person_id, date, type, summary, next_step, created_at, updated_at) VALUES (?, ?, ?, ?, 'meeting', ?, '', ?, ?)");
      for (let i = 0; i < N.contacts; i++) { const id = newId(); const d = dateAgo(rnd(3650)); insC.run(id, wsId, peopleIds[rnd(peopleIds.length)], d, sentence(12), now, now); insDoc.run(wsId, "contact", id, `contact ${d}`, sentence(12), d, now); }
      const insK = db.raw.prepare("INSERT INTO knowledge_items(id, workspace_id, title, source_type, source_url, source_title, captured_at, summary, key_ideas_json, personal_meaning, next_action, status, applied_at, applied_note, raw_content, created_at, updated_at, version) VALUES (?, ?, ?, 'article', '', '', ?, ?, '[]', '', ?, ?, NULL, '', '', ?, ?, 1)");
      for (let i = 0; i < N.knowledge; i++) { const id = newId(); const d = dateAgo(rnd(3650)); const title = `Knowledge ${i} ${sentence(3)}`; insK.run(id, wsId, title, d, sentence(20), i % 10 === 0 ? sentence(4) : "", i % 3 === 0 ? "applied" : "captured", now, now); insDoc.run(wsId, "knowledge", id, title, sentence(40), d, now); }
      const insR = db.raw.prepare("INSERT INTO reviews(id, workspace_id, kind, period_start, period_end, template_id, answers_json, summary_json, status, completed_at, created_at, updated_at) VALUES (?, ?, 'weekly', ?, ?, 'general', ?, NULL, 'completed', ?, ?, ?)");
      for (let i = 0; i < N.reviews; i++) { const id = newId(); const d = dateAgo(i * 7 % 3650 + rnd(7)); const p = weekPeriod(d); try { insR.run(id, wsId, p.start, p.end, JSON.stringify({ stop: sentence(5), continue: sentence(5), start: sentence(5) }), now, now, now); insDoc.run(wsId, "review", id, `weekly review ${p.start}`, sentence(15), p.start, now); } catch { /* duplicate week */ } }
      const insA = db.raw.prepare("INSERT INTO actions(id, workspace_id, title, notes, kind, status, due_date, scheduled_date, done_at, goal_id, outcome_id, project_id, person_id, decision_id, knowledge_id, waiting_on, created_at, updated_at, version) VALUES (?, ?, ?, '', 'task', ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, '', ?, ?, 1)");
      for (let i = 0; i < Math.round(20_000 * scale); i++) { const d = dateAgo(rnd(3650)); insA.run(newId(), wsId, `Action ${i} ${sentence(2)}`, i % 5 === 0 ? "open" : "done", d, i % 5 === 0 ? null : d + "T09:00:00.000Z", goalIds[rnd(goalIds.length)], now, now); }
    });
    return db.get<{ n: number }>("SELECT COUNT(*) n FROM search_docs")?.n;
  });
  const results: { label: string; ms: number }[] = [{ label: `generate (${gen.result} search docs)`, ms: gen.ms }];
  const tz = "Asia/Tokyo"; const today = todayIn(tz);
  const run = async (label: string, fn: () => unknown) => { const r = await timeit(label, fn); results.push({ label, ms: r.ms }); return r.result; };
  await run("fulltext search 'ProofFlow 販売' (trigram)", () => searchFullText(db, wsId, "ProofFlow 販売", { limit: 30 }).length);
  await run("fulltext search '価格' (2 chars → LIKE fallback)", () => searchFullText(db, wsId, "価格", { limit: 30 }).length);
  await run("fulltext search knowledge-only 'MCP 設計'", () => searchFullText(db, wsId, "MCP 設計", { types: ["knowledge"], limit: 30 }).length);
  await run("today view", () => todayView(db, wsId, today).big3.length);
  await run("weekly review summary", () => Object.keys(computeReviewSummary(db, wsId, "weekly", weekPeriod(today), tz, today)).length);
  await run("quarterly review summary", () => Object.keys(computeReviewSummary(db, wsId, "quarterly", quarterPeriod(today), tz, today)).length);
  const rt = requireAi(db, wsId, "chief_of_staff");
  await run("AI retrieval: structured facts", () => structuredFacts(db, wsId, [], {}).length);
  await run("AI retrieval: full (facts + fts + semantic over indexed subset)", async () => (await retrieve(db, wsId, "ProofFlow に使えそうな過去の学びは？", {}, rt)).length);
  const embN = Math.min(20_000, N.knowledge);
  const embedder = new LocalLiteEmbedder();
  await run(`embeddings sync (local-lite, ${embN} docs, differential)`, () => syncEmbeddings(db, wsId, embedder, { types: ["knowledge"], limit: embN }));
  await run(`semantic search over ${embN} vectors (cosine in JS)`, async () => (await searchSemantic(db, wsId, "価格 戦略 学び", embedder, { limit: 20 })).length);
  await run("HTTP GET /api/today via app.request", async () => { const app = createApp(db); const tok = db.get<{ id: string }>("SELECT id FROM users LIMIT 1"); void tok; return 0; });
  const size = fs.statSync(file).size;
  const md = ["# Performance results (generated data, not a sales guarantee)", "", `Date: ${new Date().toISOString()} · scale ${scale} · DB size ${(size / 1024 / 1024).toFixed(1)} MB`, "", `Rows: goals ${N.goals}, decisions ${N.decisions}, people ${N.people}, contacts ${N.contacts}, knowledge ${N.knowledge}, reviews ≤${N.reviews}, actions ${Math.round(20_000 * scale)}`, "", "| Measurement | ms |", "|---|---|", ...results.map((r) => `| ${r.label} | ${r.ms} |`), "", "Environment: Node " + process.version + ", node:sqlite (FTS5 trigram), single process, in this CI container (4 vCPU)."].join("\n");
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/PERF_RESULTS.md", md);
  console.log("\n" + md);
  db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
