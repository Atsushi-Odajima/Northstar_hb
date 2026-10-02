import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { Card, Button, Textarea, Empty, Spinner, Badge, PageHeader, EntityLink } from "../components/ui";
import type { Citation } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

const SUGGEST = ["今週何に集中すべき？", "最近止まっている目標は？", "見直し時期の Decision は？", "最近連絡していない重要人物は？", "ProofFlow に使えそうな過去の学びは？", "今月の行動は Quarter Goal と合ってる？", "約束したまま放置していることは？"];

function renderAnswer(text: string, citations: Citation[]) {
  const parts = text.split(/(\[#\d+\])/g);
  return parts.map((p, i) => {
    const m = /^\[#(\d+)\]$/.exec(p);
    if (!m) return <span key={i}>{p}</span>;
    const c = citations[Number(m[1]) - 1] ?? citations.find((_, idx) => idx === Number(m[1]) - 1);
    return c ? <EntityLink key={i} type={c.type} id={c.id}><span className="cite">#{m[1]} {c.title.slice(0, 24)}</span></EntityLink> : <span key={i} className="cite">#{m[1]}</span>;
  });
}

export default function Chief() {
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<any>("/ai/status") });
  const history = useQuery({ queryKey: ["ai-history"], queryFn: () => api.get<{ messages: { id: string; role: string; content: string; citations: Citation[] }[] }>("/ai/history") });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [last, setLast] = useState<any>(null);
  const ask = useMutation({ mutationFn: (question: string) => api.post<any>("/ai/ask", { question }), onSuccess: (r) => { setLast(r); setQ(""); inv("ai-history", "ai-status"); }, onError: (e) => toast(errText(e), "error") });
  const clear = useMutation({ mutationFn: () => api.delete("/ai/history"), onSuccess: () => { setLast(null); inv("ai-history"); } });
  const s = status.data;
  return (
    <div>
      <PageHeader title="AI Chief of Staff" subtitle="あなたの Goal・Decision・People・Knowledge・Review を横断して、根拠（記録へのリンク）付きで整理します。判断はあなたのもの。" action={<Link to="/settings#ai" className="btn">AI 設定</Link>} />
      {s && !s.enabled && <div className="notice">AI は OFF です（既定）。<Link to="/settings#ai">設定 → AI</Link> で provider を選び、送信対象のカテゴリを確認してから有効化してください。AI OFF でも他の機能はすべて使えます。</div>}
      {s && s.enabled && !s.ready && <div className="notice bad">{s.reason}</div>}
      {s && s.enabled && s.ready && <p className="small muted">provider: {s.provider} / model: {s.model} · 今月 ${s.usage.monthCostUsd.toFixed(4)} / 上限 ${s.capUsd} · AI 対象外: {s.excludedCategories.join(", ") || "なし"}</p>}
      <Card>
        <div className="row" style={{ marginBottom: 8 }}>{SUGGEST.map((x) => <Button key={x} size="sm" onClick={() => ask.mutate(x)} disabled={!s?.ready || ask.isPending}>{x}</Button>)}</div>
        <Textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="質問を入力（例: 今週何に集中すべき？）" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && q.trim()) ask.mutate(q.trim()); }} />
        <div className="row between" style={{ marginTop: 8 }}><span className="small faint">記録にないことは「見つからない」と答え、存在しない記録は作りません。</span><Button variant="primary" onClick={() => ask.mutate(q.trim())} disabled={!q.trim() || !s?.ready || ask.isPending}>{ask.isPending ? "考え中…" : "聞く"}</Button></div>
      </Card>
      {ask.isPending && <Spinner />}
      {last && (
        <Card className="accent" title="回答">
          <div style={{ whiteSpace: "pre-wrap" }}>{renderAnswer(last.answer, last.citations)}</div>
          {last.citations.length > 0 && <><h3 style={{ marginTop: 10 }}>根拠となる記録</h3><ul className="list">{last.citations.map((c: Citation, i: number) => <li key={`${c.type}:${c.id}`}><div className="grow"><EntityLink type={c.type} id={c.id}>#{i + 1} {c.title}</EntityLink> <Badge>{c.type}</Badge><div className="meta">{c.snippet}</div></div></li>)}</ul></>}
          <p className="small faint">参照した記録 {last.records.length} 件 · {last.provider}/{last.model} · ${last.costUsd.toFixed(5)}{last.insufficientEvidence && " · 根拠不足のため provider は呼び出していません"}</p>
        </Card>
      )}
      <Card title="履歴" action={history.data?.messages.length ? <Button size="sm" variant="ghost" onClick={() => clear.mutate()}>履歴を削除</Button> : null}>
        {history.isLoading ? <Spinner /> : !history.data?.messages.length ? <Empty>まだ質問していません。</Empty> : (
          <div className="chat">{history.data.messages.map((m) => <div key={m.id} className={`msg ${m.role === "user" ? "msg-user" : "msg-ai"}`}>{m.role === "assistant" ? renderAnswer(m.content, m.citations) : m.content}</div>)}</div>
        )}
      </Card>
    </div>
  );
}
