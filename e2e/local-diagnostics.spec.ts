import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("设置页诊断面板展示当前快照并提供只读恢复入口", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "诊断" }).click();

  await expect(page.getByRole("heading", { name: "诊断", exact: true })).toBeVisible();
  await expect(page.getByText("当前诊断快照")).toBeVisible();
  await expect(page.getByTestId("diagnostic-section-ai")).toBeVisible();
  await expect(page.getByTestId("diagnostic-section-obsidian")).toBeVisible();
  await expect(page.getByTestId("diagnostic-section-data")).toBeVisible();
  await expect(page.getByTestId("diagnostic-section-automation")).toBeVisible();
  await expect(page.getByTestId("diagnostic-section-browser")).toBeVisible();
  await expect(page.getByTestId("diagnostic-section-app")).toBeVisible();
  await expect(page.getByLabel("诊断报告")).toContainText("本地诊断报告");

  await page.getByRole("button", { name: "复制诊断信息" }).click();
  await expect(page.getByText(/诊断信息已复制|复制失败，请手动选择下方诊断报告/)).toBeVisible();
  await expectNoFrameworkOverlay(page);

  await page.getByRole("button", { name: "配置 AI 连接" }).first().click();
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();

  await page.getByRole("button", { name: "诊断" }).click();
  await page.getByRole("button", { name: "打开知识库" }).first().click();
  await expect(page.getByText("Obsidian 知识图谱")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "诊断" }).click();
  await page.getByRole("button", { name: "打开已安排" }).first().click();
  await expect(page.getByRole("heading", { name: "已安排", exact: true })).toBeVisible();

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
