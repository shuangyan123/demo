import assert from "node:assert/strict";
import test from "node:test";
import { planCredentialMigration, type CredentialInventoryItem } from "./credential-migration-planner.ts";

const webInventory: CredentialInventoryItem[] = [
  { id: "ai-connection:profile", storage: "web-v2" },
  { id: "mcp:server", storage: "web-v2" },
];
const expectedIds = webInventory.map((item) => item.id);

test("纯 Web 模式继续使用 WebCrypto，不产生 Desktop 迁移动作", () => {
  const plan = planCredentialMigration({ host: { kind: "web" }, expectedIds, inventory: webInventory });
  assert.equal(plan.decision, "no_op");
  assert.equal(plan.reason, "web_mode");
  assert.equal(plan.readStrategy, "web_only");
  assert.equal(plan.writeStrategy, "web_only");
  assert.equal(plan.destructiveActions, "none_phase_1");
});

test("Desktop secure host + valid Web v2 inventory is eligible only for a later staging phase", () => {
  const plan = planCredentialMigration({
    host: { kind: "desktop", availability: "available" },
    expectedIds,
    inventory: webInventory,
  });
  assert.equal(plan.decision, "eligible");
  assert.equal(plan.reason, "ready_for_phase_2");
  assert.equal(plan.nextState, "preflight");
  assert.equal(plan.retryable, true);
  assert.equal(plan.readStrategy, "desktop_first_web_fallback");
  assert.equal(plan.writeStrategy, "none_phase_1");
  assert.deepEqual(plan.items.map((item) => item.action), ["stage", "stage"]);
});

test("Desktop unavailable blocks migration without deleting the Web source", () => {
  const plan = planCredentialMigration({
    host: { kind: "desktop", availability: "temporarily_unavailable" },
    expectedIds,
    inventory: webInventory,
  });
  assert.equal(plan.decision, "blocked");
  assert.equal(plan.reason, "desktop_host_unavailable");
  assert.equal(plan.retryable, true);
  assert.equal(plan.destructiveActions, "none_phase_1");
  assert.deepEqual(plan.items.map((item) => item.action), ["retain", "retain"]);
});

test("缺失密钥、masked-only 和未知版本分别 fail closed", () => {
  const missing = planCredentialMigration({ host: { kind: "web" }, expectedIds: ["ai-connection:profile"], inventory: [{ id: "ai-connection:profile", storage: "missing" }] });
  assert.equal(missing.decision, "requires_reentry");
  assert.equal(missing.items[0].action, "reenter");

  const masked = planCredentialMigration({ host: { kind: "desktop", availability: "available" }, expectedIds: ["fenbi:default"], inventory: [{ id: "fenbi:default", storage: "masked-only" }] });
  assert.equal(masked.decision, "requires_reentry");
  assert.equal(masked.reason, "masked_only_rejected");
  assert.equal(masked.items[0].action, "reject");

  const unknown = planCredentialMigration({ host: { kind: "desktop", availability: "available" }, expectedIds: ["quota:openai"], inventory: [{ id: "quota:openai", storage: "unknown" }] });
  assert.equal(unknown.decision, "blocked");
  assert.equal(unknown.reason, "invalid_inventory");
});

test("legacy v1 必须先走现有 Web normalization，不能跨代直接改写", () => {
  const plan = planCredentialMigration({
    host: { kind: "desktop", availability: "available" },
    expectedIds: ["legacy:default", ...expectedIds],
    inventory: [{ id: "legacy:default", storage: "legacy-v1" }, ...webInventory],
  });
  assert.equal(plan.decision, "blocked");
  assert.equal(plan.reason, "legacy_requires_web_normalization");
  assert.equal(plan.items.find((item) => item.id === "legacy:default")?.action, "normalize_first");
});

test("已完成状态与未完成清单不一致时进入恢复，而不是宣称完成", () => {
  const plan = planCredentialMigration({
    host: { kind: "desktop", availability: "available" },
    expectedIds,
    state: "complete",
    inventory: webInventory,
  });
  assert.equal(plan.decision, "blocked");
  assert.equal(plan.reason, "state_inconsistent");
  assert.equal(plan.nextState, "recovery_required");
});

test("expected inventory is completed deterministically and missing records require re-entry", () => {
  const plan = planCredentialMigration({
    host: { kind: "web" },
    expectedIds: ["mcp:server", "ai-connection:profile"],
    inventory: [{ id: "mcp:server", storage: "web-v2" }],
  });
  assert.deepEqual(plan.items.map((item) => [item.id, item.action]), [
    ["ai-connection:profile", "reenter"],
    ["mcp:server", "retain"],
  ]);
  assert.equal(plan.decision, "requires_reentry");
});

test("blocked or cancelled migrations return to preflight without deleting the Web source", () => {
  for (const state of ["blocked", "cancelled"] as const) {
    const plan = planCredentialMigration({ host: { kind: "desktop", availability: "available" }, expectedIds, inventory: webInventory, state });
    assert.equal(plan.decision, "eligible");
    assert.equal(plan.nextState, "preflight");
    assert.equal(plan.retryable, true);
    assert.equal(plan.destructiveActions, "none_phase_1");
  }
});
