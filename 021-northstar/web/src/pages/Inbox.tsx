import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";
import { Card, Button, Select, Modal, Field, Input, Empty, Spinner, Badge, PageHeader } from "../components/ui";
import type { Capture } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

const TYPE_LABEL: Record<string, string> = { idea: "Idea", task: "Task", decision: "Decision", person_note: "Person Note", knowledge: "Knowledge", question: "Question", journal: "Journal", goal: "Goal" };

export default function Inbox() {
  const q = useQuery({ queryKey: ["captures"], queryFn: () => api.get<{ captures: Capture[] }>("/captures") });
  const goals = useQuery({ queryKey: ["goals-active"], queryFn: () => api.get<{ goals: { id: string; title: string; level: string }[] }>("/goals?status=active,draft") });
  const people = useQuery({ queryKey: ["people-list"], queryFn: () => api.get<{ people: { id: string; name: string }[] }>("/people?limit=500") });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<{ enabled: boolean; ready: boolean; features: Record<string, boolean> }>("/ai/status") });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ notifications: { id: string; title: string; body: string; link: string; readAt: string | null; scheduledFor: string }[]; unread: number }>("/notifications?limit=30") });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [target, setTarget] = useState<Capture | null>(null);
  const [type, setType] = useState("task");
  const [payload, setPayload] = useState<Record<string, string>>({});
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown }) => api.patch(`/captures/${id}`, body), onSuccess: () => inv("captures"), onError: (e) => toast(errText(e), "error") });
  const process = useMutation({
    mutationFn: ({ id, type, payload }: { id: string; type: string; payload: Record<string, unknown> }) => api.post<{ createdType: string; createdId: string }>(`/captures/${id}/process`, { type, payload }),
    onSuccess: () => { setTarget(null); inv("captures", "today", "actions", "goals-active"); toast(`${TYPE_LABEL[type]} として保存しました`, "success"); },
    onError: (e) => toast(errText(e), "error"),
  });
  const classify = useMutation({ mutationFn: (id: string) => api.post<{ type: string; reason: string }>(`/ai/captures/${id}/classify`), onSuccess: (r, id) => { toast(`AI 候補: ${TYPE_LABEL[r.type]}（${r.reason}）`); update.mutate({ id, body: { type: r.type } }); }, onError: (e) => toast(errText(e), "error") });
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: () => inv("notifications", "notifications-badge") });
  const open = (c: Capture) => { setTarget(c); setType(c.type ?? c.suggestedType ?? "idea"); setPayload({ title: c.rawText.split("\n")[0].slice(0, 120), dueDate: "", goalId: "", personId: "", level: "month" }); };
  const submit = () => {
    if (!target) return;
    const p: Record<string, unknown> = {};
    if (payload.title) p.title = payload.title;
    if (type === "task" || type === "question") { if (payload.dueDate) p.dueDate = payload.dueDate; if (payload.goalId) p.goalId = payload.goalId; }
    if (type === "knowledge" || type === "idea" || type === "decision") { if (payload.goalId) p.goalIds = [payload.goalId]; }
    if (type === "person_note") { if (payload.personId) p.personId = payload.personId; else p.name = payload.title; }
    if (type === "goal") { p.level = payload.level; }
    process.mutate({ id: target.id, type, payload: p });
  };
  return (
    <div>
      <PageHeader title="Inbox" subtitle="Quick Capture を見直して、Goal / Action / Decision / Knowledge / People につなげます。" action={<Link to="/capture" className="btn btn-primary">＋ Capture</Link>} />
      {notifications.data && notifications.data.notifications.length > 0 && (
        <Card title={`通知 ${notifications.data.unread ? `(${notifications.data.unread} 未読)` : ""}`} action={notifications.data.unread > 0 && <Button size="sm" onClick={() => readAll.mutate()}>すべて既読</Button>}>
          <ul className="list">{notifications.data.notifications.slice(0, 8).map((n) => <li key={n.id} style={{ opacity: n.readAt ? 0.6 : 1 }}><div className="grow"><Link to={n.link || "/today"} className="title">{n.title}</Link><div className="meta">{n.body}</div></div></li>)}</ul>
        </Card>
      )}
      {q.isLoading ? <Spinner /> : q.data!.captures.length === 0 ? <Empty>Inbox は空です。</Empty> : (
        <Card>
          <ul className="list">{q.data!.captures.map((c) => (
            <li key={c.id}>
              <div className="grow">
                <div className="title" style={{ whiteSpace: "pre-wrap" }}>{c.rawText}</div>
                <div className="meta row">{new Date(c.createdAt).toLocaleString("ja-JP")} · {c.source}{c.suggestedType && !c.type && <Badge tone="accent">候補: {TYPE_LABEL[c.suggestedType]}</Badge>}{c.type && <Badge>{TYPE_LABEL[c.type]}</Badge>}</div>
              </div>
              <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <Button size="sm" variant="primary" onClick={() => open(c)}>処理</Button>
                {ai.data?.enabled && ai.data.ready && ai.data.features.capture_classify && <Button size="sm" onClick={() => classify.mutate(c.id)}>AI分類</Button>}
                <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, body: { status: "dismissed" } })}>破棄</Button>
              </div>
            </li>
          ))}</ul>
        </Card>
      )}
      <Modal open={!!target} onClose={() => setTarget(null)} title="Capture を処理">
        {target && (
          <div>
            <p className="muted small" style={{ whiteSpace: "pre-wrap" }}>{target.rawText}</p>
            <Field label="種類"><Select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label={type === "person_note" ? "人物名（新規の場合）" : "タイトル"}><Input value={payload.title} onChange={(e) => setPayload({ ...payload, title: e.target.value })} /></Field>
            {type === "person_note" && <Field label="既存の人物"><Select value={payload.personId} onChange={(e) => setPayload({ ...payload, personId: e.target.value })}><option value="">（新規作成）</option>{people.data?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
            {(type === "task" || type === "question") && <Field label="期限"><Input type="date" value={payload.dueDate} onChange={(e) => setPayload({ ...payload, dueDate: e.target.value })} /></Field>}
            {type === "goal" && <Field label="レベル"><Select value={payload.level} onChange={(e) => setPayload({ ...payload, level: e.target.value })}>{["year", "quarter", "month", "week"].map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>}
            {["task", "question", "knowledge", "idea", "decision"].includes(type) && <Field label="関連 Goal"><Select value={payload.goalId} onChange={(e) => setPayload({ ...payload, goalId: e.target.value })}><option value="">（なし）</option>{goals.data?.goals.map((g) => <option key={g.id} value={g.id}>[{g.level}] {g.title}</option>)}</Select></Field>}
            {type === "journal" && <p className="small muted">今日の Daily Review の Journal 欄に追記します。</p>}
            <div className="row"><Button variant="primary" onClick={submit} disabled={process.isPending}>保存</Button><Button variant="ghost" onClick={() => setTarget(null)}>キャンセル</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
