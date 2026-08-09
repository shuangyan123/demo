import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationExecutionResult } from "../../services/automation-executor.ts";
import type { AutomationDefinition, AutomationRun } from "../../types/domains/automation.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { AutomationApplicationError } from "./automation-application.ts";
import { executeAutomationRun, type ExecuteAutomationRunDependencies } from "./execute-automation-run.ts";

const startedAt = new Date("2026-08-09T08:00:00.000Z");
const finishedAt = new Date("2026-08-09T08:01:00.000Z");
const definition: AutomationDefinition = {
  id: "automation-1",
  name: "每日复盘",
  templateId: "daily_review",
  prompt: "生成简报",
  sourceScopes: ["mistakes"],
  enabled: true,
  timeZone: "Asia/Shanghai",
  schedule: { kind: "interval", intervalMinutes: 60 },
  nextRunAt: "2026-08-09T09:00:00.000Z",
  createdAt: startedAt.toISOString(),
  updatedAt: startedAt.toISOString(),
};
const personalization: PersonalizationSettings = {
  id: "default",
  personaDisplayMode: "default",
  customPersonaViewMode: "flashcard",
  defaultPersonaId: "default-interview",
  modulePersonaIds: {},
  customPersonas: [],
  personaCustomizations: {},
  updatedAt: startedAt.toISOString(),
};
const output: AutomationExecutionResult = {
  result: "完成",
  proposalIds: ["proposal-1"],
  contextSummary: [{ scope: "mistakes", label: "错题", count: 1, sampleTitles: ["测试错题"] }],
  contextCharCount: 20,
};

type FailurePoint = "acquire" | "preview" | "create-run" | "start-renewal" | "execute" | "complete-success" | "complete-failure" | "release";

function harness({ failAt, leaseAvailable = true }: { failAt?: FailurePoint | FailurePoint[]; leaseAvailable?: boolean } = {}) {
  const calls: string[] = [];
  let persistedRun: AutomationRun | undefined;
  const fails = (point: FailurePoint) => Array.isArray(failAt) ? failAt.includes(point) : failAt === point;
  const dependencies: ExecuteAutomationRunDependencies = {
    async acquireLease() {
      calls.push("acquire-lease");
      if (fails("acquire")) throw new Error("租约存储失败");
      return leaseAvailable ? { ...definition, leaseOwner: "run-1" } : undefined;
    },
    async renewLease() {
      calls.push("renew-lease");
      return true;
    },
    async releaseLease() {
      calls.push("release-lease");
      if (fails("release")) throw new Error("租约释放失败");
    },
    async createRun(run) {
      calls.push("create-run");
      if (fails("create-run")) throw new Error("运行记录创建失败");
      persistedRun = run;
    },
    async completeRun({ run }) {
      calls.push(`complete-${run.status}`);
      if (fails("complete-success") && run.status === "succeeded") throw new Error("成功终态保存失败");
      if (fails("complete-failure") && run.status === "failed") throw new Error("失败终态保存失败");
      persistedRun = run;
    },
    async previewDefinition() {
      calls.push("preview");
      if (fails("preview")) throw new Error("上下文预览失败");
      return { summary: output.contextSummary, contextCharCount: output.contextCharCount };
    },
    async execute() {
      calls.push("execute");
      if (fails("execute")) throw new Error("Failed to fetch");
      return output;
    },
    classifyError(error, environment) {
      calls.push("classify-error");
      assert.equal(environment?.online, false);
      return { category: "network", recoveryAction: "check_network", message: error instanceof Error ? error.message : "执行失败" };
    },
    createLeaseOwner() {
      return "run-1";
    },
    now() {
      return finishedAt;
    },
    startLeaseRenewal() {
      calls.push("start-renewal");
      if (fails("start-renewal")) throw new Error("续租计时器启动失败");
      return () => calls.push("stop-renewal");
    },
  };
  return { calls, dependencies, getPersistedRun: () => persistedRun };
}

function runInput(dependencies: ExecuteAutomationRunDependencies) {
  return {
    definition,
    personalization,
    trigger: "scheduled" as const,
    scheduledAt: startedAt.toISOString(),
    nextRunAt: "2026-08-09T10:00:00.000Z",
    missedCount: 2,
    expectedUpdatedAt: definition.updatedAt,
    now: startedAt,
    online: false,
    dependencies,
  };
}

async function applicationError(operation: Promise<AutomationRun | undefined>): Promise<AutomationApplicationError> {
  try {
    await operation;
    assert.fail("预期 Automation Application 用例失败");
  } catch (error) {
    assert.ok(error instanceof AutomationApplicationError);
    return error;
  }
}

test("executeAutomationRun 按租约、running、续租、外部执行、终态与清理顺序成功提交", async () => {
  const state = harness();
  const run = await executeAutomationRun(runInput(state.dependencies));
  assert.equal(run?.status, "succeeded");
  assert.equal(run?.result, "完成");
  assert.equal(run?.missedCount, 2);
  assert.equal(state.getPersistedRun()?.status, "succeeded");
  assert.deepEqual(state.calls, [
    "acquire-lease", "preview", "create-run", "start-renewal", "execute",
    "complete-succeeded", "stop-renewal", "release-lease",
  ]);
});

test("executeAutomationRun 未获得租约时不创建记录或触发外部副作用", async () => {
  const state = harness({ leaseAvailable: false });
  assert.equal(await executeAutomationRun(runInput(state.dependencies)), undefined);
  assert.deepEqual(state.calls, ["acquire-lease"]);
});

test("预览或 running 写入失败时释放租约且允许安全重试", async () => {
  for (const failAt of ["preview", "create-run"] as const) {
    const state = harness({ failAt });
    const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
    assert.equal(error.step, failAt === "preview" ? "preview" : "create-run");
    assert.equal(error.retrySafety, "safe");
    assert.equal(error.partialResult.externalSideEffectsStarted, false);
    assert.equal(state.calls.at(-1), "release-lease");
  }
});

test("running 已提交但续租启动失败时不执行外部调用且只允许人工恢复", async () => {
  const state = harness({ failAt: "start-renewal" });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "start-lease-renewal");
  assert.equal(error.retrySafety, "manual-only");
  assert.equal(error.partialResult.run?.status, "running");
  assert.equal(error.partialResult.externalSideEffectsStarted, false);
  assert.equal(state.calls.includes("execute"), false);
  assert.equal(state.calls.at(-1), "release-lease");
});

test("外部执行失败只执行一次并将稳定失败终态写入收件箱", async () => {
  const state = harness({ failAt: "execute" });
  const run = await executeAutomationRun(runInput(state.dependencies));
  assert.equal(run?.status, "failed");
  assert.equal(run?.failureCategory, "network");
  assert.equal(run?.failureRecoveryAction, "check_network");
  assert.equal(run?.unread, true);
  assert.equal(state.calls.filter((call) => call === "execute").length, 1);
  assert.equal(state.getPersistedRun()?.status, "failed");
  assert.deepEqual(state.calls.slice(-3), ["complete-failed", "stop-renewal", "release-lease"]);
});

test("外部成功但终态提交失败时保留 running 与输出证据并禁止隐式重试", async () => {
  const state = harness({ failAt: "complete-success" });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "complete-run");
  assert.equal(error.retrySafety, "manual-only");
  assert.equal(error.partialResult.run?.status, "running");
  assert.equal(error.partialResult.output?.proposalIds[0], "proposal-1");
  assert.equal(state.getPersistedRun()?.status, "running");
  assert.deepEqual(state.calls.slice(-2), ["stop-renewal", "release-lease"]);
});

test("外部失败且失败终态也无法保存时暴露部分提交并禁止隐式重试", async () => {
  const state = harness({ failAt: ["execute", "complete-failure"] });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "record-failure");
  assert.equal(error.retrySafety, "manual-only");
  assert.equal(error.partialResult.run?.status, "running");
  assert.equal(error.partialResult.externalSideEffectsStarted, true);
  assert.equal(state.getPersistedRun()?.status, "running");
});

test("终态已提交但租约释放失败时以 cleanup 错误覆盖返回并保留终态证据", async () => {
  const state = harness({ failAt: "release" });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "release-lease");
  assert.equal(error.retrySafety, "manual-only");
  assert.equal(error.partialResult.run?.status, "succeeded");
  assert.equal(state.getPersistedRun()?.status, "succeeded");
  assert.deepEqual(state.calls.slice(-2), ["stop-renewal", "release-lease"]);
});

test("租约获取基础设施失败时不执行 cleanup 或外部调用", async () => {
  const state = harness({ failAt: "acquire" });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "acquire-lease");
  assert.equal(error.retrySafety, "safe");
  assert.deepEqual(state.calls, ["acquire-lease"]);
});
