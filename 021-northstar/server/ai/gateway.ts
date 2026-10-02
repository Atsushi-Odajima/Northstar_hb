import type { Db } from "../db/connection";
import type { AiSettings, AiFeature, AiCategory, EntityType } from "@shared/types";
import { AppError } from "../lib/errors";
import { newId, nowIso } from "../lib/util";
import { config } from "../config";
import { getWorkspace } from "../modules/workspace";
import { rateLimit } from "../auth/rateLimit";
import type { ChatProvider, EmbeddingProvider, UsageRecord } from "./types";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider, OpenAIEmbedder } from "./providers/openai";
import { MockChatProvider } from "./providers/mock";
import { LocalLiteEmbedder } from "../modules/search/embeddings";
import { estimateCost } from "./pricing";
import { monthPeriod, periodBounds, todayIn } from "@shared/period";

export class AiUnavailableError extends AppError {
  constructor(message: string, code = "ai_unavailable") { super(409, code, message); }
}

/** Sensitive categories → entity types that are never sent to a provider. */
export function excludedTypesFor(settings: AiSettings): EntityType[] {
  const map: Record<AiCategory, EntityType[]> = {
    journal: ["capture"], // journal captures + daily review "journal" answers (reviews handled by field filter)
    people: ["person", "contact", "promise", "follow_up"],
    decisions: ["decision"],
    reviews: ["review"],
    knowledge: ["knowledge"],
    goals: ["goal", "outcome", "project", "action"],
  };
  const out = new Set<EntityType>();
  for (const c of settings.excludedCategories) for (const t of map[c] ?? []) out.add(t);
  return [...out];
}

export interface AiRuntime { settings: AiSettings; chat: ChatProvider; embedder: EmbeddingProvider | null; excluded: EntityType[] }

export function resolveProviders(settings: AiSettings): { chat: ChatProvider | null; embedder: EmbeddingProvider | null; reason: string | null } {
  if (!settings.enabled) return { chat: null, embedder: null, reason: "AI は OFF です（設定で有効化できます）" };
  let chat: ChatProvider | null = null;
  let reason: string | null = null;
  switch (settings.provider) {
    case "anthropic":
      if (!config.anthropicApiKey) reason = "サーバーに ANTHROPIC_API_KEY が設定されていません";
      else chat = new AnthropicProvider(settings.model || "claude-opus-5-5", config.anthropicApiKey);
      break;
    case "openai":
      if (!config.openaiApiKey) reason = "サーバーに OPENAI_API_KEY が設定されていません";
      else if (!settings.model) reason = "OpenAI のモデル名を設定してください";
      else chat = new OpenAIProvider(settings.model, config.openaiApiKey, config.openaiBaseUrl);
      break;
    case "mock":
      chat = new MockChatProvider();
      break;
    default:
      reason = "AI provider が選択されていません";
  }
  let embedder: EmbeddingProvider | null = null;
  const em = settings.embeddingModel;
  if (em === "local-lite" || settings.provider === "mock") embedder = new LocalLiteEmbedder();
  else if (em && config.openaiApiKey) embedder = new OpenAIEmbedder(em, config.openaiApiKey, config.openaiBaseUrl, em.includes("large") ? 3072 : 1536);
  return { chat, embedder, reason };
}

export function aiStatus(db: Db, wsId: string) {
  const settings = getWorkspace(db, wsId).settings.ai;
  const { chat, embedder, reason } = resolveProviders(settings);
  const usage = usageSummary(db, wsId);
  return {
    enabled: settings.enabled, provider: settings.provider, model: chat?.model ?? settings.model, ready: !!chat, reason,
    embedding: embedder ? { name: embedder.name, model: embedder.model } : null,
    features: settings.features, excludedCategories: settings.excludedCategories, excludedTypes: excludedTypesFor(settings),
    usage, capUsd: settings.monthlyCapUsd, capReached: usage.monthCostUsd >= settings.monthlyCapUsd && settings.monthlyCapUsd > 0,
    serverKeys: { anthropic: !!config.anthropicApiKey, openai: !!config.openaiApiKey },
  };
}

/** Resolves a ready runtime or throws (AI OFF, feature OFF, cap reached, rate limited, missing key). Never calls a provider. */
export function requireAi(db: Db, wsId: string, feature: AiFeature): AiRuntime {
  const settings = getWorkspace(db, wsId).settings.ai;
  if (!settings.enabled) throw new AiUnavailableError("AI は OFF です。設定 → AI で有効化してください", "ai_disabled");
  if (!settings.features[feature]) throw new AiUnavailableError(`AI 機能「${feature}」は OFF です`, "ai_feature_disabled");
  const { chat, embedder, reason } = resolveProviders(settings);
  if (!chat) throw new AiUnavailableError(reason ?? "AI provider を利用できません", "ai_not_ready");
  const usage = usageSummary(db, wsId);
  if (settings.monthlyCapUsd > 0 && usage.monthCostUsd >= settings.monthlyCapUsd) throw new AiUnavailableError(`今月の AI 利用上限（$${settings.monthlyCapUsd}）に達しました`, "ai_cap_reached");
  const rl = rateLimit(`ai:${wsId}`, 30, 60_000);
  if (!rl.ok) throw new AppError(429, "rate_limited", "AI リクエストが多すぎます。1分ほど待ってください");
  return { settings, chat, embedder, excluded: excludedTypesFor(settings) };
}

export function recordUsage(db: Db, wsId: string, u: UsageRecord): void {
  db.run("INSERT INTO ai_usage(id, workspace_id, feature, provider, model, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    newId(), wsId, u.feature, u.provider, u.model, u.inputTokens, u.outputTokens, u.costUsd, nowIso());
}

export function usageSummary(db: Db, wsId: string) {
  const tz = getWorkspace(db, wsId).settings.timezone;
  const m = monthPeriod(todayIn(tz));
  const b = periodBounds(m, tz);
  const row = db.get<{ cost: number | null; calls: number; input: number | null; output: number | null }>("SELECT SUM(cost_usd) cost, COUNT(*) calls, SUM(input_tokens) input, SUM(output_tokens) output FROM ai_usage WHERE workspace_id = ? AND created_at >= ? AND created_at < ?", wsId, b.startIso, b.endIso);
  const byFeature = db.all<{ feature: string; cost: number; calls: number }>("SELECT feature, SUM(cost_usd) cost, COUNT(*) calls FROM ai_usage WHERE workspace_id = ? AND created_at >= ? AND created_at < ? GROUP BY feature", wsId, b.startIso, b.endIso);
  return { month: m.start.slice(0, 7), monthCostUsd: Math.round((row?.cost ?? 0) * 10000) / 10000, monthCalls: row?.calls ?? 0, inputTokens: row?.input ?? 0, outputTokens: row?.output ?? 0, byFeature };
}

/** Runs one chat call with usage accounting. */
export async function chatWithAccounting(db: Db, wsId: string, rt: AiRuntime, feature: AiFeature, system: string, user: string, opts: { maxTokens?: number; json?: boolean } = {}) {
  const res = await rt.chat.chat(system, [{ role: "user", content: user }], opts);
  const costUsd = estimateCost(res.model, res.inputTokens, res.outputTokens);
  recordUsage(db, wsId, { feature, provider: rt.chat.name, model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd });
  return { ...res, costUsd };
}

export function parseJsonLoose<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* try to locate a JSON object */ }
  const m = /\{[\s\S]*\}/.exec(cleaned);
  if (m) { try { return JSON.parse(m[0]) as T; } catch { /* ignore */ } }
  return fallback;
}
