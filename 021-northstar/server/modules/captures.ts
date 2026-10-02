import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Capture, CaptureType, CaptureStatus } from "@shared/types";
import { CAPTURE_TYPES } from "@shared/types";
import { CaptureCreateSchema, CaptureProcessSchema, GoalCreateSchema, ActionCreateSchema, DecisionCreateSchema, KnowledgeCreateSchema, PersonCreateSchema, ContactCreateSchema } from "@shared/schemas";
import { parseBody, parseQuery, ws } from "../lib/http";
import { badRequest, notFound } from "../lib/errors";
import { newId, nowIso } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { createGoal } from "./goals";
import { createAction } from "./actions";
import { todayIn, periodFor } from "@shared/period";
import { getWorkspace } from "./workspace";

interface CaptureRow { id: string; workspace_id: string; raw_text: string; type: CaptureType | null; suggested_type: CaptureType | null; status: CaptureStatus; processed_into_type: string | null; processed_into_id: string | null; source: Capture["source"]; client_id: string | null; created_at: string; updated_at: string }
export function mapCapture(r: CaptureRow): Capture {
  return { id: r.id, workspaceId: r.workspace_id, rawText: r.raw_text, type: r.type, suggestedType: r.suggested_type, status: r.status, processedIntoType: r.processed_into_type, processedIntoId: r.processed_into_id, source: r.source, clientId: r.client_id, createdAt: r.created_at, updatedAt: r.updated_at };
}

/** Heuristic classification — always a *suggestion*; the user confirms the type in Inbox Review. */
export function suggestType(text: string): CaptureType {
  const t = text.trim();
  if (/https?:\/\//i.test(t) || /^(読んだ|読了|book|記事|article)[:：]/i.test(t)) return "knowledge";
  if (/(決めた|決定|に決めた|やめることにした|decided|decision[:：])/i.test(t)) return "decision";
  if (/[?？]$/.test(t) || /^(なぜ|どうすれば|どうやって|why|how|what|should)/i.test(t)) return "question";
  if (/(さんと|さんに|さんから|@\w+|と会った|とMTG|と話した|met with|call with)/i.test(t)) return "person_note";
  if (/^(今日は|今日の|日記|journal)/i.test(t) || /(疲れた|嬉しかった|不安|気分)/.test(t)) return "journal";
  if (/^(todo|task|やる|する|作る|送る|書く|買う|連絡|確認)/i.test(t) || /(すること|しなきゃ|しないと|までに|を作る|を送る|を書く|を買う|に連絡|を確認|を予約|を提出|を公開)/.test(t) || /(作る|送る|書く|買う|する|やる|公開する|提出する)$/.test(t)) return "task";
  return "idea";
}

export function getCapture(db: Db, wsId: string, id: string): Capture {
  const r = db.get<CaptureRow>("SELECT * FROM captures WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Capture");
  return mapCapture(r);
}

export function createCapture(db: Db, wsId: string, input: z.infer<typeof CaptureCreateSchema>): { capture: Capture; created: boolean } {
  if (input.clientId) {
    const existing = db.get<CaptureRow>("SELECT * FROM captures WHERE workspace_id = ? AND client_id = ?", wsId, input.clientId);
    if (existing) return { capture: mapCapture(existing), created: false };
  }
  const id = newId();
  const now = nowIso();
  const createdAt = input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : now;
  const suggested = suggestType(input.rawText);
  db.transaction(() => {
    db.run("INSERT INTO captures(id, workspace_id, raw_text, type, suggested_type, status, source, client_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'inbox', ?, ?, ?, ?)",
      id, wsId, input.rawText, input.type, suggested, input.source, input.clientId, createdAt, now);
    indexEntity(db, wsId, "capture", id, input.rawText.slice(0, 80), input.rawText, createdAt.slice(0, 10));
  });
  return { capture: getCapture(db, wsId, id), created: true };
}

export function listCaptures(db: Db, wsId: string, status: CaptureStatus = "inbox", limit = 200): Capture[] {
  return db.all<CaptureRow>("SELECT * FROM captures WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?", wsId, status, limit).map(mapCapture);
}

export function updateCapture(db: Db, wsId: string, id: string, patch: { type?: CaptureType | null; status?: CaptureStatus; rawText?: string }): Capture {
  const cur = getCapture(db, wsId, id);
  const type = patch.type === undefined ? cur.type : patch.type;
  const status = patch.status ?? cur.status;
  const rawText = patch.rawText ?? cur.rawText;
  db.transaction(() => {
    db.run("UPDATE captures SET type = ?, status = ?, raw_text = ?, updated_at = ? WHERE id = ? AND workspace_id = ?", type, status, rawText, nowIso(), id, wsId);
    indexEntity(db, wsId, "capture", id, rawText.slice(0, 80), rawText, cur.createdAt.slice(0, 10));
  });
  return getCapture(db, wsId, id);
}

export function deleteCapture(db: Db, wsId: string, id: string): void {
  getCapture(db, wsId, id);
  db.transaction(() => { cleanupEntity(db, wsId, "capture", id); db.run("DELETE FROM captures WHERE id = ? AND workspace_id = ?", id, wsId); });
}

/**
 * Turn a capture into a real record. The payload is validated with the target schema; the
 * capture is marked processed with a back-reference. Creating People/Decision/Knowledge requires
 * the respective modules (resolved lazily to avoid import cycles).
 */
export async function processCapture(db: Db, wsId: string, id: string, input: z.infer<typeof CaptureProcessSchema>): Promise<{ capture: Capture; createdType: string; createdId: string }> {
  const cap = getCapture(db, wsId, id);
  if (cap.status === "processed") throw badRequest("この Capture は処理済みです");
  const base = { title: cap.rawText.split("\n")[0].slice(0, 200) };
  const payload = { ...base, ...input.payload } as Record<string, unknown>;
  let createdType = "";
  let createdId = "";
  const timezone = getWorkspace(db, wsId).settings.timezone;
  const today = todayIn(timezone);

  switch (input.type) {
    case "task": {
      const a = createAction(db, wsId, ActionCreateSchema.parse({ notes: cap.rawText, ...payload }));
      createdType = "action"; createdId = a.id; break;
    }
    case "question": {
      const a = createAction(db, wsId, ActionCreateSchema.parse({ kind: "open_loop", notes: cap.rawText, ...payload }));
      createdType = "action"; createdId = a.id; break;
    }
    case "idea": {
      const { createKnowledge } = await import("./knowledge");
      const k = createKnowledge(db, wsId, KnowledgeCreateSchema.parse({ sourceType: "idea", summary: cap.rawText, ...payload }));
      createdType = "knowledge"; createdId = k.id; break;
    }
    case "knowledge": {
      const { createKnowledge } = await import("./knowledge");
      const url = /https?:\/\/\S+/.exec(cap.rawText)?.[0] ?? "";
      const k = createKnowledge(db, wsId, KnowledgeCreateSchema.parse({ sourceUrl: url, summary: cap.rawText, ...payload }));
      createdType = "knowledge"; createdId = k.id; break;
    }
    case "decision": {
      const { createDecision } = await import("./decisions");
      const d = createDecision(db, wsId, DecisionCreateSchema.parse({ decidedAt: today, decision: cap.rawText, ...payload }));
      createdType = "decision"; createdId = d.id; break;
    }
    case "person_note": {
      const { createPerson, logContact } = await import("./people");
      let personId = typeof payload.personId === "string" ? payload.personId : "";
      if (!personId) {
        const p = createPerson(db, wsId, PersonCreateSchema.parse({ name: (payload.name as string) ?? base.title }));
        personId = p.id;
      }
      const contact = logContact(db, wsId, ContactCreateSchema.parse({ personId, date: today, type: "other", summary: cap.rawText, ...(payload.contact as object ?? {}) }));
      createdType = "contact"; createdId = contact.id; break;
    }
    case "journal": {
      const { upsertReview } = await import("./reviews");
      const r = upsertReview(db, wsId, { kind: "daily", date: today, answers: { journal: cap.rawText }, complete: false, appendAnswers: true });
      createdType = "review"; createdId = r.id; break;
    }
    default: {
      if (input.type === "goal" as unknown) {
        const g = createGoal(db, wsId, GoalCreateSchema.parse({ level: "month", description: cap.rawText, ...payload }));
        createdType = "goal"; createdId = g.goal.id;
      } else throw badRequest("不明な type");
    }
  }
  db.run("UPDATE captures SET status = 'processed', type = ?, processed_into_type = ?, processed_into_id = ?, updated_at = ? WHERE id = ?", input.type, createdType, createdId, nowIso(), id);
  return { capture: getCapture(db, wsId, id), createdType, createdId };
}

export const captureRoutes = new Hono<Env>();
captureRoutes.get("/captures", (c) => {
  const q = parseQuery(c, z.object({ status: z.enum(["inbox", "processed", "dismissed"]).default("inbox") }));
  return c.json({ captures: listCaptures(c.get("db"), ws(c), q.status) });
});
captureRoutes.post("/captures", async (c) => {
  const body = await parseBody(c, CaptureCreateSchema);
  const res = createCapture(c.get("db"), ws(c), body);
  return c.json(res, res.created ? 201 : 200);
});
/** Offline queue sync: idempotent by clientId; returns per-item outcome, never overwrites server data. */
captureRoutes.post("/captures/sync", async (c) => {
  const body = await parseBody(c, z.object({ items: z.array(CaptureCreateSchema).max(200) }));
  const db = c.get("db"); const wsId = ws(c);
  const results = body.items.map((item) => {
    try {
      const r = createCapture(db, wsId, { ...item, source: item.source === "web" ? "pwa" : item.source });
      return { clientId: item.clientId, status: r.created ? "created" : "duplicate", id: r.capture.id };
    } catch (e) {
      return { clientId: item.clientId, status: "error", message: (e as Error).message };
    }
  });
  return c.json({ results });
});
captureRoutes.patch("/captures/:id", async (c) => {
  const body = await parseBody(c, z.object({ type: z.enum(CAPTURE_TYPES).nullable().optional(), status: z.enum(["inbox", "processed", "dismissed"]).optional(), rawText: z.string().min(1).max(10000).optional() }));
  return c.json({ capture: updateCapture(c.get("db"), ws(c), c.req.param("id"), body) });
});
captureRoutes.post("/captures/:id/process", async (c) => {
  const body = await parseBody(c, CaptureProcessSchema.extend({ type: z.enum([...CAPTURE_TYPES, "goal"]) }));
  return c.json(await processCapture(c.get("db"), ws(c), c.req.param("id"), body as never));
});
captureRoutes.delete("/captures/:id", (c) => { deleteCapture(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });

export { periodFor };
