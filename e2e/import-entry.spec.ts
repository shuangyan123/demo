import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("导入资料可生成知识资料草稿并确认入库", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByRole("button", { name: "导入资料" }).first().click();
  await expect(page.getByRole("heading", { name: "粉笔导入", exact: true })).toBeVisible();

  const knowledgeImportForm = page.locator("form").filter({ has: page.getByRole("button", { name: "生成资料草稿" }) });
  await knowledgeImportForm.getByLabel("资料文本").fill("E2E 知识资料标题\n\n这是一段用于端到端测试的知识资料正文。");
  await knowledgeImportForm.getByLabel("标签").fill("e2e,资料");
  await knowledgeImportForm.getByLabel("来源").fill("E2E 导入");
  await knowledgeImportForm.getByRole("button", { name: "生成资料草稿" }).click();

  await expect(page.getByText("已生成 2 条知识资料草稿，请确认后入库")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "标题" }).first()).toHaveValue("E2E 知识资料标题");
  await page.getByRole("button", { name: /确认保存 2 条/ }).click();

  await expect(page.getByText("已保存 2 条知识资料")).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E 知识资料标题/ }).first()).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("手动录入可保存错题并在错题库中展示", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByRole("button", { name: "手动录入" }).first().click();

  const entryForm = page.locator("form").filter({ has: page.getByRole("button", { name: "保存错题" }) });
  await entryForm.getByLabel("板块").selectOption("资料分析");
  await entryForm.getByLabel("来源").fill("E2E 手动录入");
  await entryForm.getByLabel("标签").fill("e2e,错题");
  await entryForm.getByLabel("初始掌握度").selectOption("2");
  await entryForm.getByLabel("题干").fill("E2E 手动录入题干：资料分析增长率判断。");
  await entryForm.getByLabel("答案").fill("B");
  await entryForm.getByLabel("错因").fill("公式混淆");
  await entryForm.getByLabel("解析").fill("先判断基期，再比较增长率。");
  await entryForm.getByRole("button", { name: "保存错题" }).click();

  await expect(page.getByText("错题已保存到 IndexedDB")).toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E 手动录入题干：资料分析增长率判断。" })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
