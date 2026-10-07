import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** 单独真实 production durable surface；不复用未知 server，不触及安装 profile。 */
export default defineConfig({ ...base, testMatch: /diagnostic-controlled-surface\.spec\.ts/,
  projects: base.projects?.filter((project) => project.name === "chromium"), workers: 1,
  webServer: { command: "node --experimental-strip-types scripts/start-diagnostic-test-server.mts",
    url: "http://127.0.0.1:4320", reuseExistingServer: false, timeout: 60_000,
    env: { PORT: "4320", HOSTNAME: "127.0.0.1" } },
});
