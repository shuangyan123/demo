import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Desktop 迁移入口只在 AI 连接设置中装配并由显式 hook 调用既有 service", async () => {
  const [connections, panel, hook] = await Promise.all([
    readFile(new URL("./api-connections-settings-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("./desktop-credential-migration-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("./use-desktop-credential-migration.ts", import.meta.url), "utf8"),
  ]);
  assert.match(connections, /<DesktopCredentialMigrationPanel \/>/);
  assert.match(panel, /aria-label="Desktop 凭据保护"/);
  assert.match(panel, /迁移到 Desktop 保护/);
  assert.doesNotMatch(panel, /reviewDesktopCredentialProtection|safeStorage|ciphertext|payload|stack|path/);
  assert.match(hook, /migrateDesktopCredentials\(\)/);
  assert.match(hook, /readCredentialMigrationJournal/);
  assert.match(hook, /inspectCredentialProtection/);
  assert.doesNotMatch(hook, /window\.localStorage\.setItem|writeCredentialMigrationJournal/);
  const initialRead = hook.slice(hook.indexOf("\n  useEffect(()"), hook.indexOf("\n  const start"));
  assert.doesNotMatch(initialRead, /migrateDesktopCredentials/);
});
