import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import type { User, Workspace } from "@shared/types";

export interface Me { user: User; workspace: Workspace; via: string; scopes: string[] }
export function useMe() {
  return useQuery<Me, ApiError>({ queryKey: ["me"], queryFn: () => api.get<Me>("/me"), retry: false, staleTime: 60_000 });
}
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : false));
  useEffect(() => { const mq = window.matchMedia(q); const fn = () => setM(mq.matches); mq.addEventListener("change", fn); return () => mq.removeEventListener("change", fn); }, [q]);
  return m;
}
export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => { const a = () => setOn(true), b = () => setOn(false); window.addEventListener("online", a); window.addEventListener("offline", b); return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); }; }, []);
  return on;
}
export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = Array.isArray(e.details) ? (e.details as { path?: string; message?: string }[]).map((x) => `${x.path ? x.path + ": " : ""}${x.message}`).join(" / ") : "";
    return d ? `${e.message}（${d}）` : e.message;
  }
  return (e as Error)?.message ?? String(e);
}
export function useQueryParam(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}
