import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr, fmtDate } from "../api/client";
import { Card, Button, Input, Textarea, Badge, Empty, Spinner, HealthBadge, Field, Select } from "../components/ui";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { QuickCaptureBox } from "./Capture";

type TodayData = {
  date: string; weekStart: string; oneThing: { oneThingTitle: string; why: string; actionId: string | null; goalId: string | null } | null;
  big3: { id: string; rank: number; title: string; status: string; goalTitle: string | null; actionId: string | null }[];
  dueActions: { id: string; title: string; dueDate: string | null; goalTitle: string | null; projectTitle: string | null }[];
  overdue: { id: string; title: string; dueDate: string | null }[];
  followUps: { id: string; personName: string; reason: string; dueDate: string; personId: string }[];
  promisesMine: { id: string; personName: string; text: string; dueDate: string | null }[];
  waiting: { id: string; title: string; waitingOn: string }[];
  decisionReviews: { id: string; title: string; reviewDate: string | null }[];
  northStars: { id: string; title: string; level: string; progress: { percent: number | null }; health: { health: string; reason: string } }[];
  stalledNorthStars: { id: string; title: string; health: { health: string; reason: string } }[];
  calendar: { id: string; title: string; startAt: string; endAt: string; allDay: boolean; category: string }[];
  inboxCount: number; knowledgeToApply: { id: string; title: string; nextAction: string }[]; antiGoals: { id: string; text: string }[];
};

export default function Today() {
  const date = todayStr();
  const q = useQuery({ queryKey: ["today", date], queryFn: () => api.get<TodayData>(`/today?date=${date}`) });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [goalId, setGoalId] = useState<string>("");
  const saveOne = useMutation({
    mutationFn: () => api.put("/focus/day", { date, oneThingTitle: title, why, goalId: goalId || null, actionId: null, notes: "" }),
    onSuccess: () => { setEditing(false); inv("today"); toast("今日の One Thing を保存しました", "success"); }, onError: (e) => toast(errText(e), "error"),
  });
  const toggle = useMutation({
    mutationFn: ({ kind, id, done }: { kind: "big3" | "action" | "followup" | "promise"; id: string; done: boolean }) =>
      kind === "big3" ? api.patch(`/focus/big3/${id}`, { status: done ? "done" : "open" }) : kind === "action" ? api.patch(`/actions/${id}`, { status: done ? "done" : "open" }) : kind === "followup" ? api.patch(`/follow-ups/${id}`, { status: done ? "done" : "open" }) : api.patch(`/promises/${id}`, { status: done ? "done" : "open" }),
    onSuccess: () => inv("today", "focus-week", "actions"), onError: (e) => toast(errText(e), "error"),
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Empty>読み込めませんでした（{errText(q.error)}）。オフラインの場合は Capture だけ利用できます。<div style={{ marginTop: 8 }}><Link to="/capture" className="btn">Quick Capture</Link></div></Empty>;
  const d = q.data!;
  const startEdit = () => { setTitle(d.oneThing?.oneThingTitle ?? ""); setWhy(d.oneThing?.why ?? ""); setGoalId(d.oneThing?.goalId ?? d.northStars[0]?.id ?? ""); setEditing(true); };
  return (
    <div>
      <div className="page-head"><div><h1>Today</h1><p className="muted">{d.date} · 今週 {d.weekStart}〜</p></div><div className="page-actions"><Link to="/focus" className="btn">Focus Mode</Link><Link to="/reviews/daily" className="btn">Daily Review</Link></div></div>

      <Card className="accent" title="Today's One Thing" action={!editing && <Button size="sm" onClick={startEdit}>{d.oneThing ? "変更" : "決める"}</Button>}>
        {editing ? (
          <div>
            <Field label="今日、これが進めば良い日と言える1つ"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: ProofFlow 販売ページの文章を仕上げる" /></Field>
            <Field label="なぜ（North Star とのつながり）"><Textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} /></Field>
            <Field label="関連 Goal"><Select value={goalId} onChange={(e) => setGoalId(e.target.value)}><option value="">（なし）</option>{d.northStars.map((g) => <option key={g.id} value={g.id}>★ {g.title}</option>)}</Select></Field>
            <div className="row"><Button variant="primary" onClick={() => saveOne.mutate()} disabled={!title.trim() || saveOne.isPending}>保存</Button><Button variant="ghost" onClick={() => setEditing(false)}>キャンセル</Button></div>
          </div>
        ) : d.oneThing?.oneThingTitle ? (
          <div><div className="one-thing">{d.oneThing.oneThingTitle}</div>{d.oneThing.why && <p className="muted small" style={{ marginTop: 6 }}>Why: {d.oneThing.why}</p>}</div>
        ) : <Empty>まだ決まっていません。Big 3 や North Star から今日の1つを選びましょう。</Empty>}
      </Card>

      <div className="grid">
        <Card title={`This Week's Big 3 (${d.big3.filter((b) => b.status === "done").length}/${d.big3.filter((b) => b.status !== "dropped").length})`} action={<Link className="btn btn-sm" to="/reviews/weekly">週を計画</Link>}>
          {d.big3.length === 0 ? <Empty>今週の Big 3 が未設定です。<Link to="/reviews/weekly">Weekly Review</Link> で決めましょう。</Empty> : (
            <ul className="list">{d.big3.filter((b) => b.status !== "dropped").map((b) => (
              <li key={b.id}><button className={`check${b.status === "done" ? " done" : ""}`} aria-label={b.status === "done" ? "未完了に戻す" : "完了"} onClick={() => toggle.mutate({ kind: "big3", id: b.id, done: b.status !== "done" })}>{b.status === "done" ? "✓" : ""}</button>
                <div className="grow"><div className="title" style={{ textDecoration: b.status === "done" ? "line-through" : undefined }}>{b.rank}. {b.title}</div>{b.goalTitle && <div className="meta">◎ {b.goalTitle}</div>}</div></li>
            ))}</ul>
          )}
        </Card>

        <Card title="North Star" action={<Link className="btn btn-sm" to="/goals">Goals</Link>}>
          {d.northStars.length === 0 ? <Empty>North Star（今 Quarter / 今月の最重要 Goal）を決めると、ここに表示されます。</Empty> : (
            <ul className="list">{d.northStars.map((g) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">★ {g.title}</Link><div className="meta">{g.level} · {g.progress.percent === null ? "進捗未定義" : `${g.progress.percent}%`} · {g.health.reason}</div></div><HealthBadge health={g.health} /></li>)}</ul>
          )}
        </Card>

        <Card title="期限・今日の Action" action={<Link className="btn btn-sm" to="/actions">すべて</Link>}>
          {d.dueActions.length + d.overdue.length === 0 ? <Empty>今日が期限の Action はありません。</Empty> : (
            <ul className="list">
              {d.overdue.map((a) => <li key={a.id}><button className="check" onClick={() => toggle.mutate({ kind: "action", id: a.id, done: true })} aria-label="完了" /><div className="grow"><div className="title">{a.title}</div><div className="meta"><Badge tone="bad">期限切れ {fmtDate(a.dueDate)}</Badge></div></div></li>)}
              {d.dueActions.map((a) => <li key={a.id}><button className="check" onClick={() => toggle.mutate({ kind: "action", id: a.id, done: true })} aria-label="完了" /><div className="grow"><div className="title">{a.title}</div><div className="meta">{a.goalTitle ?? a.projectTitle ?? ""}</div></div></li>)}
            </ul>
          )}
        </Card>

        <Card title="Follow-up / 約束" action={<Link className="btn btn-sm" to="/people">People</Link>}>
          {d.followUps.length + d.promisesMine.length === 0 ? <Empty>期限の来た Follow-up や約束はありません。</Empty> : (
            <ul className="list">
              {d.followUps.map((f) => <li key={f.id}><button className="check" onClick={() => toggle.mutate({ kind: "followup", id: f.id, done: true })} aria-label="完了" /><div className="grow"><div className="title"><Link to={`/people/${f.personId}`}>{f.personName}</Link></div><div className="meta">{f.reason} · {f.dueDate}</div></div></li>)}
              {d.promisesMine.map((p) => <li key={p.id}><button className="check" onClick={() => toggle.mutate({ kind: "promise", id: p.id, done: true })} aria-label="完了" /><div className="grow"><div className="title">約束: {p.text}</div><div className="meta">{p.personName}{p.dueDate ? ` · ${p.dueDate}` : ""}</div></div></li>)}
            </ul>
          )}
        </Card>

        {(d.decisionReviews.length > 0 || d.stalledNorthStars.length > 0) && (
          <Card title="見直し">
            <ul className="list">
              {d.decisionReviews.map((x) => <li key={x.id}><div className="grow"><Link to={`/decisions/${x.id}`} className="title">⚖ {x.title}</Link><div className="meta">Decision Review 予定 {x.reviewDate}</div></div></li>)}
              {d.stalledNorthStars.map((g) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">★ {g.title}</Link><div className="meta">{g.health.reason}</div></div><HealthBadge health={g.health} /></li>)}
            </ul>
          </Card>
        )}

        <Card title="Waiting / Calendar">
          {d.calendar.length > 0 && <ul className="list">{d.calendar.map((e) => <li key={e.id}><div className="grow"><div className="title">{e.title}</div><div className="meta">{e.allDay ? "終日" : `${new Date(e.startAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}–${new Date(e.endAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`} · {e.category}</div></div></li>)}</ul>}
          {d.waiting.length > 0 && <ul className="list">{d.waiting.map((w) => <li key={w.id}><div className="grow"><div className="title">⏳ {w.title}</div><div className="meta">waiting on {w.waitingOn}</div></div></li>)}</ul>}
          {d.calendar.length + d.waiting.length === 0 && <Empty>今日の予定・返事待ちはありません。</Empty>}
        </Card>

        <Card title="Quick Capture">
          <QuickCaptureBox compact onSaved={() => inv("today")} />
          <p className="small muted" style={{ marginTop: 8 }}><Link to="/inbox">Inbox</Link> に {d.inboxCount} 件 {d.knowledgeToApply.length > 0 && <>· 学びを行動に: <Link to={`/knowledge/${d.knowledgeToApply[0].id}`}>{d.knowledgeToApply[0].title}</Link></>}</p>
          {d.antiGoals.length > 0 && <p className="small faint">やらないこと: {d.antiGoals.map((a) => a.text).join(" / ")}</p>}
        </Card>
      </div>
    </div>
  );
}
