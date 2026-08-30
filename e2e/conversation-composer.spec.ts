import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("Composer 一级入口与斜杠指令保持紧凑且可键盘操作", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "新对话", exact: true }).click();

  const composer = page.locator("[data-conversation-composer]");
  const addButton = composer.getByRole("button", { name: "添加文件等内容", exact: true });
  await expect(addButton).toBeVisible();
  await expect(composer.getByRole("button", { name: "点击开始听写", exact: true })).toBeVisible();
  const voiceButton = composer.getByRole("button", { name: "开启语音聊天", exact: true });
  await expect(voiceButton).toBeVisible();
  await expect(composer.getByRole("button", { name: "选择模型" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "发送" })).toHaveCount(0);

  const input = composer.getByRole("textbox", { name: "对话输入" });
  await input.fill("/解");
  const slashMenu = page.getByRole("listbox", { name: "快捷指令" });
  await expect(slashMenu).toBeVisible();
  await expect(slashMenu.getByRole("option")).toHaveCount(1);
  await expect(slashMenu.getByRole("option")).toContainText("/解释");
  await input.press("Enter");
  await expect(input).toHaveValue("请用通俗语言解释：");
  await expect(slashMenu).toBeHidden();

  await input.fill("/模");
  await input.press("Enter");
  await expect(page.getByRole("dialog", { name: "选择对话模型" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("");

  await input.fill("/mcp");
  await input.press("Enter");
  await expect(page.getByText("请先发送首条消息，再调用 MCP 工具")).toBeVisible();
  await expect(input).toHaveValue("");

  await addButton.click();
  const addMenu = page.getByRole("menu", { name: "添加与工具" });
  await expect(addMenu.getByRole("menuitem", { name: /文件和文件夹/ })).toBeVisible();
  await expect(addMenu.getByRole("menuitem", { name: /摄像头/ })).toBeVisible();
  await expect(addMenu.getByRole("menuitem", { name: /语音输入|实时语音通话|快捷指令/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(addButton).toBeFocused();

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
