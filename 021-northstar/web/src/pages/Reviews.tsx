import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Empty, Spinner, Badge, PageHeader } from "../components/ui";
import type { Review } from "@shared/types";

const KINDS: { kind: string; label: string; sub: string; time: string }[] = [
  { kind: "daily", label: "Daily Review", sub: "進んだこと・止まったこと・明日の最重要", time: "30秒〜3分" },
  { kind: "weekly", label: "Weekly Review — CEO Meeting with Yourself", sub: "THIS WEEK: North Star / Decisions / Follow-ups / Knowledge Applied / Stalled / Open Loops → NEXT WEEK: Stop / Continue / Start / Big 3", time: "20〜40分" },
  { kind: "monthly", label: "Monthly Review", sub: "Goal・Decision outcomes・People・Learning・Projects・Wins/Misses・Time・Next Focus", time: "30〜60分" },
  { kind: "quarterly", label: "Quarterly Review", sub: "Quarter Goal の結果、続ける/やめる/新Goal、Decision lessons、次の North Star", time: "1〜2時間" },
  { kind: "yearly", label: "Yearly Review", sub: "本当に前進したこと、繰り返すテーマ、来年の Vision", time: "任意" },
];

export default function Reviews() {
  const recent = useQuery({ queryKey: ["reviews-recent"], queryFn: () => api.get<{ reviews: Review[] }>("/reviews?limit=40") });
  const current = useQuery({ queryKey: ["reviews-current-all"], queryFn: async () => Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k.kind, await api.get<{ review: Review | null; period: { start: string; end: string } }>(`/reviews/current?kind=${k.kind}&date=${todayStr()}`)]))) as Record<string, { review: Review | null; period: { start: string; end: string } }> });
  return (
    <div>
      <PageHeader title="Review" subtitle="全部やる必要はありません。続けられる最小の振り返りから。Review は期間内の記録だけを使います。" />
      <div className="grid">
        {KINDS.map((k) => {
          const cur = current.data?.[k.kind];
          const status = cur?.review?.status;
          return (
            <Card key={k.kind} title={k.label} action={<Badge tone={status === "completed" ? "good" : status === "draft" ? "warn" : "neutral"}>{status === "completed" ? "完了" : status === "draft" ? "下書き" : "未着手"}</Badge>}>
              <p className="small muted">{k.sub}</p>
              <p className="small faint">目安 {k.time}{cur && ` · 今期間 ${cur.period.start}${cur.period.end !== cur.period.start ? `〜${cur.period.end}` : ""}`}</p>
              <Link to={`/reviews/${k.kind}`} className="btn btn-primary">{status === "completed" ? "開く" : status === "draft" ? "続きから" : "はじめる"}</Link>
            </Card>
          );
        })}
      </div>
      <Card title="最近の Review" action={<Link to="/settings#profile" className="btn btn-sm">質問テンプレート変更</Link>}>
        {recent.isLoading ? <Spinner /> : recent.data!.reviews.length === 0 ? <Empty>まだ Review がありません。</Empty> : (
          <ul className="list">{recent.data!.reviews.map((r) => <li key={r.id}><div className="grow"><Link to={`/reviews/id/${r.id}`} className="title">{r.kind} · {r.periodStart}{r.periodEnd !== r.periodStart ? `〜${r.periodEnd}` : ""}</Link><div className="meta">template: {r.templateId} · {r.status}{r.completedAt ? ` · ${r.completedAt.slice(0, 10)}` : ""}</div></div></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
