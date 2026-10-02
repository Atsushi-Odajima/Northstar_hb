import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Button, Field, Input, Select, Empty, Spinner, Badge, PageHeader } from "../components/ui";
import type { CalendarEvent } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const CAT: Record<string, string> = { goal: "Goal 関連", meeting: "Meeting", focus: "Focus", unclassified: "未分類" };

export default function Calendar() {
  const inv = useInvalidate();
  const { toast } = useToast();
  const [start, setStart] = useState(() => { const t = new Date(); const dow = (t.getDay() + 6) % 7; return addDays(todayStr(), -dow); });
  const end = addDays(start, 7);
  const q = useQuery({ queryKey: ["calendar", start], queryFn: () => api.get<{ events: CalendarEvent[]; suggestions: { eventId: string; suggestions: { type: string; id: string; title: string }[] }[] }>(`/calendar?from=${start}T00:00:00&to=${end}T00:00:00`) });
  const goals = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string }[] }>("/goals?status=active") });
  const [f, setF] = useState({ title: "", date: todayStr(), startTime: "10:00", endTime: "11:00", category: "focus", goalId: "" });
  const add = useMutation({ mutationFn: () => api.post("/calendar", { title: f.title, startAt: `${f.date}T${f.startTime}:00`, endAt: `${f.date}T${f.endTime}:00`, allDay: false, category: f.category, goalId: f.goalId || null, projectId: null }), onSuccess: () => { setF({ ...f, title: "" }); inv("calendar", "today"); }, onError: (e) => toast(errText(e), "error") });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/calendar/${id}`, body), onSuccess: () => inv("calendar", "today") });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/calendar/${id}`), onSuccess: () => inv("calendar") });
  const importIcs = useMutation({ mutationFn: (content: string) => api.post<{ imported: number; updated: number; recurringNotExpanded: number }>("/calendar/import-ics", { content }), onSuccess: (r) => { toast(`取り込み ${r.imported} 件 / 更新 ${r.updated} 件${r.recurringNotExpanded ? ` / 繰り返し予定 ${r.recurringNotExpanded} 件は1回分として取込` : ""}`, "success"); inv("calendar", "connectors"); }, onError: (e) => toast(errText(e), "error") });
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of q.data?.events ?? []) { const d = e.startAt.slice(0, 10); byDay.set(d, [...(byDay.get(d) ?? []), e]); }
  const hours = (e: CalendarEvent) => e.allDay ? 0 : (Date.parse(e.endAt) - Date.parse(e.startAt)) / 3_600_000;
  const totals: Record<string, number> = {};
  for (const e of q.data?.events ?? []) totals[e.category] = (totals[e.category] ?? 0) + hours(e);
  return (
    <div>
      <PageHeader title="Calendar / Time Alignment" subtitle="予定は時間利用の文脈。予定があった＝実行済み、とは扱いません。Goal/Project へのリンクは候補として提案します。" action={<><Button onClick={() => setStart(addDays(start, -7))}>← 前週</Button><Button onClick={() => setStart(addDays(start, 7))}>次週 →</Button></>} />
      <div className="grid-2">
        <Card title="予定を追加 / ICS 取り込み">
          <div className="row"><Input placeholder="タイトル" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ flex: 1 }} /><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ width: 150 }} /></div>
          <div className="row" style={{ marginTop: 8 }}><Input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} style={{ width: 110 }} /><Input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} style={{ width: 110 }} /><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={{ width: 130 }}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Select value={f.goalId} onChange={(e) => setF({ ...f, goalId: e.target.value })} style={{ flex: 1 }}><option value="">Goal（任意）</option>{goals.data?.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</Select><Button variant="primary" onClick={() => add.mutate()} disabled={!f.title.trim()}>追加</Button></div>
          <Field label="ICS ファイル（Google/Apple/Outlook から書き出し）"><input type="file" accept=".ics,text/calendar" onChange={(e) => { const file = e.target.files?.[0]; if (file) file.text().then((t) => importIcs.mutate(t)); }} /></Field>
          <p className="small faint">URL からの同期は <Link to="/settings#connectors">Settings → Connectors</Link>（利用者が設定したときだけ取得）。</p>
        </Card>
        <Card title={`今週の時間配分（${start}〜）`}>
          {Object.keys(totals).length === 0 ? <p className="small muted">予定がありません。</p> : <ul className="list">{Object.entries(totals).map(([k, v]) => <li key={k}><div className="grow">{CAT[k] ?? k}</div><b>{Math.round(v * 10) / 10}h</b></li>)}</ul>}
          <p className="small faint">「生産性スコア」のような単一指標は出しません。Goal 関連 / Meeting / Focus / 未分類の内訳のみ。</p>
        </Card>
      </div>
      {q.isLoading ? <Spinner /> : (q.data!.events.length === 0 ? <Empty>この週の予定はありません。</Empty> : (
        <Card>
          {[...byDay.keys()].sort().map((d) => <div key={d}><h3>{d}</h3><ul className="list">{byDay.get(d)!.map((e) => { const sug = q.data!.suggestions.find((s) => s.eventId === e.id); return (
            <li key={e.id}><div className="grow"><div className="title">{e.title}</div><div className="meta row"><span>{e.allDay ? "終日" : `${new Date(e.startAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}–${new Date(e.endAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`}</span><Badge>{e.source}</Badge>{e.goalId && <span>◎ linked</span>}{sug && sug.suggestions.map((s) => <Button key={s.id} size="sm" variant="ghost" onClick={() => patch.mutate({ id: e.id, body: s.type === "goal" ? { goalId: s.id, category: "goal" } : { projectId: s.id, category: "goal" } })}>候補: {s.title}</Button>)}</div></div><Select value={e.category} onChange={(ev) => patch.mutate({ id: e.id, body: { category: ev.target.value } })} style={{ width: 120 }}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Button size="sm" variant="ghost" onClick={() => del.mutate(e.id)}>削除</Button></li>
          ); })}</ul></div>)}
        </Card>
      ))}
    </div>
  );
}
