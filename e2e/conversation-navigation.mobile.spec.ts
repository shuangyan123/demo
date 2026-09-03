import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("移动端分区树使用同一底部操作层完成两级移动", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  const navigation = page.getByRole("dialog", { name: "应用导航" });

  await navigation.locator("summary").filter({ hasText: "公考" }).first().click();
  const createPartition = async (name: string) => {
    await navigation.getByRole("button", { name: "新建分区" }).click();
    await navigation.getByLabel("分区名称").fill(name);
    await navigation.getByRole("button", { name: "创建" }).click();
  };

  await createPartition("移动端目标");
  await createPartition("移动端临时");
  const targetPartitionId = await navigation.locator("[data-partition-id]").filter({ hasText: "移动端目标" }).first().getAttribute("data-partition-id");
  expect(targetPartitionId).toBeTruthy();
  await navigation.getByRole("button", { name: "移动端临时 操作" }).click();

  const rootMenu = page.getByRole("menu", { name: "分区和对话操作" });
  const rootBox = await rootMenu.boundingBox();
  const mobileRowHeights = await rootMenu.evaluate((element) => (
    Array.from(element.querySelectorAll<HTMLElement>(":scope > button")).map((item) => item.getBoundingClientRect().height)
  ));
  expect(rootBox).not.toBeNull();
  expect(mobileRowHeights.every((height) => height >= 44)).toBe(true);
  expect((rootBox?.y ?? 0) + (rootBox?.height ?? 0)).toBeGreaterThanOrEqual(840);
  await rootMenu.getByRole("menuitem", { name: "移动到" }).click();

  const moveMenu = page.getByRole("menu", { name: "移动到分区" });
  await expect(moveMenu).toBeVisible();
  await expect(rootMenu.getByRole("menuitem", { name: "重命名" })).toBeHidden();
  await expect(moveMenu.getByRole("menuitem", { name: "移动端临时" })).toHaveCount(0);
  await moveMenu.getByRole("menuitem", { name: "移动端目标" }).click();
  await expect(moveMenu).toBeHidden();
  await expect.poll(() => page.evaluate(async () => new Promise<string | undefined>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const all = request.result.transaction("aiConversationFolders", "readonly").objectStore("aiConversationFolders").getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => resolve((all.result as Array<{ label: string; parentId?: string }>).find((folder) => folder.label === "移动端临时")?.parentId);
    };
  }))).toBe(targetPartitionId);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
