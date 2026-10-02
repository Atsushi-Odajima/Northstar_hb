import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Card, Button } from "../components/ui";

const LINKS = [["/", "Strategy Dashboard"], ["/goals", "Goals"], ["/projects", "Projects"], ["/actions", "Actions / Open Loops"], ["/reviews", "Review"], ["/knowledge", "Knowledge"], ["/inbox", "Inbox / 通知"], ["/ai", "AI Chief of Staff"], ["/search", "Search"], ["/principles", "Principles / Experiments"], ["/calendar", "Calendar"], ["/focus", "Focus Mode"], ["/settings", "Settings"]];

export default function More() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const logout = async () => { await api.post("/auth/logout"); qc.clear(); nav("/login", { replace: true }); };
  return (
    <div>
      <h1 style={{ marginBottom: 12 }}>More</h1>
      <Card><ul className="list">{LINKS.map(([to, label]) => <li key={to}><Link to={to} className="title grow">{label}</Link></li>)}</ul></Card>
      <Button variant="ghost" onClick={logout}>ログアウト</Button>
    </div>
  );
}
