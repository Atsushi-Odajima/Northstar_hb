import { type Page, type APIRequestContext, expect } from "@playwright/test";

const H = { "X-Requested-With": "Northstar", "Content-Type": "application/json" };
let n = 0;
export async function signup(page: Page, opts: { onboardingDone?: boolean; aiMock?: boolean } = {}) {
  n++;
  const email = `e2e-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const res = await page.request.post("/api/auth/signup", { headers: H, data: { email, password: "e2e-password-1234", displayName: "E2E" } });
  expect(res.status(), await res.text()).toBe(201);
  if (opts.onboardingDone !== false) await api(page.request, "PATCH", "/api/settings", { onboardingDone: true });
  if (opts.aiMock) await api(page.request, "PATCH", "/api/settings", { ai: { enabled: true, provider: "mock", model: "mock-1", embeddingModel: "local-lite", features: { chief_of_staff: true, knowledge_draft: true, capture_classify: true, semantic_search: true, decision_patterns: true, chat_import_extract: true }, excludedCategories: ["journal"] } });
  return { email };
}
export async function api(req: APIRequestContext, method: string, path: string, data?: unknown) {
  const res = await req.fetch(path, { method, headers: H, data: data === undefined ? undefined : JSON.stringify(data) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  expect(res.ok(), `${method} ${path} → ${res.status()} ${text.slice(0, 300)}`).toBeTruthy();
  return json;
}
export const today = () => { const d = new Date(); const p = (x: number) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const daysAgo = (k: number) => { const d = new Date(); d.setDate(d.getDate() - k); const p = (x: number) => String(x).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
