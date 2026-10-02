import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Button, Modal, Field, Input, Textarea, Select, Empty, Spinner, Badge, PageHeader, Tabs } from "../components/ui";
import type { Decision } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

type DV = Decision & { goalIds: string[]; goalTitles: string[]; personIds: string[]; personNames: string[]; reviewCount: number; latestOutcome: string | null };
export const OUTCOME_LABEL: Record<string, string> = { better: "期待以上", as_expected: "期待通り", worse: "期待以下", too_early: "まだ早い", abandoned: "撤回" };

export function DecisionForm({ initial, onSaved, onClose, locked = false }: { initial?: Partial<DV>; onSaved: () => void; onClose: () => void; locked?: boolean }) {
  const goals = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string; level: string }[] }>("/goals?status=active,draft,paused") });
  const people = useQuery({ queryKey: ["people-list"], queryFn: () => api.get<{ people: { id: string; name: string }[] }>("/people?limit=500") });
  const [f, setF] = useState<Partial<DV>>({ title: "", decidedAt: todayStr(), context: "", options: [], decision: "", reason: "", assumptions: [], expectedOutcome: "", risks: "", confidence: 60, reviewDate: null, goalIds: [], personIds: [], ...initial });
  const [optText, setOptText] = useState((initial?.options ?? []).join("\n"));
  const [asmText, setAsmText] = useState((initial?.assumptions ?? []).join("\n"));
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, options: optText.split("\n").map((s) => s.trim()).filter(Boolean), assumptions: asmText.split("\n").map((s) => s.trim()).filter(Boolean) };
      if (initial?.id) {
        const { title, risks, reviewDate, goalIds, personIds, decidedAt, context, options, decision, reason, assumptions, expectedOutcome, confidence } = body;
        return api.patch(`/decisions/${initial.id}`, locked ? { title, risks, reviewDate, goalIds, personIds, version: initial.version } : { title, risks, reviewDate, goalIds, personIds, decidedAt, context, options, decision, reason, assumptions, expectedOutcome, confidence, version: initial.version });
      }
      return api.post("/decisions", body);
    },
    onSuccess: onSaved, onError: (e) => toast(errText(e), "error"),
  });
  return (
    <div>
      {locked && <div className="notice">レビュー済みの判断は、当時の内容（状況・選択肢・決定・理由・前提・期待・確信度）を変更できません。学びはレビューに記録します。</div>}
      <Field label="何を決めた？（タイトル）"><Input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
      <div className="grid-2">
        <Field label="決定日"><Input type="date" value={f.decidedAt ?? ""} onChange={(e) => setF({ ...f, decidedAt: e.target.value })} disabled={locked} /></Field>
        <Field label="見直し日" hint="省略時は30日後"><Input type="date" value={f.reviewDate ?? ""} onChange={(e) => setF({ ...f, reviewDate: e.target.value || null })} /></Field>
      </div>
      <Field label="状況（Context）"><Textarea rows={2} value={f.context ?? ""} onChange={(e) => setF({ ...f, context: e.target.value })} disabled={locked} /></Field>
      <Field label="検討した選択肢（1行1つ）"><Textarea rows={2} value={optText} onChange={(e) => setOptText(e.target.value)} disabled={locked} /></Field>
      <Field label="決定（Decision）"><Textarea rows={2} value={f.decision ?? ""} onChange={(e) => setF({ ...f, decision: e.target.value })} disabled={locked} /></Field>
      <Field label="理由（Reason）"><Textarea rows={2} value={f.reason ?? ""} onChange={(e) => setF({ ...f, reason: e.target.value })} disabled={locked} /></Field>
      <Field label="前提（Assumptions, 1行1つ）"><Textarea rows={2} value={asmText} onChange={(e) => setAsmText(e.target.value)} disabled={locked} /></Field>
      <div className="grid-2">
        <Field label="期待する結果"><Textarea rows={2} value={f.expectedOutcome ?? ""} onChange={(e) => setF({ ...f, expectedOutcome: e.target.value })} disabled={locked} /></Field>
        <Field label="リスク"><Textarea rows={2} value={f.risks ?? ""} onChange={(e) => setF({ ...f, risks: e.target.value })} /></Field>
      </div>
      <Field label={`確信度 ${f.confidence}%`}><input type="range" min={0} max={100} value={f.confidence} onChange={(e) => setF({ ...f, confidence: Number(e.target.value) })} disabled={locked} style={{ width: "100%" }} /></Field>
      <div className="grid-2">
        <Field label="関連 Goal"><Select multiple value={f.goalIds} onChange={(e) => setF({ ...f, goalIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} style={{ minHeight: 80 }}>{goals.data?.goals.map((g) => <option key={g.id} value={g.id}>[{g.level}] {g.title}</option>)}</Select></Field>
        <Field label="関係する人"><Select multiple value={f.personIds} onChange={(e) => setF({ ...f, personIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} style={{ minHeight: 80 }}>{people.data?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      </div>
      <div className="row"><Button variant="primary" onClick={() => save.mutate()} disabled={!f.title?.trim() || save.isPending}>保存</Button><Button variant="ghost" onClick={onClose}>キャンセル</Button></div>
    </div>
  );
}

export default function Decisions() {
  const [tab, setTab] = useState("open");
  const q = useQuery({ queryKey: ["decisions", tab], queryFn: () => api.get<{ decisions: DV[] }>(tab === "due" ? "/decisions?due=now" : `/decisions?status=${tab === "open" ? "open" : "reviewed,abandoned"}`) });
  const patterns = useQuery({ queryKey: ["decision-patterns"], queryFn: () => api.get<any>("/ai/decision-patterns") });
  const inv = useInvalidate();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title="Decision Journal" subtitle="重要な判断を、理由・前提・期待・確信度ごと記録。見直し日に当時の内容そのままで結果を記録します。" action={<Button variant="primary" onClick={() => setCreating(true)}>＋ Decision</Button>} />
      <Tabs tabs={[{ id: "due", label: "見直し時期" }, { id: "open", label: "Open" }, { id: "reviewed", label: "Reviewed" }]} value={tab} onChange={setTab} />
      {q.isLoading ? <Spinner /> : q.data!.decisions.length === 0 ? <Empty>{tab === "due" ? "見直し時期の Decision はありません。" : "Decision はありません。"}</Empty> : (
        <Card><ul className="list">{q.data!.decisions.map((d) => <li key={d.id}><div className="grow"><Link to={`/decisions/${d.id}`} className="title">⚖ {d.title}</Link><div className="meta row"><span>{d.decidedAt}</span><Badge>確信度 {d.confidence}%</Badge>{d.reviewDate && d.status === "open" && <Badge tone={d.reviewDate <= todayStr() ? "warn" : "neutral"}>見直し {d.reviewDate}</Badge>}{d.latestOutcome && <Badge tone={d.latestOutcome === "worse" ? "bad" : d.latestOutcome === "better" ? "good" : "neutral"}>{OUTCOME_LABEL[d.latestOutcome]}</Badge>}{d.goalTitles.map((t) => <span key={t}>◎ {t}</span>)}</div>{d.decision && <div className="meta">{d.decision}</div>}</div></li>)}</ul></Card>
      )}
      {patterns.data?.enough && patterns.data.patterns.length > 0 && (
        <Card title="判断パターン（候補）">
          <p className="small muted">{patterns.data.note}</p>
          <ul className="list">{patterns.data.patterns.map((p: any, i: number) => <li key={i}><div className="grow"><div className="title">{p.title}</div><div className="meta">{p.evidence} · 根拠: {p.decisionIds.slice(0, 5).map((id: string) => <Link key={id} to={`/decisions/${id}`} style={{ marginRight: 6 }}>#{id.slice(0, 6)}</Link>)}</div></div></li>)}</ul>
        </Card>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Decision を記録" wide><DecisionForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); inv("decisions", "today"); }} /></Modal>
    </div>
  );
}
