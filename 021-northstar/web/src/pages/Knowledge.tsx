import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { Card, Button, Modal, Field, Input, Textarea, Select, Empty, Spinner, Badge, PageHeader, Tabs, STATUS_LABEL } from "../components/ui";
import type { KnowledgeItem } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

type KV = KnowledgeItem & { goalIds: string[]; goalTitles: string[]; actionCount: number };
export const SOURCE_LABEL: Record<string, string> = { article: "記事", book: "本", video: "動画", podcast: "Podcast", pdf: "PDF", chat: "AIチャット", course: "講座", idea: "アイデア", other: "その他" };

export function KnowledgeForm({ initial, onSaved, onClose }: { initial?: Partial<KV>; onSaved: () => void; onClose: () => void }) {
  const goals = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string; level: string }[] }>("/goals?status=active,draft,paused") });
  const [f, setF] = useState<Partial<KV>>({ title: "", sourceType: "article", sourceUrl: "", sourceTitle: "", summary: "", keyIdeas: [], personalMeaning: "", nextAction: "", rawContent: "", goalIds: [], ...initial });
  const [ideas, setIdeas] = useState((initial?.keyIdeas ?? []).join("\n"));
  const { toast } = useToast();
  const save = useMutation({ mutationFn: () => { const body = { ...f, keyIdeas: ideas.split("\n").map((s) => s.trim()).filter(Boolean) }; return initial?.id ? api.patch(`/knowledge/${initial.id}`, { ...body, version: initial.version }) : api.post("/knowledge", body); }, onSuccess: onSaved, onError: (e) => toast(errText(e), "error") });
  return (
    <div>
      <Field label="タイトル"><Input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
      <div className="grid-2">
        <Field label="種類"><Select value={f.sourceType} onChange={(e) => setF({ ...f, sourceType: e.target.value as KV["sourceType"] })}>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="URL"><Input value={f.sourceUrl ?? ""} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} inputMode="url" /></Field>
      </div>
      <Field label="何を学んだ？（要約）"><Textarea rows={3} value={f.summary ?? ""} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      <Field label="Key Ideas（1行1つ）"><Textarea rows={2} value={ideas} onChange={(e) => setIdeas(e.target.value)} /></Field>
      <Field label="なぜ自分に重要？（Personal Meaning）"><Textarea rows={2} value={f.personalMeaning ?? ""} onChange={(e) => setF({ ...f, personalMeaning: e.target.value })} /></Field>
      <Field label="どの Goal に効く？"><Select multiple value={f.goalIds} onChange={(e) => setF({ ...f, goalIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} style={{ minHeight: 80 }}>{goals.data?.goals.map((g) => <option key={g.id} value={g.id}>[{g.level}] {g.title}</option>)}</Select></Field>
      <Field label="何をする？（Next Action）"><Input value={f.nextAction ?? ""} onChange={(e) => setF({ ...f, nextAction: e.target.value })} /></Field>
      <Field label="本文 / メモ（任意）"><Textarea rows={4} value={f.rawContent ?? ""} onChange={(e) => setF({ ...f, rawContent: e.target.value })} /></Field>
      <div className="row"><Button variant="primary" onClick={() => save.mutate()} disabled={!f.title?.trim() || save.isPending}>保存</Button><Button variant="ghost" onClick={onClose}>キャンセル</Button></div>
    </div>
  );
}

export default function Knowledge() {
  const [tab, setTab] = useState("toApply");
  const q = useQuery({ queryKey: ["knowledge", tab], queryFn: () => api.get<{ knowledge: KV[] }>(tab === "toApply" ? "/knowledge?toApply=1" : tab === "all" ? "/knowledge?status=captured,processed,applied&limit=300" : `/knowledge?status=${tab}`) });
  const inv = useInvalidate();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title="Knowledge" subtitle="記事・本・動画・AI会話を「保存して終わり」にしない。Capture → 学び → 意味 → Goal → Action → Applied。" action={<><Link to="/settings#import" className="btn">Import（Chat/Markdown/CSV）</Link><Button variant="primary" onClick={() => setCreating(true)}>＋ Knowledge</Button></>} />
      <Tabs tabs={[{ id: "toApply", label: "行動に移す" }, { id: "captured", label: "Captured" }, { id: "processed", label: "Processed" }, { id: "applied", label: "Applied" }, { id: "all", label: "すべて" }]} value={tab} onChange={setTab} />
      {q.isLoading ? <Spinner /> : q.data!.knowledge.length === 0 ? <Empty>{tab === "toApply" ? "次のアクションが決まった学びはありません。" : "Knowledge はありません。"}</Empty> : (
        <Card><ul className="list">{q.data!.knowledge.map((k) => <li key={k.id}><div className="grow"><Link to={`/knowledge/${k.id}`} className="title">{k.title}</Link><div className="meta row"><Badge>{SOURCE_LABEL[k.sourceType]}</Badge><Badge tone={k.status === "applied" ? "good" : k.status === "processed" ? "accent" : "neutral"}>{STATUS_LABEL[k.status]}</Badge><span>{k.capturedAt}</span>{k.goalTitles.map((t) => <span key={t}>◎ {t}</span>)}</div>{k.nextAction && <div className="meta">次: {k.nextAction}</div>}</div></li>)}</ul></Card>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Knowledge を追加" wide><KnowledgeForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); inv("knowledge", "today"); }} /></Modal>
    </div>
  );
}
