import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function openDataManagement(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "诊断", exact: true }).click();
  await expect(page.getByText("数据管理", { exact: true })).toBeVisible();
}

test("explicit diagnostic export preserves source facts and cannot be imported as V2", async ({ page }) => {
  await page.goto("/diagnostic");
  await page.locator('input[value="five"]').check();
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已提交" })).toBeVisible();
  const fixture = JSON.parse(await readFile(".cache/f3-validation/diagnostic-server-fixture.json", "utf8"));
  expect(fixture.root).toContain("recall-durable-submission-test-");
  const before = await readFile(fixture.file, "utf8");
  const original = JSON.parse(before);
  await openDataManagement(page);
  await expect(page.getByText(/V2 仅包含受支持的本地数据库记录/)).toBeVisible();
  await expect(page.getByText(/此文件当前仅供归档，尚不能导入恢复；/)).toBeVisible();
  const downloading = page.waitForEvent("download");
  const button = page.getByRole("button", { name: "导出诊断学习历史", exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
  const download = await downloading;
  const file = await download.path();
  expect(file).not.toBeNull();
  const source = await readFile(file!, "utf8");
  const { integrity, ...payload } = JSON.parse(source);
  expect(payload.format).toBe("recall-diagnostic-history-export");
  expect(payload.captures).toEqual(original.captures);
  expect(payload.captureCount).toBe(original.captures.length);
  expect(payload.restoreSupport).toBe("not_implemented");
  expect(payload.notice).toBe("目前不可导入恢复");
  expect(integrity.digest).toBe(createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
  expect(source).not.toContain(original.profileId);
  expect(source).not.toContain(original.epochId);
  await expect(page.getByRole("status")).toContainText("已请求下载诊断学习历史");
  await page.getByLabel("选择本地数据备份").setInputFiles(file!);
  await expect(page.getByRole("status")).toContainText("不支持的备份版本");
  await expect(page.getByRole("dialog", { name: "确认恢复本地备份" })).toHaveCount(0);
  expect(await readFile(fixture.file, "utf8")).toBe(before);
});

test("unavailable history shows a retryable manual action without a successful download", async ({ page }) => {
  await openDataManagement(page);
  await page.route("**/api/diagnostic/export", route => route.fulfill({ status: 503,
    contentType: "application/json", body: JSON.stringify({ code: "diagnostic_export_unavailable" }) }));
  let downloads = 0;
  page.on("download", () => { downloads++; });
  await page.getByRole("button", { name: "导出诊断学习历史", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("诊断学习历史导出未完成");
  await expect(page.getByRole("button", { name: "导出诊断学习历史", exact: true })).toBeEnabled();
  expect(downloads).toBe(0);
});
