import { expect, type Page } from "@playwright/test";

const CONNECTION_SAVE_READY_TIMEOUT = 15_000;

/** AI 连接编辑器按需打开，测试必须走与用户一致的“添加连接”入口。 */
export async function openConnectionEditor(page: Page) {
  const provider = page.getByRole("combobox", { name: "厂商" });
  if (!await provider.isVisible()) {
    await page.getByRole("button", { name: "添加连接" }).click();
  }
  await provider.waitFor({ state: "visible" });
  return provider;
}

/** 使用紧凑厂商选择器创建本地 OpenAI 兼容连接。 */
export async function configureCustomTextConnection(page: Page, input: { label: string; baseUrl: string; model: string; apiKey?: string }) {
  await (await openConnectionEditor(page)).click();
  await page.getByRole("option", { name: /Local \/ Custom/ }).click();
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByLabel("连接名称").fill(input.label);
  await page.getByLabel("Base URL").fill(input.baseUrl);
  if (input.apiKey) await page.getByLabel("API Key").fill(input.apiKey);
  await page.getByRole("button", { name: "保存连接" }).click();
  // 保存 handler 还会刷新 Dexie snapshot 和兼容默认连接；等待它报告完成，避免后续
  // 凭据迁移在 profile/default/legacy bridge 的跨表写入之间读取不一致快照。
  await expect(page.getByRole("status").filter({ hasText: "配置已保存" })).toBeVisible({ timeout: CONNECTION_SAVE_READY_TIMEOUT });
}

/** 自定义连接的模型属于默认能力，不写回连接档案。 */
export async function setCustomDefaultTextModel(page: Page, connectionLabel: string, modelId: string) {
  await page.getByRole("combobox", { name: "默认文本连接" }).click();
  await page.getByRole("option", { name: connectionLabel, exact: true }).click();
  await page.getByRole("button", { name: "编辑默认文本手动模型 ID" }).click();
  const model = page.getByRole("textbox", { name: "默认文本手动模型 ID" });
  await model.fill(modelId);
  await model.press("Enter");
}
