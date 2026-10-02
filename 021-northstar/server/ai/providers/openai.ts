import type { ChatMessage, ChatProvider, ChatResult, EmbeddingProvider } from "../types";
import { aiCallCounter } from "../counter";

/** OpenAI-compatible REST provider (chat completions + embeddings). Works with self-hosted gateways too. */
export class OpenAIProvider implements ChatProvider {
  readonly name = "openai" as const;
  constructor(readonly model: string, private apiKey: string, private baseUrl: string) {}
  async chat(system: string, messages: ChatMessage[], opts: { maxTokens?: number; json?: boolean } = {}): Promise<ChatResult> {
    aiCallCounter.total++;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: system }, ...messages],
        max_completion_tokens: opts.maxTokens ?? 4000,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as { choices: Array<{ message: { content: string | null }; finish_reason: string }>; usage?: { prompt_tokens: number; completion_tokens: number }; model: string };
    const text = data.choices?.[0]?.message?.content ?? "";
    return { text: text.trim(), inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, model: data.model ?? this.model, refused: data.choices?.[0]?.finish_reason === "content_filter" };
  }
}

export class OpenAIEmbedder implements EmbeddingProvider {
  readonly name = "openai" as const;
  readonly dims: number;
  constructor(readonly model: string, private apiKey: string, private baseUrl: string, dims = 1536) { this.dims = dims; }
  async embed(texts: string[]): Promise<number[][]> {
    aiCallCounter.total++;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as { data: Array<{ index: number; embedding: number[] }> };
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
