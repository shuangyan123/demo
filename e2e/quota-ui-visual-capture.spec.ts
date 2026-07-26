import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test } from "@playwright/test";

const captureEnabled = process.env.CAPTURE_VISUALS === "1";
const evidenceDir = path.resolve("docs/design/quota-ui-preview-closure");

test.beforeAll(async () => {
  if (captureEnabled) await mkdir(evidenceDir, { recursive: true });
});

test.skip(!captureEnabled, "仅在显式视觉归档时写入截图");

/** 视觉证据使用开发组件示例，不写入真实业务数据库或调用外部服务。 */
test("归档额度、连接、粉笔与 MCP 组件示例", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("http://localhost:3000/?example=connections-ready");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await page.screenshot({ path: path.join(evidenceDir, "connections-example-1536x1024.png"), fullPage: false });

  await page.setViewportSize({ width: 1115, height: 792 });
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "额度", exact: true }).click();
  await page.getByRole("combobox", { name: "开发示例状态" }).selectOption("quota-stale");
  await page.screenshot({ path: path.join(evidenceDir, "quota-stale-dark-1115x792.png"), fullPage: false });

  await page.setViewportSize({ width: 1468, height: 674 });
  await page.getByRole("button", { name: "返回应用" }).click();
  await page.getByRole("button", { name: "插件" }).click();
  await page.getByRole("combobox", { name: "开发示例状态" }).selectOption("draft-review");
  await page.getByRole("button", { name: /粉笔导入/ }).click();
  await page.screenshot({ path: path.join(evidenceDir, "fenbi-drafts-1468x674.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/?example=mcp-connected");
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByRole("button", { name: "设置" }).filter({ visible: true }).click();
  await page.getByLabel("设置分区").selectOption("mcp");
  await page.screenshot({ path: path.join(evidenceDir, "mcp-example-mobile-390x844.png"), fullPage: false });
});
