// Parses user-provided chat exports (ChatGPT / Claude JSON exports, or plain text) into numbered messages.
export interface ChatMsg { index: number; role: "user" | "assistant"; text: string; conversation: string; at?: string }

export function parseChatExport(content: string, fileName = ""): { messages: ChatMsg[]; format: string } {
  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      const fromChatGpt = parseChatGpt(data);
      if (fromChatGpt.length) return { messages: number(fromChatGpt), format: "chatgpt-json" };
      const fromClaude = parseClaude(data);
      if (fromClaude.length) return { messages: number(fromClaude), format: "claude-json" };
    } catch { /* fall through to text */ }
  }
  return { messages: number(parseText(trimmed, fileName || "conversation")), format: "text" };
}

function number(msgs: Omit<ChatMsg, "index">[]): ChatMsg[] { return msgs.map((m, i) => ({ ...m, index: i })); }

function parseChatGpt(data: unknown): Omit<ChatMsg, "index">[] {
  const convs = Array.isArray(data) ? data : [data];
  const out: Omit<ChatMsg, "index">[] = [];
  for (const c of convs as Array<{ title?: string; mapping?: Record<string, { message?: { author?: { role?: string }; content?: { parts?: unknown[]; text?: string }; create_time?: number } }> }>) {
    if (!c || typeof c !== "object" || !c.mapping) continue;
    const title = c.title ?? "ChatGPT conversation";
    const nodes = Object.values(c.mapping).map((n) => n.message).filter(Boolean) as NonNullable<typeof c.mapping[string]["message"]>[];
    nodes.sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0));
    for (const m of nodes) {
      const role = m.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      const parts = (m.content?.parts ?? (m.content?.text ? [m.content.text] : [])).filter((p): p is string => typeof p === "string");
      const text = parts.join("\n").trim();
      if (!text) continue;
      out.push({ role, text, conversation: title, at: m.create_time ? new Date(m.create_time * 1000).toISOString() : undefined });
    }
  }
  return out;
}

function parseClaude(data: unknown): Omit<ChatMsg, "index">[] {
  const convs = Array.isArray(data) ? data : [data];
  const out: Omit<ChatMsg, "index">[] = [];
  for (const c of convs as Array<{ name?: string; chat_messages?: Array<{ sender?: string; text?: string; created_at?: string }> }>) {
    if (!c || !Array.isArray(c.chat_messages)) continue;
    for (const m of c.chat_messages) {
      const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : null;
      if (!role || !m.text?.trim()) continue;
      out.push({ role, text: m.text.trim(), conversation: c.name ?? "Claude conversation", at: m.created_at });
    }
  }
  return out;
}

function parseText(text: string, conversation: string): Omit<ChatMsg, "index">[] {
  const out: Omit<ChatMsg, "index">[] = [];
  let role: "user" | "assistant" = "user";
  let buf: string[] = [];
  const flush = () => { const t = buf.join("\n").trim(); if (t) out.push({ role, text: t, conversation }); buf = []; };
  for (const line of text.split(/\r?\n/)) {
    const m = /^(user|you|human|me|assistant|chatgpt|claude|ai)\s*[:：]\s*(.*)$/i.exec(line);
    if (m) {
      flush();
      role = /^(user|you|human|me)$/i.test(m[1]) ? "user" : "assistant";
      if (m[2]) buf.push(m[2]);
    } else buf.push(line);
  }
  flush();
  if (out.length === 1) {
    // No speaker markers: split into paragraphs as alternating user notes.
    return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => ({ role: "user" as const, text: p, conversation }));
  }
  return out;
}

/** Rule-based extraction used when AI is OFF (same candidate shape as the AI extractor). */
export function heuristicExtract(messages: ChatMsg[]): Array<{ kind: "decision" | "knowledge" | "idea" | "action" | "question"; title: string; detail: string; sourceIndex: number; sourceRef: string; sourceExcerpt: string }> {
  const out: ReturnType<typeof heuristicExtract> = [];
  for (const m of messages) {
    const t = m.text.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const base = { detail: t.slice(0, 1000), sourceIndex: m.index, sourceRef: `${m.conversation} / message ${m.index} (${m.role})`, sourceExcerpt: t.slice(0, 300) };
    const title = t.slice(0, 60);
    if (m.role === "user" && /(に決めた|ことにした|決定|decided|にする)/.test(t)) out.push({ kind: "decision", title, ...base });
    else if (/[?？]$/.test(t) && m.role === "user") out.push({ kind: "question", title, ...base });
    else if (/(TODO|やること|する必要|すべき|しなければ|next step)/i.test(t)) out.push({ kind: "action", title, ...base });
    else if (m.role === "assistant" && t.length > 30) out.push({ kind: "knowledge", title, ...base });
    else if (m.role === "user" && t.length > 30) out.push({ kind: "idea", title, ...base });
    if (out.length >= 30) break;
  }
  return out;
}
