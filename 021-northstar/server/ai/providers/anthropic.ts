import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatProvider, ChatResult } from "../types";
import { aiCallCounter } from "../counter";

/** Anthropic Claude via the official SDK. Thinking is adaptive by default; effort is kept moderate for cost. */
export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;
  constructor(readonly model: string, apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  }
  async chat(system: string, messages: ChatMessage[], opts: { maxTokens?: number; json?: boolean } = {}): Promise<ChatResult> {
    aiCallCounter.total++;
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 4000,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as never);
    const r = res as unknown as { content: Array<{ type: string; text?: string }>; usage: { input_tokens: number; output_tokens: number }; model: string; stop_reason: string };
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
    return { text, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, model: r.model, refused: r.stop_reason === "refusal" };
  }
}
