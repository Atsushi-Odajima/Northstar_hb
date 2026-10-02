import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { Button, Card, Textarea, Badge, PageHeader } from "../components/ui";
import { enqueueCapture, pendingCaptures, syncCaptures, onQueueChange } from "../offline/captureQueue";
import { useToast } from "../components/Toast";
import { useOnline, errText } from "../lib/hooks";

const TYPES = [["idea", "Idea"], ["task", "Task"], ["decision", "Decision"], ["person_note", "Person"], ["knowledge", "Knowledge"], ["question", "Question"], ["journal", "Journal"]] as const;

export function QuickCaptureBox({ compact = false, onSaved }: { compact?: boolean; onSaved?: () => void }) {
  const [text, setText] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const { toast } = useToast();
  const save = async () => {
    const rawText = text.trim();
    if (!rawText) return;
    setBusy(true);
    try {
      if (online) {
        try {
          await api.post("/captures", { rawText, type, source: "pwa", clientId: crypto.randomUUID() });
          toast("Inbox に保存しました", "success");
        } catch (e) {
          if ((e as { status?: number }).status === 0) { await enqueueCapture({ rawText, type }); toast("オフラインのため端末に保存しました。接続時に同期します"); } else throw e;
        }
      } else {
        await enqueueCapture({ rawText, type });
        toast("オフラインのため端末に保存しました。接続時に同期します");
      }
      setText(""); setType(null); onSaved?.();
    } catch (e) { toast(errText(e), "error"); } finally { setBusy(false); }
  };
  return (
    <div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 2 : 5} placeholder="思いついたことを数秒で。分類は後で Inbox で。" aria-label="Quick Capture" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save(); }} />
      <div className="row between" style={{ marginTop: 8 }}>
        <div className="row">{TYPES.map(([id, label]) => <button key={id} type="button" className={`btn btn-sm${type === id ? " btn-primary" : ""}`} onClick={() => setType(type === id ? null : id)}>{label}</button>)}</div>
        <Button variant="primary" onClick={save} disabled={busy || !text.trim()}>保存 <span className="kbd hide-mobile">⌘⏎</span></Button>
      </div>
    </div>
  );
}

export default function Capture() {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof pendingCaptures>>>([]);
  const online = useOnline();
  const { toast } = useToast();
  useEffect(() => { const refresh = () => void pendingCaptures().then(setPending); refresh(); return onQueueChange(refresh); }, []);
  return (
    <div>
      <PageHeader title="Quick Capture" subtitle="Idea / Task / Decision / Person Note / Knowledge / Question / Journal を数秒で保存。オフラインでも端末に保存され、後で同期します。" action={<Link to="/inbox" className="btn">Inbox Review</Link>} />
      <Card><QuickCaptureBox /></Card>
      {pending.length > 0 && (
        <Card title={`未同期の下書き (${pending.length})`} action={<Button size="sm" disabled={!online} onClick={() => void syncCaptures().then((r) => toast(`同期: ${r.synced} 件 / 重複 ${r.duplicates} / 失敗 ${r.failed}`))}>今すぐ同期</Button>}>
          <ul className="list">{pending.map((p) => <li key={p.clientId}><div className="grow"><div className="title">{p.rawText.slice(0, 120)}</div><div className="meta">{new Date(p.createdAt).toLocaleString("ja-JP")} {p.lastError && <Badge tone="bad">{p.lastError}</Badge>}</div></div><Badge tone="warn">{online ? "同期待ち" : "オフライン"}</Badge></li>)}</ul>
          <p className="small faint">同期時は clientId で重複を防ぎ、サーバー側の既存データを上書きしません。</p>
        </Card>
      )}
    </div>
  );
}
