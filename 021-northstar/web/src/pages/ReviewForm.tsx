import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Button, Field, Textarea, Input, Empty, Spinner, Badge, HealthBadge, Select } from "../components/ui";
import type { Review } from "@shared/types";
import { useInvalidate, errText, useQueryParam } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { OUTCOME_LABEL } from "./Decisions";

type Q = { id: string; text: string; section: string; hint?: string };
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const stepFor = (kind: string, start: string, dir: 1 | -1) => kind === "daily" ? addDays(start, dir) : kind === "weekly" ? addDays(start, 7 * dir) : kind === "monthly" ? addDays(start, dir === 1 ? 32 : -1) : kind === "quarterly" ? addDays(start, dir === 1 ? 93 : -1) : addDays(start, dir === 1 ? 366 : -1);

export default function ReviewForm() {
  const params = useParams();
  const nav = useNavigate();
  const inv = useInvalidate();
  const { toast } = useToast();
  const dateParam = useQueryParam("date");
  const byId = useQuery({ queryKey: ["review", params.id], queryFn: () => api.get<{ review: Review; questions: Q[] }>(`/reviews/id/${params.id}`.replace("/id/", "/")), enabled: !!params.id });
  const kind = params.kind ?? byId.data?.review.kind ?? "weekly";
  const date = dateParam ?? byId.data?.review.periodStart ?? todayStr();
  const cur = useQuery({ queryKey: ["review-current", kind, date], queryFn: () => api.get<{ review: Review | null; period: { start: string; end: string }; templateId: string; questions: Q[]; preview: any }>(`/reviews/current?kind=${kind}&date=${date}`), enabled: !params.id || !!byId.data });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [big3Next, setBig3Next] = useState(["", "", ""]);
  const review = cur.data?.review ?? null;
  useEffect(() => { if (cur.data) setAnswers(cur.data.review?.answers ?? {}); }, [cur.data]);
  const save = useMutation({
    mutationFn: (complete: boolean) => api.put<{ review: Review }>("/reviews", { kind, date, answers, complete }),
    onSuccess: (r, complete) => { inv("review-current", "reviews-recent", "reviews-current-all", "today"); toast(complete ? "Review を完了しました。期間内データのスナップショットを保存しました" : "下書きを保存しました", "success"); if (params.id) nav(`/reviews/id/${r.review.id}`, { replace: true }); },
    onError: (e) => toast(errText(e), "error"),
  });
  const nextWeek = useMemo(() => (cur.data ? addDays(cur.data.period.start, 7) : ""), [cur.data]);
  const nextBig3 = useQuery({ queryKey: ["focus-week", nextWeek], queryFn: () => api.get<{ items: { id: string; title: string; status: string; rank: number }[]; carryOver: { id: string; title: string }[]; northStars: { id: string; title: string }[] }>(`/focus/week?date=${nextWeek}`), enabled: kind === "weekly" && !!nextWeek });
  const addBig3 = useMutation({ mutationFn: (title: string) => api.post("/focus/big3", { weekStart: nextWeek, title }), onSuccess: () => inv("focus-week", "today"), onError: (e) => toast(errText(e), "error") });
  const dropBig3 = useMutation({ mutationFn: (id: string) => api.delete(`/focus/big3/${id}`), onSuccess: () => inv("focus-week", "today") });
  if (cur.isLoading || (params.id && byId.isLoading)) return <Spinner />;
  if (cur.isError) return <Empty>{errText(cur.error)}</Empty>;
  const d = cur.data!;
  const p = d.preview as any;
  const sections = [...new Set(d.questions.map((q) => q.section))];
  const title = { daily: "Daily Review", weekly: "CEO Meeting with Yourself — Weekly Review", monthly: "Monthly Review", quarterly: "Quarterly Review", yearly: "Yearly Review" }[kind] ?? kind;
  return (
    <div>
      <p className="small muted"><Link to="/reviews">Review</Link></p>
      <div className="page-head">
        <div><h1>{title}</h1><p className="muted">{d.period.start}{d.period.end !== d.period.start ? ` 〜 ${d.period.end}` : ""} · template: {d.templateId} {review?.status === "completed" && <Badge tone="good">完了 {review.completedAt?.slice(0, 10)}</Badge>}</p></div>
        <div className="page-actions">
          <Link className="btn" to={`/reviews/${kind}?date=${stepFor(kind, d.period.start, -1)}`}>← 前</Link>
          <Link className="btn" to={`/reviews/${kind}?date=${stepFor(kind, d.period.start, 1)}`}>次 →</Link>
          {review && <a className="btn" href={`/api/reviews/${review.id}/export.md`}>Markdown</a>}
          <Button onClick={() => save.mutate(false)} disabled={save.isPending}>下書き保存</Button>
          <Button variant="primary" onClick={() => save.mutate(true)} disabled={save.isPending}>{review?.status === "completed" ? "更新して完了" : "完了"}</Button>
        </div>
      </div>
      {review?.status === "completed" && <div className="notice info">完了済みの Review です。データ欄は完了時点のスナップショットを表示しています。</div>}

      {/* THIS PERIOD — data */}
      <div className="grid">
        <Card title={kind === "weekly" ? "THIS WEEK · North Star Progress" : "North Star / Goals"}>
          {p.northStars?.length ? <ul className="list">{p.northStars.map((g: any) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">★ {g.title}</Link><div className="meta">{g.progress?.percent ?? "n/a"}% · {g.health?.reason}</div></div><HealthBadge health={g.health} /></li>)}</ul> : <p className="small muted">North Star 未設定</p>}
          {p.goals?.progressed?.length > 0 && <p className="small">進捗記録: {p.goals.progressed.map((x: any) => `${x.title}(${x.detail})`).join(", ")}</p>}
          {p.goals?.achievedOutcomes?.length > 0 && <p className="small">達成 Outcome: {p.goals.achievedOutcomes.map((x: any) => x.title).join(", ")}</p>}
          {p.big3?.weeks?.length > 0 && <p className="small">Big 3: {p.big3.done}/{p.big3.total} 完了 — {p.big3.weeks.flatMap((w: any) => w.items).map((i: any) => `${i.status === "done" ? "✓" : "・"}${i.title}`).join(" / ")}</p>}
          <p className="small muted">Action 完了 {p.actions?.doneCount ?? 0} 件（完了数は進捗の根拠にしません）</p>
        </Card>
        <Card title="Stalled Goals">
          {p.goals?.stalled?.length ? <ul className="list">{p.goals.stalled.map((g: any) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">{g.title}</Link><div className="meta">{g.reason}</div></div><HealthBadge health={{ health: g.health, reason: g.reason }} /></li>)}</ul> : <p className="small muted">停滞中の Goal はありません。</p>}
        </Card>
        <Card title="Decisions">
          <p className="small">記録 {p.decisions?.made?.length ?? 0} · レビュー {p.decisions?.reviewed?.length ?? 0} · 見直し期限 {p.decisions?.dueForReview?.length ?? 0}</p>
          <ul className="list">
            {p.decisions?.made?.map((x: any) => <li key={x.id}><div className="grow"><Link to={`/decisions/${x.id}`} className="title">⚖ {x.title}</Link><div className="meta">{x.decidedAt} · 確信度 {x.confidence}%</div></div></li>)}
            {p.decisions?.reviewed?.map((x: any) => <li key={x.id}><div className="grow"><Link to={`/decisions/${x.decisionId}`} className="title">↻ {x.title}</Link><div className="meta">{OUTCOME_LABEL[x.outcome]}{x.lessons ? ` · ${x.lessons}` : ""}</div></div></li>)}
            {p.decisions?.dueForReview?.map((x: any) => <li key={x.id}><div className="grow"><Link to={`/decisions/${x.id}`} className="title">⏰ {x.title}</Link><div className="meta">見直し予定 {x.reviewDate}</div></div></li>)}
          </ul>
        </Card>
        <Card title="Follow-ups / Promises">
          <p className="small">接点 {p.people?.contactCount ?? 0} · Follow-up 完了 {p.people?.followUpsDone ?? 0} · 期限超過 {p.people?.followUpsOverdue?.length ?? 0}</p>
          <ul className="list">
            {p.people?.promisesMineOpen?.map((x: any) => <li key={x.id}><div className="grow"><div className="title">自分の約束: {x.text}</div><div className="meta">{x.personName}{x.dueDate ? ` · ${x.dueDate}` : ""}</div></div></li>)}
            {p.people?.promisesTheirsOpen?.map((x: any) => <li key={x.id}><div className="grow"><div className="title">返事待ち: {x.text}</div><div className="meta">{x.personName}</div></div></li>)}
            {p.people?.importantNotContacted?.map((x: any) => <li key={x.id}><div className="grow"><Link to={`/people/${x.id}`} className="title">☺ {x.name}</Link><div className="meta">重要人物 · 最終接点 {x.lastContactAt ?? "なし"}</div></div></li>)}
          </ul>
        </Card>
        <Card title="Knowledge → Action">
          <p className="small">保存 {p.knowledge?.capturedCount ?? 0} · 行動に移した {p.knowledge?.applied?.length ?? 0}</p>
          <ul className="list">
            {p.knowledge?.applied?.map((x: any) => <li key={x.id}><div className="grow"><Link to={`/knowledge/${x.id}`} className="title">✓ {x.title}</Link><div className="meta">{x.note}</div></div></li>)}
            {p.knowledge?.toApply?.slice(0, 5).map((x: any) => <li key={x.id}><div className="grow"><Link to={`/knowledge/${x.id}`} className="title">→ {x.title}</Link><div className="meta">次: {x.nextAction}</div></div></li>)}
          </ul>
        </Card>
        <Card title="Open Loops / Waiting / Time">
          {p.openLoops?.length ? <ul className="list">{p.openLoops.map((x: any) => <li key={x.id}><div className="grow"><div className="title">{x.kind === "waiting" ? "⏳" : "◯"} {x.title}</div><div className="meta">{x.waitingOn}</div></div></li>)}</ul> : <p className="small muted">Open Loop なし</p>}
          {p.time && <p className="small muted">時間: {p.time.totalHours}h（Goal {p.time.byCategory.goal}h / Meeting {p.time.byCategory.meeting}h / Focus {p.time.byCategory.focus}h / 未分類 {p.time.byCategory.unclassified}h）— 生産性スコアは出しません。</p>}
          {p.antiGoals?.length > 0 && <p className="small">やらないこと: {p.antiGoals.map((a: any) => a.text).join(" / ")}</p>}
          {p.experiments?.length > 0 && <p className="small">Experiments: {p.experiments.map((e: any) => `${e.title}(${e.status})`).join(", ")}</p>}
          {p.metrics?.length > 0 && <p className="small">Metrics: {p.metrics.map((m: any) => `${m.name} ${m.value}${m.unit}`).join(" · ")}</p>}
        </Card>
        {kind === "monthly" && p.weeklyReviews && <Card title="今月の Weekly Review（Stop / Continue / Start）"><ul className="list">{p.weeklyReviews.map((w: any) => <li key={w.id}><div className="grow"><Link to={`/reviews/id/${w.id}`} className="title">週 {w.weekStart} ({w.status})</Link><div className="meta">Stop: {w.stop || "—"} / Continue: {w.continue || "—"} / Start: {w.start || "—"}</div></div></li>)}</ul></Card>}
        {(kind === "quarterly" || kind === "yearly") && p.monthlyBreakdown && (
          <Card title="月別集計" className="scroll-x">
            <table className="table"><thead><tr><th>月</th><th>Decision</th><th>Review</th><th>学び→行動</th><th>Action完了</th><th>Outcome</th><th>接点</th><th>Monthly Review</th></tr></thead>
              <tbody>{p.monthlyBreakdown.map((m: any) => <tr key={m.month}><td>{m.month}</td><td>{m.decisions}</td><td>{m.decisionReviews}</td><td>{m.knowledgeApplied}</td><td>{m.actionsDone}</td><td>{m.outcomesAchieved}</td><td>{m.contacts}</td><td>{m.monthlyReviewDone ? "✓" : "—"}</td></tr>)}</tbody></table>
            {p.periodGoals?.length > 0 && <ul className="list">{p.periodGoals.map((g: any) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">{g.isNorthStar ? "★ " : ""}{g.title}</Link><div className="meta">{g.status} · {g.progress?.percent ?? "n/a"}%</div></div><HealthBadge health={g.health} /></li>)}</ul>}
          </Card>
        )}
      </div>

      {/* Questions */}
      {sections.map((s) => (
        <Card key={s} title={s}>
          {d.questions.filter((q) => q.section === s).map((q) => (
            <Field key={q.id} label={q.text} hint={q.hint}><Textarea rows={2} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} /></Field>
          ))}
          {kind === "weekly" && s === "NEXT WEEK" && nextBig3.data && (
            <div>
              <h3>来週の Big 3（{nextWeek}〜）</h3>
              <ul className="list">{nextBig3.data.items.map((b) => <li key={b.id}><div className="grow">{b.rank}. {b.title}</div><Button size="sm" variant="ghost" onClick={() => dropBig3.mutate(b.id)}>外す</Button></li>)}</ul>
              {nextBig3.data.items.length < 3 && (
                <div className="inline-form"><Input placeholder="Big 3 に追加" value={big3Next[0]} onChange={(e) => setBig3Next([e.target.value, "", ""])} onKeyDown={(e) => { if (e.key === "Enter" && big3Next[0].trim()) { addBig3.mutate(big3Next[0].trim()); setBig3Next(["", "", ""]); } }} /><Button onClick={() => { if (big3Next[0].trim()) { addBig3.mutate(big3Next[0].trim()); setBig3Next(["", "", ""]); } }}>追加</Button></div>
              )}
              {nextBig3.data.carryOver.length > 0 && <p className="small muted">持ち越し候補: {nextBig3.data.carryOver.map((c) => <Button key={c.id} size="sm" variant="ghost" onClick={() => addBig3.mutate(c.title)}>{c.title}</Button>)}</p>}
            </div>
          )}
        </Card>
      ))}
      {kind === "daily" && (
        <Card title="Journal（任意・AI 対象外にできます）">
          <Textarea rows={3} value={answers.journal ?? ""} onChange={(e) => setAnswers({ ...answers, journal: e.target.value })} placeholder="自由記述" />
        </Card>
      )}
      <div className="row"><Button onClick={() => save.mutate(false)} disabled={save.isPending}>下書き保存</Button><Button variant="primary" onClick={() => save.mutate(true)} disabled={save.isPending}>完了</Button></div>
    </div>
  );
}
