import { test, expect } from "@playwright/test";
import { signup, api, today, daysAgo } from "./helpers";

test.describe("Northstar E2E", () => {
  test("E2E-1 Vision → Quarter Goal → Month North Star → Weekly Big 3 → Daily One Thing → Weekly Review", async ({ page }) => {
    await signup(page, { onboardingDone: false });
    await page.goto("/");
    await expect(page).toHaveURL(/onboarding/);
    await page.getByRole("button", { name: "次へ" }).click();
    await page.getByPlaceholder("例: 自分の商品で生きる").fill("自分の商品で生きる");
    await page.getByRole("button", { name: "次へ" }).click();
    await page.getByPlaceholder("例: デジタル商品を3個公開する").fill("デジタル商品を3個公開する");
    await page.getByRole("button", { name: "次へ" }).click();
    await page.getByPlaceholder("例: ProofFlow の販売を開始する").fill("ProofFlow の販売を開始する");
    await page.getByRole("button", { name: "次へ" }).click();
    await page.getByPlaceholder("例: 販売ページの文章を書く").fill("販売ページを公開する");
    await page.getByPlaceholder("例: 価格を決める").fill("価格を決める");
    await page.getByRole("button", { name: "次へ" }).click();
    await page.getByLabel("One Thing").fill("販売ページの見出しを決める");
    await page.getByRole("button", { name: "Northstar を始める" }).click();
    await expect(page).toHaveURL(/today/);
    await expect(page.locator(".one-thing")).toContainText("販売ページの見出しを決める");
    await expect(page.getByText("1. 販売ページを公開する")).toBeVisible();
    await expect(page.getByText("★ ProofFlow の販売を開始する").first()).toBeVisible();
    // hierarchy is intact
    const tree = await api(page.request, "GET", "/api/goals/tree");
    expect(tree.tree[0].level).toBe("vision");
    expect(tree.tree[0].children[0].level).toBe("quarter");
    expect(tree.tree[0].children[0].children[0].level).toBe("month");
    expect(tree.tree[0].children[0].children[0].isNorthStar).toBe(true);
    // weekly review (CEO Meeting)
    await page.goto("/reviews/weekly");
    await expect(page.getByRole("heading", { name: /CEO Meeting with Yourself/ })).toBeVisible();
    await expect(page.getByText("★ ProofFlow の販売を開始する").first()).toBeVisible();
    await page.getByLabel("やめること（Stop）").fill("SNS を眺めること");
    await page.getByLabel("続けること（Continue）").fill("朝の Focus");
    await page.getByLabel("始めること（Start）").fill("販売ページ公開");
    await page.getByRole("button", { name: "完了", exact: true }).first().click();
    await expect(page.getByText("完了済みの Review です")).toBeVisible();
    await page.goto("/reviews");
    await expect(page.getByText("weekly ·").first()).toBeVisible();
  });

  test("E2E-2 Decision → review after 30 days → result/lesson → Monthly Review", async ({ page }) => {
    await signup(page);
    await page.goto("/decisions");
    await page.getByRole("button", { name: "＋ Decision" }).click();
    await page.getByLabel("何を決めた？（タイトル）").fill("ProofFlow を先行販売する");
    await page.getByLabel("決定日").fill(daysAgo(31));
    await page.getByLabel("見直し日").fill(daysAgo(1));
    await page.getByLabel("決定（Decision）").fill("先行販売（限定価格）");
    await page.getByLabel("理由（Reason）").fill("早期フィードバックが欲しい");
    await page.getByLabel("期待する結果").fill("初月10件");
    await page.getByRole("button", { name: "保存" }).click();
    await page.getByRole("tab", { name: "見直し時期" }).click();
    await page.getByRole("link", { name: /ProofFlow を先行販売する/ }).click();
    await expect(page.getByText("早期フィードバックが欲しい")).toBeVisible();
    await page.getByRole("button", { name: "結果を記録" }).click();
    await expect(page.getByText("当時の判断（変更不可）")).toBeVisible();
    await page.locator(".modal").getByRole("combobox").first().selectOption("worse");
    await page.getByLabel("実際に何が起きた？").fill("3件のみ");
    await page.getByLabel("学び（次に活かすこと）").fill("見込み客の母数を先に測る");
    await page.getByRole("button", { name: "記録する" }).click();
    await expect(page.getByText("期待以下")).toBeVisible();
    await expect(page.getByText("理由: 早期フィードバックが欲しい").first()).toBeVisible();
    // original reason still intact in the header card
    await expect(page.locator(".card").filter({ hasText: "当時の判断" }).getByText("早期フィードバックが欲しい")).toBeVisible();
    // monthly review shows the reviewed decision in its data section
    await page.goto("/reviews/monthly");
    await expect(page.getByText(/↻ ProofFlow を先行販売する/)).toBeVisible();
  });

  test("E2E-3 Person → Contact → Promise → Follow-up → meeting brief", async ({ page }) => {
    await signup(page);
    await page.goto("/people");
    await page.getByRole("button", { name: "＋ Person" }).click();
    await page.getByLabel("名前").fill("Sample CTO");
    await page.getByLabel("組織").fill("Sample Inc");
    await page.getByLabel("重要度 (1=最重要)").selectOption("1");
    await page.getByRole("button", { name: "保存" }).click();
    await page.getByRole("link", { name: "Sample CTO" }).click();
    await page.getByRole("button", { name: "＋ 接点を記録" }).click();
    await page.getByLabel("何を話した？").fill("MCP 連携の相談");
    await page.getByLabel("自分が約束したこと").fill("資料を送る");
    await page.getByLabel("相手からの返事待ち").fill("見積の返事");
    await page.getByLabel("Follow-up 日").fill(today());
    await page.getByLabel("Follow-up の理由").fill("資料の感想を聞く");
    await page.getByRole("button", { name: "記録", exact: true }).click();
    await expect(page.getByText("自分が約束したこと: 資料を送る")).toBeVisible();
    await expect(page.getByText("相手から返事待ち: 見積の返事")).toBeVisible();
    await expect(page.getByText("最近の話題: MCP 連携の相談")).toBeVisible();
    await expect(page.getByText("未完了 Follow-up: 資料の感想を聞く")).toBeVisible();
    await expect(page.getByText("相手の性格や意図は推定していません")).toBeVisible();
    await page.goto("/today");
    await expect(page.getByText("資料の感想を聞く")).toBeVisible();
  });

  test("E2E-4 Article Knowledge → AI draft → Goal link → Action → Applied", async ({ page }) => {
    await signup(page, { aiMock: true });
    const goal = await api(page.request, "POST", "/api/goals", { title: "ProofFlow launch", level: "month", status: "active", isNorthStar: true });
    await page.goto("/knowledge");
    await page.getByRole("button", { name: "＋ Knowledge" }).click();
    await page.getByLabel("タイトル").fill("Launch playbook");
    await page.getByLabel("本文 / メモ（任意）").fill("ProofFlow launch needs a landing page. Pre-sell before building. Measure signups weekly.");
    await page.getByRole("button", { name: "保存" }).click();
    await page.getByRole("tab", { name: "Captured" }).click();
    await page.getByRole("link", { name: "Launch playbook" }).click();
    await page.getByRole("button", { name: "AI で下書き" }).click();
    await expect(page.getByText(/AI 下書き（mock-1）/)).toBeVisible();
    await page.getByRole("button", { name: /◎ ProofFlow launch/ }).click();
    await expect(page.locator(".card").filter({ hasText: "学び" }).getByRole("link", { name: "◎ ProofFlow launch" })).toBeVisible();
    await page.locator(".card").filter({ hasText: "AI 下書き" }).getByRole("button", { name: "採用" }).last().click();
    await page.getByRole("button", { name: "Action を作る" }).click();
    await expect(page.getByText(/☐ /)).toBeVisible();
    await page.getByPlaceholder("どう使った？（一言）").fill("LP を先に作った");
    await page.getByRole("button", { name: "Applied にする" }).click();
    await expect(page.getByText("6. Did I use it?")).toBeVisible();
    const detail = await api(page.request, "GET", `/api/goals/${goal.goal.id}`);
    expect(detail.relations.some((r: any) => r.type === "knowledge")).toBe(true);
  });

  test("E2E-5 Chat export → candidates → human confirmation → saved", async ({ page }) => {
    await signup(page);
    await page.goto("/settings#import");
    await page.getByRole("combobox").first().selectOption("chat_export");
    await page.getByPlaceholder("ファイルを選ぶか、ここに貼り付け").fill("user: ProofFlowは先行販売にすることに決めた\nassistant: 先行販売では、販売ページ・返金ポリシー・納期の明記が信頼につながります。期待値のコントロールが重要です。\nuser: 価格はいくらにすべき？\n");
    await page.getByRole("button", { name: "プレビュー" }).click();
    await expect(page.getByText(/プレビュー: 3 件/)).toBeVisible();
    await expect(page.getByText("候補は保存されていません")).toBeVisible();
    // deselect the question (row 3)
    await page.locator("table tbody tr").nth(2).getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "取り込みを確定" }).click();
    await expect(page.getByText(/取り込み完了/)).toBeVisible();
    await page.goto("/decisions");
    await expect(page.getByRole("link", { name: /ProofFlowは先行販売にすることに決めた/ })).toBeVisible();
    const actions = await api(page.request, "GET", "/api/actions?status=open");
    expect(actions.actions).toHaveLength(0);
  });

  test("E2E-6 AI Chief: stalled goal → answer with real citation", async ({ page }) => {
    await signup(page, { aiMock: true });
    const g = await api(page.request, "POST", "/api/goals", { title: "ErrorRelay 公開", level: "month", status: "active", isNorthStar: true });
    await page.goto("/ai");
    await page.getByRole("button", { name: "最近止まっている目標は？" }).click();
    await expect(page.locator(".card.accent")).toContainText("ErrorRelay 公開");
    const cite = page.locator(".card.accent .cite").first();
    await expect(cite).toBeVisible();
    await cite.click();
    await expect(page).toHaveURL(new RegExp(`/goals/${g.goal.id}`));
  });

  test("E2E-7 PWA Quick Capture on phone → Inbox Review on PC → Goal link", async ({ page }) => {
    await signup(page);
    const goal = await api(page.request, "POST", "/api/goals", { title: "ProofFlow 販売開始", level: "month", status: "active" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/capture");
    await page.getByLabel("Quick Capture").fill("販売ページ画像を作る");
    await page.getByRole("button", { name: /保存/ }).click();
    await expect(page.getByText("Inbox に保存しました")).toBeVisible();
    // offline draft
    await page.context().setOffline(true);
    await page.getByLabel("Quick Capture").fill("オフラインで思いついたこと");
    await page.getByRole("button", { name: /保存/ }).click();
    await expect(page.getByText("未同期の下書き (1)")).toBeVisible();
    await page.context().setOffline(false);
    // the queue auto-syncs on the `online` event; the pending card disappears once synced
    await expect(page.getByText("未同期の下書き")).toBeHidden({ timeout: 15_000 });
    // PC inbox
    await page.setViewportSize({ width: 1366, height: 850 });
    await page.goto("/inbox");
    await expect(page.getByText("オフラインで思いついたこと")).toBeVisible();
    const row = page.locator("li").filter({ hasText: "販売ページ画像を作る" });
    await expect(row.getByText("候補: Task")).toBeVisible();
    await row.getByRole("button", { name: "処理" }).click();
    await page.getByLabel("関連 Goal").selectOption(goal.goal.id);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("Task として保存しました")).toBeVisible();
    const actions = await api(page.request, "GET", `/api/actions?goalId=${goal.goal.id}`);
    expect(actions.actions.map((a: any) => a.title)).toContain("販売ページ画像を作る");
    // manifest + service worker
    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBeTruthy();
    const m = await manifest.json();
    expect(m.name).toBe("Northstar");
    expect(m.short_name).toBe("Northstar");
    expect(m.display).toBe("standalone");
    expect(m.icons.some((i: any) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  });

  test("E2E-8 AI OFF: all core non-AI features work; AI entry points are disabled", async ({ page }) => {
    await signup(page);
    await page.goto("/goals");
    await page.getByRole("button", { name: "＋ Goal" }).click();
    await page.getByLabel("タイトル").fill("Q4 商品3個公開");
    await page.getByLabel("レベル").selectOption("quarter");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("link", { name: /Q4 商品3個公開/ }).first()).toBeVisible();
    await page.goto("/search?q=Q4");
    await expect(page.getByRole("link", { name: "Q4 商品3個公開" })).toBeVisible();
    await page.goto("/ai");
    await expect(page.getByText("AI は OFF です（既定）")).toBeVisible();
    await expect(page.getByRole("button", { name: "聞く" })).toBeDisabled();
    await page.goto("/knowledge");
    await page.getByRole("button", { name: "＋ Knowledge" }).click();
    await page.getByLabel("タイトル").fill("non-AI knowledge");
    await page.getByRole("button", { name: "保存" }).click();
    await page.getByRole("tab", { name: "Captured" }).click();
    await page.getByRole("link", { name: "non-AI knowledge" }).click();
    await expect(page.getByRole("button", { name: "AI で下書き" })).toHaveCount(0);
    const status = await api(page.request, "GET", "/api/ai/status");
    expect(status.enabled).toBe(false);
  });

  test("E2E-9 Full export → restore into an empty workspace → relations match", async ({ page, browser }) => {
    await signup(page);
    const q = await api(page.request, "POST", "/api/goals", { title: "Q4 3商品", level: "quarter", status: "active", isNorthStar: true });
    const p = await api(page.request, "POST", "/api/people", { name: "Sample CTO" });
    const d = await api(page.request, "POST", "/api/decisions", { title: "先行販売", decidedAt: today(), goalIds: [q.goal.id], personIds: [p.person.id] });
    await api(page.request, "POST", "/api/knowledge", { title: "MCP記事", goalIds: [q.goal.id] });
    const exp = await page.request.get("/api/export/all.json");
    const file = await exp.json();
    expect(file.counts.relations).toBeGreaterThanOrEqual(3);
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await signup(page2);
    const v = await api(page2.request, "POST", "/api/restore/validate", { backup: file });
    expect(v.ok).toBe(true);
    const r = await api(page2.request, "POST", "/api/restore", { backup: file, mode: "replace", confirmReplace: true });
    expect(r.inserted.relations).toBe(file.counts.relations);
    await page2.goto("/decisions");
    await page2.getByRole("link", { name: /先行販売/ }).click();
    await expect(page2.getByRole("link", { name: "◎ Q4 3商品" })).toBeVisible();
    await expect(page2.getByRole("link", { name: "☺ Sample CTO" })).toBeVisible();
    void d;
    await ctx2.close();
  });
});
