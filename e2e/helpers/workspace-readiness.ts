import { expect, type Locator, type Page } from "@playwright/test";

const MODULE_READY_TIMEOUT = 20_000;

/** 只等待真实模块子树替换 lazy fallback；业务语义仍由调用处的原断言检查。 */
export async function waitForWorkspaceModule(page: Page, moduleRoot: Locator): Promise<void> {
  // 先等仅由模块渲染的节点，避免 fallback 尚未挂载时 count=0 提前通过。
  await expect(moduleRoot, "lazy module subtree should be ready").toBeVisible({ timeout: MODULE_READY_TIMEOUT });
  await expect(page.getByRole("status").filter({ hasText: "正在加载模块" })).toHaveCount(0);
}
