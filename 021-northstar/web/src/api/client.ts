export class ApiError extends Error {
  status: number; code: string; details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) { super(message); this.status = status; this.code = code; this.details = details; }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "Northstar", Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  } catch (e) {
    throw new ApiError(0, "network", navigator.onLine ? "サーバーに接続できません" : "オフラインです", e);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/signup")) {
      window.dispatchEvent(new CustomEvent("northstar:unauthorized"));
    }
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `HTTP ${res.status}`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  /** Download a file response (export) by navigating — cookies are sent automatically. */
  download: (path: string) => { window.location.href = `/api${path}`; },
};

export const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const fmtDate = (s?: string | null) => (s ? s.slice(0, 10) : "—");
export const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
