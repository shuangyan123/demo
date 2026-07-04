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
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npm run start -- -p 4320",
    url: "http://127.0.0.1:4320",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
