import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink, Link, useNavigate, useLocation, Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useMe, useOnline } from "./lib/hooks";
import { api } from "./api/client";
import { LogoMark } from "./components/Logo";
import { Spinner, Button } from "./components/ui";
import { startAutoSync, onQueueChange, pendingCaptures } from "./offline/captureQueue";
import { useToast } from "./components/Toast";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Capture from "./pages/Capture";
import Inbox from "./pages/Inbox";
import Focus from "./pages/Focus";
import Goals from "./pages/Goals";
import GoalDetail from "./pages/GoalDetail";
import Projects from "./pages/Projects";
import Actions from "./pages/Actions";
import Decisions from "./pages/Decisions";
import DecisionDetail from "./pages/DecisionDetail";
import Reviews from "./pages/Reviews";
import ReviewForm from "./pages/ReviewForm";
import People from "./pages/People";
import PersonDetail from "./pages/PersonDetail";
import Knowledge from "./pages/Knowledge";
import KnowledgeDetail from "./pages/KnowledgeDetail";
import Search from "./pages/Search";
import Chief from "./pages/Chief";
import Principles from "./pages/Principles";
import Calendar from "./pages/Calendar";
import Settings from "./pages/Settings";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import More from "./pages/More";

const NAV = [
  { to: "/", label: "Strategy", ico: "✦" }, { to: "/today", label: "Today", ico: "☀" }, { to: "/goals", label: "Goals", ico: "◎" }, { to: "/projects", label: "Projects", ico: "▣" },
  { to: "/actions", label: "Actions / Loops", ico: "☐" }, { to: "/decisions", label: "Decisions", ico: "⚖" }, { to: "/reviews", label: "Review", ico: "↻" }, { to: "/people", label: "People", ico: "☺" },
  { to: "/knowledge", label: "Knowledge", ico: "✎" }, { to: "/inbox", label: "Inbox", ico: "⤓" }, { to: "/ai", label: "AI Chief of Staff", ico: "✶" }, { to: "/search", label: "Search", ico: "⌕" },
  { to: "/principles", label: "Principles", ico: "§" }, { to: "/calendar", label: "Calendar", ico: "▦" }, { to: "/settings", label: "Settings", ico: "⚙" },
];
const TABS = [{ to: "/today", label: "Today", ico: "☀" }, { to: "/capture", label: "Capture", ico: "＋" }, { to: "/people", label: "People", ico: "☺" }, { to: "/decisions", label: "Decision", ico: "⚖" }, { to: "/more", label: "More", ico: "⋯" }];

function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const online = useOnline();
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(0);
  const [swUpdate, setSwUpdate] = useState<null | (() => void)>(null);
  const { toast } = useToast();
  const notifications = useQuery({ queryKey: ["notifications-badge"], queryFn: () => api.get<{ unread: number }>("/notifications?limit=1"), refetchInterval: 90_000 });
  useEffect(() => { startAutoSync(); const refresh = () => void pendingCaptures().then((p) => setPending(p.length)); refresh(); return onQueueChange(refresh); }, []);
  useEffect(() => {
    const onUpd = (e: Event) => setSwUpdate(() => (e as CustomEvent).detail.update);
    const onOff = () => toast("オフラインでも Today / Capture を使えます");
    window.addEventListener("northstar:sw-update", onUpd); window.addEventListener("northstar:offline-ready", onOff);
    return () => { window.removeEventListener("northstar:sw-update", onUpd); window.removeEventListener("northstar:offline-ready", onOff); };
  }, [toast]);
  const focusMode = loc.pathname === "/focus";
  return (
    <div className="shell">
      <nav className="sidenav" aria-label="メイン">
        <Link to="/" className="brand"><LogoMark /> Northstar</Link>
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `navlink${isActive ? " active" : ""}`}><span className="ico">{n.ico}</span>{n.label}</NavLink>)}
        <div className="nav-footer">人生にも、経営戦略を。</div>
      </nav>
      <main className="main">
        {!focusMode && (
          <div className="topbar">
            <form className="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }} role="search">
              <input className="input" placeholder="Goals / Decisions / People / Knowledge を横断検索" value={q} onChange={(e) => setQ(e.target.value)} aria-label="検索" />
            </form>
            {!online && <span className="offline-pill">オフライン{pending ? ` · 未同期 ${pending}` : ""}</span>}
            {online && pending > 0 && <span className="offline-pill">未同期 {pending}</span>}
            <Link to="/inbox" className="btn btn-ghost bell" aria-label="通知"><span>🔔</span>{(notifications.data?.unread ?? 0) > 0 && <span className="dot" />}</Link>
            <Link to="/capture" className="btn btn-primary hide-mobile">＋ Capture</Link>
          </div>
        )}
        {swUpdate && <div className="notice info row between"><span>新しいバージョンがあります。</span><Button size="sm" onClick={() => swUpdate()}>更新</Button></div>}
        {children}
      </main>
      {!focusMode && <nav className="tabbar" aria-label="モバイルナビ">{TABS.map((t) => <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "active" : "")}><span className="ico">{t.ico}</span>{t.label}</NavLink>)}</nav>}
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { const h = () => nav("/login", { replace: true }); window.addEventListener("northstar:unauthorized", h); return () => window.removeEventListener("northstar:unauthorized", h); }, [nav]);
  if (me.isLoading) return <div className="auth"><Spinner /></div>;
  if (me.isError) {
    if (me.error.status === 0) return <Shell>{children}</Shell>; // offline: let cached pages render
    return <Navigate to="/login" replace />;
  }
  if (!me.data!.workspace.settings.onboardingDone && loc.pathname !== "/onboarding" && loc.pathname !== "/settings") return <Navigate to="/onboarding" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Login signup />} />
      <Route path="/*" element={<Protected>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/today" element={<Today />} />
          <Route path="/focus" element={<Focus />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/goals/:id" element={<GoalDetail />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<Projects />} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/decisions" element={<Decisions />} />
          <Route path="/decisions/:id" element={<DecisionDetail />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/reviews/id/:id" element={<ReviewForm />} />
          <Route path="/reviews/:kind" element={<ReviewForm />} />
          <Route path="/people" element={<People />} />
          <Route path="/people/:id" element={<PersonDetail />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/knowledge/:id" element={<KnowledgeDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/ai" element={<Chief />} />
          <Route path="/principles" element={<Principles />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<div className="empty">ページが見つかりません。<Link to="/today">Today へ</Link></div>} />
        </Routes>
      </Protected>} />
    </Routes>
  );
}
