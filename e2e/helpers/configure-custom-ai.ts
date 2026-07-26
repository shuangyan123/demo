import type { Page } from "@playwright/test";

/** 使用紧凑厂商选择器创建本地 OpenAI 兼容连接。 */
export async function configureCustomTextConnection(page: Page, input: { label: string; baseUrl: string; model: string }) {
  await page.getByRole("combobox", { name: "厂商" }).click();
  await page.getByRole("option", { name: /Local \/ Custom/ }).click();
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByLabel("连接名称").fill(input.label);
  await page.getByLabel("Base URL").fill(input.baseUrl);
  await page.getByRole("button", { name: "保存连接" }).click();
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
