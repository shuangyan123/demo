import assert from "node:assert/strict";
import test from "node:test";
import { projectDesktopCredentialMigration } from "./desktop-credential-migration-state.ts";

const available = {
  hostKind: "desktop" as const,
  protectionStatus: "available" as const,
  journal: { state: "idle" as const, reason: undefined, backendPolicy: "web_preferred" as const },
};

test("Web 宿主不展示 Desktop 迁移能力", () => {
  const model = projectDesktopCredentialMigration({ ...available, hostKind: "web" });
  assert.deepEqual(model, {
    visible: false,
    status: "ready",
    message: "",
    busy: false,
    canStart: false,
  });
});

test("Desktop ready、进行中与完成状态来自安全事实", () => {
  assert.equal(projectDesktopCredentialMigration(available).status, "ready");
  assert.equal(projectDesktopCredentialMigration({ ...available, busy: true }).status, "in_progress");
  assert.equal(projectDesktopCredentialMigration({ ...available, journal: { state: "complete", reason: undefined, backendPolicy: "desktop_preferred" } }).status, "complete");
  assert.equal(projectDesktopCredentialMigration({ ...available, journal: { state: "complete", reason: "no_credentials", backendPolicy: "web_preferred" } }).status, "ready");
  assert.equal(projectDesktopCredentialMigration({
    ...available,
    journal: { state: "staging", reason: undefined, backendPolicy: "web_preferred" },
  }).status, "recovery_required");
});

test("requires-reentry、blocked、recovery-required 和不可用状态都使用固定安全映射", () => {
  assert.equal(projectDesktopCredentialMigration({ ...available, journal: { state: "blocked", reason: "requires_reentry", backendPolicy: "web_preferred" } }).status, "requires_reentry");
  assert.equal(projectDesktopCredentialMigration({ ...available, journal: { state: "blocked", reason: "invalid_inventory", backendPolicy: "web_preferred" } }).status, "blocked");
  assert.equal(projectDesktopCredentialMigration({ ...available, journal: { state: "recovery_required", reason: "migration_commit_failed", backendPolicy: "web_preferred" } }).status, "recovery_required");
  assert.equal(projectDesktopCredentialMigration({ ...available, protectionStatus: "temporarily_unavailable" }).status, "unavailable");
});

test("Desktop host remains visible when its credential protection backend is unavailable", () => {
  const model = projectDesktopCredentialMigration({
    ...available,
    protectionStatus: "unavailable",
  });
  assert.equal(model.visible, true);
  assert.equal(model.status, "unavailable");
  assert.equal(model.canStart, false);
});

test("迁移前后 Desktop protection unavailable 都使用不暗示迁移历史的安全文案", () => {
  const models = [
    projectDesktopCredentialMigration({
      ...available,
      protectionStatus: "temporarily_unavailable",
      journal: { state: "idle", reason: "host_unavailable_before_migration", backendPolicy: "web_preferred" },
    }),
    projectDesktopCredentialMigration({
      ...available,
      protectionStatus: "temporarily_unavailable",
      journal: { state: "complete", reason: "host_unavailable_after_cutover:api-key-secret", backendPolicy: "desktop_preferred" },
    }),
  ];

  for (const model of models) {
    assert.equal(model.status, "unavailable");
    assert.equal(model.canStart, false);
    assert.match(model.message, /暂时无法读取或继续验证 Desktop 凭据/);
    assert.match(model.message, /不会降级为明文存储/);
    assert.match(model.message, /不会将 Desktop 凭据静默回退到 Web/);
    assert.doesNotMatch(JSON.stringify(model), /未执行迁移|host_unavailable_after_cutover|api-key-secret/i);
  }
});

test("UI-visible migration model 不包含 journal ID、密文或原始错误", () => {
  const model = projectDesktopCredentialMigration({
    ...available,
    journal: {
      state: "blocked",
      reason: "credential_requires_reentry:sk-api-key-plaintext-ciphertext",
      backendPolicy: "web_preferred",
    },
  });
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /sk-api-key-plaintext-ciphertext|ciphertext|stack|C:\\\\Users\\\\/i);
  assert.equal(model.message.includes("credential_requires_reentry"), false);
});
