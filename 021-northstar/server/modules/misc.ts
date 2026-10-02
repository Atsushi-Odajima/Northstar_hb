import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Principle, Experiment, Metric, MetricEntry } from "@shared/types";
import { PrincipleCreateSchema, PrincipleUpdateSchema, ExperimentCreateSchema, ExperimentUpdateSchema, MetricCreateSchema, MetricEntrySchema, RelationCreateSchema } from "@shared/schemas";
import { parseBody, ws } from "../lib/http";
import { badRequest, notFound } from "../lib/errors";
import { newId, nowIso, bool } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { logActivity } from "./activity";
import { link, unlink, relationsOf } from "./relations";
import { stripUndefined } from "./goals";
import { AUTO_METRIC_SOURCES } from "./reviews";
import { ENTITY_TYPES } from "@shared/types";

interface PRow { id: string; workspace_id: string; kind: Principle["kind"]; text: string; active: number; period_start: string | null; period_end: string | null; created_at: string; updated_at: string }
const mapP = (r: PRow): Principle => ({ id: r.id, workspaceId: r.workspace_id, kind: r.kind, text: r.text, active: bool(r.active), periodStart: r.period_start, periodEnd: r.period_end, createdAt: r.created_at, updatedAt: r.updated_at });
interface ERow { id: string; workspace_id: string; title: string; hypothesis: string; action: string; period_start: string | null; period_end: string | null; success_signal: string; status: Experiment["status"]; result: string; lesson: string; created_at: string; updated_at: string }
const mapE = (r: ERow): Experiment => ({ id: r.id, workspaceId: r.workspace_id, title: r.title, hypothesis: r.hypothesis, action: r.action, periodStart: r.period_start, periodEnd: r.period_end, successSignal: r.success_signal, status: r.status, result: r.result, lesson: r.lesson, createdAt: r.created_at, updatedAt: r.updated_at });

export function listPrinciples(db: Db, wsId: string): Principle[] { return db.all<PRow>("SELECT * FROM principles WHERE workspace_id = ? ORDER BY kind, active DESC, created_at", wsId).map(mapP); }
export function createPrinciple(db: Db, wsId: string, input: z.infer<typeof PrincipleCreateSchema>): Principle {
  const id = newId(); const now = nowIso();
  db.run("INSERT INTO principles(id, workspace_id, kind, text, active, period_start, period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, wsId, input.kind, input.text, input.active, input.periodStart, input.periodEnd, now, now);
  indexEntity(db, wsId, "principle", id, input.text, input.kind === "anti_goal" ? "Anti-goal / Not-to-do" : "Operating principle", now.slice(0, 10));
  return mapP(db.get<PRow>("SELECT * FROM principles WHERE id = ?", id)!);
}
export function updatePrinciple(db: Db, wsId: string, id: string, patch: z.infer<typeof PrincipleUpdateSchema>): Principle {
  const r = db.get<PRow>("SELECT * FROM principles WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Principle");
  const next = { ...mapP(r), ...stripUndefined(patch) };
  db.run("UPDATE principles SET kind=?, text=?, active=?, period_start=?, period_end=?, updated_at=? WHERE id=?", next.kind, next.text, next.active, next.periodStart, next.periodEnd, nowIso(), id);
  indexEntity(db, wsId, "principle", id, next.text, next.kind, r.created_at.slice(0, 10));
  return mapP(db.get<PRow>("SELECT * FROM principles WHERE id = ?", id)!);
}
export function deletePrinciple(db: Db, wsId: string, id: string): void {
  if (!db.get("SELECT 1 FROM principles WHERE id = ? AND workspace_id = ?", id, wsId)) throw notFound("Principle");
  db.transaction(() => { cleanupEntity(db, wsId, "principle", id); db.run("DELETE FROM principles WHERE id = ?", id); });
}

export function listExperiments(db: Db, wsId: string): Experiment[] { return db.all<ERow>("SELECT * FROM experiments WHERE workspace_id = ? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, created_at DESC", wsId).map(mapE); }
export function createExperiment(db: Db, wsId: string, input: z.infer<typeof ExperimentCreateSchema>): Experiment {
  const id = newId(); const now = nowIso();
  db.run("INSERT INTO experiments(id, workspace_id, title, hypothesis, action, period_start, period_end, success_signal, status, result, lesson, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, wsId, input.title, input.hypothesis, input.action, input.periodStart, input.periodEnd, input.successSignal, input.status, input.result, input.lesson, now, now);
  indexEntity(db, wsId, "experiment", id, input.title, [input.hypothesis, input.action, input.successSignal, input.result, input.lesson].filter(Boolean).join("\n"), input.periodStart ?? now.slice(0, 10));
  return mapE(db.get<ERow>("SELECT * FROM experiments WHERE id = ?", id)!);
}
export function updateExperiment(db: Db, wsId: string, id: string, patch: z.infer<typeof ExperimentUpdateSchema>): Experiment {
  const r = db.get<ERow>("SELECT * FROM experiments WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Experiment");
  const cur = mapE(r);
  const next = { ...cur, ...stripUndefined(patch) };
  db.transaction(() => {
    db.run("UPDATE experiments SET title=?, hypothesis=?, action=?, period_start=?, period_end=?, success_signal=?, status=?, result=?, lesson=?, updated_at=? WHERE id=?", next.title, next.hypothesis, next.action, next.periodStart, next.periodEnd, next.successSignal, next.status, next.result, next.lesson, nowIso(), id);
    indexEntity(db, wsId, "experiment", id, next.title, [next.hypothesis, next.action, next.successSignal, next.result, next.lesson].filter(Boolean).join("\n"), next.periodStart ?? r.created_at.slice(0, 10));
    if (next.status === "completed" && cur.status !== "completed") logActivity(db, wsId, "experiment", id, "experiment.completed", next.lesson || next.title);
  });
  return mapE(db.get<ERow>("SELECT * FROM experiments WHERE id = ?", id)!);
}
export function deleteExperiment(db: Db, wsId: string, id: string): void {
  if (!db.get("SELECT 1 FROM experiments WHERE id = ? AND workspace_id = ?", id, wsId)) throw notFound("Experiment");
  db.transaction(() => { cleanupEntity(db, wsId, "experiment", id); db.run("DELETE FROM experiments WHERE id = ?", id); });
}

interface MRow { id: string; workspace_id: string; name: string; unit: string; source: string; created_at: string }
const mapM = (r: MRow): Metric => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, unit: r.unit, source: r.source, createdAt: r.created_at });
export function listMetrics(db: Db, wsId: string): Metric[] { return db.all<MRow>("SELECT * FROM metrics WHERE workspace_id = ? ORDER BY created_at", wsId).map(mapM); }
export function createMetric(db: Db, wsId: string, input: z.infer<typeof MetricCreateSchema>): Metric {
  if (!(AUTO_METRIC_SOURCES as readonly string[]).includes(input.source)) throw badRequest("source が不正です");
  const id = newId();
  db.run("INSERT INTO metrics(id, workspace_id, name, unit, source, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, wsId, input.name, input.unit, input.source, nowIso());
  return mapM(db.get<MRow>("SELECT * FROM metrics WHERE id = ?", id)!);
}
export function deleteMetric(db: Db, wsId: string, id: string): void {
  if (!db.get("SELECT 1 FROM metrics WHERE id = ? AND workspace_id = ?", id, wsId)) throw notFound("Metric");
  db.run("DELETE FROM metrics WHERE id = ?", id);
}
export function addMetricEntry(db: Db, wsId: string, metricId: string, input: z.infer<typeof MetricEntrySchema>): MetricEntry {
  if (!db.get("SELECT 1 FROM metrics WHERE id = ? AND workspace_id = ?", metricId, wsId)) throw notFound("Metric");
  const id = newId();
  db.run("INSERT INTO metric_entries(id, metric_id, date, value, note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(metric_id, date) DO UPDATE SET value = excluded.value, note = excluded.note", id, metricId, input.date, input.value, input.note);
  const r = db.get<{ id: string; metric_id: string; date: string; value: number; note: string }>("SELECT * FROM metric_entries WHERE metric_id = ? AND date = ?", metricId, input.date)!;
  return { id: r.id, metricId: r.metric_id, date: r.date, value: r.value, note: r.note };
}
export function metricEntries(db: Db, wsId: string, metricId: string, from?: string, to?: string): MetricEntry[] {
  if (!db.get("SELECT 1 FROM metrics WHERE id = ? AND workspace_id = ?", metricId, wsId)) throw notFound("Metric");
  return db.all<{ id: string; metric_id: string; date: string; value: number; note: string }>("SELECT * FROM metric_entries WHERE metric_id = ? AND date >= ? AND date <= ? ORDER BY date", metricId, from ?? "0000-01-01", to ?? "9999-12-31")
    .map((r) => ({ id: r.id, metricId: r.metric_id, date: r.date, value: r.value, note: r.note }));
}

export const miscRoutes = new Hono<Env>();
miscRoutes.get("/principles", (c) => c.json({ principles: listPrinciples(c.get("db"), ws(c)) }));
miscRoutes.post("/principles", async (c) => c.json({ principle: createPrinciple(c.get("db"), ws(c), await parseBody(c, PrincipleCreateSchema)) }, 201));
miscRoutes.patch("/principles/:id", async (c) => c.json({ principle: updatePrinciple(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, PrincipleUpdateSchema)) }));
miscRoutes.delete("/principles/:id", (c) => { deletePrinciple(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
miscRoutes.get("/experiments", (c) => c.json({ experiments: listExperiments(c.get("db"), ws(c)) }));
miscRoutes.post("/experiments", async (c) => c.json({ experiment: createExperiment(c.get("db"), ws(c), await parseBody(c, ExperimentCreateSchema)) }, 201));
miscRoutes.patch("/experiments/:id", async (c) => c.json({ experiment: updateExperiment(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, ExperimentUpdateSchema)) }));
miscRoutes.delete("/experiments/:id", (c) => { deleteExperiment(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
miscRoutes.get("/metrics", (c) => c.json({ metrics: listMetrics(c.get("db"), ws(c)), sources: AUTO_METRIC_SOURCES }));
miscRoutes.post("/metrics", async (c) => c.json({ metric: createMetric(c.get("db"), ws(c), await parseBody(c, MetricCreateSchema)) }, 201));
miscRoutes.delete("/metrics/:id", (c) => { deleteMetric(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
miscRoutes.get("/metrics/:id/entries", (c) => c.json({ entries: metricEntries(c.get("db"), ws(c), c.req.param("id"), c.req.query("from"), c.req.query("to")) }));
miscRoutes.post("/metrics/:id/entries", async (c) => c.json({ entry: addMetricEntry(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, MetricEntrySchema)) }, 201));
miscRoutes.post("/relations", async (c) => {
  const body = await parseBody(c, RelationCreateSchema);
  const rel = link(c.get("db"), ws(c), body.fromType, body.fromId, body.toType, body.toId, body.kind);
  return c.json({ relation: rel, created: !!rel }, rel ? 201 : 200);
});
miscRoutes.delete("/relations/:id", (c) => { unlink(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
miscRoutes.get("/relations/:type/:id", (c) => {
  const type = c.req.param("type");
  if (!(ENTITY_TYPES as readonly string[]).includes(type)) throw badRequest("type が不正です");
  return c.json({ relations: relationsOf(c.get("db"), ws(c), type as never, c.req.param("id")) });
});
