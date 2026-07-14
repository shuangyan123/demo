import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("角色设置可切换定制视图并打开默认人设编辑弹层", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "个性化" }).click();

  await expect(page.getByRole("heading", { name: "个性化" })).toBeVisible();
  await page.getByRole("button", { name: "定制" }).click();
  await expect(page.getByRole("heading", { name: "定制角色" })).toBeVisible();
  await page.getByRole("button", { name: "头像" }).click();
  await expect(page.getByRole("button", { name: "头像" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "闪卡" }).click();
  await expect(page.getByRole("button", { name: "闪卡" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "新建角色" }).click();
  await expect(page.getByRole("button", { name: "新建角色" })).toHaveCount(0);
  await page.getByRole("button", { name: "默认" }).click();
  await expect(page.getByRole("heading", { name: "默认人设" })).toBeVisible();

  const firstPersona = page.locator(".persona-default-persona button").first();
  await firstPersona.click();
  await expect(page.getByText("默认人设编辑")).toBeVisible();
  await page.getByLabel("角色名称").fill("E2E 默认老师");
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByText("默认人设编辑")).toHaveCount(0);

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
