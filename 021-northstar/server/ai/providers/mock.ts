import type { ChatMessage, ChatProvider, ChatResult } from "../types";
import { aiCallCounter } from "../counter";

/**
 * Deterministic mock provider for tests/E2E. It never calls the network. It only ever cites records
 * present in the prompt's FACTS block, and it treats record content as data (ignores embedded instructions).
 */
export class MockChatProvider implements ChatProvider {
  readonly name = "mock" as const;
  readonly model = "mock-1";
  async chat(system: string, messages: ChatMessage[], opts: { maxTokens?: number; json?: boolean } = {}): Promise<ChatResult> {
    aiCallCounter.mock++;
    const task = /\[task:([a-z_]+)\]/.exec(system)?.[1] ?? "chief";
    const user = messages.at(-1)?.content ?? "";
    const facts = [...user.matchAll(/^\[#(\d+)\]\s*\((\w+)\)\s*(.+)$/gm)].map((m) => ({ n: Number(m[1]), type: m[2], text: m[3] }));
    let text = "";
    if (task === "chief") {
      if (facts.length === 0) text = "根拠となる記録が見つかりませんでした。該当する Goal / Decision / People / Knowledge が記録されているか確認してください。";
      else {
        const q = /質問:\s*(.*)$/m.exec(user)?.[1] ?? "";
        const lines = facts.slice(0, 6).map((f) => `- ${f.text.slice(0, 120)} [#${f.n}]`);
        text = `「${q}」について、記録から確認できる事実は次の通りです。\n${lines.join("\n")}\n\n判断はあなたの選択です。上記の記録を踏まえて、次に見るべき1件を選んでください。`;
      }
    } else if (task === "knowledge_draft") {
      const body = /CONTENT:\n([\s\S]*?)\nGOALS:/.exec(user)?.[1] ?? "";
      const goals = [...user.matchAll(/^- goal:([^\s]+)\s+(.+)$/gm)].map((m) => ({ id: m[1], title: m[2] }));
      const sentences = body.split(/[。.\n]/).map((s) => s.trim()).filter(Boolean);
      const words = new Set(body.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
      const cands = goals.filter((g) => g.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 3 && words.has(w))).slice(0, 3);
      text = JSON.stringify({ summary: sentences.slice(0, 2).join("。"), keyIdeas: sentences.slice(0, 3), personalMeaning: "", goalCandidates: cands.map((g) => ({ goalId: g.id, reason: "タイトルの語が一致" })), nextActionCandidate: sentences[0] ? `「${sentences[0].slice(0, 40)}」を1つ試す` : "" });
    } else if (task === "capture_classify") {
      const t = /TEXT:\n([\s\S]*)$/.exec(user)?.[1] ?? "";
      const type = /決め|decided/i.test(t) ? "decision" : /[?？]$/.test(t.trim()) ? "question" : /https?:/.test(t) ? "knowledge" : /さん|@/.test(t) ? "person_note" : "task";
      text = JSON.stringify({ type, confidence: 0.6, reason: "mock heuristic" });
    } else if (task === "chat_extract") {
      const msgs = [...user.matchAll(/^\[m(\d+)\]\s*(user|assistant):\s*(.+)$/gm)].map((m) => ({ i: Number(m[1]), role: m[2], text: m[3] }));
      const items = msgs.flatMap((m) => {
        const t = m.text;
        if (/決め|decided|にする$/.test(t)) return [{ kind: "decision", title: t.slice(0, 60), detail: t, sourceIndex: m.i }];
        if (/[?？]$/.test(t.trim())) return [{ kind: "question", title: t.slice(0, 60), detail: t, sourceIndex: m.i }];
        if (/TODO|やる|する必要|すべき/.test(t)) return [{ kind: "action", title: t.slice(0, 60), detail: t, sourceIndex: m.i }];
        if (m.role === "assistant" && t.length > 30) return [{ kind: "knowledge", title: t.slice(0, 60), detail: t, sourceIndex: m.i }];
        if (m.role === "user" && t.length > 20) return [{ kind: "idea", title: t.slice(0, 60), detail: t, sourceIndex: m.i }];
        return [];
      });
      text = JSON.stringify({ items: items.slice(0, 30) });
    } else {
      text = JSON.stringify({ text: "mock" });
    }
    return { text, inputTokens: Math.ceil((system.length + user.length) / 4), outputTokens: Math.ceil(text.length / 4), model: this.model };
  }
}
