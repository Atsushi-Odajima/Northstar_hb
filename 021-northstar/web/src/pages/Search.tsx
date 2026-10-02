import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Card, Input, Button, Empty, Spinner, Badge, PageHeader, EntityLink } from "../components/ui";
import { useQueryParam, errText } from "../lib/hooks";

const TYPES = ["goal", "project", "action", "decision", "review", "person", "contact", "knowledge", "capture", "principle", "experiment"];

export default function Search() {
  const initial = useQueryParam("q") ?? "";
  const [q, setQ] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const [types, setTypes] = useState<string[]>([]);
  const [semantic, setSemantic] = useState(false);
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<{ enabled: boolean; ready: boolean; features: Record<string, boolean>; embedding: unknown }>("/ai/status") });
  const canSemantic = !!ai.data?.enabled && ai.data.ready && ai.data.features.semantic_search && !!ai.data.embedding;
  const res = useQuery({ queryKey: ["search", submitted, types.join(","), semantic], enabled: !!submitted, queryFn: () => api.get<any>(`${semantic ? "/search/semantic" : "/search"}?q=${encodeURIComponent(submitted)}${types.length ? `&types=${types.join(",")}` : ""}&limit=50`) });
  return (
    <div>
      <PageHeader title="Search" subtitle="Goals / Decisions / People / Contacts / Knowledge / Reviews / Projects を横断して全文検索。" />
      <Card>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}><Input aria-label="検索語" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例: ProofFlow / 先行販売 / MCP" autoFocus /><Button type="submit" variant="primary">検索</Button></form>
        <div className="row" style={{ marginTop: 8 }}>{TYPES.map((t) => <button key={t} type="button" className={`btn btn-sm${types.includes(t) ? " btn-primary" : ""}`} onClick={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}>{t}</button>)}
          {canSemantic && <label className="row small" style={{ marginLeft: "auto" }}><input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} /> Semantic（AI）</label>}
        </div>
      </Card>
      {res.isLoading && <Spinner />}
      {res.isError && <Empty>{errText(res.error)}</Empty>}
      {res.data && (
        <Card title={`${res.data.hits.length} 件${res.data.mode === "semantic" ? ` · semantic (${res.data.embedding})` : ""}`}>
          {res.data.hits.length === 0 ? <Empty>該当なし</Empty> : <ul className="list">{res.data.hits.map((h: any) => <li key={`${h.type}:${h.id}`}><div className="grow"><EntityLink type={h.type} id={h.id}>{h.title}</EntityLink> <Badge>{h.type}</Badge>{h.date && <span className="small muted"> {h.date}</span>}<div className="meta" dangerouslySetInnerHTML={{ __html: escapeHtml(h.snippet).replace(/\[/g, "<mark>").replace(/\]/g, "</mark>") }} />{typeof h.score === "number" && res.data.mode === "semantic" && <div className="meta">similarity {h.score.toFixed(2)}</div>}</div></li>)}</ul>}
          {res.data.fulltextHits?.length > 0 && <details className="section"><summary>全文一致 ({res.data.fulltextHits.length})</summary><ul className="list">{res.data.fulltextHits.map((h: any) => <li key={`${h.type}:${h.id}`}><div className="grow"><EntityLink type={h.type} id={h.id}>{h.title}</EntityLink> <Badge>{h.type}</Badge></div></li>)}</ul></details>}
        </Card>
      )}
    </div>
  );
}
function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
