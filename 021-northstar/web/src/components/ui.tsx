import React from "react";
import { Link } from "react-router";

export function Card({ title, children, className = "", action, id }: { title?: React.ReactNode; children: React.ReactNode; className?: string; action?: React.ReactNode; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || action) && <header className="card-head"><h2>{title}</h2>{action}</header>}
      {children}
    </section>
  );
}
export function PageHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
export function Button({ children, variant = "default", size, type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger"; size?: "sm" }) {
  return <button type={type} className={`btn btn-${variant}${size ? ` btn-${size}` : ""}`} {...rest}>{children}</button>;
}
export function Field({ label, children, hint, inline }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; inline?: boolean }) {
  return (
    <label className={`field${inline ? " field-inline" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input className="input" {...props} />; }
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="input textarea" {...props} />; }
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select className="input" {...props} />; }
export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent" }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) { return <div className="empty"><p>{children}</p>{action}</div>; }
export function Spinner() { return <div className="spinner" aria-label="読み込み中" />; }
export function Row({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <div className={`row ${className}`}>{children}</div>; }
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) { return <div className="stat"><div className="stat-value">{value}</div><div className="stat-label">{label}</div>{sub && <div className="stat-sub">{sub}</div>}</div>; }
export function ProgressBar({ percent }: { percent: number | null }) {
  return <div className="progress" title={percent === null ? "未定義" : `${percent}%`}><div className="progress-bar" style={{ width: `${percent ?? 0}%`, opacity: percent === null ? 0.3 : 1 }} /></div>;
}
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head"><h2>{title}</h2><button className="btn btn-ghost" onClick={onClose} aria-label="閉じる">✕</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab${value === t.id ? " active" : ""}`} onClick={() => onChange(t.id)}>{t.label}</button>)}</div>;
}
export const HEALTH_LABEL: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  achieved: { label: "達成", tone: "good" }, on_track: { label: "前進中", tone: "good" }, activity_without_outcome: { label: "作業のみ", tone: "warn" },
  stalled: { label: "停滞", tone: "bad" }, no_signal: { label: "記録なし", tone: "neutral" }, inactive: { label: "非Active", tone: "neutral" },
};
export function HealthBadge({ health }: { health?: { health: string; reason: string } }) {
  if (!health) return null;
  const h = HEALTH_LABEL[health.health] ?? { label: health.health, tone: "neutral" as const };
  return <Badge tone={h.tone}>{h.label}</Badge>;
}
export const LEVEL_LABEL: Record<string, string> = { vision: "Vision", year: "Year", quarter: "Quarter", month: "Month", week: "Week" };
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Active", paused: "Paused", achieved: "Achieved", dropped: "Dropped", archived: "Archived", open: "Open", done: "Done", idea: "Idea", waiting: "Waiting", completed: "Completed", reviewed: "Reviewed", abandoned: "Abandoned", captured: "Captured", processed: "Processed", applied: "Applied" };
export function EntityLink({ type, id, children }: { type: string; id: string; children: React.ReactNode }) {
  const map: Record<string, string> = { goal: `/goals/${id}`, project: `/projects/${id}`, decision: `/decisions/${id}`, person: `/people/${id}`, knowledge: `/knowledge/${id}`, review: `/reviews/${id}`, action: `/actions?id=${id}`, outcome: `/goals`, contact: `/people`, promise: `/people`, follow_up: `/people`, capture: `/inbox`, principle: `/principles`, experiment: `/principles`, calendar_event: `/calendar` };
  return <Link to={map[type] ?? "/"} className="entity-link">{children}</Link>;
}
