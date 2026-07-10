import { expect, test, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 读取真实 review_workspace，验证空白草稿不会提前落库。 */
async function conversationCount(page: Page): Promise<number> {
  return page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const countRequest = database.transaction("aiConversations", "readonly").objectStore("aiConversations").count();
      countRequest.onerror = () => reject(countRequest.error);
      countRequest.onsuccess = () => resolve(countRequest.result);
    };
  }));
}

test("公考默认折叠，新对话保持草稿且普通文本不显示 caret", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");

  const projectSummary = page.locator("summary").filter({ hasText: "公考" }).first();
  await expect(projectSummary).toBeVisible();
  await expect(page.getByRole("button", { name: "错题库" })).toBeHidden();
  await projectSummary.click();
  await expect(page.getByRole("button", { name: "错题库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "错题库" })).toHaveCount(1);

  const before = await conversationCount(page);
  await page.getByRole("button", { name: "新对话" }).click();
  await expect(page.getByRole("textbox", { name: "对话输入" })).toBeVisible();
  expect(await conversationCount(page)).toBe(before);

  const caret = await page.evaluate(() => ({
    heading: getComputedStyle(document.querySelector(".conversation-empty-prompt h2")!).caretColor,
    input: getComputedStyle(document.querySelector("textarea[aria-label='对话输入']")!).caretColor,
  }));
  expect(caret.heading).toMatch(/transparent|rgba\([^)]*,\s*0\)/);
  expect(caret.input).not.toMatch(/transparent|rgba\([^)]*,\s*0\)/);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("对话文件夹可新建、重命名、移动和删除且使用统一操作抽屉", async ({ page }) => {
  await page.goto("/");
  const createFolder = async (name: string) => {
    await page.getByRole("button", { name: "新建文件夹" }).click();
    await page.getByLabel("新文件夹名称").fill(name);
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page.getByRole("button", { name: `${name} 操作` })).toBeVisible();
  };

  await createFolder("目标分类");
  await createFolder("临时分类");
  await page.getByRole("button", { name: "临时分类 操作" }).click();
  const drawer = page.getByRole("dialog", { name: "对话树操作" });
  await drawer.getByLabel("名称").fill("待移动分类");
  await drawer.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("button", { name: "待移动分类 操作" })).toBeVisible();

  await page.getByRole("button", { name: "待移动分类 操作" }).click();
  await drawer.getByLabel("移动到").selectOption({ label: "目标分类" });
  const targetFolder = page.locator(".conversation-tree-folder").filter({ has: page.getByRole("button", { name: "目标分类 操作" }) }).first();
  await expect(targetFolder.getByRole("button", { name: "待移动分类 操作" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "待移动分类 操作" }).click();
  await drawer.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("button", { name: "待移动分类 操作" })).toHaveCount(0);
});
