import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("P3 移动导入步骤与全屏搜索没有横向溢出", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.getByRole("region", { name: "下一步" }).getByRole("button", { name: "导入资料" }).click();
  await expect(page.getByRole("heading", { name: "导入资料" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1 来源" })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "2 草稿" }).click();
  await expect(page.getByRole("button", { name: "2 草稿" })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "3 确认" }).click();
  await page.screenshot({ path: testInfo.outputPath("p3-import-mobile.png"), fullPage: false });

  await page.getByRole("button", { name: "展开侧边栏" }).click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  const searchTrigger = drawer.getByRole("button", { name: "搜索" });
  await searchTrigger.click();
  const palette = page.getByRole("dialog", { name: "搜索聊天或运行命令" });
  await expect(palette).toBeVisible();
  const box = await palette.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
