// Export / Import / Backup / Restore. The backup format is the full-data JSON export.
import { Hono } from "hono";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import { SCHEMA_VERSION } from "../db/schema";
import { config } from "../config";
import { parseBody, ws } from "../lib/http";
import { badRequest, notFound } from "../lib/errors";
import { newId, nowIso, parseJson, csvEscape, parseCsv } from "../lib/util";
import { getWorkspace, updateWorkspaceSettings } from "./workspace";
import { rebuildSearchIndex } from "./search/indexer";
import { ImportPreviewSchema, ImportConfirmSchema, PersonCreateSchema, GoalCreateSchema, KnowledgeCreateSchema, DecisionCreateSchema } from "@shared/schemas";
import { createPerson, findDuplicates } from "./people";
import { createGoal, goalTree } from "./goals";
import { createKnowledge } from "./knowledge";
import { createDecision } from "./decisions";
import { listReviews, reviewToMarkdown } from "./reviews";
import { todayIn } from "@shared/period";
import { parseChatExport, heuristicExtract } from "../ai/chatImport";
import { extractFromChat } from "../ai/drafts";
import { getWorkspace as gw } from "./workspace";
import { createAction } from "./actions";
import { ActionCreateSchema } from "@shared/schemas";
import { log } from "../lib/log";

/** Tables in insertion order (parents first). metric_entries has no workspace_id → handled via metrics join. */
export const EXPORT_TABLES = [
  "goals", "goal_progress_log", "outcomes", "projects", "decisions", "decision_reviews", "people", "contacts", "promises", "follow_ups",
  "knowledge_items", "actions", "big3_items", "daily_focus", "captures", "reviews", "relations", "principles", "experiments",
  "metrics", "metric_entries", "calendar_events", "activity_log", "ai_messages", "ai_usage", "connectors", "notifications",
] as const;
type TableName = (typeof EXPORT_TABLES)[number];
type Row = Record<string, unknown>;

export interface BackupFile {
  format: "northstar-backup"; schemaVersion: number; appVersion: string; generatedAt: string;
  workspace: { name: string; settings: unknown }; counts: Record<string, number>; checksum: string; tables: Record<TableName, Row[]>;
}

export function checksumOf(tables: Record<string, Row[]>): string {
  const h = createHash("sha256");
  for (const t of EXPORT_TABLES) h.update(t).update(JSON.stringify(tables[t] ?? []));
  return `sha256:${h.digest("hex")}`;
}

export function exportWorkspace(db: Db, wsId: string): BackupFile {
  const wsRec = getWorkspace(db, wsId);
  const tables = {} as Record<TableName, Row[]>;
  const counts: Record<string, number> = {};
  for (const t of EXPORT_TABLES) {
    let rows: Row[];
    if (t === "metric_entries") rows = db.all<Row>("SELECT me.* FROM metric_entries me JOIN metrics m ON m.id = me.metric_id WHERE m.workspace_id = ? ORDER BY me.metric_id, me.date", wsId);
    else rows = db.all<Row>(`SELECT * FROM ${t} WHERE workspace_id = ? ORDER BY rowid`, wsId);
    for (const r of rows) delete r.workspace_id;
    tables[t] = rows;
    counts[t] = rows.length;
  }
  return { format: "northstar-backup", schemaVersion: db.schemaVersion(), appVersion: config.appVersion, generatedAt: nowIso(), workspace: { name: wsRec.name, settings: wsRec.settings }, counts, checksum: checksumOf(tables), tables };
}

const FK: Partial<Record<TableName, [string, TableName][]>> = {
  goals: [["parent_id", "goals"]], goal_progress_log: [["goal_id", "goals"]], outcomes: [["goal_id", "goals"]],
  decision_reviews: [["decision_id", "decisions"]], contacts: [["person_id", "people"]], promises: [["person_id", "people"], ["contact_id", "contacts"]], follow_ups: [["person_id", "people"], ["contact_id", "contacts"]],
  actions: [["goal_id", "goals"], ["outcome_id", "outcomes"], ["project_id", "projects"], ["person_id", "people"], ["decision_id", "decisions"], ["knowledge_id", "knowledge_items"]],
  big3_items: [["goal_id", "goals"], ["project_id", "projects"], ["action_id", "actions"]], daily_focus: [["action_id", "actions"], ["goal_id", "goals"]],
  metric_entries: [["metric_id", "metrics"]], calendar_events: [["goal_id", "goals"], ["project_id", "projects"]],
};

export function validateBackup(data: unknown, currentSchema: number): { ok: boolean; issues: string[]; file?: BackupFile } {
  const issues: string[] = [];
  if (!data || typeof data !== "object") return { ok: false, issues: ["JSON オブジェクトではありません"] };
  const f = data as Partial<BackupFile>;
  if (f.format !== "northstar-backup") issues.push("format が northstar-backup ではありません");
  if (typeof f.schemaVersion !== "number") issues.push("schemaVersion がありません");
  else if (f.schemaVersion > currentSchema) issues.push(`schemaVersion ${f.schemaVersion} はこのアプリ (v${currentSchema}) より新しいため復元できません`);
  if (!f.tables || typeof f.tables !== "object") { issues.push("tables がありません"); return { ok: false, issues }; }
  const tables = f.tables as Record<string, unknown>;
  const ids: Record<string, Set<string>> = {};
  for (const t of EXPORT_TABLES) {
    const rows = tables[t];
    if (rows === undefined) { ids[t] = new Set(); continue; }
    if (!Array.isArray(rows)) { issues.push(`${t} が配列ではありません`); continue; }
    ids[t] = new Set();
    rows.forEach((r, i) => {
      if (!r || typeof r !== "object" || typeof (r as Row).id !== "string") issues.push(`${t}[${i}] に id がありません`);
      else ids[t].add((r as Row).id as string);
    });
  }
  if (f.checksum && f.checksum !== checksumOf(tables as Record<string, Row[]>)) issues.push("checksum が一致しません（ファイルが破損・改変されています）");
  for (const t of EXPORT_TABLES) {
    const rows = (tables[t] as Row[] | undefined) ?? [];
    for (const [col, ref] of FK[t] ?? []) {
      for (const r of rows) {
        const v = r[col];
        if (v !== null && v !== undefined && !ids[ref]?.has(String(v))) issues.push(`${t}.${col}=${String(v).slice(0, 12)}… が ${ref} に存在しません`);
        if (issues.length > 50) break;
      }
    }
  }
  const rel = (tables.relations as Row[] | undefined) ?? [];
  for (const r of rel) {
    const ft = TABLE_OF_TYPE[String(r.from_type)], tt = TABLE_OF_TYPE[String(r.to_type)];
    if (!ft || !ids[ft]?.has(String(r.from_id))) issues.push(`relation ${String(r.id).slice(0, 8)} の from が存在しません`);
    if (!tt || !ids[tt]?.has(String(r.to_id))) issues.push(`relation ${String(r.id).slice(0, 8)} の to が存在しません`);
    if (issues.length > 50) break;
  }
  return issues.length ? { ok: false, issues: issues.slice(0, 50) } : { ok: true, issues: [], file: f as BackupFile };
}

const TABLE_OF_TYPE: Record<string, TableName> = { goal: "goals", outcome: "outcomes", project: "projects", action: "actions", decision: "decisions", review: "reviews", person: "people", contact: "contacts", knowledge: "knowledge_items", capture: "captures", principle: "principles", experiment: "experiments", calendar_event: "calendar_events", promise: "promises", follow_up: "follow_ups" };

/**
 * Restore into the workspace. `replace` deletes the workspace's current data first — inside a single transaction,
 * so a failure leaves current data untouched. Ids are preserved when free; an id that already belongs to another
 * workspace in the same database is remapped (all references follow), so restoring into an empty environment
 * yields byte-identical data while cross-workspace restores stay safe.
 */
export function restoreWorkspace(db: Db, wsId: string, file: BackupFile, mode: "replace" | "merge"): { inserted: Record<string, number>; skipped: Record<string, number>; remapped: number } {
  const inserted: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  let remapped = 0;
  db.transaction(() => {
    if (mode === "replace") {
      for (const t of [...EXPORT_TABLES].reverse()) {
        if (t === "metric_entries") db.run("DELETE FROM metric_entries WHERE metric_id IN (SELECT id FROM metrics WHERE workspace_id = ?)", wsId);
        else db.run(`DELETE FROM ${t} WHERE workspace_id = ?`, wsId);
      }
      db.run("DELETE FROM search_docs WHERE workspace_id = ?", wsId);
      db.run("DELETE FROM embeddings WHERE workspace_id = ?", wsId);
    }
    // Build id remap for rows whose id is taken by another workspace.
    const idMap = new Map<string, string>();
    for (const t of EXPORT_TABLES) {
      if (t === "metric_entries") continue;
      for (const r of file.tables[t] ?? []) {
        const id = String(r.id);
        const owner = db.get<{ workspace_id: string }>(`SELECT workspace_id FROM ${t} WHERE id = ?`, id);
        if (owner && owner.workspace_id !== wsId) { idMap.set(id, newId()); remapped++; }
      }
    }
    const mapId = (v: unknown) => (typeof v === "string" && idMap.has(v) ? idMap.get(v)! : v);
    for (const t of EXPORT_TABLES) {
      const rows = file.tables[t] ?? [];
      inserted[t] = 0; skipped[t] = 0;
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]).filter((c) => c !== "workspace_id");
      const hasWs = t !== "metric_entries";
      const allCols = hasWs ? ["workspace_id", ...cols] : cols;
      const sql = `INSERT OR IGNORE INTO ${t}(${allCols.join(",")}) VALUES (${allCols.map(() => "?").join(",")})`;
      const fkCols = new Set((FK[t] ?? []).map(([c]) => c));
      for (const raw of rows) {
        const r: Row = { ...raw };
        if (t !== "metric_entries") r.id = mapId(r.id);
        for (const c of fkCols) r[c] = mapId(r[c]);
        if (t === "relations") { r.from_id = mapId(r.from_id); r.to_id = mapId(r.to_id); }
        if (t === "captures") r.processed_into_id = mapId(r.processed_into_id);
        if (t === "activity_log") r.entity_id = mapId(r.entity_id);
        if (t === "metric_entries") r.metric_id = mapId(r.metric_id);
        if (t === "metric_entries" && !db.get("SELECT 1 FROM metrics WHERE id = ? AND workspace_id = ?", r.metric_id as string, wsId)) { skipped[t]++; continue; }
        if (mode === "merge" && t !== "metric_entries" && db.get(`SELECT 1 FROM ${t} WHERE id = ?`, r.id as string)) { skipped[t]++; continue; }
        const vals = cols.map((c) => { const v = r[c]; return v === undefined ? null : (typeof v === "object" && v !== null ? JSON.stringify(v) : v) as never; });
        const res = db.run(sql, ...(hasWs ? [wsId, ...vals] : vals));
        if (res.changes) inserted[t]++; else skipped[t]++;
      }
    }
    if (mode === "replace" && file.workspace?.settings) updateWorkspaceSettings(db, wsId, { name: file.workspace.name, settings: file.workspace.settings as never });
    rebuildSearchIndex(db, wsId);
  });
  return { inserted, skipped, remapped };
}

// ---------- Markdown / CSV exports ----------
export function goalsMarkdown(db: Db, wsId: string): string {
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  const lines: string[] = ["# Goals", ""];
  const walk = (nodes: ReturnType<typeof goalTree>, depth: number) => {
    for (const n of nodes) {
      lines.push(`${"  ".repeat(depth)}- **[${n.level}]** ${n.title}${n.isNorthStar ? " ★" : ""} — ${n.status}, progress ${n.progress.percent ?? "n/a"}%${n.successDefinition ? ` / 成功の定義: ${n.successDefinition}` : ""}${n.why ? ` / Why: ${n.why}` : ""}`);
      walk(n.children, depth + 1);
    }
  };
  walk(goalTree(db, wsId, today, true), 0);
  return lines.join("\n") + "\n";
}
export function decisionsMarkdown(db: Db, wsId: string): string {
  const rows = db.all<Row>("SELECT * FROM decisions WHERE workspace_id = ? ORDER BY decided_at", wsId);
  const out = ["# Decision Journal", ""];
  for (const d of rows) {
    out.push(`## ${d.decided_at} — ${d.title}`, "", `- 状況: ${d.context}`, `- 選択肢: ${parseJson<string[]>(d.options_json, []).join(" / ")}`, `- 決定: ${d.decision}`, `- 理由: ${d.reason}`, `- 前提: ${parseJson<string[]>(d.assumptions_json, []).join(" / ")}`, `- 期待する結果: ${d.expected_outcome}`, `- リスク: ${d.risks}`, `- 確信度: ${d.confidence}%`, `- レビュー予定: ${d.review_date ?? "-"} / status: ${d.status}`);
    for (const r of db.all<Row>("SELECT * FROM decision_reviews WHERE decision_id = ? ORDER BY reviewed_at", d.id as string)) out.push(`- レビュー ${r.reviewed_at}: **${r.outcome}** — ${r.result}${r.lessons ? ` / 学び: ${r.lessons}` : ""}`);
    out.push("");
  }
  return out.join("\n");
}
export function reviewsMarkdown(db: Db, wsId: string): string {
  return listReviews(db, wsId, { limit: 2000 }).reverse().map(reviewToMarkdown).join("\n\n---\n\n") + "\n";
}
export function peopleCsv(db: Db, wsId: string): string {
  const cols = ["id", "name", "organization", "role", "relationship_type", "importance", "tags", "how_met", "notes", "last_contact_at", "next_follow_up_at", "created_at"];
  const rows: Row[] = db.all<Row>("SELECT * FROM people WHERE workspace_id = ? ORDER BY name", wsId).map((r) => ({ ...r, tags: parseJson<string[]>(r.tags_json, []).join("; ") }));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(","))].join("\r\n") + "\r\n";
}
export function knowledgeMarkdown(db: Db, wsId: string): string {
  const rows = db.all<Row>("SELECT * FROM knowledge_items WHERE workspace_id = ? ORDER BY captured_at", wsId);
  const out = ["# Knowledge", ""];
  for (const k of rows) out.push(`## ${k.title}`, "", `- Source: ${k.source_type}${k.source_url ? ` ${k.source_url}` : ""}${k.source_title ? ` (${k.source_title})` : ""}`, `- Captured: ${k.captured_at} / Status: ${k.status}`, `- Summary: ${k.summary}`, `- Key ideas: ${parseJson<string[]>(k.key_ideas_json, []).join(" / ")}`, `- Personal meaning: ${k.personal_meaning}`, `- Next action: ${k.next_action}`, k.applied_note ? `- Applied: ${k.applied_note}` : "", "");
  return out.join("\n");
}

// ---------- CSV / Markdown import ----------
const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "名前", "氏名", "full name"], organization: ["organization", "company", "会社", "組織", "所属"], role: ["role", "title", "役職", "肩書"], relationshipType: ["relationship", "relationshiptype", "関係"],
  importance: ["importance", "重要度", "priority"], tags: ["tags", "タグ"], howMet: ["howmet", "how met", "出会い", "きっかけ"], notes: ["notes", "note", "memo", "メモ", "備考"],
  title: ["title", "タイトル", "goal", "目標", "件名", "name"], level: ["level", "階層", "レベル"], parentTitle: ["parent", "parenttitle", "親"], startDate: ["startdate", "start", "開始", "開始日"], endDate: ["enddate", "end", "期限", "終了日", "deadline"],
  successDefinition: ["success", "successdefinition", "成功の定義"], why: ["why", "理由", "なぜ"], sourceType: ["sourcetype", "type", "種類"], sourceUrl: ["url", "sourceurl", "link", "リンク"], summary: ["summary", "要約", "概要", "description"],
  capturedAt: ["capturedat", "date", "日付", "captured"], decidedAt: ["decidedat", "date", "日付", "決定日"], decision: ["decision", "決定", "決めたこと"], reason: ["reason", "理由"], confidence: ["confidence", "確信度"], reviewDate: ["reviewdate", "review", "レビュー日"],
};
const TARGET_FIELDS: Record<string, string[]> = {
  people_csv: ["name", "organization", "role", "relationshipType", "importance", "tags", "howMet", "notes"],
  goals_csv: ["title", "level", "parentTitle", "startDate", "endDate", "successDefinition", "why"],
  knowledge_csv: ["title", "sourceType", "sourceUrl", "summary", "capturedAt"],
  decisions_csv: ["title", "decidedAt", "decision", "reason", "confidence", "reviewDate"],
};
function suggestMapping(kind: string, headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const field of TARGET_FIELDS[kind] ?? []) {
    const aliases = FIELD_ALIASES[field] ?? [field];
    const h = headers.find((x) => !used.has(x) && aliases.includes(x.trim().toLowerCase().replace(/[_\s]/g, "")) || aliases.includes(x.trim().toLowerCase()));
    if (h) { mapping[field] = h; used.add(h); }
  }
  return mapping;
}

export interface ImportPreview { importId: string; kind: string; headers: string[]; rows: Row[]; rowCount: number; suggestedMapping: Record<string, string>; fields: string[]; duplicates: { row: number; existingId: string; label: string }[]; notes: string[]; counts?: Record<string, number>; issues?: string[]; candidates?: unknown[] }

export async function previewImport(db: Db, wsId: string, input: z.infer<typeof ImportPreviewSchema>): Promise<ImportPreview> {
  const id = newId();
  let preview: Omit<ImportPreview, "importId">;
  const notes: string[] = [];
  if (input.kind.endsWith("_csv")) {
    const parsed = parseCsv(input.content);
    if (parsed.length < 2) throw badRequest("CSV にヘッダー行とデータ行が必要です");
    const headers = parsed[0].map((h) => h.trim());
    const rows = parsed.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
    const mapping = suggestMapping(input.kind, headers);
    const duplicates: ImportPreview["duplicates"] = [];
    if (input.kind === "people_csv" && mapping.name) rows.forEach((r, i) => { for (const d of findDuplicates(db, wsId, String(r[mapping.name]))) duplicates.push({ row: i, existingId: d.id, label: d.name }); });
    if (input.kind === "goals_csv") notes.push("インポートした Goal は status=draft で作成されます（勝手に Active にしません）");
    if (input.kind === "decisions_csv") notes.push("インポートした Decision は status=open、レビュー日は CSV の値（なければ空）です");
    preview = { kind: input.kind, headers, rows: rows.slice(0, 50), rowCount: rows.length, suggestedMapping: mapping, fields: TARGET_FIELDS[input.kind], duplicates, notes };
  } else if (input.kind === "markdown") {
    const sections = splitMarkdown(input.content, input.fileName);
    preview = { kind: input.kind, headers: ["title", "body"], rows: sections.slice(0, 50), rowCount: sections.length, suggestedMapping: {}, fields: ["title", "body"], duplicates: [], notes: ["見出し（# / ##）ごとに Knowledge（captured）として取り込みます"] };
  } else if (input.kind === "json_backup") {
    let data: unknown;
    try { data = JSON.parse(input.content); } catch { throw badRequest("JSON を読み取れません"); }
    const v = validateBackup(data, db.schemaVersion());
    preview = { kind: input.kind, headers: [], rows: [], rowCount: 0, suggestedMapping: {}, fields: [], duplicates: [], notes: ["既存データは残し、同じ id の record はスキップします（merge）。全置換は Backup/Restore 画面から行えます"], counts: v.file?.counts ?? {}, issues: v.issues };
  } else {
    // chat_export: AI extraction when available, otherwise heuristic rules. Nothing is saved until confirm.
    const { messages, format } = parseChatExport(input.content, input.fileName);
    if (messages.length === 0) throw badRequest("会話を読み取れませんでした");
    let candidates: unknown[];
    let via = "heuristic";
    try {
      const r = await extractFromChat(db, wsId, input.content, input.fileName);
      candidates = r.items; via = `ai:${r.model}`;
    } catch {
      candidates = heuristicExtract(messages);
    }
    preview = { kind: input.kind, headers: ["kind", "title", "detail", "sourceRef"], rows: candidates.slice(0, 50) as Row[], rowCount: candidates.length, suggestedMapping: {}, fields: [], duplicates: [], notes: [`抽出方式: ${via}。候補は保存されていません。確認して選んだものだけが保存されます`, `format: ${format}, messages: ${messages.length}`], candidates };
  }
  db.run("INSERT INTO imports(id, workspace_id, kind, file_name, status, preview_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'preview', ?, ?, ?)", id, wsId, input.kind, input.fileName, JSON.stringify({ ...preview, content: input.kind === "json_backup" || input.kind === "chat_export" ? "" : input.content, candidatesFull: preview.candidates ?? null, allRows: input.kind.endsWith("_csv") ? parseCsv(input.content).slice(1) : input.kind === "markdown" ? splitMarkdown(input.content, input.fileName) : null, backup: input.kind === "json_backup" ? JSON.parse(input.content) : null }), nowIso(), nowIso());
  return { importId: id, ...preview };
}

function splitMarkdown(content: string, fileName: string): Row[] {
  const lines = content.split(/\r?\n/);
  const out: Row[] = [];
  let title = fileName.replace(/\.md$/i, "") || "Imported note";
  let buf: string[] = [];
  const flush = () => { const body = buf.join("\n").trim(); if (body || out.length === 0) out.push({ title, body }); buf = []; };
  for (const l of lines) {
    const m = /^#{1,2}\s+(.+)$/.exec(l);
    if (m) { if (buf.length || out.length) flush(); title = m[1].trim(); } else buf.push(l);
  }
  flush();
  return out.filter((s) => String(s.body).trim() || out.length === 1);
}

export async function confirmImport(db: Db, wsId: string, input: z.infer<typeof ImportConfirmSchema>): Promise<{ created: Record<string, number>; skipped: number }> {
  const rec = db.get<{ kind: string; preview_json: string; status: string }>("SELECT kind, preview_json, status FROM imports WHERE id = ? AND workspace_id = ?", input.importId, wsId);
  if (!rec) throw notFound("Import");
  if (rec.status === "done") throw badRequest("この import は完了済みです");
  const stored = parseJson<Record<string, any>>(rec.preview_json, {});
  const created: Record<string, number> = {};
  let skipped = 0;
  const bump = (k: string) => { created[k] = (created[k] ?? 0) + 1; };
  const selected = (n: number) => !input.selectedRows || input.selectedRows.includes(n);
  const mapping = Object.keys(input.mapping).length ? input.mapping : (stored.suggestedMapping ?? {});
  const headers: string[] = stored.headers ?? [];
  const today = todayIn(gw(db, wsId).settings.timezone);
  const get = (row: string[], field: string) => { const h = mapping[field]; const i = h ? headers.indexOf(h) : -1; return i >= 0 ? (row[i] ?? "").trim() : ""; };

  db.transaction(() => {
    if (rec.kind === "people_csv") {
      const dupRows = new Set((stored.duplicates ?? []).map((d: { row: number }) => d.row));
      (stored.allRows as string[][]).forEach((row, i) => {
        if (!selected(i)) return;
        if (dupRows.has(i) && input.duplicateAction === "skip") { skipped++; return; }
        const name = get(row, "name"); if (!name) { skipped++; return; }
        const imp = Number(get(row, "importance"));
        createPerson(db, wsId, PersonCreateSchema.parse({ name, organization: get(row, "organization"), role: get(row, "role"), importance: Number.isInteger(imp) && imp >= 1 && imp <= 5 ? imp : 3, tags: get(row, "tags").split(/[;,、]/).map((s) => s.trim()).filter(Boolean), howMet: get(row, "howMet"), notes: get(row, "notes") }));
        bump("people");
      });
    } else if (rec.kind === "goals_csv") {
      const byTitle = new Map<string, string>();
      (stored.allRows as string[][]).forEach((row, i) => {
        if (!selected(i)) return;
        const title = get(row, "title"); if (!title) { skipped++; return; }
        const level = (["vision", "year", "quarter", "month", "week"].includes(get(row, "level").toLowerCase()) ? get(row, "level").toLowerCase() : "year") as "year";
        const parentId = byTitle.get(get(row, "parentTitle")) ?? null;
        const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        try {
          const g = createGoal(db, wsId, GoalCreateSchema.parse({ title, level, parentId, startDate: dateOk(get(row, "startDate")), endDate: dateOk(get(row, "endDate")), successDefinition: get(row, "successDefinition"), why: get(row, "why"), status: "draft" }));
          byTitle.set(title, g.goal.id); bump("goals");
        } catch { skipped++; }
      });
    } else if (rec.kind === "knowledge_csv") {
      (stored.allRows as string[][]).forEach((row, i) => {
        if (!selected(i)) return;
        const title = get(row, "title"); if (!title) { skipped++; return; }
        const st = get(row, "sourceType").toLowerCase();
        createKnowledge(db, wsId, KnowledgeCreateSchema.parse({ title, sourceType: ["article", "book", "video", "podcast", "pdf", "chat", "course", "idea", "other"].includes(st) ? st : "other", sourceUrl: get(row, "sourceUrl"), summary: get(row, "summary"), capturedAt: /^\d{4}-\d{2}-\d{2}$/.test(get(row, "capturedAt")) ? get(row, "capturedAt") : today }));
        bump("knowledge");
      });
    } else if (rec.kind === "decisions_csv") {
      (stored.allRows as string[][]).forEach((row, i) => {
        if (!selected(i)) return;
        const title = get(row, "title"); if (!title) { skipped++; return; }
        const conf = Number(get(row, "confidence"));
        createDecision(db, wsId, DecisionCreateSchema.parse({ title, decidedAt: /^\d{4}-\d{2}-\d{2}$/.test(get(row, "decidedAt")) ? get(row, "decidedAt") : today, decision: get(row, "decision"), reason: get(row, "reason"), confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : 50, reviewDate: /^\d{4}-\d{2}-\d{2}$/.test(get(row, "reviewDate")) ? get(row, "reviewDate") : null }));
        bump("decisions");
      });
    } else if (rec.kind === "markdown") {
      (stored.allRows as Row[]).forEach((s, i) => {
        if (!selected(i)) return;
        createKnowledge(db, wsId, KnowledgeCreateSchema.parse({ title: String(s.title).slice(0, 300), sourceType: "other", rawContent: String(s.body), summary: String(s.body).slice(0, 500) }));
        bump("knowledge");
      });
    } else if (rec.kind === "json_backup") {
      const v = validateBackup(stored.backup, db.schemaVersion());
      if (!v.ok) throw badRequest("バックアップの検証に失敗しました", v.issues);
      const r = restoreWorkspace(db, wsId, v.file!, "merge");
      for (const [k, n] of Object.entries(r.inserted)) if (n) created[k] = n;
      skipped = Object.values(r.skipped).reduce((a, b) => a + b, 0);
    } else if (rec.kind === "chat_export") {
      const cands = (stored.candidatesFull ?? stored.candidates ?? []) as Array<{ kind: string; title: string; detail: string; sourceRef: string; sourceExcerpt?: string }>;
      cands.forEach((cnd, i) => {
        if (!selected(i)) return;
        const src = `出典: ${cnd.sourceRef}\n${cnd.sourceExcerpt ?? ""}`.trim();
        switch (cnd.kind) {
          case "decision": createDecision(db, wsId, DecisionCreateSchema.parse({ title: cnd.title, decidedAt: today, decision: cnd.detail, context: src })); bump("decisions"); break;
          case "knowledge": case "idea": createKnowledge(db, wsId, KnowledgeCreateSchema.parse({ title: cnd.title, sourceType: cnd.kind === "idea" ? "idea" : "chat", summary: cnd.detail, rawContent: src, sourceTitle: cnd.sourceRef })); bump("knowledge"); break;
          case "action": createAction(db, wsId, ActionCreateSchema.parse({ title: cnd.title, notes: `${cnd.detail}\n${src}` })); bump("actions"); break;
          case "question": createAction(db, wsId, ActionCreateSchema.parse({ title: cnd.title, kind: "open_loop", notes: `${cnd.detail}\n${src}` })); bump("actions"); break;
          default: skipped++;
        }
      });
    }
    db.run("UPDATE imports SET status = 'done', result_json = ?, updated_at = ? WHERE id = ?", JSON.stringify({ created, skipped }), nowIso(), input.importId);
  });
  return { created, skipped };
}

// ---------- backups on disk ----------
function backupDir(wsId: string) { const d = path.resolve(config.backupDir, wsId); fs.mkdirSync(d, { recursive: true }); return d; }
export function writeBackup(db: Db, wsId: string): { name: string; bytes: number; counts: Record<string, number>; checksum: string } {
  const file = exportWorkspace(db, wsId);
  const name = `northstar-backup-${file.generatedAt.replace(/[:.]/g, "-")}.json`;
  const json = JSON.stringify(file);
  fs.writeFileSync(path.join(backupDir(wsId), name), json);
  log("info", "backup.written", { wsId, name, bytes: json.length });
  return { name, bytes: json.length, counts: file.counts, checksum: file.checksum };
}
export function listBackups(wsId: string) {
  return fs.readdirSync(backupDir(wsId)).filter((f) => f.endsWith(".json")).sort().reverse().map((name) => { const st = fs.statSync(path.join(backupDir(wsId), name)); return { name, bytes: st.size, modifiedAt: st.mtime.toISOString() }; });
}
export function readBackup(wsId: string, name: string): string {
  if (!/^[\w.-]+\.json$/.test(name)) throw badRequest("ファイル名が不正です");
  const p = path.join(backupDir(wsId), name);
  if (!fs.existsSync(p)) throw notFound("Backup");
  return fs.readFileSync(p, "utf8");
}

// ---------- routes ----------
export const transferRoutes = new Hono<Env>();
const attach = (c: { header: (k: string, v: string) => void }, filename: string, type: string) => { c.header("Content-Type", type); c.header("Content-Disposition", `attachment; filename="${filename}"`); };
transferRoutes.get("/export/all.json", (c) => { const f = exportWorkspace(c.get("db"), ws(c)); attach(c, `northstar-export-${f.generatedAt.slice(0, 10)}.json`, "application/json; charset=utf-8"); return c.body(JSON.stringify(f, null, 2)); });
transferRoutes.get("/export/goals.md", (c) => { attach(c, "goals.md", "text/markdown; charset=utf-8"); return c.body(goalsMarkdown(c.get("db"), ws(c))); });
transferRoutes.get("/export/decisions.md", (c) => { attach(c, "decisions.md", "text/markdown; charset=utf-8"); return c.body(decisionsMarkdown(c.get("db"), ws(c))); });
transferRoutes.get("/export/reviews.md", (c) => { attach(c, "reviews.md", "text/markdown; charset=utf-8"); return c.body(reviewsMarkdown(c.get("db"), ws(c))); });
transferRoutes.get("/export/people.csv", (c) => { attach(c, "people.csv", "text/csv; charset=utf-8"); return c.body("﻿" + peopleCsv(c.get("db"), ws(c))); });
transferRoutes.get("/export/knowledge.md", (c) => { attach(c, "knowledge.md", "text/markdown; charset=utf-8"); return c.body(knowledgeMarkdown(c.get("db"), ws(c))); });

transferRoutes.post("/import/preview", async (c) => c.json(await previewImport(c.get("db"), ws(c), await parseBody(c, ImportPreviewSchema))));
transferRoutes.post("/import/confirm", async (c) => c.json(await confirmImport(c.get("db"), ws(c), await parseBody(c, ImportConfirmSchema))));

transferRoutes.get("/backup", (c) => c.json({ backups: listBackups(ws(c)), dir: config.backupDir }));
transferRoutes.post("/backup", (c) => c.json(writeBackup(c.get("db"), ws(c)), 201));
transferRoutes.get("/backup/:name", (c) => { const json = readBackup(ws(c), c.req.param("name")); attach(c, c.req.param("name"), "application/json; charset=utf-8"); return c.body(json); });
transferRoutes.post("/restore/validate", async (c) => {
  const body = await parseBody(c, z.object({ backup: z.unknown() }));
  const v = validateBackup(body.backup, c.get("db").schemaVersion());
  return c.json({ ok: v.ok, issues: v.issues, counts: v.file?.counts ?? null, schemaVersion: v.file?.schemaVersion ?? null, generatedAt: v.file?.generatedAt ?? null });
});
transferRoutes.post("/restore", async (c) => {
  const body = await parseBody(c, z.object({ backup: z.unknown().optional(), backupName: z.string().optional(), mode: z.enum(["replace", "merge"]).default("merge"), confirmReplace: z.boolean().default(false) }));
  const db = c.get("db"); const wsId = ws(c);
  const data = body.backup ?? (body.backupName ? JSON.parse(readBackup(wsId, body.backupName)) : null);
  if (!data) throw badRequest("backup または backupName が必要です");
  const v = validateBackup(data, db.schemaVersion());
  if (!v.ok) return c.json({ error: { code: "invalid_backup", message: "バックアップの検証に失敗したため、現在のデータは変更していません", details: v.issues } }, 400);
  if (body.mode === "replace" && !body.confirmReplace) throw badRequest("全置換には confirmReplace=true が必要です");
  const result = restoreWorkspace(db, wsId, v.file!, body.mode);
  return c.json({ ok: true, mode: body.mode, ...result });
});
