// AI provider abstraction. The DB is the source of truth; providers only see the retrieved, privacy-filtered context.
export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface ChatResult { text: string; inputTokens: number; outputTokens: number; model: string; refused?: boolean }
export interface ChatProvider {
  readonly name: "anthropic" | "openai" | "mock";
  readonly model: string;
  chat(system: string, messages: ChatMessage[], opts?: { maxTokens?: number; json?: boolean }): Promise<ChatResult>;
}
export interface EmbeddingProvider {
  readonly name: "openai" | "local-lite" | "mock";
  readonly model: string;
  readonly dims: number;
  /** Returns one vector per input text (same order). */
  embed(texts: string[]): Promise<number[][]>;
}
export interface UsageRecord { feature: string; provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }
