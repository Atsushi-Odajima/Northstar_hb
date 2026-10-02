import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { Card, Button, Modal, Field, Input, Textarea, Select, Empty, Spinner, HealthBadge, Badge, PageHeader, ProgressBar, LEVEL_LABEL, STATUS_LABEL } from "../components/ui";
import type { Goal } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

type Node = Goal & { progress: { percent: number | null }; health: { health: string; reason: string }; children: Node[] };

export function GoalForm({ initial, onSaved, onClose, parentOptions }: { initial?: Partial<Goal>; onSaved: () => void; onClose: () => void; parentOptions: { id: string; title: string; level: string }[] }) {
  const [f, setF] = useState<Partial<Goal>>({ title: "", description: "", level: "month", parentId: null, startDate: null, endDate: null, status: "active", priority: 3, successDefinition: "", why: "", progressMode: "manual", progressManual: 0, isNorthStar: false, ...initial });
  const { toast } = useToast();
  const set = (k: keyof Goal, v: unknown) => setF({ ...f, [k]: v });
  const save = useMutation({
    mutationFn: () => initial?.id ? api.patch(`/goals/${initial.id}`, { ...f, version: initial.version }) : api.post<{ goal: Goal; warnings: string[] }>("/goals", f),
    onSuccess: (r: any) => { if (r?.warnings?.length) toast(r.warnings.join(" / ")); onSaved(); },
    onError: (e) => toast(errText(e), "error"),
  });
  return (
    <div>
      <Field label="タイトル"><Input value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} autoFocus /></Field>
      <div className="grid-2">
        <Field label="レベル"><Select value={f.level} onChange={(e) => set("level", e.target.value)}>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="親 Goal"><Select value={f.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)}><option value="">（なし）</option>{parentOptions.filter((p) => p.id !== initial?.id).map((p) => <option key={p.id} value={p.id}>[{LEVEL_LABEL[p.level]}] {p.title}</option>)}</Select></Field>
        <Field label="開始"><Input type="date" value={f.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} /></Field>
        <Field label="終了"><Input type="date" value={f.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} /></Field>
        <Field label="状態"><Select value={f.status} onChange={(e) => set("status", e.target.value)}>{["draft", "active", "paused", "achieved", "dropped", "archived"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
        <Field label="優先度 (1=高)"><Select value={f.priority} onChange={(e) => set("priority", Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        <Field label="進捗の測り方" hint="タスク完了数では測りません"><Select value={f.progressMode} onChange={(e) => set("progressMode", e.target.value)}><option value="manual">Manual（自分で%）</option><option value="milestone">Milestone（Outcome 達成率）</option><option value="binary">Binary（達成/未達）</option><option value="linked_outcomes">Linked Outcomes（全 Outcome 達成で100）</option></Select></Field>
        <Field label="North Star"><Select value={f.isNorthStar ? "1" : "0"} onChange={(e) => set("isNorthStar", e.target.value === "1")}><option value="0">いいえ</option><option value="1">★ 最重要 Goal にする</option></Select></Field>
      </div>
      <Field label="成功の定義（何が起きれば達成？）"><Textarea value={f.successDefinition ?? ""} onChange={(e) => set("successDefinition", e.target.value)} rows={2} /></Field>
      <Field label="Why（なぜ重要か）"><Textarea value={f.why ?? ""} onChange={(e) => set("why", e.target.value)} rows={2} /></Field>
      <Field label="メモ"><Textarea value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} /></Field>
      <div className="row"><Button variant="primary" onClick={() => save.mutate()} disabled={!f.title?.trim() || save.isPending}>保存</Button><Button variant="ghost" onClick={onClose}>キャンセル</Button></div>
    </div>
  );
}

function TreeNode({ n }: { n: Node }) {
  return (
    <li>
      <div className="goal-row">
        <span className="lvl">{LEVEL_LABEL[n.level]}</span>
        <div className="grow" style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/goals/${n.id}`} className="title">{n.isNorthStar ? "★ " : ""}{n.title}</Link>
          <div className="row small muted"><Badge>{STATUS_LABEL[n.status]}</Badge><HealthBadge health={n.health} />{n.progress.percent !== null && <span>{n.progress.percent}%</span>}{n.endDate && <span>〜{n.endDate}</span>}</div>
        </div>
        <div style={{ width: 90 }} className="hide-mobile"><ProgressBar percent={n.progress.percent} /></div>
      </div>
      {n.children.length > 0 && <ul>{n.children.map((c) => <TreeNode key={c.id} n={c} />)}</ul>}
    </li>
  );
}

export default function Goals() {
  const [showAll, setShowAll] = useState(false);
  const tree = useQuery({ queryKey: ["goals-tree", showAll], queryFn: () => api.get<{ tree: Node[]; warning: string | null }>(`/goals/tree${showAll ? "?all=1" : ""}`) });
  const ns = useQuery({ queryKey: ["northstar"], queryFn: () => api.get<{ northStars: Node[]; warning: string | null; max: number }>("/northstar") });
  const all = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string; level: string }[] }>("/goals?status=active,draft,paused") });
  const inv = useInvalidate();
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader title="Goals" subtitle="Vision → Year → Quarter → Month → Week。Goal と Outcome と Task を分けて考えます。" action={<><Button onClick={() => setShowAll(!showAll)}>{showAll ? "Active のみ" : "Archive も表示"}</Button><Button variant="primary" onClick={() => setCreating(true)}>＋ Goal</Button></>} />
      {(ns.data?.warning || tree.data?.warning) && <div className="notice">{ns.data?.warning ?? tree.data?.warning}</div>}
      <Card title={`North Star（最重要 Goal ${ns.data?.northStars.length ?? 0}/${ns.data?.max ?? 3}）`}>
        {ns.isLoading ? <Spinner /> : ns.data!.northStars.length === 0 ? <Empty>Quarter / Month の最重要 Goal を 1〜3 件だけ ★ にしましょう。</Empty> : (
          <ul className="list">{ns.data!.northStars.map((g) => <li key={g.id}><div className="grow"><Link to={`/goals/${g.id}`} className="title">★ {g.title}</Link><div className="meta">{LEVEL_LABEL[g.level]} · {g.health.reason}</div><ProgressBar percent={g.progress.percent} /></div><HealthBadge health={g.health} /></li>)}</ul>
        )}
      </Card>
      <Card title="Goal Hierarchy">
        {tree.isLoading ? <Spinner /> : tree.data!.tree.length === 0 ? <Empty>まだ Goal がありません。Vision か Year Goal から始めましょう。<div style={{ marginTop: 8 }}><Button variant="primary" onClick={() => setCreating(true)}>最初の Goal を作る</Button></div></Empty> : <div className="tree"><ul>{tree.data!.tree.map((n) => <TreeNode key={n.id} n={n} />)}</ul></div>}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Goal を追加" wide>
        <GoalForm parentOptions={all.data?.goals ?? []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); inv("goals-tree", "northstar", "goals-active", "today"); }} />
      </Modal>
    </div>
  );
}
