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

/** 直接向真实 IndexedDB 写入一条持久化对话，用于验证树拖拽与 repository 更新闭环。 */
async function seedConversation(page: Page, id: string, title: string): Promise<void> {
  await page.evaluate(async ({ conversationId, conversationTitle }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("aiConversations", "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      const timestamp = new Date().toISOString();
      transaction.objectStore("aiConversations").put({ id: conversationId, projectId: "civil-service", studyDomainId: "civil-service", title: conversationTitle, kind: "general", status: "active", sourceType: "manual", messageCount: 1, createdAt: timestamp, updatedAt: timestamp });
    };
  }), { conversationId: id, conversationTitle: title });
}

async function conversationFolderId(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(async (conversationId) => new Promise<string | undefined>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const getRequest = request.result.transaction("aiConversations", "readonly").objectStore("aiConversations").get(conversationId);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => resolve(getRequest.result?.folderId);
    };
  }), id);
}

/** 使用浏览器原生 DataTransfer 驱动完整 HTML5 拖拽事件链。 */
async function html5Drag(page: Page, sourceSelector: string, targetSelector: string): Promise<void> {
  await page.evaluate(({ sourceSelector: sourceQuery, targetSelector: targetQuery }) => {
    const source = document.querySelector(sourceQuery);
    const target = document.querySelector(targetQuery);
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) throw new Error("拖拽源或目标不存在");
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
  }, { sourceSelector, targetSelector });
}

test("公考默认折叠，新对话保持草稿且普通文本不显示 caret", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");

  const projectSummary = page.locator("summary").filter({ hasText: "公考" }).first();
  await expect(projectSummary).toBeVisible();
  await expect(page.getByRole("button", { name: "学习数据" })).toBeHidden();
  await projectSummary.click();
  const moduleSummary = page.locator("summary").filter({ hasText: "模块" }).first();
  await expect(moduleSummary).toBeVisible();
  await expect(page.getByRole("button", { name: "学习数据" })).toBeHidden();
  await moduleSummary.click();
  await expect(page.getByRole("button", { name: "学习数据" })).toBeVisible();
  await expect(page.getByRole("button", { name: "学习数据" })).toHaveCount(1);
  await expect(page.getByText("板块筛选")).toHaveCount(0);

  const before = await conversationCount(page);
  await page.getByRole("button", { name: "新对话", exact: true }).click();
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

test("桌面拖拽手柄可将持久化对话移入文件夹并拖回根目录", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByLabel("新文件夹名称").fill("拖拽目标");
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByLabel("新文件夹名称").fill("嵌套文件夹");
  await page.getByRole("button", { name: "创建" }).click();
  await seedConversation(page, "drag-conversation", "拖拽验证对话");
  await page.reload();

  const folder = page.locator('[data-folder-id]').filter({ hasText: "拖拽目标" }).first();
  const folderId = await folder.getAttribute("data-folder-id");
  expect(folderId).toBeTruthy();
  await html5Drag(page, '[data-conversation-id="drag-conversation"] .conversation-tree-drag-handle', `[data-folder-id="${folderId}"] > .conversation-tree-folder-row`);
  await expect(folder.locator('[data-conversation-id="drag-conversation"]')).toBeVisible();
  expect(await conversationFolderId(page, "drag-conversation")).toBe(folderId);

  await html5Drag(page, `[data-folder-id="${folderId}"] [data-conversation-id="drag-conversation"] .conversation-tree-drag-handle`, "[data-drop-root]");
  await expect(page.locator('[data-drop-root] > [data-conversation-id="drag-conversation"]')).toBeVisible();
  expect(await conversationFolderId(page, "drag-conversation")).toBeUndefined();

  const targetRootFolder = page.locator('[data-folder-id]').filter({ hasText: "拖拽目标" }).first();
  const nestedRootFolder = page.locator('[data-folder-id]').filter({ hasText: "嵌套文件夹" }).first();
  const nestedFolderId = await nestedRootFolder.getAttribute("data-folder-id");
  expect(nestedFolderId).toBeTruthy();
  await html5Drag(page, `[data-folder-id="${nestedFolderId}"] > .conversation-tree-folder-row .conversation-tree-drag-handle`, `[data-folder-id="${folderId}"] > .conversation-tree-folder-row`);
  await expect(targetRootFolder.getByRole("button", { name: "嵌套文件夹 操作" })).toBeVisible();
  await html5Drag(page, `[data-folder-id="${nestedFolderId}"] > .conversation-tree-folder-row .conversation-tree-drag-handle`, "[data-drop-root]");
  await expect(page.locator('[data-drop-root] > [data-folder-id]').filter({ hasText: "嵌套文件夹" })).toBeVisible();
});
