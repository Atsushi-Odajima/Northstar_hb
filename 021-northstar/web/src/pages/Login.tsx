import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button, Field, Input } from "../components/ui";
import { LogoMark } from "../components/Logo";
import { errText } from "../lib/hooks";

export default function Login({ signup = false }: { signup?: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await api.post(signup ? "/auth/signup" : "/auth/login", signup ? { email, password, displayName: name } : { email, password });
      await qc.invalidateQueries();
      nav("/", { replace: true });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="brand"><LogoMark size={34} /> Northstar</div>
      <p className="tagline">人生にも、経営戦略を。</p>
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginBottom: 12 }}>{signup ? "アカウント作成" : "ログイン"}</h2>
        {signup && <Field label="表示名"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
        <Field label="メールアドレス"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" /></Field>
        <Field label="パスワード" hint={signup ? "10文字以上" : undefined}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={signup ? 10 : 1} autoComplete={signup ? "new-password" : "current-password"} /></Field>
        {err && <div className="notice bad">{err}</div>}
        <Button type="submit" variant="primary" disabled={busy} style={{ width: "100%" }}>{signup ? "作成してはじめる" : "ログイン"}</Button>
        <p className="small muted" style={{ marginTop: 12, textAlign: "center" }}>
          {signup ? <>アカウントをお持ちの方は <Link to="/login">ログイン</Link></> : <>はじめての方は <Link to="/signup">アカウント作成</Link></>}
        </p>
        <p className="small faint" style={{ textAlign: "center" }}>あなたの Goals・Decision・People・Journal は、あなた専用の private workspace に保存されます。AI は初期状態で OFF です。</p>
      </form>
    </div>
  );
}
