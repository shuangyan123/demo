import { expect, test, type Page } from "@playwright/test";
import { configureCustomTextConnection } from "./helpers/configure-custom-ai";

async function openAiConnectionSettings(page: Page) {
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();
}

async function installFakeDesktopCredentialProtection(page: Page, expectedSecret: string): Promise<void> {
  await page.addInitScript(({ expectedSecret: expected }) => {
    const protectedSecrets = new Map<string, string>();
    const protectedPayload = "ZHVtbXktcHJvdGVjdGVk";
    let protectCalls = 0;
    let unprotectCalls = 0;
    let sawExpectedSecret = false;
    let roundTripMatchesExpected = false;

    const failure = () => ({ ok: false as const, error: { code: "host_payload_invalid", message: "safe test failure" } });

    Object.defineProperty(window, "reviewDesktopCredentialProtection", {
      configurable: true,
      value: {
        getStatus: async () => ({ ok: true, value: { status: "available", backend: "os_protected" } }),
        protectCredential: async (context: string, secret: string) => {
          protectCalls += 1;
          if (!secret) return failure();
          protectedSecrets.set(context, secret);
          sawExpectedSecret ||= secret === expected;
          return { ok: true, value: { version: "desktop-v1", context, payload: protectedPayload } };
        },
        unprotectCredential: async (context: string, envelope: { context?: string; payload?: string }) => {
          unprotectCalls += 1;
          const secret = protectedSecrets.get(context);
          if (!secret || envelope.context !== context || envelope.payload !== protectedPayload) return failure();
          roundTripMatchesExpected = secret === expected;
          return { ok: true, value: { secret, shouldReProtect: false, context } };
        },
      },
    });
    Object.defineProperty(window, "__e2eDesktopCredentialEvidence", {
      configurable: true,
      value: { read: () => ({ protectCalls, unprotectCalls, sawExpectedSecret, roundTripMatchesExpected }) },
    });
  }, { expectedSecret });
}

test("Web 不展示 Desktop 凭据迁移入口", async ({ page }) => {
  await page.goto("/");
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop 凭据保护" })).toHaveCount(0);
});

test("Desktop 迁移必须由用户显式启动，且非空 credential 完成状态可从 journal 恢复", async ({ page }) => {
  const nonEmptyCredential = "e2e-desktop-secret";
  await installFakeDesktopCredentialProtection(page, nonEmptyCredential);
  await page.goto("/");
  await openAiConnectionSettings(page);

  const panel = page.getByRole("region", { name: "Desktop 凭据保护" });
  await expect(panel).toHaveAttribute("data-status", "ready");
  expect(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-migration:v1"))).toBeNull();

  await configureCustomTextConnection(page, { label: "E2E Desktop credential", baseUrl: "http://127.0.0.1:9999/v1", model: "unused", apiKey: nonEmptyCredential });
  const beforeMigration = await page.evaluate(() => (window as Window & {
    __e2eDesktopCredentialEvidence?: { read: () => { protectCalls: number; unprotectCalls: number; sawExpectedSecret: boolean; roundTripMatchesExpected: boolean } };
  }).__e2eDesktopCredentialEvidence?.read());
  expect(beforeMigration?.protectCalls ?? 0).toBe(0);
  await panel.getByRole("button", { name: "迁移到 Desktop 保护" }).click();
  await expect(panel).toHaveAttribute("data-status", "complete");
  await expect(panel).toContainText("未执行清理");

  const bridgeEvidence = await page.evaluate(() => (window as Window & {
    __e2eDesktopCredentialEvidence?: { read: () => { protectCalls: number; unprotectCalls: number; sawExpectedSecret: boolean; roundTripMatchesExpected: boolean } };
  }).__e2eDesktopCredentialEvidence?.read());
  expect(bridgeEvidence?.protectCalls ?? 0).toBeGreaterThan(0);
  expect(bridgeEvidence?.unprotectCalls ?? 0).toBeGreaterThan(0);
  expect(bridgeEvidence?.sawExpectedSecret).toBe(true);
  expect(bridgeEvidence?.roundTripMatchesExpected).toBe(true);
  const authorityEvidence = await page.evaluate(() => {
    const journal = JSON.parse(window.localStorage.getItem("review-workspace:credential-migration:v1") ?? "{}");
    const authorities = Object.values(journal.authorities ?? {});
    return {
      state: journal.state,
      backendPolicy: journal.backendPolicy,
      desktopAuthority: authorities.length > 0 && authorities.every((authority) => authority === "desktop_primary"),
    };
  });
  expect(authorityEvidence).toEqual({ state: "complete", backendPolicy: "desktop_preferred", desktopAuthority: true });
  expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), nonEmptyCredential)).toBe(false);
  expect(await page.evaluate((secret) => Object.values(localStorage).some((value) => value.includes(secret)), nonEmptyCredential)).toBe(false);
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem("review-workspace:credential-migration:v1") ?? "{}").state)).toBe("complete");

  await page.reload();
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop 凭据保护" })).toHaveAttribute("data-status", "complete");
  await expect(page.getByRole("button", { name: "迁移到 Desktop 保护" })).toHaveCount(0);
});
