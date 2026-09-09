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

async function conversationPartitionId(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(async (conversationId) => new Promise<string | undefined>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const getRequest = request.result.transaction("aiConversations", "readonly").objectStore("aiConversations").get(conversationId);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => resolve(getRequest.result?.partitionId ?? getRequest.result?.folderId);
    };
  }), id);
}

/** 使用真实指针轨迹驱动 dnd-kit，覆盖激活距离与碰撞检测。 */
async function pointerDrag(page: Page, sourceSelector: string, targetSelector: string): Promise<void> {
  const source = page.locator(sourceSelector);
  await expect(source).toBeVisible();
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("拖拽源没有可见边界");
  const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  await source.hover({ position: { x: sourceBox.width / 2, y: sourceBox.height / 2 } });
  await page.mouse.down();
  // 使用多次真实指针移动越过 PointerSensor 的 6px 激活阈值。
  await page.mouse.move(start.x + 8, start.y + 3, { steps: 4 });
  await page.mouse.move(start.x + 18, start.y + 5, { steps: 6 });
  await page.mouse.move(start.x + 18, start.y + 5);
  await expect(page.locator(".conversation-tree-drag-overlay").first()).toBeVisible();
  const target = page.locator(targetSelector);
  await expect(target).toBeVisible();
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("拖拽目标没有可见边界");
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await expect(page.locator(".conversation-tree-drag-overlay")).toHaveCount(0);
  await expect(page.locator("[data-drop-root-target]")).toHaveCount(0);
}

test("公考默认折叠，新对话保持草稿且普通文本不显示 caret", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");

  const projectSummary = page.locator("summary").filter({ hasText: "公考" }).first();
  await expect(projectSummary).toBeVisible();
  await expect(page.getByRole("button", { name: "错题库" })).toBeHidden();
  await projectSummary.click();
  const moduleSummary = page.locator("summary").filter({ hasText: "学习" }).first();
  await expect(moduleSummary).toBeVisible();
  await expect(page.getByRole("button", { name: "错题库" })).toBeHidden();
  await moduleSummary.click();
  await expect(page.getByRole("button", { name: "错题库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "错题库" })).toHaveCount(1);
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

test("对话分区可通过右键菜单行内重命名、移动和删除", async ({ page }) => {
  await page.goto("/");
  await page.locator("summary").filter({ hasText: "公考" }).first().click();
  const createPartition = async (name: string) => {
    await page.getByRole("button", { name: "新建分区" }).click();
    await page.getByLabel("分区名称").fill(name);
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page.getByRole("button", { name: `${name} 操作` })).toBeVisible();
  };

  await createPartition("目标分类");
  await createPartition("临时分类");
  const temporaryPartition = page.locator('[data-partition-id]').filter({ hasText: "临时分类" }).first();
  await temporaryPartition.click({ button: "right" });
  const drawer = page.getByRole("menu", { name: "分区和对话操作" });
  const contextMenuBox = await drawer.boundingBox();
  await page.locator(".conversation-tree-drawer-backdrop").click({ position: { x: 2, y: 2 } });
  const actionButton = page.getByRole("button", { name: "临时分类 操作" });
  const actionButtonBox = await actionButton.boundingBox();
  await actionButton.click();
  const buttonMenuBox = await drawer.boundingBox();
  const menuMetrics = await drawer.evaluate((element) => {
    const rows = Array.from(element.querySelectorAll<HTMLElement>(":scope > button")).map((item) => item.getBoundingClientRect());
    return {
      heights: rows.map((row) => row.height),
      gaps: rows.slice(1).map((row, index) => row.top - rows[index].bottom),
    };
  });
  expect(contextMenuBox).not.toBeNull();
  expect(buttonMenuBox).not.toBeNull();
  expect(menuMetrics.heights.every((height) => height <= 33)).toBe(true);
  expect(menuMetrics.gaps.every((gap) => gap <= 3)).toBe(true);
  expect(Math.abs((contextMenuBox?.x ?? 0) - (buttonMenuBox?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((contextMenuBox?.y ?? 0) - (buttonMenuBox?.y ?? 0))).toBeLessThanOrEqual(1);
  expect((buttonMenuBox?.x ?? 0) >= (actionButtonBox?.x ?? 0) + (actionButtonBox?.width ?? 0)).toBe(true);
  await expect(drawer.getByRole("menuitem", { name: "重命名" }).locator("svg")).toHaveCount(1);
  await expect(drawer.getByRole("menuitem", { name: "移动到" }).locator("svg")).toHaveCount(2);
  await drawer.getByRole("menuitem", { name: "重命名" }).click();
  const renameInput = page.getByLabel("重命名临时分类");
  await renameInput.fill("待移动分类");
  await renameInput.press("Enter");
  await expect(page.getByRole("button", { name: "待移动分类 操作" })).toBeVisible();

  await page.getByRole("button", { name: "待移动分类 操作" }).click();
  await drawer.getByRole("menuitem", { name: "移动到" }).click();
  const moveMenu = page.getByRole("menu", { name: "移动到分区" });
  await expect(moveMenu).toBeVisible();
  await moveMenu.getByRole("menuitem", { name: "目标分类" }).click();
  const targetPartition = page.locator("[data-partition-id]").filter({ has: page.getByRole("button", { name: "目标分类 操作" }) }).first();
  await expect(targetPartition.getByRole("button", { name: "待移动分类 操作" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "待移动分类 操作" }).click();
  await drawer.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.getByRole("button", { name: "待移动分类 操作" })).toHaveCount(0);
});

test("桌面名称区域可将持久化对话移入分区并拖回项目根目录", async ({ page }) => {
  await page.goto("/");
  await page.locator("summary").filter({ hasText: "公考" }).first().click();
  await page.getByRole("button", { name: "新建分区" }).click();
  await page.getByLabel("分区名称").fill("拖拽目标");
  await page.getByRole("button", { name: "创建" }).click();
  await page.getByRole("button", { name: "新建分区" }).click();
  await page.getByLabel("分区名称").fill("嵌套分区");
  await page.getByRole("button", { name: "创建" }).click();

  const targetRootPartition = page.locator('[data-partition-id]').filter({ hasText: "拖拽目标" }).first();
  const nestedRootPartition = page.locator('[data-partition-id]').filter({ hasText: "嵌套分区" }).first();
  const initialTargetPartitionId = await targetRootPartition.getAttribute("data-partition-id");
  const nestedPartitionId = await nestedRootPartition.getAttribute("data-partition-id");
  expect(initialTargetPartitionId).toBeTruthy();
  expect(nestedPartitionId).toBeTruthy();
  await pointerDrag(page, `[data-partition-id="${nestedPartitionId}"] > .conversation-tree-folder-row .conversation-tree-folder-label`, `[data-partition-id="${initialTargetPartitionId}"] > .conversation-tree-folder-row`);
  await expect(targetRootPartition.getByRole("button", { name: "嵌套分区 操作" })).toBeVisible();
  await pointerDrag(page, `[data-partition-id="${nestedPartitionId}"] > .conversation-tree-folder-row .conversation-tree-folder-label`, "[data-drop-root-target]");
  await expect(page.locator('[data-drop-root] > [data-partition-id]').filter({ hasText: "嵌套分区" })).toBeVisible();

  await seedConversation(page, "drag-conversation", "拖拽验证对话");
  await page.reload();
  const reloadedProjectSummary = page.locator("summary").filter({ hasText: "公考" }).first();
  await expect(reloadedProjectSummary).toBeVisible();
  if (!await reloadedProjectSummary.evaluate((element) => element.parentElement?.hasAttribute("open"))) await reloadedProjectSummary.click();

  const rootPartitionX = await page.locator('[data-partition-id] .conversation-tree-folder-label').first().evaluate((element) => element.getBoundingClientRect().x);
  const rootChatX = await page.locator('[data-conversation-id="drag-conversation"] .conversation-tree-chat-label').evaluate((element) => element.getBoundingClientRect().x);
  expect(Math.abs(rootChatX - rootPartitionX)).toBeLessThanOrEqual(1);

  const partition = page.locator('[data-partition-id]').filter({ hasText: "拖拽目标" }).first();
  const partitionId = await partition.getAttribute("data-partition-id");
  expect(partitionId).toBeTruthy();
  await pointerDrag(page, '[data-conversation-id="drag-conversation"] .conversation-tree-chat-label', `[data-partition-id="${partitionId}"] > .conversation-tree-folder-row`);
  await expect(partition.locator('[data-conversation-id="drag-conversation"]')).toBeVisible();
  expect(await conversationPartitionId(page, "drag-conversation")).toBe(partitionId);

  await pointerDrag(page, `[data-partition-id="${partitionId}"] [data-conversation-id="drag-conversation"] .conversation-tree-chat-label`, "[data-drop-root-target]");
  await expect(page.locator('[data-drop-root] > [data-conversation-id="drag-conversation"]')).toBeVisible();
  expect(await conversationPartitionId(page, "drag-conversation")).toBeUndefined();

});
