import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Button, Modal, Field, Textarea, Select, Empty, Spinner, Badge, EntityLink, Input } from "../components/ui";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { DecisionForm, OUTCOME_LABEL } from "./Decisions";

export default function DecisionDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const inv = useInvalidate();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["decision", id], queryFn: () => api.get<any>(`/decisions/${id}`) });
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [r, setR] = useState({ outcome: "as_expected", result: "", lessons: "", reviewedAt: todayStr() });
  const refresh = () => inv("decision", "decisions", "today");
  const review = useMutation({ mutationFn: () => api.post(`/decisions/${id}/review`, r), onSuccess: () => { setReviewing(false); refresh(); toast("結果を記録しました。当時の判断内容はそのまま保持されます", "success"); }, onError: (e) => toast(errText(e), "error") });
  const del = useMutation({ mutationFn: () => api.delete(`/decisions/${id}`), onSuccess: () => { refresh(); nav("/decisions"); } });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Empty>{errText(q.error)}</Empty>;
  const { decision: d, reviews, relations, actions } = q.data;
  const locked = reviews.length > 0;
  return (
    <div>
      <p className="small muted"><Link to="/decisions">Decision Journal</Link></p>
      <div className="page-head">
        <div><h1>⚖ {d.title}</h1><div className="row small muted"><span>決定 {d.decidedAt}</span><Badge>確信度 {d.confidence}%</Badge><Badge tone={d.status === "open" ? "accent" : "neutral"}>{d.status}</Badge>{d.reviewDate && <span>見直し {d.reviewDate}</span>}</div></div>
        <div className="page-actions">{d.status !== "abandoned" && <Button variant="primary" onClick={() => setReviewing(true)}>結果を記録</Button>}<Button onClick={() => setEditing(true)}>編集</Button><Button variant="danger" onClick={() => confirm("削除しますか？") && del.mutate()}>削除</Button></div>
      </div>
      <div className="grid-2">
        <Card title="当時の判断">
          {d.context && <p><b>状況:</b> {d.context}</p>}
          {d.options.length > 0 && <p><b>選択肢:</b> {d.options.join(" / ")}</p>}
          <p><b>決定:</b> {d.decision || "—"}</p>
          <p><b>理由:</b> {d.reason || "—"}</p>
          {d.assumptions.length > 0 && <p><b>前提:</b> {d.assumptions.join(" / ")}</p>}
          <p><b>期待する結果:</b> {d.expectedOutcome || "—"}</p>
          {d.risks && <p><b>リスク:</b> {d.risks}</p>}
          <p className="small">{d.goalTitles.map((t: string, i: number) => <Link key={t} to={`/goals/${d.goalIds[i]}`} style={{ marginRight: 8 }}>◎ {t}</Link>)}{d.personNames.map((t: string, i: number) => <Link key={t} to={`/people/${d.personIds[i]}`} style={{ marginRight: 8 }}>☺ {t}</Link>)}</p>
        </Card>
        <Card title={`レビュー履歴 (${reviews.length})`}>
          {reviews.length === 0 ? <Empty>まだ結果を記録していません。見直し日に、当時の判断を読み返してから結果を記録します。結果が悪い＝判断が悪い、ではありません。</Empty> : (
            <ul className="list">{reviews.map((rv: any) => <li key={rv.id}><div className="grow"><div className="title"><Badge tone={rv.outcome === "worse" ? "bad" : rv.outcome === "better" ? "good" : "neutral"}>{OUTCOME_LABEL[rv.outcome]}</Badge> {rv.reviewedAt}{rv.source === "mcp" && <Badge>via MCP</Badge>}</div>{rv.result && <div className="meta">結果: {rv.result}</div>}{rv.lessons && <div className="meta">学び: {rv.lessons}</div>}<details className="section"><summary className="small">当時のスナップショット</summary><p className="small muted">決定: {rv.snapshot.decision} / 理由: {rv.snapshot.reason} / 前提: {rv.snapshot.assumptions.join(", ")} / 期待: {rv.snapshot.expectedOutcome} / 確信度 {rv.snapshot.confidence}%</p></details></div></li>)}</ul>
          )}
          {(actions.length > 0 || relations.length > 0) && <><h3 style={{ marginTop: 10 }}>つながり</h3><ul className="list">{actions.map((a: any) => <li key={a.id}><div className="grow">☐ {a.title}</div></li>)}{relations.map((x: any) => <li key={x.relationId}><div className="grow"><EntityLink type={x.type} id={x.id}>{x.title ?? x.id}</EntityLink> <span className="meta">{x.type}</span></div></li>)}</ul></>}
        </Card>
      </div>
      <Modal open={reviewing} onClose={() => setReviewing(false)} title="Decision Review" wide>
        <div className="notice info">当時の判断（変更不可）: <b>{d.decision}</b> — 理由: {d.reason} / 前提: {d.assumptions.join(", ") || "—"} / 期待: {d.expectedOutcome || "—"} / 確信度 {d.confidence}%</div>
        <div className="grid-2">
          <Field label="結果"><Select value={r.outcome} onChange={(e) => setR({ ...r, outcome: e.target.value })}>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="レビュー日"><Input type="date" value={r.reviewedAt} onChange={(e) => setR({ ...r, reviewedAt: e.target.value })} /></Field>
        </div>
        <Field label="実際に何が起きた？"><Textarea rows={3} value={r.result} onChange={(e) => setR({ ...r, result: e.target.value })} /></Field>
        <Field label="学び（次に活かすこと）"><Textarea rows={3} value={r.lessons} onChange={(e) => setR({ ...r, lessons: e.target.value })} /></Field>
        <div className="row"><Button variant="primary" onClick={() => review.mutate()} disabled={review.isPending}>記録する</Button><Button variant="ghost" onClick={() => setReviewing(false)}>キャンセル</Button></div>
      </Modal>
      <Modal open={editing} onClose={() => setEditing(false)} title="Decision を編集" wide><DecisionForm initial={d} locked={locked} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} /></Modal>
    </div>
  );
}
