// Northstar MCP tools. Read tools are plain lookups; write tools require `confirm: true` (intent confirmation)
// and otherwise return a preview of what would be created. No tool can delete goals, finalize a decision outcome
// without explicit confirmation, or write free-form person notes.
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import type { Db } from "../db/connection";
import { todayIn, weekStart } from "@shared/period";
import { getWorkspace } from "../modules/workspace";
import { todayView, big3ForWeek, addBig3 } from "../modules/focus";
import { createGoal, listGoals, goalView } from "../modules/goals";
import { createDecision, getDecision, reviewDecision, reviewsOf, listDecisions } from "../modules/decisions";
import { personBrief, listPeople, createFollowUp } from "../modules/people";
import { listKnowledge } from "../modules/knowledge";
import { createCapture } from "../modules/captures";
import { searchFullText } from "../modules/search/search";
import { upsertReview, findReview, computeReviewSummary } from "../modules/reviews";
import { questionsFor } from "../modules/reviewTemplates";
import { askChief } from "../ai/chief";
import { periodFor } from "@shared/period";
import { GOAL_LEVELS, DECISION_OUTCOMES, CAPTURE_TYPES } from "@shared/types";
import { config } from "../config";

export interface McpAuth { workspaceId: string; scopes: string[]; tokenId: string }

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const needConfirm = (what: string, preview: unknown) => text({ status: "confirmation_required", message: `${what}。内容を利用者に確認し、同意が得られたら confirm=true で再実行してください。`, preview });
const denied = () => text({ status: "forbidden", message: "この API token には write 権限がありません" });

export function buildMcpServer(db: Db, auth: McpAuth): McpServer {
  const server = new McpServer({ name: "northstar", version: config.appVersion });
  const wsId = auth.workspaceId;
  const canWrite = auth.scopes.includes("write");
  const tz = () => getWorkspace(db, wsId).settings.timezone;
  const today = () => todayIn(tz());

  server.registerTool("get_today_focus", {
    title: "Today's focus", description: "今日の One Thing、今週の Big 3、期限の Action、Follow-up、Decision Review、停滞中の North Star を返します（読み取り専用）。",
    inputSchema: z.object({ date: z.string().optional().describe("YYYY-MM-DD（省略時は今日）") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ date }) => text(todayView(db, wsId, date ?? today())));

  server.registerTool("get_weekly_big3", {
    title: "Weekly Big 3", description: "指定週（省略時は今週）の Big 3 を返します。", inputSchema: z.object({ date: z.string().optional() }), annotations: { readOnlyHint: true },
  }, async ({ date }) => { const w = weekStart(date ?? today()); return text({ weekStart: w, items: big3ForWeek(db, wsId, w) }); });

  server.registerTool("search_northstar", {
    title: "Search", description: "Goals / Decisions / People / Knowledge / Reviews を横断全文検索します。", inputSchema: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).optional() }), annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => text({ hits: searchFullText(db, wsId, query, { limit: limit ?? 20 }) }));

  server.registerTool("get_person_brief", {
    title: "Person brief", description: "人物名または ID から、会う前の Brief（前回の接点、約束、未完了 Follow-up、関連 Goal/Project）を返します。事実のみで、性格や意図の推定は含みません。",
    inputSchema: z.object({ personIdOrName: z.string().min(1) }), annotations: { readOnlyHint: true },
  }, async ({ personIdOrName }) => {
    const people = listPeople(db, wsId, { q: personIdOrName, limit: 5 });
    const direct = db.get<{ id: string }>("SELECT id FROM people WHERE id = ? AND workspace_id = ?", personIdOrName, wsId);
    const id = direct?.id ?? (people.length === 1 ? people[0].id : null);
    if (!id) return text({ status: people.length ? "ambiguous" : "not_found", candidates: people.map((p) => ({ id: p.id, name: p.name, organization: p.organization })) });
    return text(personBrief(db, wsId, id, today()));
  });

  server.registerTool("find_related_knowledge", {
    title: "Related knowledge", description: "テーマや Goal に関連しそうな過去の学び（Knowledge）を返します。", inputSchema: z.object({ topic: z.string().min(1).max(200), limit: z.number().int().min(1).max(30).optional() }), annotations: { readOnlyHint: true },
  }, async ({ topic, limit }) => text({ knowledge: searchFullText(db, wsId, topic, { types: ["knowledge"], limit: limit ?? 10 }), toApply: listKnowledge(db, wsId, { toApply: true, limit: 10 }).map((k) => ({ id: k.id, title: k.title, nextAction: k.nextAction })) }));

  server.registerTool("list_goals", {
    title: "List goals", description: "Active な Goal と health（進捗ではなく Outcome ベース）を返します。", inputSchema: z.object({ status: z.string().optional() }), annotations: { readOnlyHint: true },
  }, async ({ status }) => text({ goals: listGoals(db, wsId, { status: (status?.split(",") as never) ?? ["active"] }).map((g) => goalView(db, wsId, g, today())).map((g) => ({ id: g.id, title: g.title, level: g.level, status: g.status, isNorthStar: g.isNorthStar, progress: g.progress, health: g.health })) }));

  server.registerTool("review_decision", {
    title: "Review a decision", description: "見直し時期の Decision を当時の判断内容（スナップショット）付きで返します。outcome を渡しても confirm=true が無い限り結果は確定しません。",
    inputSchema: z.object({ decisionId: z.string().optional().describe("省略時は見直し期限が来た Decision 一覧"), outcome: z.enum(DECISION_OUTCOMES).optional(), result: z.string().max(5000).optional(), lessons: z.string().max(5000).optional(), confirm: z.boolean().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ decisionId, outcome, result, lessons, confirm }) => {
    if (!decisionId) return text({ due: listDecisions(db, wsId, { dueBy: today() }).map((d) => ({ id: d.id, title: d.title, decidedAt: d.decidedAt, reviewDate: d.reviewDate, confidence: d.confidence })) });
    const d = getDecision(db, wsId, decisionId);
    const snapshot = { title: d.title, decidedAt: d.decidedAt, context: d.context, options: d.options, decision: d.decision, reason: d.reason, assumptions: d.assumptions, expectedOutcome: d.expectedOutcome, confidence: d.confidence, reviews: reviewsOf(db, wsId, d.id) };
    if (!outcome) return text({ decision: snapshot, note: "結果を記録するには outcome と confirm=true を渡してください（利用者の明示的な判断が必要）" });
    if (!canWrite) return denied();
    if (!confirm) return needConfirm("Decision の結果を記録しようとしています", { decision: d.title, outcome, result, lessons });
    return text({ status: "recorded", ...reviewDecision(db, wsId, decisionId, { outcome, result: result ?? "", lessons: lessons ?? "" }, "mcp") });
  });

  server.registerTool("capture_item", {
    title: "Quick capture", description: "メモを Northstar の Inbox に保存します（後で利用者が分類）。", inputSchema: z.object({ text: z.string().min(1).max(10000), type: z.enum(CAPTURE_TYPES).optional(), confirm: z.boolean().optional() }), annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ text: t, type, confirm }) => {
    if (!canWrite) return denied();
    if (!confirm) return needConfirm("Inbox に Capture を保存しようとしています", { text: t, type: type ?? null });
    return text({ status: "created", ...createCapture(db, wsId, { rawText: t, type: type ?? null, source: "mcp", clientId: null }) });
  });

  server.registerTool("create_goal", {
    title: "Create goal", description: "Goal を draft で作成します（Active 化は利用者がアプリで行います）。", inputSchema: z.object({ title: z.string().min(1).max(300), level: z.enum(GOAL_LEVELS), parentId: z.string().optional(), why: z.string().max(2000).optional(), successDefinition: z.string().max(2000).optional(), startDate: z.string().optional(), endDate: z.string().optional(), confirm: z.boolean().optional() }), annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (input) => {
    if (!canWrite) return denied();
    const { confirm, ...rest } = input;
    if (!confirm) return needConfirm("Goal を作成しようとしています（status=draft）", rest);
    const r = createGoal(db, wsId, { title: rest.title, level: rest.level, parentId: rest.parentId ?? null, why: rest.why ?? "", successDefinition: rest.successDefinition ?? "", startDate: rest.startDate ?? null, endDate: rest.endDate ?? null, description: "", status: "draft", priority: 3, progressMode: "manual", progressManual: 0, isNorthStar: false });
    return text({ status: "created", goal: r.goal, warnings: r.warnings });
  });

  server.registerTool("record_decision", {
    title: "Record decision", description: "Decision Journal に判断を記録します（理由・前提・期待する結果・確信度・レビュー日）。", inputSchema: z.object({ title: z.string().min(1).max(300), decision: z.string().max(2000), reason: z.string().max(5000).optional(), context: z.string().max(5000).optional(), options: z.array(z.string()).max(20).optional(), assumptions: z.array(z.string()).max(20).optional(), expectedOutcome: z.string().max(2000).optional(), confidence: z.number().int().min(0).max(100).optional(), reviewDate: z.string().optional(), confirm: z.boolean().optional() }), annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (input) => {
    if (!canWrite) return denied();
    const { confirm, ...rest } = input;
    if (!confirm) return needConfirm("Decision を記録しようとしています", rest);
    const d = createDecision(db, wsId, { title: rest.title, decidedAt: today(), context: rest.context ?? "", options: rest.options ?? [], decision: rest.decision, reason: rest.reason ?? "", assumptions: rest.assumptions ?? [], expectedOutcome: rest.expectedOutcome ?? "", risks: "", confidence: rest.confidence ?? 50, reviewDate: rest.reviewDate ?? null, goalIds: [], personIds: [] });
    return text({ status: "created", decision: d });
  });

  server.registerTool("create_followup", {
    title: "Create follow-up", description: "人物への Follow-up（期限と理由）を作成します。人物のメモ本文は作成しません。", inputSchema: z.object({ personId: z.string(), dueDate: z.string(), reason: z.string().max(500).optional(), confirm: z.boolean().optional() }), annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ personId, dueDate, reason, confirm }) => {
    if (!canWrite) return denied();
    if (!confirm) return needConfirm("Follow-up を作成しようとしています", { personId, dueDate, reason });
    return text({ status: "created", followUp: createFollowUp(db, wsId, { personId, contactId: null, dueDate, reason: reason ?? "" }) });
  });

  server.registerTool("set_weekly_big3", {
    title: "Add a Big 3 item", description: "今週（または指定週）の Big 3 に1件追加します（最大3件）。", inputSchema: z.object({ title: z.string().min(1).max(300), weekStart: z.string().optional(), goalId: z.string().optional(), confirm: z.boolean().optional() }), annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ title, weekStart: wk, goalId, confirm }) => {
    if (!canWrite) return denied();
    const w = weekStart(wk ?? today());
    if (!confirm) return needConfirm("Big 3 に追加しようとしています", { weekStart: w, title, goalId, current: big3ForWeek(db, wsId, w).map((b) => b.title) });
    return text({ status: "created", item: addBig3(db, wsId, { weekStart: w, title, goalId: goalId ?? null, projectId: null, actionId: null }) });
  });

  server.registerTool("start_weekly_review", {
    title: "Start weekly review", description: "今週の Weekly Review（CEO Meeting with Yourself）の質問と期間内データのプレビューを返します。回答の保存は confirm=true と answers が必要です。",
    inputSchema: z.object({ date: z.string().optional(), answers: z.record(z.string(), z.string()).optional(), confirm: z.boolean().optional() }), annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ date, answers, confirm }) => {
    const d = date ?? today();
    const period = periodFor("weekly", d);
    const settings = getWorkspace(db, wsId).settings;
    const existing = findReview(db, wsId, "weekly", period.start);
    if (answers && Object.keys(answers).length) {
      if (!canWrite) return denied();
      if (!confirm) return needConfirm("Weekly Review の回答を保存しようとしています（下書き）", { period, answers });
      return text({ status: "saved_draft", review: upsertReview(db, wsId, { kind: "weekly", date: d, answers, complete: false }) });
    }
    return text({ period, questions: questionsFor(existing?.templateId ?? settings.reviewTemplate, "weekly"), existing, preview: existing?.summary ?? computeReviewSummary(db, wsId, "weekly", period, settings.timezone, today()) });
  });

  server.registerTool("ask_chief_of_staff", {
    title: "Ask the AI Chief of Staff", description: "利用者の記録を根拠に質問へ答えます（AI 設定が ON のときのみ）。回答には記録への引用が付きます。", inputSchema: z.object({ question: z.string().min(1).max(4000) }), annotations: { readOnlyHint: true },
  }, async ({ question }) => {
    try { const r = await askChief(db, wsId, question, {}); return text({ answer: r.answer, citations: r.citations, insufficientEvidence: r.insufficientEvidence }); }
    catch (e) { return text({ status: "unavailable", message: (e as Error).message }); }
  });

  return server;
}
