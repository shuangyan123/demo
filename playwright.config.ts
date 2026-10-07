import { defineConfig, devices } from "@playwright/test";

/** Playwright E2E 配置：使用生产构建后的 Next.js 服务验证关键浏览器流程。 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: ".playwright-results",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4320",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /.*\.mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      testMatch: /.*\.mobile\.spec\.ts/,
      // 产品移动验收基准固定为 390×844，避免沿用 Pixel 5 的 393×727 掩盖矮屏布局问题。
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "cross-env PORT=4320 HOSTNAME=127.0.0.1 node --experimental-strip-types scripts/start-diagnostic-test-server.mts",
    url: "http://127.0.0.1:4320",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
