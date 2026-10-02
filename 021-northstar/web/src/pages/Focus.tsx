import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Button, Spinner, Empty } from "../components/ui";

export default function Focus() {
  const date = todayStr();
  const q = useQuery({ queryKey: ["focus-mode", date], queryFn: () => api.get<any>(`/focus/mode?date=${date}`) });
  const [sec, setSec] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => { if (!running) return; const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t); }, [running]);
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d?.focus) return <div className="focus-screen"><Empty>今日の One Thing が未設定です。<div style={{ marginTop: 10 }}><Link to="/today" className="btn btn-primary">Today で決める</Link></div></Empty></div>;
  const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="focus-screen">
      <p className="muted small">Focus Mode · {date}</p>
      <div className="one-thing" style={{ marginBottom: 12 }}>{d.focus.oneThingTitle}</div>
      {d.why && <p className="muted">Why: {d.why}</p>}
      {d.goal && <p className="small">◎ <Link to={`/goals/${d.goal.id}`}>{d.goal.title}</Link>{d.chain?.length ? <span className="faint"> ← {d.chain.map((g: any) => g.title).join(" ← ")}</span> : null}</p>}
      {d.nextActions?.length > 0 && <div className="card" style={{ textAlign: "left" }}><h3>Next Actions</h3><ul className="list">{d.nextActions.map((a: any) => <li key={a.id}><div className="grow">{a.title}</div></li>)}</ul></div>}
      {(d.knowledge?.length > 0 || d.people?.length > 0) && <div className="card" style={{ textAlign: "left" }}>{d.knowledge?.length > 0 && <p className="small">学び: {d.knowledge.map((k: any) => <Link key={k.id} to={`/knowledge/${k.id}`} style={{ marginRight: 8 }}>{k.title}</Link>)}</p>}{d.people?.length > 0 && <p className="small">People: {d.people.map((p: any) => <Link key={p.id} to={`/people/${p.id}`} style={{ marginRight: 8 }}>{p.title}</Link>)}</p>}</div>}
      <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
        <span className="mono" style={{ fontSize: "1.6rem" }}>{mm}:{ss}</span>
        <Button onClick={() => setRunning(!running)}>{running ? "一時停止" : "タイマー開始"}</Button>
        <Button variant="ghost" onClick={() => { setSec(0); setRunning(false); }}>リセット</Button>
      </div>
      <p style={{ marginTop: 24 }}><Link to="/today">← Today に戻る</Link></p>
    </div>
  );
}
