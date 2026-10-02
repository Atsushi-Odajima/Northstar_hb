// USD per 1M tokens. Anthropic prices from the official docs cache (2026-09-25, see SOURCE_NOTES.md).
// OpenAI prices could not be verified in this environment (egress blocked) — configure via env and re-check before sale.
export interface Price { input: number; output: number; verified: boolean }
export const CHAT_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, verified: true },
  "claude-opus-5": { input: 5, output: 25, verified: true },
  "claude-sonnet-5-5": { input: 2, output: 10, verified: true },
  "claude-sonnet-5": { input: 2, output: 10, verified: true },
  "claude-haiku-4-5": { input: 1, output: 5, verified: true },
  "mock-1": { input: 1, output: 5, verified: true }, // test provider: fake price so cap logic is testable
};
export const EMBEDDING_PRICES: Record<string, Price> = {
  "text-embedding-3-small": { input: Number(process.env.OPENAI_EMBED_PRICE_IN ?? 0.02), output: 0, verified: false },
  "text-embedding-3-large": { input: Number(process.env.OPENAI_EMBED_PRICE_IN_LARGE ?? 0.13), output: 0, verified: false },
  "local-lite-v1": { input: 0, output: 0, verified: true },
};
export function chatPrice(model: string): Price {
  return CHAT_PRICES[model] ?? { input: Number(process.env.OPENAI_PRICE_IN ?? 0), output: Number(process.env.OPENAI_PRICE_OUT ?? 0), verified: false };
}
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = chatPrice(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
export function estimateEmbeddingCost(model: string, tokens: number): number {
  const p = EMBEDDING_PRICES[model] ?? { input: 0, output: 0, verified: false };
  return (tokens * p.input) / 1_000_000;
}
export const ANTHROPIC_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"] as const;
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
