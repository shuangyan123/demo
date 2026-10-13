import { type Locator } from "@playwright/test";

const WORKSPACE_VIEW_READY_TIMEOUT = 15_000;

/**
 * 以动态视图的语义节点挂载作为就绪条件；Playwright 会轮询至节点出现，成功后立即返回。
 */
export async function waitForWorkspaceViewReady(target: Locator): Promise<void> {
  await target.waitFor({ state: "visible", timeout: WORKSPACE_VIEW_READY_TIMEOUT });
}
