import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { configureCustomTextConnection, setCustomDefaultTextModel } from "./helpers/configure-custom-ai";

test("AI 连接可保存本地自定义文本连接并设为默认", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();

  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await configureCustomTextConnection(page, { label: "E2E 本地文本连接", baseUrl: "http://127.0.0.1:9999/v1", model: "local-e2e-model" });

  await expect(page.getByRole("button", { name: /E2E 本地文本连接/ })).toBeVisible();
  await setCustomDefaultTextModel(page, "E2E 本地文本连接", "local-e2e-model");
  await expect(page.getByRole("combobox", { name: "默认文本连接" })).toContainText("E2E 本地文本连接");

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("本机密钥库缺失时连接进入可恢复状态且重输只替换当前凭据", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const originalSecret = "e2e-original-secret-never-render";
  const replacementSecret = "e2e-replacement-secret-never-render";

  const openConnections = async () => {
    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
  };

  await page.goto("/");
  await openConnections();
  await page.getByRole("combobox", { name: "厂商" }).click();
  await page.getByRole("option", { name: /Local \/ Custom/ }).click();
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByLabel("连接名称").fill("E2E 凭据恢复");
  await page.getByLabel("Base URL").fill("http://127.0.0.1:9999/v1");
  await page.getByLabel("API Key").fill(originalSecret);
  await page.getByRole("button", { name: "保存连接" }).click();
  await expect(page.getByText("配置已保存")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(originalSecret);

  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace_secure_keys");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("keys", "readwrite");
      transaction.objectStore("keys").clear();
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        request.result.close();
        resolve();
      };
    };
  }));
  await page.reload();
  await openConnections();

  const savedRow = page.getByRole("button", { name: /E2E 凭据恢复/ }).locator("..");
  await expect(savedRow).toContainText("需要重新输入");
  await page.getByRole("button", { name: "重新输入密钥" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "凭据需要重新输入" })).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await page.getByLabel("API Key").fill(replacementSecret);
  await page.getByRole("button", { name: "保存连接" }).click();
  await expect(page.getByText("配置已保存")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新输入密钥" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(replacementSecret);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("官方厂商保存反馈就近显示且切换厂商原地更新", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();

  const form = page.locator("form").filter({ has: page.getByRole("combobox", { name: "厂商" }) });
  await form.getByRole("combobox", { name: "厂商" }).click();
  await page.getByRole("option", { name: "Google Gemini" }).click();
  await form.getByText("高级设置", { exact: true }).click();
  await form.getByLabel("API Key").fill("e2e-google-secret-never-render");
  await form.getByRole("button", { name: "保存连接" }).click();
  await expect(form.getByRole("status")).toContainText("配置已保存");

  await form.getByRole("combobox", { name: "厂商" }).click();
  await page.getByRole("option", { name: "DeepSeek" }).click();
  await form.getByRole("button", { name: "保存连接" }).click();
  await expect(form.getByRole("alert")).toContainText("切换厂商后必须重新输入 API Key");
  await expect(form.getByLabel("API Key")).toBeFocused();

  await form.getByLabel("API Key").fill("e2e-deepseek-secret-never-render");
  await form.getByRole("button", { name: "保存连接" }).click();
  await expect(form.getByRole("status")).toContainText("配置已保存");
  const profiles = await page.evaluate(async () => new Promise<Array<{ id: string; provider: string }>>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const all = request.result.transaction("apiConnectionProfiles", "readonly").objectStore("apiConnectionProfiles").getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => resolve(all.result.map(({ id, provider }) => ({ id, provider })));
    };
  }));
  expect(profiles).toHaveLength(1);
  expect(profiles[0].provider).toBe("deepseek");
  await expect(page.locator("body")).not.toContainText("e2e-google-secret-never-render");
  await expect(page.locator("body")).not.toContainText("e2e-deepseek-secret-never-render");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
