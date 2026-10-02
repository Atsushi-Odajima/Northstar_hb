import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signup, api } from "./helpers";

// Automated accessibility smoke (axe-core): no serious/critical violations on the main screens.
const PAGES = ["/today", "/", "/goals", "/decisions", "/people", "/knowledge", "/reviews", "/reviews/weekly", "/inbox", "/capture", "/ai", "/settings", "/principles", "/calendar", "/search?q=ProofFlow"];

test.describe("Accessibility (axe)", () => {
  test("login page", async ({ page }) => {
    await page.goto("/login");
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  });
  test("main screens", async ({ page }) => {
    await signup(page);
    await api(page.request, "POST", "/api/goals", { title: "ProofFlow 販売開始", level: "month", status: "active", isNorthStar: true });
    await api(page.request, "POST", "/api/people", { name: "Sample CTO" });
    await api(page.request, "POST", "/api/decisions", { title: "先行販売", decidedAt: "2026-09-01" });
    const report: string[] = [];
    for (const p of PAGES) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).analyze();
      const bad = r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""));
      if (bad.length) report.push(`${p}: ${bad.map((v) => `${v.id}(${v.nodes.length})`).join(", ")}`);
    }
    expect(report, report.join("\n")).toEqual([]);
  });
});
