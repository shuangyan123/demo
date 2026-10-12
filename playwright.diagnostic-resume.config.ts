import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** 测试自身持有同一隔离 Host profile，A/B 退出后才清理；不使用 F3 launcher 的 exit cleanup。 */
export default defineConfig({ ...base, testMatch: /diagnostic-resume\.spec\.ts/, webServer: undefined,
  projects: base.projects?.filter(project => project.name === "chromium"), workers: 1, retries: 0, timeout: 120_000,
});
