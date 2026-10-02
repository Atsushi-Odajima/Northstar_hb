import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { Card, Button, Modal, Field, Input, Textarea, Empty, Spinner, Badge, EntityLink, STATUS_LABEL } from "../components/ui";
import type { KnowledgeItem } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { KnowledgeForm, SOURCE_LABEL } from "./Knowledge";

type KV = KnowledgeItem & { goalIds: string[]; goalTitles: string[]; projectIds: string[]; personIds: string[]; actionCount: number };

export default function KnowledgeDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const inv = useInvalidate();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["knowledge-item", id], queryFn: () => api.get<{ knowledge: KV; actions: any[]; relations: any[] }>(`/knowledge/${id}`) });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<{ enabled: boolean; ready: boolean; features: Record<string, boolean> }>("/ai/status") });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const [applyNote, setApplyNote] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const refresh = () => inv("knowledge-item", "knowledge", "today", "actions");
  const getDraft = useMutation({ mutationFn: () => api.post<any>(`/ai/knowledge/${id}/draft`), onSuccess: (d) => { setDraft(d); toast(`AI 下書きを作成しました（${d.model}）。採用する項目を選んでください`); }, onError: (e) => toast(errText(e), "error") });
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/knowledge/${id}`, body), onSuccess: () => { refresh(); toast("保存しました", "success"); }, onError: (e) => toast(errText(e), "error") });
  const mkAction = useMutation({ mutationFn: () => api.post(`/knowledge/${id}/action`, { title: actionTitle || undefined }), onSuccess: () => { setActionTitle(""); refresh(); toast("Action を作成しました", "success"); }, onError: (e) => toast(errText(e), "error") });
  const del = useMutation({ mutationFn: () => api.delete(`/knowledge/${id}`), onSuccess: () => { refresh(); nav("/knowledge"); } });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Empty>{errText(q.error)}</Empty>;
  const { knowledge: k, actions, relations } = q.data!;
  const steps = [
    { label: "Capture", done: true }, { label: "What did I learn?", done: !!k.summary }, { label: "Why matter?", done: !!k.personalMeaning }, { label: "Which Goal?", done: k.goalIds.length > 0 }, { label: "What action?", done: !!k.nextAction || actions.length > 0 }, { label: "Did I use it?", done: k.status === "applied" },
  ];
  return (
    <div>
      <p className="small muted"><Link to="/knowledge">Knowledge</Link></p>
      <div className="page-head">
        <div><h1>{k.title}</h1><div className="row small muted"><Badge>{SOURCE_LABEL[k.sourceType]}</Badge><Badge tone={k.status === "applied" ? "good" : "neutral"}>{STATUS_LABEL[k.status]}</Badge><span>{k.capturedAt}</span>{k.sourceUrl && <a href={k.sourceUrl} target="_blank" rel="noreferrer noopener">source ↗</a>}</div></div>
        <div className="page-actions">{ai.data?.enabled && ai.data.ready && ai.data.features.knowledge_draft && <Button onClick={() => getDraft.mutate()} disabled={getDraft.isPending}>AI で下書き</Button>}<Button onClick={() => setEditing(true)}>編集</Button><Button variant="danger" onClick={() => confirm("削除しますか？検索・AI index からも削除されます。") && del.mutate()}>削除</Button></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>{steps.map((s, i) => <Badge key={s.label} tone={s.done ? "good" : "neutral"}>{i + 1}. {s.label}</Badge>)}</div>
      {draft && (
        <Card className="accent" title={`AI 下書き（${draft.model}）— 採用するものだけ反映`}>
          <p className="small muted">AI は候補を出すだけです。保存はあなたの確認後。</p>
          {draft.summary && <p><b>要約:</b> {draft.summary} <Button size="sm" onClick={() => patch.mutate({ summary: draft.summary })}>採用</Button></p>}
          {draft.keyIdeas?.length > 0 && <p><b>Key Ideas:</b> {draft.keyIdeas.join(" / ")} <Button size="sm" onClick={() => patch.mutate({ keyIdeas: draft.keyIdeas, status: k.status === "captured" ? "processed" : k.status })}>採用</Button></p>}
          {draft.goalCandidates?.length > 0 && <p><b>Goal 候補:</b> {draft.goalCandidates.map((g: any) => <Button key={g.goalId} size="sm" onClick={() => patch.mutate({ goalIds: [...new Set([...k.goalIds, g.goalId])] })}>◎ {g.title}（{g.reason}）</Button>)}</p>}
          {draft.nextActionCandidate && <p><b>Action 候補:</b> {draft.nextActionCandidate} <Button size="sm" onClick={() => patch.mutate({ nextAction: draft.nextActionCandidate })}>採用</Button></p>}
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>閉じる</Button>
        </Card>
      )}
      <div className="grid-2">
        <Card title="学び">
          <p><b>何を学んだ？</b><br />{k.summary || <span className="muted">未記入</span>}</p>
          {k.keyIdeas.length > 0 && <ul>{k.keyIdeas.map((i, n) => <li key={n}>{i}</li>)}</ul>}
          <p><b>なぜ自分に重要？</b><br />{k.personalMeaning || <span className="muted">未記入（本人にしか書けない欄）</span>}</p>
          <p><b>どの Goal に効く？</b><br />{k.goalTitles.length ? k.goalIds.map((g, i) => <Link key={g} to={`/goals/${g}`} style={{ marginRight: 8 }}>◎ {k.goalTitles[i]}</Link>) : <span className="muted">未リンク</span>}</p>
          {k.rawContent && <details className="section"><summary>本文 / メモ</summary><p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{k.rawContent}</p></details>}
        </Card>
        <Card title="行動につなげる">
          <p><b>Next Action:</b> {k.nextAction || <span className="muted">未定</span>}</p>
          <div className="inline-form"><Input placeholder={k.nextAction || "Action のタイトル"} value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} /><Button onClick={() => mkAction.mutate()} disabled={!(actionTitle.trim() || k.nextAction)}>Action を作る</Button></div>
          {actions.length > 0 && <ul className="list">{actions.map((a) => <li key={a.id}><div className="grow"><div className="title">{a.status === "done" ? "✓ " : "☐ "}{a.title}</div><div className="meta">{a.dueDate ?? ""}</div></div></li>)}</ul>}
          <h3 style={{ marginTop: 12 }}>使った？（Applied）</h3>
          {k.status === "applied" ? <p className="small">✓ {k.appliedAt?.slice(0, 10)} {k.appliedNote}</p> : (
            <div className="inline-form"><Input placeholder="どう使った？（一言）" value={applyNote} onChange={(e) => setApplyNote(e.target.value)} /><Button variant="primary" onClick={() => patch.mutate({ status: "applied", appliedNote: applyNote })}>Applied にする</Button></div>
          )}
          {relations.length > 0 && <><h3 style={{ marginTop: 12 }}>つながり</h3><ul className="list">{relations.map((r: any) => <li key={r.relationId}><div className="grow"><EntityLink type={r.type} id={r.id}>{r.title ?? r.id}</EntityLink> <span className="meta">{r.type}</span></div></li>)}</ul></>}
        </Card>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title="Knowledge を編集" wide><KnowledgeForm initial={k} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} /></Modal>
    </div>
  );
}
