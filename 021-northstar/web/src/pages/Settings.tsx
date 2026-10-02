import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { Card, Button, Field, Input, Select, Textarea, Empty, Spinner, Badge, PageHeader, Tabs } from "../components/ui";
import type { WorkspaceSettings, AiFeature, AiCategory } from "@shared/types";
import { AI_FEATURES, AI_SENSITIVE_CATEGORIES } from "@shared/types";
import { useMe, useInvalidate, errText } from "../lib/hooks";
import { useToast } from "../components/Toast";

const FEATURE_LABEL: Record<AiFeature, string> = { chief_of_staff: "AI Chief of Staff（質問応答）", knowledge_draft: "Knowledge の要約/Goal/Action 下書き", capture_classify: "Capture の分類候補", semantic_search: "Semantic Search（embedding）", decision_patterns: "判断パターン候補（根拠 Decision 付き）", chat_import_extract: "Chat export からの候補抽出" };
const CATEGORY_LABEL: Record<AiCategory, string> = { journal: "Journal / 未分類 Capture", people: "People（人物・接点・約束・Follow-up）", decisions: "Decisions", reviews: "Reviews", knowledge: "Knowledge", goals: "Goals / Projects / Actions" };

export default function Settings() {
  const me = useMe();
  const inv = useInvalidate();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useToast();
  const [tab, setTab] = useState(() => location.hash.replace("#", "") || "profile");
  const s = me.data?.workspace.settings;
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch("/settings", body), onSuccess: () => { inv("me", "ai-status"); toast("保存しました", "success"); }, onError: (e) => toast(errText(e), "error") });
  if (!s) return <Spinner />;
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={(t) => { setTab(t); history.replaceState(null, "", `#${t}`); }} tabs={[{ id: "profile", label: "Profile" }, { id: "ai", label: "AI & Privacy" }, { id: "notifications", label: "通知" }, { id: "connectors", label: "Connectors" }, { id: "mcp", label: "Plugin / MCP" }, { id: "import", label: "Import" }, { id: "export", label: "Export / Backup" }, { id: "account", label: "Account" }]} />
      {tab === "profile" && <ProfileTab s={s} name={me.data!.workspace.name} save={(b) => save.mutate(b)} />}
      {tab === "ai" && <AiTab s={s} save={(b) => save.mutate(b)} />}
      {tab === "notifications" && <NotificationsTab s={s} save={(b) => save.mutate(b)} />}
      {tab === "connectors" && <ConnectorsTab />}
      {tab === "mcp" && <McpTab />}
      {tab === "import" && <ImportTab />}
      {tab === "export" && <ExportTab />}
      {tab === "account" && <AccountTab onDeleted={() => { qc.clear(); nav("/login", { replace: true }); }} />}
    </div>
  );
}

function ProfileTab({ s, name, save }: { s: WorkspaceSettings; name: string; save: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ name, timezone: s.timezone, reviewTemplate: s.reviewTemplate });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const { toast } = useToast();
  const changePw = useMutation({ mutationFn: () => api.post("/auth/change-password", pw), onSuccess: () => { setPw({ currentPassword: "", newPassword: "" }); toast("パスワードを変更しました（他端末はログアウトされます）", "success"); }, onError: (e) => toast(errText(e), "error") });
  return (
    <div className="grid-2">
      <Card title="Workspace">
        <Field label="Workspace 名"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="タイムゾーン" hint="Today / Review の日付境界に使います"><Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} list="tzs" /><datalist id="tzs">{["Asia/Tokyo", "UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Singapore"].map((t) => <option key={t} value={t} />)}</datalist></Field>
        <Field label="Review 質問テンプレート" hint="変更しても過去の Review は変わりません"><Select value={f.reviewTemplate} onChange={(e) => setF({ ...f, reviewTemplate: e.target.value as WorkspaceSettings["reviewTemplate"] })}>{[["general", "一般"], ["founder", "Founder"], ["freelancer", "Freelancer"], ["creator", "Creator"], ["manager", "Manager"], ["investor", "Investor（金融助言なし）"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Button variant="primary" onClick={() => save(f)}>保存</Button>
      </Card>
      <Card title="パスワード変更">
        <Field label="現在のパスワード"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="新しいパスワード（10文字以上）"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" /></Field>
        <Button onClick={() => changePw.mutate()} disabled={!pw.currentPassword || pw.newPassword.length < 10}>変更</Button>
      </Card>
    </div>
  );
}

function AiTab({ s, save }: { s: WorkspaceSettings; save: (b: Record<string, unknown>) => void }) {
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<any>("/ai/status") });
  const emb = useQuery({ queryKey: ["ai-embeddings"], queryFn: () => api.get<{ total: number; indexed: number; stale: number }>("/ai/embeddings") });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [ai, setAi] = useState({ ...s.ai });
  const sync = useMutation({ mutationFn: () => api.post<any>("/ai/embeddings/sync"), onSuccess: (r) => { toast(`${r.embedded} 件を index しました`, "success"); inv("ai-embeddings"); }, onError: (e) => toast(errText(e), "error") });
  const delEmb = useMutation({ mutationFn: () => api.delete<any>("/ai/embeddings"), onSuccess: (r) => { toast(`${r.deleted} 件の embedding を削除しました`, "success"); inv("ai-embeddings"); } });
  const st = status.data;
  return (
    <div>
      <div className="notice info">AI は既定で OFF。有効化しても、送信されるのは質問に関係する記録の抜粋だけで、workspace 全体は送りません。下の「AI 対象外カテゴリ」に入れたデータは一切送信されません。provider の API key はサーバー側の環境変数のみで、ブラウザには出ません。</div>
      <div className="grid-2">
        <Card title="Provider">
          <Field label="AI を使う"><Select value={ai.enabled ? "1" : "0"} onChange={(e) => setAi({ ...ai, enabled: e.target.value === "1" })}><option value="0">OFF（既定）</option><option value="1">ON</option></Select></Field>
          <Field label="Provider" hint={st ? `サーバーの key: Anthropic ${st.serverKeys.anthropic ? "✓" : "未設定"} / OpenAI ${st.serverKeys.openai ? "✓" : "未設定"}` : undefined}><Select value={ai.provider} onChange={(e) => setAi({ ...ai, provider: e.target.value as typeof ai.provider, model: e.target.value === "anthropic" ? "claude-opus-5-5" : e.target.value === "mock" ? "mock-1" : "" })}><option value="none">未選択</option><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI 互換</option><option value="mock">テスト用 mock（外部送信なし）</option></Select></Field>
          <Field label="Model">{ai.provider === "anthropic" ? <Select value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })}>{["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"].map((m) => <option key={m} value={m}>{m}</option>)}</Select> : <Input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} placeholder={ai.provider === "openai" ? "例: gpt-5-mini（販売前に公式で確認）" : ""} />}</Field>
          <Field label="Embedding（Semantic Search 用）" hint="local-lite は外部送信なし・精度限定。OpenAI 互換 embedding はモデル名を入力"><Input value={ai.embeddingModel} onChange={(e) => setAi({ ...ai, embeddingModel: e.target.value })} placeholder="local-lite / text-embedding-3-small" list="embs" /><datalist id="embs"><option value="local-lite" /><option value="text-embedding-3-small" /></datalist></Field>
          <Field label="月間上限（USD）" hint="到達すると AI 呼び出しを停止します"><Input type="number" min={0} step={1} value={ai.monthlyCapUsd} onChange={(e) => setAi({ ...ai, monthlyCapUsd: Number(e.target.value) })} /></Field>
          <Button variant="primary" onClick={() => save({ ai })}>保存</Button>
          {st && <p className="small muted" style={{ marginTop: 10 }}>状態: {st.enabled ? (st.ready ? `利用可（${st.provider}/${st.model}）` : `未準備: ${st.reason}`) : "OFF"} · 今月 ${st.usage.monthCostUsd.toFixed(4)} / {st.usage.monthCalls} calls{st.capReached && " · 上限到達"}</p>}
        </Card>
        <Card title="機能別 ON/OFF と AI 対象外カテゴリ">
          {AI_FEATURES.map((f) => <label key={f} className="row small" style={{ marginBottom: 6 }}><input type="checkbox" checked={ai.features[f]} onChange={(e) => setAi({ ...ai, features: { ...ai.features, [f]: e.target.checked } })} /> {FEATURE_LABEL[f]}</label>)}
          <h3 style={{ marginTop: 12 }}>AI に送らないカテゴリ</h3>
          {AI_SENSITIVE_CATEGORIES.map((c) => <label key={c} className="row small" style={{ marginBottom: 6 }}><input type="checkbox" checked={ai.excludedCategories.includes(c)} onChange={(e) => setAi({ ...ai, excludedCategories: e.target.checked ? [...ai.excludedCategories, c] : ai.excludedCategories.filter((x) => x !== c) })} /> {CATEGORY_LABEL[c]}</label>)}
          <Button variant="primary" onClick={() => save({ ai })}>保存</Button>
          <h3 style={{ marginTop: 12 }}>AI index（embedding）</h3>
          <p className="small muted">{emb.data ? `${emb.data.indexed}/${emb.data.total} 件 index 済み（差分更新）` : ""}</p>
          <div className="row"><Button size="sm" onClick={() => sync.mutate()} disabled={!st?.ready}>今すぐ index</Button><Button size="sm" variant="danger" onClick={() => confirm("AI index をすべて削除しますか？") && delEmb.mutate()}>AI index を削除</Button></div>
        </Card>
      </div>
    </div>
  );
}

function NotificationsTab({ s, save }: { s: WorkspaceSettings; save: (b: Record<string, unknown>) => void }) {
  const [n, setN] = useState({ ...s.notifications });
  const vapid = useQuery({ queryKey: ["vapid"], queryFn: () => api.get<{ publicKey: string | null; configured: boolean }>("/push/vapid-public-key") });
  const { toast } = useToast();
  const subscribe = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("このブラウザは Web Push に対応していません（iOS はホーム画面に追加後のみ）");
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("通知が許可されませんでした");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid.data!.publicKey! });
      await api.post("/push/subscribe", sub.toJSON());
      toast("この端末で Push 通知を受け取ります", "success");
    } catch (e) { toast(errText(e), "error"); }
  };
  const Row = ({ k, label, time }: { k: keyof typeof n; label: string; time?: keyof typeof n }) => (
    <div className="row between" style={{ marginBottom: 6 }}><label className="row small"><input type="checkbox" checked={!!n[k]} onChange={(e) => setN({ ...n, [k]: e.target.checked })} /> {label}</label>{time && <Input type="time" value={String(n[time])} onChange={(e) => setN({ ...n, [time]: e.target.value })} style={{ width: 120 }} />}</div>
  );
  return (
    <div className="grid-2">
      <Card title="通知（罪悪感を煽らない最小限）">
        <Row k="morningBrief" label="Morning Brief" time="morningBriefTime" />
        <Row k="eveningReflection" label="Evening Reflection" time="eveningReflectionTime" />
        <div className="row between" style={{ marginBottom: 6 }}><label className="row small"><input type="checkbox" checked={n.weeklyReview} onChange={(e) => setN({ ...n, weeklyReview: e.target.checked })} /> Weekly Review（CEO Meeting）</label><div className="row"><Select value={n.weeklyReviewDay} onChange={(e) => setN({ ...n, weeklyReviewDay: Number(e.target.value) })} style={{ width: 90 }}>{["日", "月", "火", "水", "木", "金", "土"].map((d, i) => <option key={i} value={i}>{d}</option>)}</Select><Input type="time" value={n.weeklyReviewTime} onChange={(e) => setN({ ...n, weeklyReviewTime: e.target.value })} style={{ width: 120 }} /></div></div>
        <Row k="decisionReviews" label="Decision Review の時期" />
        <Row k="followUps" label="Follow-up 期限" />
        <Row k="promises" label="約束の期限" />
        <div className="row" style={{ marginTop: 8 }}><span className="small muted">Quiet hours</span><Input type="time" value={n.quietHoursStart} onChange={(e) => setN({ ...n, quietHoursStart: e.target.value })} style={{ width: 120 }} /><span>〜</span><Input type="time" value={n.quietHoursEnd} onChange={(e) => setN({ ...n, quietHoursEnd: e.target.value })} style={{ width: 120 }} /></div>
        <Button variant="primary" style={{ marginTop: 10 }} onClick={() => save({ notifications: n })}>保存</Button>
      </Card>
      <Card title="Web Push">
        <p className="small muted">{vapid.data?.configured ? "サーバーに VAPID 鍵が設定されています。" : "サーバーに VAPID 鍵が未設定のため、アプリ内通知のみ利用できます（OPERATIONS.md 参照）。"}</p>
        <label className="row small"><input type="checkbox" checked={n.webPush} onChange={(e) => setN({ ...n, webPush: e.target.checked })} /> Push 通知を使う</label>
        <div className="row" style={{ marginTop: 8 }}><Button onClick={subscribe} disabled={!vapid.data?.configured}>この端末を登録</Button><Button variant="primary" onClick={() => save({ notifications: n })}>保存</Button></div>
        <p className="small faint">同じ通知は1回だけ送られます（dedupe）。iOS Safari はホーム画面に追加した PWA でのみ Push が利用できます。</p>
      </Card>
    </div>
  );
}

function ConnectorsTab() {
  const q = useQuery({ queryKey: ["connectors"], queryFn: () => api.get<{ connectors: any[] }>("/connectors") });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const configure = useMutation({ mutationFn: () => api.put("/connectors/ics", { config: { url } }), onSuccess: () => { toast("保存しました", "success"); inv("connectors"); }, onError: (e) => toast(errText(e), "error") });
  const sync = useMutation({ mutationFn: () => api.post<any>("/connectors/ics/sync"), onSuccess: (r) => { toast(`同期: ${r.imported} 件追加 / ${r.updated} 件更新`, "success"); inv("connectors", "calendar"); }, onError: (e) => toast(errText(e), "error") });
  const remove = useMutation({ mutationFn: (t: string) => api.delete(`/connectors/${t}`), onSuccess: () => inv("connectors") });
  if (q.isLoading) return <Spinner />;
  return (
    <div>
      <div className="notice info">Connector は無くても Northstar は単体で成立します。初版で実装済みなのは ICS（ファイル / 利用者が設定した URL の手動同期）のみ。メール・連絡先・予定の全件を勝手に取得することはありません。</div>
      <Card>
        <ul className="list">{q.data!.connectors.map((c) => <li key={c.type}><div className="grow"><div className="title">{c.label} <Badge tone={c.status === "connected" ? "good" : c.status === "planned" ? "neutral" : c.status === "error" ? "bad" : "warn"}>{c.status}</Badge></div><div className="meta">{c.description}</div><div className="meta">scope: {c.scopes.join(", ")} · 確認状況: {c.verification}{c.lastSyncAt ? ` · 最終同期 ${c.lastSyncAt.slice(0, 16)}` : ""}</div>
          {c.type === "ics" && <div className="row" style={{ marginTop: 6 }}><Input placeholder="ICS URL（任意・秘密 URL は暗号化保存ではないため共有端末では注意）" value={url || (c.hasSecret ? "（設定済み）" : "")} onChange={(e) => setUrl(e.target.value)} onFocus={() => { if (!url) setUrl(""); }} style={{ flex: 1 }} /><Button size="sm" onClick={() => configure.mutate()} disabled={!/^https?:\/\//.test(url)}>保存</Button><Button size="sm" onClick={() => sync.mutate()} disabled={!c.hasSecret}>今すぐ同期</Button>{c.hasSecret && <Button size="sm" variant="ghost" onClick={() => remove.mutate("ics")}>解除</Button>}</div>}
        </div></li>)}</ul>
      </Card>
    </div>
  );
}

function McpTab() {
  const q = useQuery({ queryKey: ["tokens"], queryFn: () => api.get<{ tokens: any[] }>("/tokens") });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const create = useMutation({ mutationFn: () => api.post<any>("/tokens", { name, scopes: write ? ["read", "write"] : ["read"] }), onSuccess: (r) => { setCreated(r); setName(""); inv("tokens"); }, onError: (e) => toast(errText(e), "error") });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/tokens/${id}`), onSuccess: () => inv("tokens") });
  const origin = location.origin;
  return (
    <div>
      <div className="notice info">ChatGPT / Claude などから Northstar に接続するための MCP サーバー（Streamable HTTP）: <code className="kbd">{origin}/mcp</code>。認証は API token（Bearer）。書き込み tool は必ず confirm（意図確認）が必要で、Goal の削除・Decision 結果の勝手な確定・Person メモの作成はできません。</div>
      <div className="grid-2">
        <Card title="API token">
          <Field label="名前"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: ChatGPT（読み取り）" /></Field>
          <label className="row small" style={{ marginBottom: 8 }}><input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} /> 書き込みを許可（capture / goal / decision / follow-up / big3 / review 下書き）</label>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!name.trim()}>発行</Button>
          {created && <div className="notice" style={{ marginTop: 10 }}>この token は二度と表示されません:<br /><code className="kbd" style={{ wordBreak: "break-all" }}>{created.token}</code></div>}
          <ul className="list" style={{ marginTop: 10 }}>{q.data?.tokens.map((t) => <li key={t.id} style={{ opacity: t.revokedAt ? 0.5 : 1 }}><div className="grow"><div className="title">{t.name} {t.scopes.map((s: string) => <Badge key={s}>{s}</Badge>)}</div><div className="meta">発行 {t.createdAt.slice(0, 10)}{t.lastUsedAt ? ` · 最終利用 ${t.lastUsedAt.slice(0, 16)}` : ""}{t.revokedAt ? " · 失効済み" : ""}</div></div>{!t.revokedAt && <Button size="sm" variant="danger" onClick={() => revoke.mutate(t.id)}>失効</Button>}</li>)}</ul>
        </Card>
        <Card title="接続方法">
          <p className="small"><b>Claude Desktop / Claude Code（ローカル stdio）:</b></p>
          <pre className="kbd small" style={{ whiteSpace: "pre-wrap" }}>{`{\n  "mcpServers": {\n    "northstar": {\n      "command": "pnpm",\n      "args": ["--dir", "/path/to/021-northstar", "mcp"],\n      "env": { "NORTHSTAR_DB": "/path/to/data/northstar.db", "NORTHSTAR_MCP_TOKEN": "ns_..." }\n    }\n  }\n}`}</pre>
          <p className="small"><b>ChatGPT（Developer mode → Connectors）/ Claude（Remote MCP）:</b> URL に <code className="kbd">{origin}/mcp</code>、認証ヘッダー <code className="kbd">Authorization: Bearer ns_...</code>。公開 HTTPS で配信されている必要があります。</p>
          <p className="small muted">tools: get_today_focus / get_weekly_big3 / search_northstar / get_person_brief / find_related_knowledge / list_goals / review_decision / capture_item / create_goal / record_decision / create_followup / set_weekly_big3 / start_weekly_review / ask_chief_of_staff。詳細は MCP_PLUGIN.md。</p>
        </Card>
      </div>
    </div>
  );
}

function ImportTab() {
  const { toast } = useToast();
  const inv = useInvalidate();
  const [kind, setKind] = useState("people_csv");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [dup, setDup] = useState<"skip" | "import_as_new">("skip");
  const doPreview = useMutation({ mutationFn: () => api.post<any>("/import/preview", { kind, content, fileName }), onSuccess: (p) => { setPreview(p); setMapping(p.suggestedMapping ?? {}); setSelected(null); }, onError: (e) => toast(errText(e), "error") });
  const confirm = useMutation({ mutationFn: () => api.post<any>("/import/confirm", { importId: preview.importId, mapping, selectedRows: selected ? [...selected] : undefined, duplicateAction: dup }), onSuccess: (r) => { toast(`取り込み完了: ${Object.entries(r.created).map(([k, v]) => `${k} ${v}`).join(", ") || "0"}（スキップ ${r.skipped}）`, "success"); setPreview(null); setContent(""); inv("people", "goals-tree", "knowledge", "decisions"); }, onError: (e) => toast(errText(e), "error") });
  const rows: any[] = preview?.rows ?? [];
  const toggle = (i: number) => { const s = new Set(selected ?? rows.map((_: unknown, idx: number) => idx)); if (s.has(i)) s.delete(i); else s.add(i); setSelected(s); };
  const isSel = (i: number) => !selected || selected.has(i);
  return (
    <div>
      <Card title="Import（Preview → mapping → 確認）">
        <div className="row"><Select aria-label="取り込みの種類" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 240 }}><option value="people_csv">People CSV</option><option value="goals_csv">Goals CSV（draft で取り込み）</option><option value="knowledge_csv">Knowledge CSV</option><option value="decisions_csv">Decisions CSV</option><option value="markdown">Markdown（Notion/Obsidian export）</option><option value="chat_export">AI チャット export（ChatGPT/Claude JSON, テキスト）</option><option value="json_backup">Northstar JSON（merge）</option></Select><input type="file" aria-label="取り込むファイル" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); f.text().then(setContent); } }} /></div>
        <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="ファイルを選ぶか、ここに貼り付け" style={{ marginTop: 8 }} />
        <p className="small faint">AI チャットは、あなたが明示的に export / アップロードした会話だけを読み取ります。候補は確認後にのみ保存されます。</p>
        <Button variant="primary" onClick={() => doPreview.mutate()} disabled={!content.trim() || doPreview.isPending}>プレビュー</Button>
      </Card>
      {preview && (
        <Card title={`プレビュー: ${preview.rowCount} 件${preview.duplicates?.length ? ` · 重複候補 ${preview.duplicates.length}` : ""}`} className="scroll-x">
          {preview.notes?.map((n: string, i: number) => <p key={i} className="small muted">{n}</p>)}
          {preview.issues?.length > 0 && <div className="notice bad">{preview.issues.join(" / ")}</div>}
          {preview.counts && <p className="small">{Object.entries(preview.counts).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
          {preview.fields?.length > 0 && <div className="row" style={{ marginBottom: 8 }}>{preview.fields.map((f: string) => <label key={f} className="small">{f}: <Select value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })} style={{ width: 140, display: "inline-block" }}><option value="">—</option>{preview.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}</Select></label>)}</div>}
          {preview.duplicates?.length > 0 && <div className="row small" style={{ marginBottom: 8 }}>重複候補の扱い: <Select value={dup} onChange={(e) => setDup(e.target.value as typeof dup)} style={{ width: 200 }}><option value="skip">スキップ（統合しない）</option><option value="import_as_new">別人物として取り込む</option></Select></div>}
          {rows.length > 0 && <table className="table"><thead><tr><th></th>{preview.headers.map((h: string) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r: any, i: number) => <tr key={i} style={{ opacity: isSel(i) ? 1 : 0.4 }}><td><input type="checkbox" checked={isSel(i)} onChange={() => toggle(i)} />{preview.duplicates?.some((d: any) => d.row === i) && <Badge tone="warn">重複?</Badge>}</td>{preview.headers.map((h: string) => <td key={h}>{String(r[h] ?? "").slice(0, 80)}</td>)}</tr>)}</tbody></table>}
          <div className="row" style={{ marginTop: 10 }}><Button variant="primary" onClick={() => confirm.mutate()} disabled={confirm.isPending || preview.issues?.length > 0}>取り込みを確定</Button><Button variant="ghost" onClick={() => setPreview(null)}>キャンセル</Button></div>
        </Card>
      )}
    </div>
  );
}

function ExportTab() {
  const backups = useQuery({ queryKey: ["backups"], queryFn: () => api.get<{ backups: { name: string; bytes: number; modifiedAt: string }[]; dir: string }>("/backup") });
  const inv = useInvalidate();
  const { toast } = useToast();
  const [restoreFile, setRestoreFile] = useState<any>(null);
  const [validation, setValidation] = useState<any>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const mk = useMutation({ mutationFn: () => api.post<any>("/backup"), onSuccess: (r) => { toast(`バックアップを作成しました（${r.name}）`, "success"); inv("backups"); }, onError: (e) => toast(errText(e), "error") });
  const validate = useMutation({ mutationFn: (b: unknown) => api.post<any>("/restore/validate", { backup: b }), onSuccess: setValidation, onError: (e) => toast(errText(e), "error") });
  const restore = useMutation({ mutationFn: () => api.post<any>("/restore", { backup: restoreFile, mode, confirmReplace: mode === "replace" }), onSuccess: (r) => { toast(`復元完了（${mode}）: ${Object.entries(r.inserted).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}`, "success"); setRestoreFile(null); setValidation(null); inv("me"); }, onError: (e) => toast(errText(e), "error") });
  return (
    <div className="grid-2">
      <Card title="Export（AI provider にロックインしません）">
        <div className="row" style={{ flexWrap: "wrap" }}>{[["/export/all.json", "全データ JSON"], ["/export/goals.md", "Goals Markdown"], ["/export/decisions.md", "Decisions Markdown"], ["/export/reviews.md", "Reviews Markdown"], ["/export/people.csv", "People CSV"], ["/export/knowledge.md", "Knowledge Markdown"]].map(([p, l]) => <a key={p} className="btn" href={`/api${p}`}>{l}</a>)}</div>
        <p className="small faint">PDF が必要な場合は Markdown をブラウザで印刷（Cmd/Ctrl+P → PDF 保存）してください。</p>
      </Card>
      <Card title="Backup / Restore">
        <Button variant="primary" onClick={() => mk.mutate()}>今すぐバックアップ（サーバー保存）</Button>
        <p className="small muted">保存先: {backups.data?.dir}（schemaVersion / appVersion / generatedAt / count / checksum 付き）</p>
        <ul className="list">{backups.data?.backups.slice(0, 10).map((b) => <li key={b.name}><div className="grow"><a href={`/api/backup/${b.name}`} className="title">{b.name}</a><div className="meta">{Math.round(b.bytes / 1024)} KB · {b.modifiedAt.slice(0, 16)}</div></div></li>)}</ul>
        <h3 style={{ marginTop: 12 }}>Restore</h3>
        <input type="file" aria-label="復元するバックアップファイル" accept="application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then((t) => { try { const j = JSON.parse(t); setRestoreFile(j); validate.mutate(j); } catch { toast("JSON を読み取れません", "error"); } }); }} />
        {validation && <div className={`notice ${validation.ok ? "info" : "bad"}`} style={{ marginTop: 8 }}>{validation.ok ? `検証 OK: schema v${validation.schemaVersion} · ${validation.generatedAt?.slice(0, 16)} · ${Object.entries(validation.counts ?? {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}` : `検証失敗（現在のデータは変更されません）: ${validation.issues.join(" / ")}`}</div>}
        {validation?.ok && <div className="row" style={{ marginTop: 8 }}><Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} style={{ width: 260 }}><option value="merge">merge（既存を残し、無い id だけ追加）</option><option value="replace">replace（現在のデータを全置換）</option></Select><Button variant={mode === "replace" ? "danger" : "primary"} onClick={() => { if (mode !== "replace" || confirm("現在の workspace データをすべて置き換えます。よろしいですか？")) restore.mutate(); }} disabled={restore.isPending}>復元</Button></div>}
      </Card>
    </div>
  );
}

function AccountTab({ onDeleted }: { onDeleted: () => void }) {
  const { toast } = useToast();
  const [pw, setPw] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const del = useMutation({ mutationFn: () => api.delete("/account", { password: pw, confirm: confirmText }), onSuccess: onDeleted, onError: (e) => toast(errText(e), "error") });
  return (
    <div className="grid-2">
      <Card title="データの持ち出し"><a className="btn" href="/api/account/export">アカウント全データを Export</a><p className="small muted" style={{ marginTop: 8 }}>Backup と同じ形式（JSON）。別環境の Northstar に Restore できます。</p></Card>
      <Card title="アカウント削除">
        <p className="small muted">Goals / Decisions / People / Knowledge / Reviews / 検索 index / AI index / API token / セッションを完全に削除します。元に戻せません。サーバー側バックアップファイル（BACKUP_DIR）は運用者が別途削除してください。</p>
        <Field label="パスワード"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="確認のため DELETE と入力"><Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
        <Button variant="danger" onClick={() => del.mutate()} disabled={!pw || confirmText !== "DELETE"}>アカウントを削除</Button>
      </Card>
    </div>
  );
}
