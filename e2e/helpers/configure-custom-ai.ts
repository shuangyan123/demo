import type { Page } from "@playwright/test";

/** 使用紧凑三级选择器创建本地 OpenAI 兼容连接。 */
export async function configureCustomTextConnection(page: Page, input: { label: string; baseUrl: string; model: string }) {
  await page.getByLabel("厂商").selectOption("custom");
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByLabel("连接名称").fill(input.label);
  await page.getByLabel("Base URL").fill(input.baseUrl);
  await page.getByRole("button", { name: "保存连接" }).click();
}

/** 自定义连接的模型属于默认能力，不写回连接档案。 */
export async function setCustomDefaultTextModel(page: Page, connectionLabel: string, modelId: string) {
  await page.locator('select[aria-label="默认文本"]').selectOption({ label: connectionLabel });
  const model = page.getByLabel("默认文本模型");
  await model.fill(modelId);
  await model.press("Enter");
}
