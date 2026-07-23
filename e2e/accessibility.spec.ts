import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** 关键桌面页面不得出现 axe serious 或 critical 问题。 */
test("桌面总览通过严重级无障碍门禁", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  await testInfo.attach("axe-desktop.json", {
    body: Buffer.from(JSON.stringify(violations, null, 2)),
    contentType: "application/json",
  });
  expect(violations).toEqual([]);
});
