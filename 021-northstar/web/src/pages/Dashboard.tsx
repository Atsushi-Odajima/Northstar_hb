import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Empty, Spinner, HealthBadge, Badge, ProgressBar, PageHeader, LEVEL_LABEL } from "../components/ui";
import { errText } from "../lib/hooks";

export default function Dashboard() {
  const date = todayStr();
  const today = useQuery({ queryKey: ["today", date], queryFn: () => api.get<any>(`/today?date=${date}`) });
  const goals = useQuery({ queryKey: ["goals-list-active"], queryFn: () => api.get<{ goals: any[]; warning: string | null }>("/goals?status=active") });
  const knowledge = useQuery({ queryKey: ["knowledge", "toApply"], queryFn: () => api.get<{ knowledge: any[] }>("/knowledge?toApply=1") });
  const loops = useQuery({ queryKey: ["open-loops"], queryFn: () => api.get<any>("/open-loops") });
  if (today.isLoading) return <Spinner />;
  if (today.isError) return <Empty>{errText(today.error)}</Empty>;
  const d = today.data;
  const stalled = (goals.data?.goals ?? []).filter((g) => ["stalled", "no_signal", "activity_without_outcome"].includes(g.health.health) && g.level !== "vision");
  const progressing = (goals.data?.goals ?? []).filter((g) => g.health.health === "on_track" && g.level !== "vision");
  return (
    <div>
      <PageHeader title="Strategy" subtitle="忙しかったか、ではなく、重要だと決めた方向へ前進したか。" action={<><Link to="/reviews/weekly" className="btn">CEO Meeting with Yourself</Link><Link to="/ai" className="btn btn-primary">AI Chief of Staff</Link></>} />
      {goals.data?.warning && <div className="notice">{goals.data.warning}</div>}
      <div className="grid">
        <Card title="North Star" action={<Link className="btn btn-sm" to="/goals">Goals</Link>}>
          {d.northStars.length === 0 ? <Empty>最重要 Goal（North Star）を 1〜3 件決めましょう。<div style={{ marginTop: 8 }}><Link className="btn btn-primary" to="/goals">Goals へ</Link></div></Empty> : <ul className="list">{d.northStars.map((g: any) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">★ {g.title}</Link><div className="meta">{LEVEL_LABEL[g.level]} · {g.health.reason}</div><ProgressBar percent={g.progress.percent} /></div><HealthBadge health={g.health} /></li>)}</ul>}
        </Card>
        <Card title="This Week's Big 3" action={<Link className="btn btn-sm" to="/reviews/weekly">計画</Link>}>
          {d.big3.length === 0 ? <Empty>未設定</Empty> : <ul className="list">{d.big3.filter((b: any) => b.status !== "dropped").map((b: any) => <li key={b.id}><div className="grow"><div className="title" style={{ textDecoration: b.status === "done" ? "line-through" : undefined }}>{b.rank}. {b.title}</div>{b.goalTitle && <div className="meta">◎ {b.goalTitle}</div>}</div>{b.status === "done" && <Badge tone="good">done</Badge>}</li>)}</ul>}
        </Card>
        <Card title="Today's One Thing" action={<Link className="btn btn-sm" to="/today">Today</Link>}>
          {d.oneThing?.oneThingTitle ? <div className="one-thing">{d.oneThing.oneThingTitle}</div> : <Empty>未設定</Empty>}
        </Card>
        <Card title="Progress / Stalled">
          {progressing.length > 0 && <p className="small">前進中: {progressing.slice(0, 5).map((g) => <Link key={g.id} to={`/goals/${g.id}`} style={{ marginRight: 8 }}>{g.title}</Link>)}</p>}
          {stalled.length === 0 ? <p className="small muted">停滞中の Goal はありません。</p> : <ul className="list">{stalled.slice(0, 6).map((g) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">{g.title}</Link><div className="meta">{g.health.reason}</div></div><HealthBadge health={g.health} /></li>)}</ul>}
        </Card>
        <Card title="Decision Reviews" action={<Link className="btn btn-sm" to="/decisions">Decisions</Link>}>
          {d.decisionReviews.length === 0 ? <p className="small muted">見直し時期の Decision はありません。</p> : <ul className="list">{d.decisionReviews.map((x: any) => <li key={x.id}><div className="grow"><Link to={`/decisions/${x.id}`} className="title">⚖ {x.title}</Link><div className="meta">予定 {x.reviewDate}</div></div></li>)}</ul>}
        </Card>
        <Card title="Follow-ups / Promises" action={<Link className="btn btn-sm" to="/people">People</Link>}>
          {d.followUps.length + d.promisesMine.length === 0 ? <p className="small muted">期限の来た Follow-up・約束はありません。</p> : <ul className="list">{d.followUps.map((f: any) => <li key={f.id}><div className="grow"><Link to={`/people/${f.personId}`} className="title">{f.personName}</Link><div className="meta">{f.reason} · {f.dueDate}</div></div></li>)}{d.promisesMine.map((p: any) => <li key={p.id}><div className="grow"><div className="title">約束: {p.text}</div><div className="meta">{p.personName}</div></div></li>)}</ul>}
        </Card>
        <Card title="Knowledge to Apply" action={<Link className="btn btn-sm" to="/knowledge">Knowledge</Link>}>
          {!knowledge.data?.knowledge.length ? <p className="small muted">行動待ちの学びはありません。</p> : <ul className="list">{knowledge.data.knowledge.slice(0, 5).map((k) => <li key={k.id}><div className="grow"><Link to={`/knowledge/${k.id}`} className="title">{k.title}</Link><div className="meta">次: {k.nextAction}</div></div></li>)}</ul>}
        </Card>
        <Card title="Open Loops" action={<Link className="btn btn-sm" to="/actions">Actions</Link>}>
          {!loops.data || loops.data.openLoops.length + loops.data.waiting.length === 0 ? <p className="small muted">Open Loop はありません。</p> : <ul className="list">{loops.data.openLoops.slice(0, 4).map((a: any) => <li key={a.id}><div className="grow">◯ {a.title}</div></li>)}{loops.data.waiting.slice(0, 4).map((a: any) => <li key={a.id}><div className="grow">⏳ {a.title} <span className="muted small">({a.waitingOn})</span></div></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}
