import { expect, test, type Page } from "@playwright/test";
import { configureCustomTextConnection } from "./helpers/configure-custom-ai";

async function openAiConnectionSettings(page: Page) {
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();
}

async function installFakeDesktopCredentialProtection(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "reviewDesktopCredentialProtection", {
      configurable: true,
      value: {
        getStatus: async () => ({ ok: true, value: { status: "available", backend: "os_protected" } }),
        protectCredential: async (context: string) => ({ ok: true, value: { version: "desktop-v1", context, payload: "YQ==" } }),
        unprotectCredential: async (context: string) => ({ ok: true, value: { secret: "", shouldReProtect: false, context } }),
      },
    });
  });
}

test("Web 不展示 Desktop 凭据迁移入口", async ({ page }) => {
  await page.goto("/");
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop 凭据保护" })).toHaveCount(0);
});

test("Desktop 迁移必须由用户显式启动，且完成状态可从 journal 恢复", async ({ page }) => {
  await installFakeDesktopCredentialProtection(page);
  await page.goto("/");
  await openAiConnectionSettings(page);

  const panel = page.getByRole("region", { name: "Desktop 凭据保护" });
  await expect(panel).toHaveAttribute("data-status", "ready");
  expect(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-migration:v1"))).toBeNull();

  await configureCustomTextConnection(page, { label: "E2E Desktop credential", baseUrl: "http://127.0.0.1:9999/v1", model: "unused" });
  await panel.getByRole("button", { name: "迁移到 Desktop 保护" }).click();
  await expect(panel).toHaveAttribute("data-status", "complete");
  await expect(panel).toContainText("未执行清理");
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem("review-workspace:credential-migration:v1") ?? "{}").state)).toBe("complete");

  await page.reload();
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop 凭据保护" })).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("button", { name: "迁移到 Desktop 保护" })).toHaveCount(0);
});
