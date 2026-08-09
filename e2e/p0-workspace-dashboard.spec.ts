import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/layout-assertions";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 计算每个编号圆环中心到桌面装饰路径的最短屏幕距离。 */
async function readDesktopFlowNodeDistances(page: Page) {
  return page.locator(".dashboard-study-flow-canvas").evaluate((canvas) => {
    const paths = [...canvas.querySelectorAll<SVGPathElement>(".dashboard-study-flow-path-desktop [data-flow-segment]")];
    return [...canvas.querySelectorAll<HTMLElement>("[data-flow-node]")].map((node) => {
      const bounds = node.getBoundingClientRect();
      const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      let minimum = Number.POSITIVE_INFINITY;
      for (const path of paths) {
        const matrix = path.getScreenCTM();
        if (!matrix) continue;
        const length = path.getTotalLength();
        for (let offset = 0; offset <= length; offset += 1) {
          const localPoint = path.getPointAtLength(Math.min(offset, length));
          const point = new DOMPoint(localPoint.x, localPoint.y).matrixTransform(matrix);
          minimum = Math.min(minimum, Math.hypot(point.x - center.x, point.y - center.y));
        }
      }
      return minimum;
    });
  });
}

test("桌面总览保持唯一主操作、七阶段链路和三个折叠详情区", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.locator(".dashboard-next-action .ui-button-primary")).toHaveCount(1);
  await expect(page.locator(".dashboard-study-flow-list > li")).toHaveCount(7);
  await expect(page.locator(".dashboard-study-flow-path-desktop")).toBeVisible();
  await expect(page.locator('[data-flow-segment="tail"]')).toHaveAttribute("stroke", "var(--study-flow-green)");
  for (const distance of await readDesktopFlowNodeDistances(page)) expect(distance).toBeLessThanOrEqual(2);
  await expect(page.getByText("粉笔文本、文件或截图先进入可确认草稿。")).toHaveCount(0);

  const dashboardFrame = page.locator(".chrome-content-frame");
  const dashboardMain = page.locator(".chrome-content");
  await expect(page.locator(".chrome-topbar")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.locator(".chrome-sidebar")).toHaveCSS("border-right-width", "0px");
  await expect(dashboardFrame).toHaveAttribute("data-content-surface", "raised-surface");
  await expect(dashboardFrame).toHaveCSS("padding-left", "0px");
  await expect(dashboardFrame).toHaveCSS("overflow", "visible");
  await expect(dashboardFrame).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await dashboardFrame.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe("none");
  const edgeDecoration = await dashboardFrame.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return {
      backgroundImage: style.backgroundImage,
      content: style.content,
    };
  });
  expect(edgeDecoration.backgroundImage).toBe("none");
  expect(edgeDecoration.content === "none" || edgeDecoration.content === "normal").toBe(true);
  await expect(dashboardMain).toHaveCSS("border-top-left-radius", "18px");
  await expect(dashboardMain).toHaveCSS("border-bottom-left-radius", "0px");
  await expect(dashboardMain).toHaveCSS("border-top-width", "1px");
  await expect(dashboardMain).toHaveCSS("border-left-width", "1px");
  await expect(dashboardMain).toHaveCSS("border-bottom-width", "0px");
  const chromeTransition = await page.locator(".chrome-shell").evaluate((shell) => {
    const topbar = shell.querySelector<HTMLElement>(".chrome-topbar")!;
    const sidebar = shell.querySelector<HTMLElement>(".chrome-sidebar")!;
    return {
      diffuseEnabled: document.body.dataset.diffuseGradient === "true",
      sharedBackground: getComputedStyle(shell, "::before").backgroundImage,
      topbarBackground: getComputedStyle(topbar).backgroundImage,
      sidebarBackground: getComputedStyle(sidebar).backgroundImage,
    };
  });
  if (chromeTransition.diffuseEnabled) {
    expect(chromeTransition.sharedBackground).toContain("radial-gradient");
  } else {
    expect(chromeTransition.sharedBackground).toBe("none");
  }
  expect(chromeTransition.topbarBackground).toBe("none");
  expect(chromeTransition.sidebarBackground).toBe("none");
  const sharedEdge = await dashboardMain.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      backgroundPosition: style.backgroundPosition,
      backgroundSize: style.backgroundSize,
      shadow: style.boxShadow,
      scrollbarWidth: style.scrollbarWidth,
    };
  });
  expect(sharedEdge.shadow).toBe("none");
  expect(sharedEdge.backgroundImage).toBe("none");
  expect(sharedEdge.backgroundPosition).toBe("0% 0%");
  expect(sharedEdge.backgroundSize).toBe("auto");
  expect(sharedEdge.scrollbarWidth).toBe("none");
  const desktopGeometry = await page.locator(".chrome-layout").evaluate((layout) => {
    const main = layout.querySelector<HTMLElement>(".chrome-content")!;
    const sidebar = layout.querySelector<HTMLElement>(".chrome-sidebar")!;
    const layoutBounds = layout.getBoundingClientRect();
    const mainBounds = main.getBoundingClientRect();
    const sidebarBounds = sidebar.getBoundingClientRect();
    const frameBounds = layout.querySelector<HTMLElement>(".chrome-content-frame")!.getBoundingClientRect();
    return {
      bottomGap: Math.abs(layoutBounds.bottom - mainBounds.bottom),
      frameTop: frameBounds.top,
      leftGap: Math.abs(sidebarBounds.right - mainBounds.left),
      mainTop: mainBounds.top,
      rightGap: Math.abs(layoutBounds.right - mainBounds.right),
    };
  });
  expect(desktopGeometry.frameTop).toBe(52);
  expect(desktopGeometry.mainTop).toBe(52);
  expect(desktopGeometry.leftGap).toBeLessThanOrEqual(1);
  expect(desktopGeometry.rightGap).toBeLessThanOrEqual(1);
  expect(desktopGeometry.bottomGap).toBeLessThanOrEqual(1);

  for (const label of ["六大板块", "知识中枢", "面试与辅导"]) {
    const disclosure = page.locator(".dashboard-disclosure").filter({ hasText: label });
    await expect(disclosure).not.toHaveAttribute("open", "");
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await disclosure.locator("summary").click();
    await expect(disclosure).not.toHaveAttribute("open", "");
  }

  await page.locator(".chrome-content").evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: testInfo.outputPath("p0-dashboard-desktop.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  await expectNoHorizontalOverflow(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("桌面新对话使用抬升面边界且空白提示靠近底部输入框", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "新对话", exact: true }).click();

  await expect(page.getByRole("heading", { name: "从一个问题开始" })).toBeVisible();
  await expect(page.getByText("发送首条消息后才会创建对话")).toBeVisible();
  const boundary = await page.locator(".chrome-content-frame").evaluate((frame) => {
    const main = frame.querySelector<HTMLElement>(".chrome-content")!;
    const frameStyle = getComputedStyle(frame);
    const mainStyle = getComputedStyle(main);
    return {
      bottomBorderWidth: mainStyle.borderBottomWidth,
      leftBorderWidth: mainStyle.borderLeftWidth,
      paddingLeft: frameStyle.paddingLeft,
      radius: mainStyle.borderTopLeftRadius,
      bottomRadius: mainStyle.borderBottomLeftRadius,
      backgroundImage: mainStyle.backgroundImage,
      backgroundPosition: mainStyle.backgroundPosition,
      backgroundSize: mainStyle.backgroundSize,
      shadow: mainStyle.boxShadow,
      topBorderWidth: mainStyle.borderTopWidth,
    };
  });
  expect(boundary.paddingLeft).toBe("0px");
  expect(boundary.radius).toBe("18px");
  expect(boundary.bottomRadius).toBe("0px");
  expect(boundary.shadow).toBe("none");
  expect(boundary.backgroundImage).toBe("none");
  expect(boundary.backgroundPosition).toBe("0% 0%");
  expect(boundary.backgroundSize).toBe("auto");
  expect(boundary.topBorderWidth).toBe("1px");
  expect(boundary.leftBorderWidth).toBe("1px");
  expect(boundary.bottomBorderWidth).toBe("0px");

  const contentFit = await page.locator(".chrome-content").evaluate((main) => {
    const workspace = main.querySelector<HTMLElement>(".conversation-workspace")!;
    const mainBounds = main.getBoundingClientRect();
    const workspaceBounds = workspace.getBoundingClientRect();
    const mainStyle = getComputedStyle(main);
    const contentBounds = {
      top: mainBounds.top + Number.parseFloat(mainStyle.borderTopWidth),
      right: mainBounds.right - Number.parseFloat(mainStyle.borderRightWidth),
      bottom: mainBounds.bottom - Number.parseFloat(mainStyle.borderBottomWidth),
      left: mainBounds.left + Number.parseFloat(mainStyle.borderLeftWidth),
    };
    return {
      top: Math.abs(workspaceBounds.top - contentBounds.top),
      right: Math.abs(workspaceBounds.right - contentBounds.right),
      bottom: Math.abs(workspaceBounds.bottom - contentBounds.bottom),
      left: Math.abs(workspaceBounds.left - contentBounds.left),
    };
  });
  for (const distance of Object.values(contentFit)) expect(distance).toBeLessThanOrEqual(1);

  const composer = await page.locator(".conversation-composer").boundingBox();
  const prompt = await page.locator(".conversation-empty-prompt").boundingBox();
  expect(composer).toBeTruthy();
  expect(prompt).toBeTruthy();
  expect(1024 - (composer!.y + composer!.height)).toBeLessThan(28);
  expect(composer!.y - (prompt!.y + prompt!.height)).toBeLessThan(150);

  await page.screenshot({ path: testInfo.outputPath("p0-conversation-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(page.locator(".chrome-content-frame")).toHaveCSS("padding-left", "0px");
  await expect(page.locator(".chrome-content")).toHaveCSS("border-top-left-radius", "0px");
});

test("普通模块与独立设置工作台共享同一外层边界", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "错题复盘 暂无到期" }).click();
  await expect(page.locator(".chrome-content-frame")).toHaveAttribute("data-content-surface", "raised-surface");
  await expect(page.locator(".chrome-content-frame")).toHaveCSS("padding-left", "0px");
  await expect(page.locator(".chrome-content")).toHaveCSS("border-top-left-radius", "18px");
  await page.locator(".chrome-shell").evaluate((shell) => { shell.dataset.shellIdentity = "persistent"; });

  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.locator(".chrome-shell")).toHaveCount(1);
  await expect(page.locator(".chrome-shell")).toHaveAttribute("data-shell-identity", "persistent");
  await expect(page.locator(".chrome-content-frame")).toHaveAttribute("data-content-surface", "raised-surface");
  await expect(page.locator(".chrome-content-frame")).toHaveCSS("padding-left", "0px");
  await expect(page.locator(".chrome-content")).toHaveCSS("border-top-left-radius", "18px");
});

test("移动端侧栏是默认关闭的焦点抽屉，七阶段沿 S 曲线自然滚动", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "展开侧边栏" });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole("dialog", { name: "应用导航" })).toBeHidden();
  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "新对话", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await drawer.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "对话输入" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "应用导航" })).toBeHidden();
  await expect(page.locator(".chrome-sidebar")).toHaveCSS("opacity", "0");
  await expect(page.locator(".chrome-content-frame")).toHaveCSS("padding-left", "0px");
  await expect(page.locator(".chrome-content")).toHaveCSS("border-top-left-radius", "0px");
  await expect(page.locator(".chrome-content")).toHaveCSS("box-shadow", "none");
  await page.screenshot({ path: testInfo.outputPath("p0-conversation-mobile.png"), fullPage: false });

  await page.goto("/");
  await expect(page.locator(".chrome-layout")).toHaveAttribute("data-mobile-sidebar", "closed");
  await expect(page.locator(".chrome-sidebar")).toHaveCSS("opacity", "0");
  await expect(page.locator(".dashboard-study-flow-path-mobile")).toBeVisible();
  await expect(page.locator(".dashboard-study-flow-list > li")).toHaveCount(7);
  await expect(page.getByRole("button", { name: /Obsidian 输出/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("p0-dashboard-mobile.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("深色模式下桌面与移动端保持学习路径和新对话可用", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "返回应用" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".dashboard-study-flow-path-desktop")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".dashboard-study-flow-path-mobile")).toBeVisible();
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByRole("dialog", { name: "应用导航" }).getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "对话输入" })).toBeVisible();
  await expect(page.locator(".chrome-content")).toHaveCSS("box-shadow", "none");
  await expectNoHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
