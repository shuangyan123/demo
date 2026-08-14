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
    let cleanupHostChecksUntilFailure: number | undefined;
    let unprotectFailureCode: "host_payload_invalid" | "host_context_mismatch" | undefined;

    const failure = (code: "host_payload_invalid" | "host_context_mismatch" = "host_payload_invalid") => ({ ok: false as const, error: { code, message: "safe test failure" } });
    Object.defineProperty(window, "reviewDesktopCredentialProtection", {
      configurable: true,
      value: {
        getStatus: async () => {
          if (cleanupHostChecksUntilFailure !== undefined) {
            if (cleanupHostChecksUntilFailure === 0) return { ok: true, value: { status: "unavailable", backend: "os_protected" } };
            cleanupHostChecksUntilFailure -= 1;
          }
          return { ok: true, value: { status: "available", backend: "os_protected" } };
        },
        protectCredential: async (context: string, secret: string) => {
          protectCalls += 1;
          if (!secret) return failure();
          protectedSecrets.set(context, secret);
          return { ok: true, value: { version: "desktop-v1", context, payload: protectedPayload } };
        },
        unprotectCredential: async (context: string, envelope: { context?: string; payload?: string }) => {
          unprotectCalls += 1;
          if (unprotectFailureCode) return failure(unprotectFailureCode);
          // The fake bridge models OS-protected material surviving a renderer
          // reload without persisting the synthetic secret in app storage.
          const secret = protectedSecrets.get(context) ?? expected;
          if (!secret || envelope.context !== context || envelope.payload !== protectedPayload) return failure();
          return { ok: true, value: { secret, shouldReProtect: false } };
        },
      },
    });
    Object.defineProperty(window, "__e2eCleanupEvidence", {
      configurable: true,
      value: {
        read: () => ({ protectCalls, unprotectCalls, expectedSecretSeen: [...protectedSecrets.values()].includes(expected) }),
        failAfterChecks: (count: number) => { cleanupHostChecksUntilFailure = count; },
        recoverHost: () => { cleanupHostChecksUntilFailure = undefined; },
        failUnprotect: (code: "host_payload_invalid" | "host_context_mismatch") => { unprotectFailureCode = code; },
      },
    });
  }, { expectedSecret });
}

test("Web does not render the Desktop cleanup execution surface", async ({ page }) => {
  await page.goto("/");
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop credential cleanup" })).toHaveCount(0);
});
test("Desktop cleanup review is blocked before migration and does not create cleanup state", async ({ page }) => {
  await installFakeDesktopCredentialProtection(page, "unused-before-migration");
  await page.goto("/");
  await openAiConnectionSettings(page);

  const panel = page.getByRole("region", { name: "Desktop credential cleanup" });
  await expect(panel).toHaveAttribute("data-status", "deferred");
  await panel.getByRole("button", { name: "Review cleanup" }).click();
  await expect(panel).toHaveAttribute("data-status", "blocked");
  await expect(panel).toContainText("migration");
  expect(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-cleanup:v1"))).toBeNull();
});

test("Host unavailable keeps cleanup blocked without creating cleanup state", async ({ page }) => {
  await installFakeDesktopCredentialProtection(page, "unused-host-unavailable");
  await page.goto("/");
  await page.evaluate(() => (window as Window & {
    __e2eCleanupEvidence?: { failAfterChecks: (count: number) => void };
  }).__e2eCleanupEvidence?.failAfterChecks(0));
  await openAiConnectionSettings(page);

  const panel = page.getByRole("region", { name: "Desktop credential cleanup" });
  await expect(panel).toHaveAttribute("data-status", "unavailable");
  await panel.getByRole("button", { name: "Review cleanup" }).click();
  await expect(panel).toHaveAttribute("data-status", "unavailable");
  expect(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-cleanup:v1"))).toBeNull();
});

test("eligible Desktop cleanup requires acknowledgement, preserves migration authority, and completes in a fake isolated profile", async ({ page }) => {
  const expectedSecret = "e2e-cleanup-secret";
  await installFakeDesktopCredentialProtection(page, expectedSecret);
  await page.goto("/");
  await openAiConnectionSettings(page);
  await configureCustomTextConnection(page, {
    label: "E2E cleanup execution",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "unused",
    apiKey: expectedSecret,
  });

  const migrationPanel = page.getByRole("region", { name: /Desktop/ }).first();
  await migrationPanel.getByRole("button", { name: /Desktop/ }).click();
  await expect(migrationPanel).toHaveAttribute("data-status", "complete");

  const cleanupPanel = page.getByRole("region", { name: "Desktop credential cleanup" });
  await cleanupPanel.getByRole("button", { name: "Review cleanup" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "awaiting_confirmation");
  const confirm = cleanupPanel.getByRole("button", { name: "Confirm and clean" });
  await expect(confirm).toBeDisabled();
  await cleanupPanel.getByRole("checkbox").check();
  await expect(confirm).toBeEnabled();

  const before = await page.evaluate(() => ({
    migrationJournal: window.localStorage.getItem("review-workspace:credential-migration:v1"),
    desktopStore: window.localStorage.getItem("review-workspace:desktop-credentials:v1"),
    evidence: (window as Window & {
      __e2eCleanupEvidence?: { read: () => { protectCalls: number; unprotectCalls: number; expectedSecretSeen: boolean } };
    }).__e2eCleanupEvidence?.read(),
  }));
  await confirm.click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "complete");
  const after = await page.evaluate(() => ({
    cleanupJournal: window.localStorage.getItem("review-workspace:credential-cleanup:v1"),
    migrationJournal: window.localStorage.getItem("review-workspace:credential-migration:v1"),
    desktopStore: window.localStorage.getItem("review-workspace:desktop-credentials:v1"),
    localStorageValues: Object.values(localStorage),
  }));
  expect(JSON.parse(after.cleanupJournal ?? "{}").state).toBe("complete");
  expect(after.migrationJournal).toBe(before.migrationJournal);
  expect(after.desktopStore).toBe(before.desktopStore);
  expect(after.localStorageValues.some((value) => value.includes(expectedSecret))).toBe(false);
  expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), expectedSecret)).toBe(false);

  const evidence = await page.evaluate(() => (window as Window & {
    __e2eCleanupEvidence?: { read: () => { protectCalls: number; unprotectCalls: number; expectedSecretSeen: boolean } };
  }).__e2eCleanupEvidence?.read());
  expect(before.evidence?.protectCalls ?? 0).toBeGreaterThan(0);
  expect(before.evidence?.unprotectCalls ?? 0).toBeGreaterThan(0);
  expect(evidence?.protectCalls).toBe(before.evidence?.protectCalls);
  const expectedDesktopVerificationCount = JSON.parse(before.migrationJournal ?? "{}").expectedIds?.length ?? 0;
  expect(evidence?.unprotectCalls).toBe((before.evidence?.unprotectCalls ?? 0) + expectedDesktopVerificationCount);
  expect(evidence?.expectedSecretSeen).toBe(true);

  await page.reload();
  await openAiConnectionSettings(page);
  await expect(page.getByRole("region", { name: "Desktop credential cleanup" })).toHaveAttribute("data-status", "complete");
});

test("Desktop unprotect verification failure blocks cleanup before the first source delete", async ({ page }) => {
  const expectedSecret = "e2e-unprotect-failure-secret";
  await installFakeDesktopCredentialProtection(page, expectedSecret);
  await page.goto("/");
  await openAiConnectionSettings(page);
  await configureCustomTextConnection(page, {
    label: "E2E unprotect failure",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "unused",
    apiKey: expectedSecret,
  });
  const migrationPanel = page.getByRole("region", { name: /Desktop/ }).first();
  await migrationPanel.getByRole("button", { name: /Desktop/ }).click();
  await expect(migrationPanel).toHaveAttribute("data-status", "complete");

  const cleanupPanel = page.getByRole("region", { name: "Desktop credential cleanup" });
  await cleanupPanel.getByRole("button", { name: "Review cleanup" }).click();
  await page.evaluate(() => (window as Window & {
    __e2eCleanupEvidence?: { failUnprotect: (code: "host_payload_invalid" | "host_context_mismatch") => void };
  }).__e2eCleanupEvidence?.failUnprotect("host_payload_invalid"));
  await cleanupPanel.getByRole("checkbox").check();
  await cleanupPanel.getByRole("button", { name: "Confirm and clean" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "blocked");
  expect(JSON.parse(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-cleanup:v1") ?? "{}")).reasonCode)
    .toBe("desktop_verification_failed");
});

test("stale Desktop state after review blocks cleanup before the first source delete", async ({ page }) => {
  const expectedSecret = "e2e-stale-cleanup-secret";
  await installFakeDesktopCredentialProtection(page, expectedSecret);
  await page.goto("/");
  await openAiConnectionSettings(page);
  await configureCustomTextConnection(page, {
    label: "E2E stale cleanup",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "unused",
    apiKey: expectedSecret,
  });
  const migrationPanel = page.getByRole("region", { name: /Desktop/ }).first();
  await migrationPanel.getByRole("button", { name: /Desktop/ }).click();
  await expect(migrationPanel).toHaveAttribute("data-status", "complete");

  const cleanupPanel = page.getByRole("region", { name: "Desktop credential cleanup" });
  await cleanupPanel.getByRole("button", { name: "Review cleanup" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "awaiting_confirmation");
  await page.evaluate(() => {
    const key = "review-workspace:desktop-credentials:v1";
    const current = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    window.localStorage.setItem(key, JSON.stringify({ ...current, records: [] }));
  });
  await cleanupPanel.getByRole("checkbox").check();
  await cleanupPanel.getByRole("button", { name: "Confirm and clean" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "blocked");
  expect(JSON.parse(await page.evaluate(() => window.localStorage.getItem("review-workspace:credential-cleanup:v1") ?? "{}")).reasonCode).toBe("physical_inventory_changed");
});

test("partial cleanup is surfaced after reload and resumes only after an explicit recovery action", async ({ page }) => {
  const expectedSecret = "e2e-partial-cleanup-secret";
  await installFakeDesktopCredentialProtection(page, expectedSecret);
  await page.goto("/");
  await openAiConnectionSettings(page);
  await configureCustomTextConnection(page, {
    label: "E2E partial cleanup",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "unused",
    apiKey: expectedSecret,
  });
  const migrationPanel = page.getByRole("region", { name: /Desktop/ }).first();
  await migrationPanel.getByRole("button", { name: /Desktop/ }).click();
  await expect(migrationPanel).toHaveAttribute("data-status", "complete");

  const cleanupPanel = page.getByRole("region", { name: "Desktop credential cleanup" });
  await cleanupPanel.getByRole("button", { name: "Review cleanup" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "awaiting_confirmation");
  await page.evaluate(() => (window as Window & {
    __e2eCleanupEvidence?: { failAfterChecks: (count: number) => void };
  }).__e2eCleanupEvidence?.failAfterChecks(5));
  await cleanupPanel.getByRole("checkbox").check();
  await cleanupPanel.getByRole("button", { name: "Confirm and clean" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "unavailable");
  await expect(cleanupPanel.getByRole("button", { name: "Resume cleanup" })).toHaveCount(0);
  await page.evaluate(() => (window as Window & {
    __e2eCleanupEvidence?: { recoverHost: () => void };
  }).__e2eCleanupEvidence?.recoverHost());
  await cleanupPanel.getByRole("button", { name: "Review cleanup" }).click();
  await expect(cleanupPanel).toHaveAttribute("data-status", "partial");

  await page.reload();
  await openAiConnectionSettings(page);
  const reloadedPanel = page.getByRole("region", { name: "Desktop credential cleanup" });
  await expect(reloadedPanel).toHaveAttribute("data-status", "partial");
  await expect(reloadedPanel.getByRole("button", { name: "Resume cleanup" })).toHaveCount(0);
  await reloadedPanel.getByRole("button", { name: "Review recovery" }).click();
  await reloadedPanel.getByRole("checkbox").check();
  await reloadedPanel.getByRole("button", { name: "Resume cleanup" }).click();
  await expect(reloadedPanel).toHaveAttribute("data-status", "complete");
});
