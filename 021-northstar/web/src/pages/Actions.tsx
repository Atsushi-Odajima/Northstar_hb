import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { Card, Button, Field, Input, Select, Empty, Spinner, Badge, PageHeader, Tabs } from "../components/ui";
import { useInvalidate, errText, useQueryParam } from "../lib/hooks";
import { useToast } from "../components/Toast";

export default function Actions() {
  const [tab, setTab] = useState("open");
  const highlight = useQueryParam("id");
  const q = useQuery({ queryKey: ["actions", tab], queryFn: () => api.get<{ actions: any[] }>(`/actions?status=${tab === "done" ? "done" : "open"}${tab === "loops" ? "&kind=open_loop,waiting" : tab === "open" ? "&kind=task,follow_up" : ""}&limit=300`) });
  const loops = useQuery({ queryKey: ["open-loops"], queryFn: () => api.get<any>("/open-loops"), enabled: tab === "loops" });
  const goals = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string; level: string }[] }>("/goals?status=active") });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [f, setF] = useState({ title: "", kind: "task", dueDate: "", goalId: "", waitingOn: "" });
  const refresh = () => inv("actions", "open-loops", "today");
  const add = useMutation({ mutationFn: () => api.post("/actions", { title: f.title, kind: f.kind, dueDate: f.dueDate || null, goalId: f.goalId || null, waitingOn: f.waitingOn }), onSuccess: () => { setF({ ...f, title: "", waitingOn: "" }); refresh(); }, onError: (e) => toast(errText(e), "error") });
  const toggle = useMutation({ mutationFn: (a: any) => api.patch(`/actions/${a.id}`, { status: a.status === "done" ? "open" : "done" }), onSuccess: refresh });
  const drop = useMutation({ mutationFn: (id: string) => api.patch(`/actions/${id}`, { status: "dropped" }), onSuccess: refresh });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <PageHeader title="Actions / Open Loops" subtitle="Task は Goal/Project の手段。Open Loop は未解決事項、Waiting は外部の返事待ち。Weekly Review で確認します。" />
      <Card>
        <div className="grid-2">
          <Field label="追加"><Input placeholder="タイトル" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && f.title.trim() && add.mutate()} /></Field>
          <div className="row">
            <Select aria-label="種類" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} style={{ width: 140 }}><option value="task">Task</option><option value="open_loop">Open Loop</option><option value="waiting">Waiting</option></Select>
            <Input aria-label="期限" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} style={{ width: 160 }} />
            <Select aria-label="関連 Goal" value={f.goalId} onChange={(e) => setF({ ...f, goalId: e.target.value })} style={{ flex: 1 }}><option value="">Goal（任意）</option>{goals.data?.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</Select>
            {f.kind === "waiting" && <Input aria-label="返事待ちの相手" placeholder="誰の返事待ち？" value={f.waitingOn} onChange={(e) => setF({ ...f, waitingOn: e.target.value })} style={{ width: 160 }} />}
            <Button variant="primary" onClick={() => add.mutate()} disabled={!f.title.trim()}>追加</Button>
          </div>
        </div>
      </Card>
      <Tabs tabs={[{ id: "open", label: "Open" }, { id: "loops", label: "Open Loops / Waiting" }, { id: "done", label: "Done" }]} value={tab} onChange={setTab} />
      {tab === "loops" && loops.data && (
        <div className="grid">
          <Card title={`Open Loops (${loops.data.openLoops.length})`}>{loops.data.openLoops.length === 0 ? <Empty>未解決事項はありません。</Empty> : <ul className="list">{loops.data.openLoops.map((a: any) => <li key={a.id}><button className="check" aria-label="完了にする" onClick={() => toggle.mutate(a)} /><div className="grow"><div className="title">{a.title}</div><div className="meta">{a.goalTitle ?? a.projectTitle ?? ""} {a.dueDate ?? ""}</div></div></li>)}</ul>}</Card>
          <Card title={`Waiting (${loops.data.waiting.length + loops.data.waitingProjects.length + loops.data.waitingOnOthers.length})`}>
            <ul className="list">
              {loops.data.waiting.map((a: any) => <li key={a.id}><button className="check" aria-label="完了にする" onClick={() => toggle.mutate(a)} /><div className="grow"><div className="title">⏳ {a.title}</div><div className="meta">waiting on {a.waitingOn}</div></div></li>)}
              {loops.data.waitingProjects.map((p: any) => <li key={p.id}><div className="grow"><Link to={`/projects/${p.id}`} className="title">▣ {p.title}</Link><div className="meta">Project waiting · {p.nextAction}</div></div></li>)}
              {loops.data.waitingOnOthers.map((p: any) => <li key={p.id}><div className="grow"><div className="title">☺ {p.personName}: {p.text}</div><div className="meta">返事待ち {p.dueDate ?? ""}</div></div></li>)}
            </ul>
          </Card>
        </div>
      )}
      {tab !== "loops" && (q.isLoading ? <Spinner /> : q.data!.actions.length === 0 ? <Empty>Action はありません。</Empty> : (
        <Card><ul className="list">{q.data!.actions.map((a) => <li key={a.id} style={{ background: a.id === highlight ? "var(--accent-soft)" : undefined }}><button className={`check${a.status === "done" ? " done" : ""}`} aria-label="完了切替" onClick={() => toggle.mutate(a)}>{a.status === "done" ? "✓" : ""}</button><div className="grow"><div className="title">{a.title}</div><div className="meta row">{a.kind !== "task" && <Badge>{a.kind}</Badge>}{a.dueDate && <Badge tone={a.dueDate < today && a.status === "open" ? "bad" : "neutral"}>{a.dueDate}</Badge>}{a.goalTitle && <Link to={`/goals/${a.goalId}`}>◎ {a.goalTitle}</Link>}{a.projectTitle && <Link to={`/projects/${a.projectId}`}>▣ {a.projectTitle}</Link>}{a.personName && <Link to={`/people/${a.personId}`}>☺ {a.personName}</Link>}</div></div>{a.status === "open" && <Button size="sm" variant="ghost" onClick={() => drop.mutate(a.id)}>やめる</Button>}</li>)}</ul></Card>
      ))}
    </div>
  );
}
