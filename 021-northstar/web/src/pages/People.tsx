import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, todayStr, fmtDate } from "../api/client";
import { Card, Button, Modal, Field, Input, Textarea, Select, Empty, Spinner, Badge, PageHeader } from "../components/ui";
import type { Person } from "@shared/types";
import { useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

export const REL_LABEL: Record<string, string> = { client: "顧客", partner: "パートナー", mentor: "メンター", peer: "同業/仲間", friend: "友人", investor: "投資家", vendor: "外注/業者", team: "チーム", community: "コミュニティ", other: "その他" };

export function PersonForm({ initial, onSaved, onClose }: { initial?: Partial<Person>; onSaved: (p: Person) => void; onClose: () => void }) {
  const [f, setF] = useState<Partial<Person>>({ name: "", organization: "", role: "", relationshipType: "other", importance: 3, tags: [], howMet: "", notes: "", nextFollowUpAt: null, ...initial });
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => { const body = { ...f, tags: tags.split(/[,、]/).map((s) => s.trim()).filter(Boolean) }; return initial?.id ? api.patch<{ person: Person }>(`/people/${initial.id}`, { ...body, version: initial.version }) : api.post<{ person: Person; possibleDuplicates: Person[] }>("/people", body); },
    onSuccess: (r: any) => { if (r.possibleDuplicates?.length) toast(`同じ名前の人物が既にあります（${r.possibleDuplicates.map((p: Person) => p.name).join(", ")}）。自動統合はしません。`); onSaved(r.person); },
    onError: (e) => toast(errText(e), "error"),
  });
  return (
    <div>
      <Field label="名前"><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <div className="grid-2">
        <Field label="組織"><Input value={f.organization ?? ""} onChange={(e) => setF({ ...f, organization: e.target.value })} /></Field>
        <Field label="役割"><Input value={f.role ?? ""} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>
        <Field label="関係"><Select value={f.relationshipType} onChange={(e) => setF({ ...f, relationshipType: e.target.value as Person["relationshipType"] })}>{Object.entries(REL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="重要度 (1=最重要)"><Select value={f.importance} onChange={(e) => setF({ ...f, importance: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
      </div>
      <Field label="タグ（カンマ区切り）"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
      <Field label="出会ったきっかけ"><Input value={f.howMet ?? ""} onChange={(e) => setF({ ...f, howMet: e.target.value })} /></Field>
      <Field label="メモ"><Textarea rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <Field label="次の Follow-up 予定"><Input type="date" value={f.nextFollowUpAt ?? ""} onChange={(e) => setF({ ...f, nextFollowUpAt: e.target.value || null })} /></Field>
      <div className="row"><Button variant="primary" onClick={() => save.mutate()} disabled={!f.name?.trim() || save.isPending}>保存</Button><Button variant="ghost" onClick={onClose}>キャンセル</Button></div>
    </div>
  );
}

export default function People() {
  const [q, setQ] = useState("");
  const [imp, setImp] = useState("");
  const list = useQuery({ queryKey: ["people", q, imp], queryFn: () => api.get<{ people: Person[] }>(`/people?limit=500${q ? `&q=${encodeURIComponent(q)}` : ""}${imp ? `&importance=${imp}` : ""}`) });
  const follow = useQuery({ queryKey: ["follow-ups-due"], queryFn: () => api.get<{ followUps: { id: string; personId: string; personName: string; dueDate: string; reason: string }[] }>("/follow-ups?status=open&due=now") });
  const promises = useQuery({ queryKey: ["promises-open"], queryFn: () => api.get<{ promises: { id: string; personName: string; personId: string; direction: string; text: string; dueDate: string | null }[] }>("/promises?status=open") });
  const inv = useInvalidate();
  const [creating, setCreating] = useState(false);
  const today = todayStr();
  const daysSince = (d: string | null) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000) : null);
  return (
    <div>
      <PageHeader title="People" subtitle="人脈は「会って終わり」にしない。接点・約束・Follow-up を次の行動につなげます。" action={<Button variant="primary" onClick={() => setCreating(true)}>＋ Person</Button>} />
      <div className="grid-2">
        <Card title="Follow-up（期限）">
          {follow.data?.followUps.length ? <ul className="list">{follow.data.followUps.map((f) => <li key={f.id}><div className="grow"><Link to={`/people/${f.personId}`} className="title">{f.personName}</Link><div className="meta">{f.reason} · {f.dueDate}</div></div></li>)}</ul> : <p className="small muted">期限の来た Follow-up はありません。</p>}
        </Card>
        <Card title="Promise Tracker">
          {promises.data?.promises.length ? <ul className="list">{promises.data.promises.slice(0, 8).map((p) => <li key={p.id}><div className="grow"><div className="title">{p.direction === "mine" ? "自分の約束" : "返事待ち"}: {p.text}</div><div className="meta"><Link to={`/people/${p.personId}`}>{p.personName}</Link>{p.dueDate ? ` · ${p.dueDate}` : ""}</div></div><Badge tone={p.direction === "mine" ? "warn" : "neutral"}>{p.direction === "mine" ? "mine" : "theirs"}</Badge></li>)}</ul> : <p className="small muted">未完了の約束はありません。</p>}
        </Card>
      </div>
      <Card>
        <div className="row" style={{ marginBottom: 10 }}><Input placeholder="名前・組織で検索" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} /><Select aria-label="重要度で絞り込み" value={imp} onChange={(e) => setImp(e.target.value)} style={{ width: 160 }}><option value="">重要度すべて</option><option value="1">1 のみ</option><option value="2">1〜2</option><option value="3">1〜3</option></Select></div>
        {list.isLoading ? <Spinner /> : list.data!.people.length === 0 ? <Empty>人物がいません。</Empty> : (
          <ul className="list">{list.data!.people.map((p) => { const ds = daysSince(p.lastContactAt); return (
            <li key={p.id}><div className="grow"><Link to={`/people/${p.id}`} className="title">{p.name}</Link> <span className="small muted">{p.organization}{p.role ? ` · ${p.role}` : ""}</span><div className="meta row"><Badge tone={p.importance <= 2 ? "accent" : "neutral"}>重要度 {p.importance}</Badge><span>{REL_LABEL[p.relationshipType]}</span><span>最終接点 {fmtDate(p.lastContactAt)}{ds !== null ? `（${ds}日前）` : ""}</span>{p.nextFollowUpAt && <span>次 {p.nextFollowUpAt}</span>}{p.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div></div>{p.importance <= 2 && (ds === null || ds > 30) && <Badge tone="warn">30日以上接点なし</Badge>}</li>
          ); })}</ul>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Person を追加"><PersonForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); inv("people", "people-list"); }} /></Modal>
    </div>
  );
}
