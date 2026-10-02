import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, fmtDate } from "../api/client";
import { Card, Button, Modal, Field, Input, Textarea, Select, Empty, Spinner, Badge, PageHeader, STATUS_LABEL, EntityLink } from "../components/ui";
import type { Project } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

type PV = Project & { goalIds: string[]; goalTitles: string[]; openActionCount: number };

function ProjectForm({ initial, goals, onSaved, onClose }: { initial?: Partial<PV>; goals: { id: string; title: string; level: string }[]; onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState<Partial<PV>>({ title: "", outcome: "", description: "", status: "active", nextAction: "", deadline: null, goalIds: [], ...initial });
  const { toast } = useToast();
  const save = useMutation({ mutationFn: () => initial?.id ? api.patch(`/projects/${initial.id}`, { ...f, version: initial.version }) : api.post("/projects", f), onSuccess: onSaved, onError: (e) => toast(errText(e), "error") });
  return (
    <div>
      <Field label="Project 名"><Input value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
      <Field label="Outcome（この Project が終わると何が手に入る？）"><Textarea rows={2} value={f.outcome ?? ""} onChange={(e) => setF({ ...f, outcome: e.target.value })} /></Field>
      <div className="grid-2">
        <Field label="状態"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as PV["status"] })}>{["idea", "active", "waiting", "paused", "completed", "dropped"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
        <Field label="期限"><Input type="date" value={f.deadline ?? ""} onChange={(e) => setF({ ...f, deadline: e.target.value || null })} /></Field>
      </div>
      <Field label="次の一手（Next Action）"><Input value={f.nextAction ?? ""} onChange={(e) => setF({ ...f, nextAction: e.target.value })} /></Field>
      <Field label="貢献する Goal"><Select multiple value={f.goalIds} onChange={(e) => setF({ ...f, goalIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} style={{ minHeight: 90 }}>{goals.map((g) => <option key={g.id} value={g.id}>[{g.level}] {g.title}</option>)}</Select></Field>
      <Field label="メモ"><Textarea rows={2} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="row"><Button variant="primary" onClick={() => save.mutate()} disabled={!f.title?.trim()}>保存</Button><Button variant="ghost" onClick={onClose}>キャンセル</Button></div>
    </div>
  );
}

export default function Projects() {
  const { id } = useParams();
  const nav = useNavigate();
  const inv = useInvalidate();
  const { toast } = useToast();
  const list = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: PV[] }>("/projects") });
  const detail = useQuery({ queryKey: ["project", id], queryFn: () => api.get<any>(`/projects/${id}`), enabled: !!id });
  const goals = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string; level: string }[] }>("/goals?status=active,draft,paused") });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [actionTitle, setActionTitle] = useState("");
  const refresh = () => inv("projects", "project", "today", "open-loops");
  const addAction = useMutation({ mutationFn: () => api.post("/actions", { title: actionTitle, projectId: id }), onSuccess: () => { setActionTitle(""); refresh(); }, onError: (e) => toast(errText(e), "error") });
  const toggleAction = useMutation({ mutationFn: (a: any) => api.patch(`/actions/${a.id}`, { status: a.status === "done" ? "open" : "done" }), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.delete(`/projects/${id}`), onSuccess: () => { refresh(); nav("/projects"); } });
  const p: PV | undefined = detail.data?.project;
  return (
    <div>
      <PageHeader title="Projects" subtitle="Goal に貢献する一連の仕事。Idea / Active / Waiting / Paused / Completed。" action={<Button variant="primary" onClick={() => setCreating(true)}>＋ Project</Button>} />
      <div className="grid-2">
        <Card title="一覧">
          {list.isLoading ? <Spinner /> : list.data!.projects.length === 0 ? <Empty>Project はまだありません。</Empty> : (
            <ul className="list">{list.data!.projects.map((x) => <li key={x.id} style={{ background: x.id === id ? "var(--accent-soft)" : undefined, borderRadius: 8, padding: "8px 6px" }}><div className="grow"><Link to={`/projects/${x.id}`} className="title">{x.title}</Link><div className="meta row"><Badge tone={x.status === "active" ? "good" : x.status === "waiting" ? "warn" : "neutral"}>{STATUS_LABEL[x.status]}</Badge>{x.goalTitles.map((t) => <span key={t}>◎ {t}</span>)}{x.deadline && <span>〜{x.deadline}</span>}{x.openActionCount > 0 && <span>{x.openActionCount} open</span>}</div>{x.nextAction && <div className="meta">次: {x.nextAction}</div>}</div></li>)}</ul>
          )}
        </Card>
        {p ? (
          <Card title={p.title} action={<div className="row"><Button size="sm" onClick={() => setEditing(true)}>編集</Button><Button size="sm" variant="danger" onClick={() => confirm("削除しますか？") && del.mutate()}>削除</Button></div>}>
            <p className="row small"><Badge>{STATUS_LABEL[p.status]}</Badge>{p.deadline && <span>期限 {fmtDate(p.deadline)}</span>}</p>
            {p.outcome && <p><b>Outcome:</b> {p.outcome}</p>}
            {p.nextAction && <p><b>Next Action:</b> {p.nextAction}</p>}
            {p.goalTitles.length > 0 && <p className="small">貢献する Goal: {p.goalIds.map((g, i) => <Link key={g} to={`/goals/${g}`} style={{ marginRight: 8 }}>◎ {p.goalTitles[i]}</Link>)}</p>}
            {p.description && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{p.description}</p>}
            <h3 style={{ marginTop: 10 }}>Actions</h3>
            <ul className="list">{(detail.data.actions as any[]).map((a) => <li key={a.id}><button className={`check${a.status === "done" ? " done" : ""}`} onClick={() => toggleAction.mutate(a)}>{a.status === "done" ? "✓" : ""}</button><div className="grow"><div className="title">{a.title}</div><div className="meta">{a.kind !== "task" && <Badge>{a.kind}</Badge>} {a.waitingOn && `waiting on ${a.waitingOn}`} {a.dueDate ?? ""}</div></div></li>)}</ul>
            <div className="inline-form" style={{ marginTop: 8 }}><Input placeholder="Action を追加" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && actionTitle.trim() && addAction.mutate()} /><Button onClick={() => addAction.mutate()} disabled={!actionTitle.trim()}>追加</Button></div>
            {detail.data.relations?.length > 0 && <><h3 style={{ marginTop: 10 }}>つながり</h3><ul className="list">{detail.data.relations.map((r: any) => <li key={r.relationId}><div className="grow"><EntityLink type={r.type} id={r.id}>{r.title ?? r.id}</EntityLink><div className="meta">{r.type}</div></div></li>)}</ul></>}
            <Modal open={editing} onClose={() => setEditing(false)} title="Project を編集"><ProjectForm initial={p} goals={goals.data?.goals ?? []} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} /></Modal>
          </Card>
        ) : <Card><Empty>Project を選ぶと詳細が表示されます。</Empty></Card>}
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="Project を追加"><ProjectForm goals={goals.data?.goals ?? []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} /></Modal>
    </div>
  );
}
