import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr, fmtDate } from "../api/client";
import { Card, Button, Modal, Field, Input, Textarea, Select, Empty, Spinner, Badge, EntityLink } from "../components/ui";
import type { Person, Contact, Promise_, FollowUp } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { PersonForm, REL_LABEL } from "./People";

export default function PersonDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const inv = useInvalidate();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["person", id], queryFn: () => api.get<{ person: Person; contacts: Contact[]; promises: (Promise_ & { personName: string })[]; followUps: (FollowUp & { personName: string })[]; relations: any[] }>(`/people/${id}`) });
  const brief = useQuery({ queryKey: ["brief", id], queryFn: () => api.get<any>(`/people/${id}/brief`) });
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [c, setC] = useState({ date: todayStr(), type: "meeting", summary: "", nextStep: "", promiseMine: "", promiseMineDue: "", promiseTheirs: "", promiseTheirsDue: "", followUpDue: "", followUpReason: "" });
  const refresh = () => inv("person", "brief", "people", "today", "follow-ups-due", "promises-open");
  const log = useMutation({
    mutationFn: () => api.post("/contacts", { personId: id, date: c.date, type: c.type, summary: c.summary, nextStep: c.nextStep, promises: [...(c.promiseMine ? [{ direction: "mine", text: c.promiseMine, dueDate: c.promiseMineDue || null }] : []), ...(c.promiseTheirs ? [{ direction: "theirs", text: c.promiseTheirs, dueDate: c.promiseTheirsDue || null }] : [])], followUp: c.followUpDue ? { dueDate: c.followUpDue, reason: c.followUpReason } : null }),
    onSuccess: () => { setLogging(false); setC({ ...c, summary: "", nextStep: "", promiseMine: "", promiseTheirs: "", followUpDue: "", followUpReason: "" }); refresh(); toast("接点を記録しました", "success"); }, onError: (e) => toast(errText(e), "error"),
  });
  const togglePromise = useMutation({ mutationFn: (p: Promise_) => api.patch(`/promises/${p.id}`, { status: p.status === "done" ? "open" : "done" }), onSuccess: refresh });
  const toggleFollow = useMutation({ mutationFn: (f: FollowUp) => api.patch(`/follow-ups/${f.id}`, { status: f.status === "done" ? "open" : "done" }), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.delete(`/people/${id}`), onSuccess: () => { refresh(); nav("/people"); } });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Empty>{errText(q.error)}</Empty>;
  const { person: p, contacts, promises, followUps, relations } = q.data!;
  const b = brief.data;
  return (
    <div>
      <p className="small muted"><Link to="/people">People</Link></p>
      <div className="page-head">
        <div><h1>{p.name}</h1><div className="row small muted"><span>{p.organization}{p.role ? ` · ${p.role}` : ""}</span><Badge tone={p.importance <= 2 ? "accent" : "neutral"}>重要度 {p.importance}</Badge><span>{REL_LABEL[p.relationshipType]}</span>{p.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div></div>
        <div className="page-actions"><Button variant="primary" onClick={() => setLogging(true)}>＋ 接点を記録</Button><Button onClick={() => setEditing(true)}>編集</Button><Button variant="danger" onClick={() => confirm("削除しますか？接点・約束も削除されます。") && del.mutate()}>削除</Button></div>
      </div>
      <div className="grid-2">
        <Card title="会う前の Brief（事実のみ）">
          {!b ? <Spinner /> : (
            <div>
              <p className="small">最終接点: {fmtDate(p.lastContactAt)}{b.daysSinceLastContact !== null ? `（${b.daysSinceLastContact}日前）` : ""}{p.howMet && ` · 出会い: ${p.howMet}`}</p>
              {b.topics.length > 0 && <p className="small"><b>最近の話題:</b> {b.topics.join(" / ")}</p>}
              {b.myOpenPromises.length > 0 && <p className="small"><b>自分が約束したこと:</b> {b.myOpenPromises.map((x: any) => x.text).join(" / ")}</p>}
              {b.waitingFromThem.length > 0 && <p className="small"><b>相手から返事待ち:</b> {b.waitingFromThem.map((x: any) => x.text).join(" / ")}</p>}
              {b.openFollowUps.length > 0 && <p className="small"><b>未完了 Follow-up:</b> {b.openFollowUps.map((x: any) => `${x.reason}（${x.dueDate}）`).join(" / ")}</p>}
              {(b.relatedGoals.length > 0 || b.relatedProjects.length > 0) && <p className="small"><b>関連:</b> {b.relatedGoals.map((g: any) => <Link key={g.id} to={`/goals/${g.id}`} style={{ marginRight: 6 }}>◎ {g.title}</Link>)}{b.relatedProjects.map((g: any) => <Link key={g.id} to={`/projects/${g.id}`} style={{ marginRight: 6 }}>▣ {g.title}</Link>)}</p>}
              {b.relatedDecisions.length > 0 && <p className="small"><b>関係する判断:</b> {b.relatedDecisions.map((d: any) => <Link key={d.id} to={`/decisions/${d.id}`} style={{ marginRight: 6 }}>⚖ {d.title}</Link>)}</p>}
              {p.notes && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{p.notes}</p>}
              <p className="small faint">{b.note}</p>
            </div>
          )}
        </Card>
        <Card title="約束 / Follow-up">
          <ul className="list">
            {promises.map((x) => <li key={x.id}><button className={`check${x.status === "done" ? " done" : ""}`} aria-label="完了切替" onClick={() => togglePromise.mutate(x)}>{x.status === "done" ? "✓" : ""}</button><div className="grow"><div className="title">{x.direction === "mine" ? "自分の約束" : "返事待ち"}: {x.text}</div><div className="meta">{x.dueDate ?? ""} {x.status}</div></div></li>)}
            {followUps.map((f) => <li key={f.id}><button className={`check${f.status === "done" ? " done" : ""}`} aria-label="完了切替" onClick={() => toggleFollow.mutate(f)}>{f.status === "done" ? "✓" : ""}</button><div className="grow"><div className="title">Follow-up: {f.reason || "連絡する"}</div><div className="meta">{f.dueDate} {f.status}</div></div></li>)}
          </ul>
          {promises.length + followUps.length === 0 && <p className="small muted">接点を記録するときに約束や Follow-up を追加できます。</p>}
        </Card>
      </div>
      <Card title={`接点の履歴 (${contacts.length})`}>
        {contacts.length === 0 ? <Empty>まだ接点の記録がありません。</Empty> : <ul className="list">{contacts.map((ct) => <li key={ct.id}><div className="grow"><div className="title">{ct.date} · {ct.type}</div><div className="meta" style={{ whiteSpace: "pre-wrap" }}>{ct.summary}</div>{ct.nextStep && <div className="meta">次: {ct.nextStep}</div>}</div></li>)}</ul>}
        {relations.length > 0 && <><h3 style={{ marginTop: 10 }}>つながり</h3><ul className="list">{relations.map((r: any) => <li key={r.relationId}><div className="grow"><EntityLink type={r.type} id={r.id}>{r.title ?? r.id}</EntityLink> <span className="meta">{r.type}</span></div></li>)}</ul></>}
      </Card>
      <Modal open={logging} onClose={() => setLogging(false)} title="接点を記録" wide>
        <div className="grid-2">
          <Field label="日付"><Input type="date" value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} /></Field>
          <Field label="種類"><Select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })}>{["meeting", "call", "message", "email", "event", "other"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        </div>
        <Field label="何を話した？"><Textarea rows={3} value={c.summary} onChange={(e) => setC({ ...c, summary: e.target.value })} autoFocus /></Field>
        <Field label="次のステップ"><Input value={c.nextStep} onChange={(e) => setC({ ...c, nextStep: e.target.value })} /></Field>
        <div className="grid-2">
          <Field label="自分が約束したこと"><Input value={c.promiseMine} onChange={(e) => setC({ ...c, promiseMine: e.target.value })} /></Field>
          <Field label="期限"><Input type="date" value={c.promiseMineDue} onChange={(e) => setC({ ...c, promiseMineDue: e.target.value })} /></Field>
          <Field label="相手からの返事待ち"><Input value={c.promiseTheirs} onChange={(e) => setC({ ...c, promiseTheirs: e.target.value })} /></Field>
          <Field label="期限"><Input type="date" value={c.promiseTheirsDue} onChange={(e) => setC({ ...c, promiseTheirsDue: e.target.value })} /></Field>
          <Field label="Follow-up 日"><Input type="date" value={c.followUpDue} onChange={(e) => setC({ ...c, followUpDue: e.target.value })} /></Field>
          <Field label="Follow-up の理由"><Input value={c.followUpReason} onChange={(e) => setC({ ...c, followUpReason: e.target.value })} /></Field>
        </div>
        <div className="row"><Button variant="primary" onClick={() => log.mutate()} disabled={log.isPending}>記録</Button><Button variant="ghost" onClick={() => setLogging(false)}>キャンセル</Button></div>
      </Modal>
      <Modal open={editing} onClose={() => setEditing(false)} title="Person を編集"><PersonForm initial={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} /></Modal>
    </div>
  );
}
