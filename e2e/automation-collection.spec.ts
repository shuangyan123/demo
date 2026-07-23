import { expect, test } from "@playwright/test";
import { configureCustomTextConnection, setCustomDefaultTextModel } from "./helpers/configure-custom-ai";
import { startMockAiProvider, type MockAiRequest } from "./helpers/mock-ai-provider";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

const cases = [
  { template: "xingce_collection", label: "行测采集", title: "资料分析增长率方法", body: "先确认基期与现期，再核对增长率口径和常见陷阱。" },
  { template: "shenlun_collection", label: "申论采集", title: "基层治理主题素材", body: "政策原文强调基层治理协同，并可用于提出分层论证结构。" },
  { template: "interview_collection", label: "面试采集", title: "公共服务热点作答框架", body: "可核验事实与观点材料分列，再按问题、原因、措施组织作答。" },
] as const;

function curatorResponse(title: string, body: string) {
  return (request: MockAiRequest): string => {
    const payload = JSON.parse(((request.body as { messages?: Array<{ role: string; content: string }> }).messages?.find((message) => message.role === "user")?.content ?? "{}")) as { evidence?: Array<{ id: string }> };
    return JSON.stringify({ items: [{ key: "proposal-1", title, summary: body, paragraphs: [{ text: body, evidenceIds: [payload.evidence?.[0]?.id] }], tags: ["e2e", "外部采集"], proposedLinks: [], reason: "由白名单公开资料整理" }] });
  };
}

for (const item of cases) {
  test(`${item.label}从白名单资料生成带证据的待确认提案`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1536, height: 1024 });
    const provider = await startMockAiProvider({ response: curatorResponse(item.title, item.body) });
    const runtimeErrors = collectRuntimeErrors(page);
    let fetchCount = 0;
    await page.route("**/api/acquisition/fetch", async (route) => {
      fetchCount += 1;
      const requestBody = route.request().postDataJSON() as { url: string };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        url: requestBody.url, title: `${item.label}公开资料`, publisher: "E2E 官方来源", publishedAt: "2026-07-20T00:00:00.000Z",
        fetchedAt: "2026-07-21T00:00:00.000Z", contentHash: `hash-${item.template}`, text: `${item.body} 这是可核验的一手材料。`, excerpt: item.body,
        discoveredUrls: [], contentType: "text/html",
      }) });
    });

    try {
      await page.goto("/");
      await page.getByRole("button", { name: "设置" }).first().click();
      await page.getByRole("button", { name: "AI 连接" }).click();
      await configureCustomTextConnection(page, { label: `${item.label} Mock`, baseUrl: provider.baseUrl, model: "mock-collection-model" });
      await setCustomDefaultTextModel(page, `${item.label} Mock`, "mock-collection-model");

      await page.goto("/");
      await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
      await page.getByRole("button", { name: "新建任务" }).click();
      await page.getByLabel("模板").selectOption(item.template);
      await page.getByRole("button", { name: "+ 页面" }).click();
      await page.getByLabel("来源名称").fill("E2E 白名单来源");
      await page.getByRole("checkbox", { name: "启用" }).check();
      await page.getByLabel("指定页面 URL").fill("https://example.com/allowed\nhttps://blocked.test/drop");
      await page.getByLabel("任务允许域名").fill("https://example.com");
      await page.getByLabel("来源允许域名").fill("https://example.com");
      await page.getByLabel("权威性").selectOption("official");
      await page.getByLabel("整理模型 A连接").selectOption({ label: `${item.label} Mock` });
      await page.getByLabel("整理模型 A模型 ID").fill("mock-collection-model");

      await page.getByRole("button", { name: "预览读取范围" }).click();
      const preview = page.getByRole("region", { name: "已安排读取范围预览" });
      await expect(preview).toContainText("E2E 白名单来源");
      await expect(preview).toContainText("https://example.com");
      expect(fetchCount).toBe(0);
      expect(provider.requests).toHaveLength(0);
      if (item.template === "xingce_collection") await page.screenshot({ path: testInfo.outputPath("scheduled-collection-desktop-1536x1024.png"), fullPage: true });

      await page.getByRole("button", { name: "试运行", exact: true }).click();
      await expect(page.getByText("试运行结果", { exact: true })).toBeVisible();
      await expect(page.getByText(/试运行整理出 1 条外部知识提案/)).toBeVisible();
      expect(fetchCount).toBe(1);
      expect(provider.requests).toHaveLength(1);

      await page.getByRole("button", { name: "创建已安排" }).click();
      const taskCard = page.locator("article").filter({ hasText: item.label }).first();
      await taskCard.getByRole("button", { name: new RegExp(item.label) }).click();
      await page.getByRole("button", { name: "立即运行" }).click();
      await expect.poll(() => provider.requests.length).toBe(2);
      expect(fetchCount).toBe(2);
      const inbox = page.locator("section").filter({ hasText: "运行收件箱" }).first();
      await expect(inbox.getByText(/已生成 1 条外部知识提案/)).toBeVisible();
      await inbox.getByRole("button", { name: "查看详情" }).first().click();
      await expect(inbox).toContainText("B 级 1");
      await expect(inbox).toContainText("未交叉");

      await page.goto("/");
      await page.locator(".dashboard-configuration-health > summary").click();
      await page.locator(".dashboard-configuration-health").getByRole("button", { name: "连接 Obsidian" }).click();
      await expect(page.getByText(item.title)).toBeVisible();
      await expect(page.locator("span").filter({ hasText: /^未交叉复核$/ }).first()).toBeVisible();
      await expect(page.getByText(/段落证据 · 1 条/)).toBeVisible();
      await expect(page.getByRole("link", { name: /E2E 官方来源/ })).toBeVisible();
      if (item.template === "xingce_collection") {
        /** 将新增复核工作台定位为视觉验收主画面，避免长页面截图只展示知识库概览。 */
        await page.getByRole("heading", { name: "知识演进提案" }).evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: testInfo.outputPath("scheduled-proposal-review-desktop-1536x1024.png") });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        await page.getByRole("heading", { name: "知识演进提案" }).evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: testInfo.outputPath("scheduled-proposal-review-mobile-390x844.png") });
      }

      await expectNoFrameworkOverlay(page);
      expectNoRuntimeErrors(runtimeErrors);
    } finally {
      await provider.stop();
    }
  });
}

test("MCP 搜索只提供候选 URL 且丢弃非白名单结果", async ({ page }) => {
  const provider = await startMockAiProvider({ response: curatorResponse("MCP 行测方法", "只使用白名单页面的证据整理方法。") });
  const fetchedUrls: string[] = [];
  const mcpCalls: Array<{ tool?: string; arguments?: Record<string, unknown> }> = [];
  await page.route("**/api/mcp/call", async (route) => {
    mcpCalls.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { items: ["https://example.com/allowed", "https://blocked.test/drop"] } }) });
  });
  await page.route("**/api/acquisition/fetch", async (route) => {
    const body = route.request().postDataJSON() as { url: string };
    fetchedUrls.push(body.url);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      url: body.url, title: "MCP 候选正文", publisher: "E2E 官方来源", publishedAt: "2026-07-20T00:00:00.000Z", fetchedAt: "2026-07-21T00:00:00.000Z",
      contentHash: "mcp-hash", text: "白名单候选正文提供可核验的行测方法证据。", excerpt: "白名单候选正文", discoveredUrls: [], contentType: "text/html",
    }) });
  });
  try {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("review-workspace:mcp-settings:v2", JSON.stringify({
      profiles: [{ id: "mcp-e2e", label: "E2E Search", endpoint: "https://mcp.example.com/mcp", enabled: true, authMode: "none", createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" }],
      discovery: { "mcp-e2e": { serverId: "mcp-e2e", status: "ready", tools: ["search"], resources: [], prompts: [], message: "ready", toolDescriptors: [{ name: "search", permission: "allow_scheduled" }] } },
    })));
    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await configureCustomTextConnection(page, { label: "MCP Collection Mock", baseUrl: provider.baseUrl, model: "mock-collection-model" });
    await setCustomDefaultTextModel(page, "MCP Collection Mock", "mock-collection-model");

    await page.goto("/");
    await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
    await page.getByRole("button", { name: "新建任务" }).click();
    await page.getByLabel("模板").selectOption("xingce_collection");
    await page.getByRole("button", { name: "+ MCP" }).click();
    await page.getByRole("checkbox", { name: "启用" }).check();
    await page.getByLabel("任务允许域名").fill("https://example.com");
    await page.getByLabel("来源允许域名").fill("https://example.com");
    await page.getByLabel("MCP 定时工具").selectOption({ label: "E2E Search · search" });
    await page.getByLabel("整理模型 A连接").selectOption({ label: "MCP Collection Mock" });
    await page.getByLabel("整理模型 A模型 ID").fill("mock-collection-model");
    await page.getByRole("button", { name: "试运行", exact: true }).click();
    await expect(page.getByText(/试运行整理出 1 条外部知识提案/)).toBeVisible();
    expect(mcpCalls).toHaveLength(1);
    expect(mcpCalls[0]).toMatchObject({ tool: "search", arguments: { query: "行测 题型方法 答案依据" } });
    expect(fetchedUrls).toEqual(["https://example.com/allowed"]);
  } finally {
    await provider.stop();
  }
});

test("双模型事实分歧进入争议并阻止确认", async ({ page }) => {
  const provider = await startMockAiProvider({ response: (request) => {
    const messages = (request.body as { messages?: Array<{ role: string; content: string }> }).messages ?? [];
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (system.includes("独立事实复核模型")) return JSON.stringify({ items: [{ key: "proposal-1", status: "disputed", issues: ["证据不足以支持具体结论"] }] });
    const payload = JSON.parse(messages.find((message) => message.role === "user")?.content ?? "{}") as { evidence?: Array<{ id: string }> };
    return JSON.stringify({ items: [{ key: "proposal-1", title: "争议热点材料", summary: "待复核材料", paragraphs: [{ text: "证据不足的具体结论。", evidenceIds: [payload.evidence?.[0]?.id] }], tags: ["争议"], proposedLinks: [], reason: "测试模型分歧" }] });
  } });
  await page.route("**/api/acquisition/fetch", async (route) => {
    const body = route.request().postDataJSON() as { url: string };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: body.url, title: "热点材料", publisher: "公开来源", publishedAt: "2026-07-20T00:00:00.000Z", fetchedAt: "2026-07-21T00:00:00.000Z", contentHash: "disputed-hash", text: "公开材料只陈述基础事实。", excerpt: "基础事实", discoveredUrls: [], contentType: "text/html" }) });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await configureCustomTextConnection(page, { label: "Dual Model Mock", baseUrl: provider.baseUrl, model: "curator-model" });
    await setCustomDefaultTextModel(page, "Dual Model Mock", "curator-model");
    await page.goto("/");
    await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
    await page.getByRole("button", { name: "新建任务" }).click();
    await page.getByLabel("模板").selectOption("interview_collection");
    await page.getByRole("button", { name: "+ 页面" }).click();
    await page.getByRole("checkbox", { name: "启用" }).check();
    await page.getByLabel("指定页面 URL").fill("https://example.com/hot");
    await page.getByLabel("任务允许域名").fill("https://example.com");
    await page.getByLabel("来源允许域名").fill("https://example.com");
    await page.getByLabel("整理模型 A连接").selectOption({ label: "Dual Model Mock" });
    await page.getByLabel("整理模型 A模型 ID").fill("curator-model");
    await page.getByLabel("复核模型 B连接").selectOption({ label: "Dual Model Mock" });
    await page.getByLabel("复核模型 B模型 ID").fill("reviewer-model");
    await page.getByRole("button", { name: "创建已安排" }).click();
    const card = page.locator("article").filter({ hasText: "面试采集" }).first();
    await card.getByRole("button", { name: /面试采集/ }).click();
    await page.getByRole("button", { name: "立即运行" }).click();
    await expect.poll(() => provider.requests.length).toBe(2);
    await page.goto("/");
    await page.locator(".dashboard-configuration-health > summary").click();
    await page.locator(".dashboard-configuration-health").getByRole("button", { name: "连接 Obsidian" }).click();
    await expect(page.getByText("争议热点材料")).toBeVisible();
    await expect(page.locator("span").filter({ hasText: /^有争议$/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "确认写入" })).toBeDisabled();
    await expect(page.getByLabel("选择 争议热点材料")).toBeDisabled();
  } finally {
    await provider.stop();
  }
});
