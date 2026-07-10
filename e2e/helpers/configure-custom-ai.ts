import type { Page } from "@playwright/test";

/** 使用紧凑三级选择器创建本地 OpenAI 兼容连接。 */
export async function configureCustomTextConnection(page: Page, input: { label: string; baseUrl: string; model: string }) {
  await page.getByLabel("厂商").selectOption("custom");
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByLabel("连接名称").fill(input.label);
  await page.getByLabel("Base URL").fill(input.baseUrl);
  await page.getByRole("textbox", { name: "手动模型 ID" }).fill(input.model);
  await page.getByRole("button", { name: "保存连接" }).click();
}
