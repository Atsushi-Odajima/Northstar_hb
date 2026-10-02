// Seeds the SAMPLE workspace (fictional persons only) into a separate database file by default.
// Usage: pnpm seed:sample            → data/sample.db (user: sample@northstar.local / sample-password-123)
//        NORTHSTAR_DB=./data/x.db pnpm seed:sample
import { openDatabase } from "../server/db/connection";
import { hashPassword } from "../server/auth/password";
import { createWorkspace, updateWorkspaceSettings } from "../server/modules/workspace";
import { createGoal, createOutcome } from "../server/modules/goals";
import { createProject } from "../server/modules/projects";
import { createAction } from "../server/modules/actions";
import { createDecision } from "../server/modules/decisions";
import { createPerson, logContact } from "../server/modules/people";
import { createKnowledge } from "../server/modules/knowledge";
import { addBig3, setDailyFocus } from "../server/modules/focus";
import { upsertReview } from "../server/modules/reviews";
import { createPrinciple, createExperiment, createMetric } from "../server/modules/misc";
import { createCapture } from "../server/modules/captures";
import { newId, nowIso } from "../server/lib/util";
import { todayIn, weekStart, quarterPeriod, monthPeriod, addDays } from "../shared/period";

export async function seedSample(dbFile: string, email = "sample@northstar.local", password = "sample-password-123") {
  const db = openDatabase(dbFile);
  const existing = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
  if (existing) { console.log("sample user already exists; skipping"); db.close(); return { email, password }; }
  const userId = newId(); const now = nowIso();
  db.run("INSERT INTO users(id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", userId, email, await hashPassword(password), "Sample Founder", now, now);
  const ws = createWorkspace(db, userId, "Sample Founder の Northstar");
  const wsId = ws.id;
  updateWorkspaceSettings(db, wsId, { settings: { onboardingDone: true, reviewTemplate: "founder" } as never });
  const tz = "Asia/Tokyo"; const today = todayIn(tz); const q = quarterPeriod(today); const m = monthPeriod(today); const wk = weekStart(today);

  const vision = createGoal(db, wsId, { title: "自分の商品で生きる", level: "vision", status: "active", description: "会社に依存しない収入の柱を、自分の知見を商品化して作る", parentId: null, startDate: null, endDate: null, priority: 1, successDefinition: "", why: "", progressMode: "manual", progressManual: 0, isNorthStar: false }).goal;
  const year = createGoal(db, wsId, { title: `${today.slice(0, 4)}: デジタル商品で安定収入`, level: "year", parentId: vision.id, status: "active", startDate: `${today.slice(0, 4)}-01-01`, endDate: `${today.slice(0, 4)}-12-31`, description: "", priority: 1, successDefinition: "商品3つ以上が継続的に売れている", why: "", progressMode: "milestone", progressManual: 0, isNorthStar: false }).goal;
  const quarter = createGoal(db, wsId, { title: "デジタル商品を3個公開する", level: "quarter", parentId: year.id, status: "active", startDate: q.start, endDate: q.end, description: "", priority: 1, successDefinition: "3商品の販売ページ公開＋各1件以上購入", why: "検証を回す数が必要", progressMode: "milestone", progressManual: 0, isNorthStar: true }).goal;
  createOutcome(db, wsId, { goalId: quarter.id, title: "ProofFlow 公開", description: "", status: "open", dueDate: m.end });
  createOutcome(db, wsId, { goalId: quarter.id, title: "ErrorRelay 公開", description: "", status: "open", dueDate: q.end });
  createOutcome(db, wsId, { goalId: quarter.id, title: "3商品目 公開", description: "", status: "open", dueDate: q.end });
  const month = createGoal(db, wsId, { title: "ProofFlow の販売を開始する", level: "month", parentId: quarter.id, status: "active", startDate: m.start, endDate: m.end, description: "", priority: 1, successDefinition: "販売ページ公開と初回購入", why: "最初の1商品が出ると残りが回り始める", progressMode: "linked_outcomes", progressManual: 0, isNorthStar: true }).goal;
  const o1 = createOutcome(db, wsId, { goalId: month.id, title: "販売ページ公開", description: "", status: "open", dueDate: addDays(today, 7) });
  createOutcome(db, wsId, { goalId: month.id, title: "初回購入", description: "", status: "open", dueDate: m.end });
  const stalled = createGoal(db, wsId, { title: "ErrorRelay を公開する", level: "month", parentId: quarter.id, status: "active", startDate: m.start, endDate: addDays(m.end, 30), description: "", priority: 2, successDefinition: "", why: "", progressMode: "manual", progressManual: 10, isNorthStar: false }).goal;
  db.run("UPDATE goals SET updated_at = ? WHERE id = ?", addDays(today, -40) + "T00:00:00.000Z", stalled.id);
  db.run("UPDATE goal_progress_log SET date = ? WHERE goal_id = ?", addDays(today, -40), stalled.id);

  const proofFlow = createProject(db, wsId, { title: "ProofFlow", outcome: "販売ページと決済が動き、最初の購入者が出る", description: "校正ワークフロー製品", status: "active", nextAction: "販売ページの文章を仕上げる", deadline: m.end, goalIds: [month.id] });
  const errorRelay = createProject(db, wsId, { title: "ErrorRelay", outcome: "エラー通知連携の MVP", description: "", status: "waiting", nextAction: "デザイナーの返事待ち", deadline: q.end, goalIds: [quarter.id] });

  const cto = createPerson(db, wsId, { name: "Sample CTO", organization: "Sample Inc", role: "CTO", relationshipType: "partner", importance: 1, tags: ["tech", "mcp"], howMet: "勉強会", notes: "MCP 連携に関心。資料を送ると言ってある", nextFollowUpAt: null });
  const designer = createPerson(db, wsId, { name: "Sample Designer", organization: "Studio Sample", role: "Designer", relationshipType: "vendor", importance: 2, tags: ["design"], howMet: "紹介", notes: "ErrorRelay の LP 相談中", nextFollowUpAt: null });
  logContact(db, wsId, { personId: cto.id, date: addDays(today, -3), type: "meeting", summary: "MCP 連携の相談。Northstar を ChatGPT から使えるようにする話", nextStep: "資料送付", promises: [{ direction: "mine", text: "MCP 連携の資料を送る", dueDate: addDays(today, 2) }, { direction: "theirs", text: "社内で検討した結果の返事", dueDate: addDays(today, 10) }], followUp: { dueDate: addDays(today, 5), reason: "資料への感想を聞く" } });
  logContact(db, wsId, { personId: designer.id, date: addDays(today, -12), type: "message", summary: "ErrorRelay の LP 見積依頼", nextStep: "見積待ち", promises: [{ direction: "theirs", text: "LP 見積", dueDate: addDays(today, -2) }], followUp: null });

  const decision = createDecision(db, wsId, { title: "ProofFlow を先行販売する", decidedAt: addDays(today, -31), context: "資金繰りと検証を両立したい。完成を待つと3か月遅れる", options: ["先行販売", "完成後に販売", "無料ベータ"], decision: "先行販売（限定価格）", reason: "早期フィードバックと初期売上が欲しい。失敗しても学びが残る", assumptions: ["見込み客が10人はいる", "返金対応で信頼は維持できる"], expectedOutcome: "初月10件の購入", risks: "期待値のズレ、返金", confidence: 70, reviewDate: addDays(today, -1), goalIds: [month.id], personIds: [] });
  createDecision(db, wsId, { title: "価格は 9,800円で開始", decidedAt: addDays(today, -5), context: "", options: ["4,980", "9,800", "19,800"], decision: "9,800円", reason: "個人事業主が稟議なしで買える上限", assumptions: ["競合の価格帯と整合"], expectedOutcome: "CVR 2%", risks: "安すぎ/高すぎ両方", confidence: 55, reviewDate: addDays(today, 25), goalIds: [month.id], personIds: [] });

  const k = createKnowledge(db, wsId, { title: "MCP（Model Context Protocol）入門記事", sourceType: "article", sourceUrl: "https://example.com/mcp-intro", sourceTitle: "example.com", summary: "MCP は LLM アプリにツール/データを安全に接続する標準。Streamable HTTP で remote server を公開できる", keyIdeas: ["tools に readOnlyHint 等の annotations", "書き込み系は人間の確認が前提", "ChatGPT / Claude 双方が接続可能"], personalMeaning: "Northstar を AI クライアントから使えるようにすると、ProofFlow の差別化にもなる", nextAction: "Northstar に read-only MCP tool を 3 つ追加する", status: "processed", rawContent: "", goalIds: [quarter.id], projectIds: [proofFlow.id], personIds: [cto.id], capturedAt: addDays(today, -8) });
  createKnowledge(db, wsId, { title: "価格心理（アンカリング）", sourceType: "book", sourceUrl: "", sourceTitle: "", summary: "高い選択肢を見せると中間価格が選ばれやすい", keyIdeas: ["3段階価格", "松竹梅"], personalMeaning: "", nextAction: "", status: "captured", rawContent: "", goalIds: [], projectIds: [], personIds: [], capturedAt: addDays(today, -2) });
  void k;

  createAction(db, wsId, { title: "販売ページの文章を仕上げる", notes: "", kind: "task", status: "open", dueDate: today, scheduledDate: null, goalId: month.id, outcomeId: o1.id, projectId: proofFlow.id, personId: null, decisionId: null, knowledgeId: null, waitingOn: "" });
  const done = createAction(db, wsId, { title: "販売ページの画像を作る", notes: "", kind: "task", status: "open", dueDate: addDays(today, -1), scheduledDate: null, goalId: month.id, outcomeId: o1.id, projectId: proofFlow.id, personId: null, decisionId: null, knowledgeId: null, waitingOn: "" });
  db.run("UPDATE actions SET status = 'done', done_at = ? WHERE id = ?", addDays(today, -1) + "T09:00:00.000Z", done.id);
  createAction(db, wsId, { title: "ErrorRelay LP の見積返事待ち", notes: "", kind: "waiting", status: "open", dueDate: null, scheduledDate: null, goalId: null, outcomeId: null, projectId: errorRelay.id, personId: designer.id, decisionId: null, knowledgeId: null, waitingOn: "Sample Designer" });
  createAction(db, wsId, { title: "ProofFlow の返金ポリシーをどうするか", notes: "", kind: "open_loop", status: "open", dueDate: null, scheduledDate: null, goalId: month.id, outcomeId: null, projectId: proofFlow.id, personId: null, decisionId: decision.id, knowledgeId: null, waitingOn: "" });

  const b1 = addBig3(db, wsId, { weekStart: wk, title: "ProofFlow 販売ページを公開する", goalId: month.id, projectId: proofFlow.id, actionId: null });
  addBig3(db, wsId, { weekStart: wk, title: "Sample CTO に MCP 資料を送る", goalId: quarter.id, projectId: null, actionId: null });
  addBig3(db, wsId, { weekStart: wk, title: "ErrorRelay の見積を確定させる", goalId: null, projectId: errorRelay.id, actionId: null });
  setDailyFocus(db, wsId, { date: today, oneThingTitle: "販売ページの文章を仕上げる", actionId: null, goalId: month.id, why: "今月の North Star の最初の Outcome", notes: "" });
  void b1;

  // Last week's review: Big3 2/3, one stalled
  const lastWeek = addDays(wk, -7);
  const lb1 = addBig3(db, wsId, { weekStart: lastWeek, title: "価格を決める", goalId: month.id, projectId: null, actionId: null });
  const lb2 = addBig3(db, wsId, { weekStart: lastWeek, title: "販売ページの構成を決める", goalId: month.id, projectId: null, actionId: null });
  addBig3(db, wsId, { weekStart: lastWeek, title: "ErrorRelay のデザイン依頼", goalId: null, projectId: errorRelay.id, actionId: null });
  db.run("UPDATE big3_items SET status = 'done' WHERE id IN (?, ?)", lb1.id, lb2.id);
  upsertReview(db, wsId, { kind: "weekly", date: lastWeek, answers: { north_star_progress: "価格と構成が決まり、販売ページに着手できる状態になった", overspent: "ErrorRelay のデザイン調整に時間を使いすぎた", stop: "ErrorRelay の細部調整", continue: "朝90分 Focus", start: "販売ページを公開する", big3_plan: "販売ページ公開 / MCP 資料 / 見積確定" }, complete: true });

  createPrinciple(db, wsId, { kind: "principle", text: "新規 Project は同時 3 件まで", active: true, periodStart: null, periodEnd: null });
  createPrinciple(db, wsId, { kind: "anti_goal", text: "今 Quarter は新しい SNS を始めない", active: true, periodStart: q.start, periodEnd: q.end });
  createExperiment(db, wsId, { title: "朝90分 Focus", hypothesis: "午前中に深い作業を置くと商品制作が進む", action: "9:00-10:30 は通知を切って制作", periodStart: addDays(today, -7), periodEnd: addDays(today, 7), successSignal: "週5日実施、販売ページ公開", status: "running", result: "", lesson: "" });
  const metric = createMetric(db, wsId, { name: "商品公開数", unit: "件", source: "outcomes_achieved" });
  const metric2 = createMetric(db, wsId, { name: "学び→行動", unit: "件", source: "knowledge_applied" });
  updateWorkspaceSettings(db, wsId, { settings: { selectedMetricIds: [metric.id, metric2.id] } as never });
  createCapture(db, wsId, { rawText: "ProofFlow のオンボーディング動画を作るべきか？", type: null, source: "pwa", clientId: null });
  createCapture(db, wsId, { rawText: "https://example.com/pricing-page-teardown 読む", type: null, source: "web", clientId: null });

  db.close();
  console.log(`sample workspace seeded into ${dbFile}\n  login: ${email} / ${password}`);
  return { email, password };
}

const isMain = process.argv[1] && (process.argv[1].endsWith("seed-sample.ts") || process.argv[1].endsWith("seed-sample.js") || process.argv[1].endsWith("seed-sample.mjs"));
if (isMain) {
  const file = process.env.NORTHSTAR_DB ?? "./data/sample.db";
  seedSample(file).catch((e) => { console.error(e); process.exit(1); });
}
