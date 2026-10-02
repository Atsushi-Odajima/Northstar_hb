import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Button, Field, Input, Textarea, Select, Empty, Spinner, Badge, PageHeader, Modal } from "../components/ui";
import type { Principle, Experiment, Metric } from "@shared/types";
import { useInvalidate, errText, useMe } from "../lib/hooks";
import { useToast } from "../components/Toast";

export default function Principles() {
  const inv = useInvalidate();
  const { toast } = useToast();
  const me = useMe();
  const pr = useQuery({ queryKey: ["principles"], queryFn: () => api.get<{ principles: Principle[] }>("/principles") });
  const ex = useQuery({ queryKey: ["experiments"], queryFn: () => api.get<{ experiments: Experiment[] }>("/experiments") });
  const mt = useQuery({ queryKey: ["metrics"], queryFn: () => api.get<{ metrics: Metric[]; sources: string[] }>("/metrics") });
  const [pText, setPText] = useState(""); const [pKind, setPKind] = useState("principle"); const [pEnd, setPEnd] = useState("");
  const [exp, setExp] = useState<Partial<Experiment> | null>(null);
  const [mName, setMName] = useState(""); const [mSource, setMSource] = useState("manual"); const [mUnit, setMUnit] = useState("");
  const [entry, setEntry] = useState<{ metricId: string; value: string; date: string } | null>(null);
  const addP = useMutation({ mutationFn: () => api.post("/principles", { kind: pKind, text: pText, periodStart: pKind === "anti_goal" && pEnd ? todayStr() : null, periodEnd: pKind === "anti_goal" && pEnd ? pEnd : null }), onSuccess: () => { setPText(""); inv("principles", "today"); }, onError: (e) => toast(errText(e), "error") });
  const toggleP = useMutation({ mutationFn: (p: Principle) => api.patch(`/principles/${p.id}`, { active: !p.active }), onSuccess: () => inv("principles", "today") });
  const delP = useMutation({ mutationFn: (id: string) => api.delete(`/principles/${id}`), onSuccess: () => inv("principles") });
  const saveE = useMutation({ mutationFn: () => exp?.id ? api.patch(`/experiments/${exp.id}`, exp) : api.post("/experiments", exp), onSuccess: () => { setExp(null); inv("experiments"); }, onError: (e) => toast(errText(e), "error") });
  const addM = useMutation({ mutationFn: () => api.post("/metrics", { name: mName, source: mSource, unit: mUnit }), onSuccess: () => { setMName(""); inv("metrics"); }, onError: (e) => toast(errText(e), "error") });
  const delM = useMutation({ mutationFn: (id: string) => api.delete(`/metrics/${id}`), onSuccess: () => inv("metrics") });
  const addEntry = useMutation({ mutationFn: () => api.post(`/metrics/${entry!.metricId}/entries`, { date: entry!.date, value: Number(entry!.value) }), onSuccess: () => { setEntry(null); toast("記録しました", "success"); }, onError: (e) => toast(errText(e), "error") });
  const selected = me.data?.workspace.settings.selectedMetricIds ?? [];
  const toggleSel = useMutation({ mutationFn: (id: string) => api.patch("/settings", { selectedMetricIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] }), onSuccess: () => inv("me") });
  return (
    <div>
      <PageHeader title="Principles / Anti-goals / Experiments / Metrics" subtitle="自分の運用ルール。AI は矛盾候補を示せますが強制しません。Experiment は自己観察であり、科学的な因果を保証しません。" />
      <div className="grid-2">
        <Card title="Operating Principles / Anti-goals（やらないこと）">
          {pr.isLoading ? <Spinner /> : <ul className="list">{pr.data!.principles.map((p) => <li key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}><div className="grow"><div className="title">{p.kind === "anti_goal" ? "✗ " : "§ "}{p.text}</div><div className="meta">{p.kind === "anti_goal" ? "Anti-goal" : "Principle"}{p.periodEnd ? ` · 〜${p.periodEnd}` : ""}{!p.active && " · inactive"}</div></div><Button size="sm" variant="ghost" onClick={() => toggleP.mutate(p)}>{p.active ? "停止" : "再開"}</Button><Button size="sm" variant="ghost" onClick={() => delP.mutate(p.id)}>削除</Button></li>)}</ul>}
          <div className="row" style={{ marginTop: 8 }}><Select value={pKind} onChange={(e) => setPKind(e.target.value)} style={{ width: 140 }}><option value="principle">Principle</option><option value="anti_goal">Anti-goal</option></Select><Input placeholder={pKind === "anti_goal" ? "例: 今Quarterは新SNSを始めない" : "例: 新規Projectは同時3件まで"} value={pText} onChange={(e) => setPText(e.target.value)} style={{ flex: 1 }} />{pKind === "anti_goal" && <Input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} style={{ width: 160 }} />}<Button variant="primary" onClick={() => addP.mutate()} disabled={!pText.trim()}>追加</Button></div>
        </Card>
        <Card title="Experiments（自己実験）" action={<Button size="sm" onClick={() => setExp({ title: "", hypothesis: "", action: "", periodStart: todayStr(), periodEnd: null, successSignal: "", status: "planned", result: "", lesson: "" })}>＋ Experiment</Button>}>
          {ex.isLoading ? <Spinner /> : ex.data!.experiments.length === 0 ? <Empty>例: 「朝90分 Focus」— 仮説・行動・期間・成功シグナル・結果・学び。</Empty> : <ul className="list">{ex.data!.experiments.map((e) => <li key={e.id}><div className="grow"><div className="title">{e.title} <Badge tone={e.status === "running" ? "accent" : e.status === "completed" ? "good" : "neutral"}>{e.status}</Badge></div><div className="meta">仮説: {e.hypothesis} · {e.periodStart ?? ""}〜{e.periodEnd ?? ""} · シグナル: {e.successSignal}</div>{(e.result || e.lesson) && <div className="meta">結果: {e.result} / 学び: {e.lesson}</div>}</div><Button size="sm" variant="ghost" onClick={() => setExp(e)}>編集</Button></li>)}</ul>}
        </Card>
      </div>
      <Card title="Personal Metrics（自分で選んだ指標だけ。人生スコアは作りません）">
        {mt.isLoading ? <Spinner /> : <ul className="list">{mt.data!.metrics.map((m) => <li key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggleSel.mutate(m.id)} aria-label="Review に表示" style={{ marginTop: 6 }} /><div className="grow"><div className="title">{m.name} <span className="small muted">{m.unit}</span></div><div className="meta">source: {m.source}{selected.includes(m.id) && " · Review に表示"}</div></div>{m.source === "manual" && <Button size="sm" onClick={() => setEntry({ metricId: m.id, value: "", date: todayStr() })}>値を記録</Button>}<Button size="sm" variant="ghost" onClick={() => delM.mutate(m.id)}>削除</Button></li>)}</ul>}
        <div className="row" style={{ marginTop: 8 }}><Input placeholder="指標名（例: 深い作業時間）" value={mName} onChange={(e) => setMName(e.target.value)} style={{ flex: 1 }} /><Input placeholder="単位" value={mUnit} onChange={(e) => setMUnit(e.target.value)} style={{ width: 90 }} /><Select value={mSource} onChange={(e) => setMSource(e.target.value)} style={{ width: 200 }}>{(mt.data?.sources ?? ["manual"]).map((s) => <option key={s} value={s}>{s}</option>)}</Select><Button variant="primary" onClick={() => addM.mutate()} disabled={!mName.trim()}>追加</Button></div>
      </Card>
      <Modal open={!!exp} onClose={() => setExp(null)} title={exp?.id ? "Experiment を編集" : "Experiment を追加"} wide>
        {exp && <div>
          <Field label="タイトル"><Input value={exp.title ?? ""} onChange={(e) => setExp({ ...exp, title: e.target.value })} /></Field>
          <Field label="仮説"><Textarea rows={2} value={exp.hypothesis ?? ""} onChange={(e) => setExp({ ...exp, hypothesis: e.target.value })} /></Field>
          <Field label="行動"><Input value={exp.action ?? ""} onChange={(e) => setExp({ ...exp, action: e.target.value })} /></Field>
          <div className="grid-2"><Field label="開始"><Input type="date" value={exp.periodStart ?? ""} onChange={(e) => setExp({ ...exp, periodStart: e.target.value || null })} /></Field><Field label="終了"><Input type="date" value={exp.periodEnd ?? ""} onChange={(e) => setExp({ ...exp, periodEnd: e.target.value || null })} /></Field></div>
          <Field label="成功シグナル"><Input value={exp.successSignal ?? ""} onChange={(e) => setExp({ ...exp, successSignal: e.target.value })} /></Field>
          <Field label="状態"><Select value={exp.status} onChange={(e) => setExp({ ...exp, status: e.target.value as Experiment["status"] })}>{["planned", "running", "completed", "abandoned"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="結果"><Textarea rows={2} value={exp.result ?? ""} onChange={(e) => setExp({ ...exp, result: e.target.value })} /></Field>
          <Field label="学び"><Textarea rows={2} value={exp.lesson ?? ""} onChange={(e) => setExp({ ...exp, lesson: e.target.value })} /></Field>
          <div className="row"><Button variant="primary" onClick={() => saveE.mutate()} disabled={!exp.title?.trim()}>保存</Button><Button variant="ghost" onClick={() => setExp(null)}>キャンセル</Button></div>
        </div>}
      </Modal>
      <Modal open={!!entry} onClose={() => setEntry(null)} title="値を記録">
        {entry && <div><div className="grid-2"><Field label="日付"><Input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></Field><Field label="値"><Input type="number" value={entry.value} onChange={(e) => setEntry({ ...entry, value: e.target.value })} /></Field></div><Button variant="primary" onClick={() => addEntry.mutate()} disabled={entry.value === ""}>記録</Button></div>}
      </Modal>
    </div>
  );
}
