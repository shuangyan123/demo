import { expect, type ConsoleMessage, type Page } from "@playwright/test";

const RUNTIME_ERROR_PATTERN = /Cannot read properties of null|Unhandled Runtime|Application error|TypeError/i;

/** 收集浏览器运行时错误，供关键流程统一断言页面没有崩溃。 */
export function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message: ConsoleMessage) => {
    if (["error", "warning"].includes(message.type()) && RUNTIME_ERROR_PATTERN.test(message.text())) {
      errors.push(message.text());
    }
  });
  return errors;
}

/** 断言页面没有框架错误覆盖层，避免测试只检查控件却漏掉 Next/React 崩溃。 */
export async function expectNoFrameworkOverlay(page: Page): Promise<void> {
  await expect(page.getByText(RUNTIME_ERROR_PATTERN)).toHaveCount(0);
}

/** 断言监听到的运行时错误为空。 */
export function expectNoRuntimeErrors(errors: string[]): void {
  expect(errors).toEqual([]);
}
