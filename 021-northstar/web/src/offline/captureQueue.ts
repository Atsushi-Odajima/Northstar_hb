// Offline-safe Quick Capture queue (IndexedDB). Items are synced with idempotent clientIds; the server never
// overwrites existing records, and conflicts (duplicates) are reported, not merged silently.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { api } from "../api/client";

interface QueueDB extends DBSchema {
  captures: { key: string; value: { clientId: string; rawText: string; type: string | null; createdAt: string; attempts: number; lastError?: string } };
}
let dbp: Promise<IDBPDatabase<QueueDB>> | null = null;
const db = () => (dbp ??= openDB<QueueDB>("northstar-offline", 1, { upgrade(d) { d.createObjectStore("captures", { keyPath: "clientId" }); } }));

export const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function enqueueCapture(item: { rawText: string; type: string | null }) {
  const rec = { clientId: newClientId(), rawText: item.rawText, type: item.type, createdAt: new Date().toISOString(), attempts: 0 };
  await (await db()).put("captures", rec);
  notify();
  return rec;
}
export async function pendingCaptures() { return (await db()).getAll("captures"); }
export async function removePending(clientId: string) { await (await db()).delete("captures", clientId); notify(); }

export interface SyncResult { synced: number; duplicates: number; failed: number }
let syncing = false;
export async function syncCaptures(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, duplicates: 0, failed: 0 };
  if (syncing || !navigator.onLine) return result;
  syncing = true;
  try {
    const items = await pendingCaptures();
    if (items.length === 0) return result;
    const res = await api.post<{ results: { clientId: string; status: string; message?: string }[] }>("/captures/sync", {
      items: items.map((i) => ({ rawText: i.rawText, type: i.type, clientId: i.clientId, source: "pwa", createdAt: i.createdAt })),
    });
    for (const r of res.results) {
      if (r.status === "created") { result.synced++; await removePending(r.clientId); }
      else if (r.status === "duplicate") { result.duplicates++; await removePending(r.clientId); }
      else { result.failed++; const it = items.find((i) => i.clientId === r.clientId); if (it) await (await db()).put("captures", { ...it, attempts: it.attempts + 1, lastError: r.message }); }
    }
    notify();
    return result;
  } finally { syncing = false; }
}

const listeners = new Set<() => void>();
export function onQueueChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function notify() { for (const l of listeners) l(); }

let started = false;
export function startAutoSync() {
  if (started) return; started = true;
  const run = () => { void syncCaptures().catch(() => undefined); };
  window.addEventListener("online", run);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run(); });
  setTimeout(run, 1500);
  setInterval(run, 60_000);
}
