import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, fmtDate } from "../api/client";
import { Card, Button, Modal, Field, Input, Empty, Spinner, HealthBadge, Badge, ProgressBar, LEVEL_LABEL, STATUS_LABEL, EntityLink } from "../components/ui";
import type { Goal, Outcome } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { GoalForm } from "./Goals";

export default function GoalDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const inv = useInvalidate();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["goal", id], queryFn: () => api.get<any>(`/goals/${id}`) });
  const all = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string; level: string }[] }>("/goals?status=active,draft,paused") });
  const [editing, setEditing] = useState(false);
  const [outcomeTitle, setOutcomeTitle] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => inv("goal", "goals-tree", "northstar", "today");
  const addOutcome = useMutation({ mutationFn: () => api.post(`/goals/${id}/outcomes`, { title: outcomeTitle }), onSuccess: () => { setOutcomeTitle(""); refresh(); }, onError: (e) => toast(errText(e), "error") });
  const toggleOutcome = useMutation({ mutationFn: (o: Outcome) => api.patch(`/outcomes/${o.id}`, { status: o.status === "achieved" ? "open" : "achieved" }), onSuccess: refresh });
  const addAction = useMutation({ mutationFn: () => api.post("/actions", { title: actionTitle, goalId: id }), onSuccess: () => { setActionTitle(""); refresh(); inv("actions"); }, onError: (e) => toast(errText(e), "error") });
  const toggleAction = useMutation({ mutationFn: (a: any) => api.patch(`/actions/${a.id}`, { status: a.status === "done" ? "open" : "done" }), onSuccess: () => { refresh(); inv("actions"); } });
  const logProgress = useMutation({ mutationFn: (p: number) => api.post(`/goals/${id}/progress`, { progress: p, note }), onSuccess: () => { setNote(""); setProgress(null); refresh(); toast("進捗を記録しました", "success"); }, onError: (e) => toast(errText(e), "error") });
  const setStatus = useMutation({ mutationFn: (status: string) => api.patch(`/goals/${id}`, { status }), onSuccess: refresh, onError: (e) => toast(errText(e), "error") });
  const del = useMutation({ mutationFn: () => api.delete(`/goals/${id}`), onSuccess: () => { refresh(); nav("/goals"); } });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Empty>{errText(q.error)}</Empty>;
  const { goal, outcomes, children, ancestors, actions, relations, progressLog } = q.data as { goal: Goal & { progress: { percent: number | null; basis: string }; health: { health: string; reason: string } }; outcomes: Outcome[]; children: any[]; ancestors: Goal[]; actions: any[]; relations: any[]; progressLog: any[] };
  const allOutcomesDone = outcomes.length > 0 && outcomes.filter((o) => o.status !== "dropped").every((o) => o.status === "achieved");
  return (
    <div>
      <p className="small muted">{[...ancestors].reverse().map((a) => <span key={a.id}><Link to={`/goals/${a.id}`}>{a.title}</Link> › </span>)}<Link to="/goals">Goals</Link></p>
      <div className="page-head">
        <div><h1>{goal.isNorthStar ? "★ " : ""}{goal.title}</h1><div className="row small muted"><Badge tone="accent">{LEVEL_LABEL[goal.level]}</Badge><Badge>{STATUS_LABEL[goal.status]}</Badge><HealthBadge health={goal.health} /><span>{fmtDate(goal.startDate)} 〜 {fmtDate(goal.endDate)}</span></div></div>
        <div className="page-actions"><Button onClick={() => setEditing(true)}>編集</Button>{goal.status === "active" && <Button onClick={() => setStatus.mutate("paused")}>Pause</Button>}{goal.status !== "active" && goal.status !== "achieved" && <Button onClick={() => setStatus.mutate("active")}>Activate</Button>}{goal.status !== "achieved" && <Button variant="primary" onClick={() => { if (confirm(allOutcomesDone ? "この Goal を達成済みにしますか？" : "Outcome がまだ未達です。それでも達成済みにしますか？（タスク完了だけでは達成とみなしません）")) setStatus.mutate("achieved"); }}>達成にする</Button>}<Button variant="danger" onClick={() => { if (confirm("この Goal を削除しますか？Outcome も削除されます。")) del.mutate(); }}>削除</Button></div>
      </div>
      <div className="grid-2">
        <Card title="進捗と健康状態">
          <ProgressBar percent={goal.progress.percent} />
          <p className="small muted" style={{ marginTop: 6 }}>{goal.progress.percent === null ? "進捗は未定義（Outcome を追加すると算出）" : `${goal.progress.percent}%`} · {goal.progress.basis}</p>
          <p className="small"><HealthBadge health={goal.health} /> {goal.health.reason}</p>
          {allOutcomesDone && goal.status !== "achieved" && <div className="notice info">すべての Outcome が達成されています。Goal を「達成」にするのはあなたの判断です。</div>}
          {goal.progressMode === "manual" && (
            <div style={{ marginTop: 10 }}>
              <Field label={`進捗を記録（${progress ?? goal.progressManual}%）`}><input aria-label="進捗 %" type="range" min={0} max={100} value={progress ?? goal.progressManual} onChange={(e) => setProgress(Number(e.target.value))} style={{ width: "100%" }} /></Field>
              <div className="inline-form"><Input placeholder="何が進んだ？（任意）" value={note} onChange={(e) => setNote(e.target.value)} /><Button onClick={() => logProgress.mutate(progress ?? goal.progressManual)} disabled={logProgress.isPending}>記録</Button></div>
            </div>
          )}
          {goal.successDefinition && <p className="small" style={{ marginTop: 10 }}><b>成功の定義:</b> {goal.successDefinition}</p>}
          {goal.why && <p className="small"><b>Why:</b> {goal.why}</p>}
          {goal.description && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{goal.description}</p>}
        </Card>
        <Card title={`Outcomes（成果）${outcomes.length ? ` ${outcomes.filter((o) => o.status === "achieved").length}/${outcomes.length}` : ""}`}>
          <p className="small muted">例: Goal「ProofFlow 販売開始」→ Outcome「販売ページ公開 / 初回購入」</p>
          <ul className="list">{outcomes.map((o) => <li key={o.id}><button className={`check${o.status === "achieved" ? " done" : ""}`} onClick={() => toggleOutcome.mutate(o)} aria-label="達成切替">{o.status === "achieved" ? "✓" : ""}</button><div className="grow"><div className="title">{o.title}</div><div className="meta">{o.status === "achieved" ? `達成 ${fmtDate(o.achievedAt)}` : o.dueDate ? `期限 ${o.dueDate}` : "未達"}</div></div></li>)}</ul>
          <div className="inline-form" style={{ marginTop: 8 }}><Input placeholder="Outcome を追加" value={outcomeTitle} onChange={(e) => setOutcomeTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && outcomeTitle.trim() && addOutcome.mutate()} /><Button onClick={() => addOutcome.mutate()} disabled={!outcomeTitle.trim()}>追加</Button></div>
        </Card>
        <Card title={`Actions（タスク）${actions.length ? ` ${actions.filter((a) => a.status === "done").length}/${actions.length}` : ""}`}>
          <ul className="list">{actions.map((a) => <li key={a.id}><button className={`check${a.status === "done" ? " done" : ""}`} onClick={() => toggleAction.mutate(a)} aria-label="完了切替">{a.status === "done" ? "✓" : ""}</button><div className="grow"><div className="title" style={{ textDecoration: a.status === "done" ? "line-through" : undefined }}>{a.title}</div><div className="meta">{a.kind !== "task" && <Badge>{a.kind}</Badge>} {a.dueDate ?? ""}</div></div></li>)}</ul>
          <div className="inline-form" style={{ marginTop: 8 }}><Input placeholder="Action を追加" value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && actionTitle.trim() && addAction.mutate()} /><Button onClick={() => addAction.mutate()} disabled={!actionTitle.trim()}>追加</Button></div>
          <p className="small faint" style={{ marginTop: 6 }}>Action を大量に完了しても、Outcome が未達なら「順調」とは表示されません。</p>
        </Card>
        <Card title="子 Goal / つながり">
          {children.length > 0 && <ul className="list">{children.map((c) => <li key={c.id}><div className="grow"><Link to={`/goals/${c.id}`} className="title">{c.title}</Link><div className="meta">{LEVEL_LABEL[c.level]}</div></div><HealthBadge health={c.health} /></li>)}</ul>}
          {relations.length > 0 ? <ul className="list">{relations.map((r) => <li key={r.relationId}><div className="grow"><EntityLink type={r.type} id={r.id}>{r.title ?? r.id}</EntityLink><div className="meta">{r.type} · {r.kind}</div></div></li>)}</ul> : <p className="small muted">Project / Decision / Knowledge / People からこの Goal にリンクできます。</p>}
          {progressLog.length > 0 && <details className="section"><summary>進捗ログ ({progressLog.length})</summary><ul className="list">{progressLog.slice(0, 20).map((p) => <li key={p.id}><div className="grow"><div className="title">{p.progress}%</div><div className="meta">{p.date} {p.note}</div></div></li>)}</ul></details>}
        </Card>
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title="Goal を編集" wide>
        <GoalForm initial={goal} parentOptions={all.data?.goals ?? []} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />
      </Modal>
    </div>
  );
}
