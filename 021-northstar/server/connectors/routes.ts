import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import { parseBody, ws } from "../lib/http";
import { badRequest } from "../lib/errors";
import { CONNECTORS, connectorStates, configureConnector, connectorConfig, removeConnector, type ConnectorType } from "./registry";
import { importIcs } from "../modules/calendar";

export const connectorRoutes = new Hono<Env>();
connectorRoutes.get("/connectors", (c) => c.json({ connectors: connectorStates(c.get("db"), ws(c)) }));
connectorRoutes.put("/connectors/:type", async (c) => {
  const type = c.req.param("type") as ConnectorType;
  const def = CONNECTORS.find((x) => x.type === type);
  if (!def) throw badRequest("不明な connector");
  if (!def.implemented) throw badRequest(`${def.label} は初版では計画段階です（${def.verification}）`);
  const body = await parseBody(c, z.object({ config: z.record(z.string(), z.string().max(2000)) }));
  if (type === "ics" && body.config.url && !/^https?:\/\//.test(body.config.url)) throw badRequest("ICS URL は http(s) で始まる必要があります");
  configureConnector(c.get("db"), ws(c), type, body.config);
  return c.json({ ok: true });
});
connectorRoutes.delete("/connectors/:type", (c) => { removeConnector(c.get("db"), ws(c), c.req.param("type") as ConnectorType); return c.json({ ok: true }); });
/** Manual sync (explicit user action). Only the ICS connector is implemented. */
connectorRoutes.post("/connectors/:type/sync", async (c) => {
  const type = c.req.param("type") as ConnectorType;
  if (type !== "ics") throw badRequest("この connector は同期できません");
  const db = c.get("db"); const wsId = ws(c);
  const cfg = connectorConfig(db, wsId, "ics");
  const url = String(cfg.url ?? "");
  if (!url) throw badRequest("ICS URL が設定されていません（ファイル取り込みは /calendar/import-ics）");
  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: "text/calendar" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    db.run("UPDATE connectors SET status = 'error', updated_at = ? WHERE workspace_id = ? AND type = 'ics'", new Date().toISOString(), wsId);
    throw badRequest(`ICS の取得に失敗しました: ${(e as Error).message}`);
  }
  return c.json(importIcs(db, wsId, text));
});
