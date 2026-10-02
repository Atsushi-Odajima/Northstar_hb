import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, todayStr } from "../api/client";
import { Card, Button, Field, Input, Textarea } from "../components/ui";
import { LogoMark } from "../components/Logo";
import { useToast } from "../components/Toast";
import { errText } from "../lib/hooks";

const weekStart = (d: string) => { const x = new Date(d + "T00:00:00"); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x.toISOString().slice(0, 10); };
const quarterEnd = (d: string) => { const x = new Date(d + "T00:00:00"); const q = Math.floor(x.getMonth() / 3); return new Date(x.getFullYear(), q * 3 + 3, 0).toISOString().slice(0, 10); };
const quarterStart = (d: string) => { const x = new Date(d + "T00:00:00"); const q = Math.floor(x.getMonth() / 3); return new Date(x.getFullYear(), q * 3, 1).toISOString().slice(0, 10); };
const monthStart = (d: string) => d.slice(0, 8) + "01";
const monthEnd = (d: string) => { const x = new Date(d + "T00:00:00"); return new Date(x.getFullYear(), x.getMonth() + 1, 0).toISOString().slice(0, 10); };

export default function Onboarding() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [vision, setVision] = useState("");
  const [quarter, setQuarter] = useState({ title: "", success: "" });
  const [month, setMonth] = useState("");
  const [big3, setBig3] = useState(["", "", ""]);
  const [one, setOne] = useState("");
  const [busy, setBusy] = useState(false);
  const today = todayStr();
  const finish = async (skip = false) => {
    setBusy(true);
    try {
      if (!skip) {
        let visionId: string | null = null, quarterId: string | null = null, monthId: string | null = null;
        if (vision.trim()) visionId = (await api.post<any>("/goals", { title: vision.trim(), level: "vision", status: "active" })).goal.id;
        if (quarter.title.trim()) quarterId = (await api.post<any>("/goals", { title: quarter.title.trim(), level: "quarter", parentId: visionId, status: "active", isNorthStar: !month.trim(), successDefinition: quarter.success, startDate: quarterStart(today), endDate: quarterEnd(today), progressMode: "milestone" })).goal.id;
        if (month.trim()) monthId = (await api.post<any>("/goals", { title: month.trim(), level: "month", parentId: quarterId, status: "active", isNorthStar: true, startDate: monthStart(today), endDate: monthEnd(today), progressMode: "milestone" })).goal.id;
        for (const t of big3.filter((b) => b.trim())) await api.post("/focus/big3", { weekStart: weekStart(today), title: t.trim(), goalId: monthId ?? quarterId });
        if (one.trim()) await api.put("/focus/day", { date: today, oneThingTitle: one.trim(), goalId: monthId ?? quarterId, actionId: null, why: "", notes: "" });
      }
      await api.patch("/settings", { onboardingDone: true });
      await qc.invalidateQueries();
      nav("/today", { replace: true });
    } catch (e) { toast(errText(e), "error"); } finally { setBusy(false); }
  };
  const steps = [
    <div key="0"><div className="brand" style={{ justifyContent: "center", fontSize: "1.4rem" }}><LogoMark size={36} /> Northstar</div><p className="tagline">人生にも、経営戦略を。</p><p>「忙しい。でも何も進んでない。」を終わらせるための最初の30分。<br />Vision → 今 Quarter の Goal → 今月の North Star → 今週の Big 3 → 今日の One Thing の順に、5つだけ決めます。すべて後から変更できます。</p><p className="small faint">AI は OFF のまま始まります。あなたの記録は private workspace に保存されます。</p></div>,
    <div key="1"><h2>1. Vision（任意）</h2><p className="muted small">長文は不要。仕事・事業・学習・人間関係・生活、どれでも。1行で。</p><Field label="数年後、こうなっていたい"><Textarea rows={2} value={vision} onChange={(e) => setVision(e.target.value)} placeholder="例: 自分の商品で生きる" autoFocus /></Field></div>,
    <div key="2"><h2>2. 今 Quarter の Goal</h2><p className="muted small">今四半期（〜{quarterEnd(today)}）で「これが起きれば前進」と言える1つ。</p><Field label="Goal"><Input value={quarter.title} onChange={(e) => setQuarter({ ...quarter, title: e.target.value })} placeholder="例: デジタル商品を3個公開する" autoFocus /></Field><Field label="成功の定義（何が起きれば達成？）"><Input value={quarter.success} onChange={(e) => setQuarter({ ...quarter, success: e.target.value })} placeholder="例: 3商品の販売ページが公開され、各1件以上購入" /></Field></div>,
    <div key="3"><h2>3. 今月の North Star</h2><p className="muted small">今月（〜{monthEnd(today)}）の最重要 Goal。これが「今、重要なこと」になります。</p><Field label="North Star"><Input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="例: ProofFlow の販売を開始する" autoFocus /></Field></div>,
    <div key="4"><h2>4. 今週の Big 3</h2><p className="muted small">今週（{weekStart(today)}〜）やることは原則3つまで。Todo を全部書く場所ではありません。</p>{big3.map((b, i) => <Field key={i} label={`Big ${i + 1}`}><Input value={b} onChange={(e) => setBig3(big3.map((x, j) => (j === i ? e.target.value : x)))} placeholder={["例: 販売ページの文章を書く", "例: 価格を決める", "例: 告知先リストを作る"][i]} autoFocus={i === 0} /></Field>)}</div>,
    <div key="5"><h2>5. 今日の One Thing</h2><p className="muted small">今日これが進めば良い日、と言える1つ。</p><Field label="One Thing"><Input value={one} onChange={(e) => setOne(e.target.value)} placeholder={big3.find((b) => b.trim()) ? `例: ${big3.find((b) => b.trim())} の最初の30分` : "例: 販売ページの見出しを決める"} autoFocus /></Field><p className="small faint">このあと Today 画面に移動します。毎日 Today を開き、週末に「CEO Meeting with Yourself（Weekly Review）」を行うのが基本の運用です。</p></div>,
  ];
  return (
    <div className="onboard-step">
      <Card>
        <p className="small faint">Step {step + 1} / {steps.length}</p>
        {steps[step]}
        <div className="row between" style={{ marginTop: 12 }}>
          <div className="row">{step > 0 && <Button onClick={() => setStep(step - 1)}>戻る</Button>}<Button variant="ghost" onClick={() => finish(true)} disabled={busy}>スキップして始める</Button></div>
          {step < steps.length - 1 ? <Button variant="primary" onClick={() => setStep(step + 1)}>次へ</Button> : <Button variant="primary" onClick={() => finish(false)} disabled={busy}>Northstar を始める</Button>}
        </div>
      </Card>
    </div>
  );
}
