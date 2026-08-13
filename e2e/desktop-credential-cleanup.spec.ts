import { expect, test, type Page } from "@playwright/test";
import { configureCustomTextConnection } from "./helpers/configure-custom-ai";

async function openAiConnectionSettings(page: Page) {
  await page.getByRole("complementary").getByRole("button").last().click();
  await page.getByRole("button", { name: /AI/ }).first().click();
}

async function installFakeDesktopCredentialProtection(page: Page, expectedSecret: string): Promise<void> {
  await page.addInitScript(({ expectedSecret: expected }) => {
    const protectedSecrets = new Map<string, string>();
    const protectedPayload = "ZHVtbXktcHJvdGVjdGVk";
    let protectCalls = 0;
    let unprotectCalls = 0;
    let cleanupAttemptCount = 0;

    const failure = () => ({ ok: false as const, error: { code: "host_payload_invalid" as const, message: "safe test failure" } });
    Object.defineProperty(window, "reviewDesktopCredentialProtection", {
      configurable: true,
      value: {
        getStatus: async () => ({ ok: true, value: { status: "available", backend: "os_protected" } }),
        protectCredential: async (context: string, secret: string) => {
          protectCalls += 1;
          if (!secret) return failure();
          protectedSecrets.set(context, secret);
          return { ok: true, value: { version: "desktop-v1", context, payload: protectedPayload } };
        },
        unprotectCredential: async (context: string, envelope: { context?: string; payload?: string }) => {
          unprotectCalls += 1;
          const secret = protectedSecrets.get(context);
          if (!secret || envelope.context !== context || envelope.payload !== protectedPayload) return failure();
          return { ok: true, value: { secret, shouldReProtect: false } };
        },
      },
    });
    Object.defineProperty(window, "__e2eCleanupEvidence", {
      configurable: true,
      value: {
        read: () => ({
          protectCalls,
          unprotectCalls,
          cleanupAttemptCount,
          expectedSecretSeen: [...protectedSecrets.values()].includes(expected),
        }),
        markCleanupAttempt: () => { cleanupAttemptCount += 1; },
      },
    });
  }, { expectedSecret });
}

test("Web does not render the Desktop cleanup review surface", async ({ page }) => {
  await page.goto("/");
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop credential cleanup readiness" })).toHaveCount(0);
});

test("Desktop cleanup review is blocked before migration and does not create cleanup state", async ({ page }) => {
  await installFakeDesktopCredentialProtection(page, "unused-before-migration");
  await page.goto("/");
  await openAiConnectionSettings(page);

  const panel = page.getByRole("region", { name: "Desktop credential cleanup readiness" });
  await expect(panel).toHaveAttribute("data-status", "deferred");
  await panel.getByRole("button", { name: "Review readiness" }).click();
  await expect(panel).toHaveAttribute("data-status", "blocked");
  await expect(panel).toContainText("migration");
  expect(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-cleanup:v1"))).toBeNull();
  const evidence = await page.evaluate(() => (window as Window & {
    __e2eCleanupEvidence?: { read: () => { cleanupAttemptCount: number } };
  }).__e2eCleanupEvidence?.read());
  expect(evidence?.cleanupAttemptCount ?? 0).toBe(0);
});

test("completed Desktop migration exposes readiness-only review, preserves sources/key/journals, and survives reload", async ({ page }) => {
  const expectedSecret = "e2e-cleanup-secret";
  await installFakeDesktopCredentialProtection(page, expectedSecret);
  await page.goto("/");
  await openAiConnectionSettings(page);
  await configureCustomTextConnection(page, {
    label: "E2E cleanup foundation",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "unused",
    apiKey: expectedSecret,
  });

  const migrationPanel = page.getByRole("region", { name: /Desktop/ }).first();
  await migrationPanel.getByRole("button", { name: /Desktop/ }).click();
  await expect(migrationPanel).toHaveAttribute("data-status", "complete");

  const cleanupPanel = page.getByRole("region", { name: "Desktop credential cleanup readiness" });
  await expect(cleanupPanel).toBeVisible();
  const before = await page.evaluate(() => ({
    cleanupJournal: window.localStorage.getItem("review-workspace:credential-cleanup:v1"),
    migrationJournal: window.localStorage.getItem("review-workspace:credential-migration:v1"),
    desktopStore: window.localStorage.getItem("review-workspace:desktop-credentials:v1"),
    localStorageKeys: Object.keys(localStorage).sort(),
  }));

  await cleanupPanel.getByRole("button", { name: "Review readiness" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "deferred");
  await expect(cleanupPanel).toContainText("Destructive cleanup remains disabled");
  const after = await page.evaluate(() => ({
    cleanupJournal: window.localStorage.getItem("review-workspace:credential-cleanup:v1"),
    migrationJournal: window.localStorage.getItem("review-workspace:credential-migration:v1"),
    desktopStore: window.localStorage.getItem("review-workspace:desktop-credentials:v1"),
    localStorageKeys: Object.keys(localStorage).sort(),
  }));
  expect(after).toEqual(before);
  expect(after.cleanupJournal).toBeNull();

  const evidence = await page.evaluate(() => (window as Window & {
    __e2eCleanupEvidence?: { read: () => { protectCalls: number; unprotectCalls: number; cleanupAttemptCount: number; expectedSecretSeen: boolean } };
  }).__e2eCleanupEvidence?.read());
  expect(evidence?.protectCalls ?? 0).toBeGreaterThan(0);
  expect(evidence?.unprotectCalls ?? 0).toBeGreaterThan(0);
  expect(evidence?.expectedSecretSeen).toBe(true);
  expect(evidence?.cleanupAttemptCount ?? 0).toBe(0);
  expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), expectedSecret)).toBe(false);

  await page.reload();
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop credential cleanup readiness" })).toHaveAttribute("data-status", "deferred");
  expect(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-cleanup:v1"))).toBeNull();
});
