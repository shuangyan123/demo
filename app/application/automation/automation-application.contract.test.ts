import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderFailureError } from "../../services/ai-provider-failure.ts";
import { AutomationExecutionProgressError } from "../../services/automation-errors.ts";
import type { AutomationExternalAuthorizationResult } from "../../services/automation-external-authorization.ts";
import type { AutomationExecutionResult } from "../../services/automation-executor.ts";
import type { AutomationDefinition, AutomationExternalExecutionSummary, AutomationRun } from "../../types/domains/automation.ts";
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
const readyAuthorization: AutomationExternalAuthorizationResult = {
  status: "ready",
  requirements: [],
  missingPermissions: [],
  disabledResources: [],
  staleResources: [],
  invalidScopes: [],
  reasonCodes: ["authorization_ready"],
};
const acquiredExternalExecution: AutomationExternalExecutionSummary = {
  sourceKinds: ["url", "mcp_search"],
  mcpTools: [{ serverId: "server-a", toolName: "search-y" }],
  httpOrigins: ["https://example.com"],
  externalCallCount: 3,
  successfulCallCount: 2,
  failedCallCount: 1,
};

type FailurePoint = "acquire" | "preview" | "create-run" | "start-renewal" | "stop-renewal" | "execute" | "complete-success" | "complete-failure" | "release";

function harness({ failAt, leaseAvailable = true, authorize = false, executeError }: { failAt?: FailurePoint | FailurePoint[]; leaseAvailable?: boolean; authorize?: boolean; executeError?: unknown } = {}) {
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
      if (fails("execute")) throw executeError ?? new Error("Failed to fetch");
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
      return () => {
        calls.push("stop-renewal");
        if (fails("stop-renewal")) throw new Error("续租计时器停止失败");
      };
    },
    authorize: authorize ? async () => readyAuthorization : undefined,
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

test("complete-run 与 releaseLease 同时失败时保留主错误并附加 cleanup 诊断", async () => {
  const state = harness({ failAt: ["complete-success", "release"] });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "complete-run");
  assert.match((error.cause as Error).message, /成功终态保存失败/);
  assert.equal(error.retrySafety, "manual-only");
  assert.equal(error.partialResult.run?.status, "running");
  assert.equal(error.partialResult.output?.proposalIds[0], "proposal-1");
  assert.equal(state.getPersistedRun()?.status, "running");
  assert.equal(error.cleanupErrors.length, 1);
  assert.match((error.cleanupErrors[0] as Error).message, /租约释放失败/);
  assert.deepEqual(state.calls.slice(-2), ["stop-renewal", "release-lease"]);
});

test("record-failure 与 releaseLease 同时失败时保留主错误并附加 cleanup 诊断", async () => {
  const state = harness({ failAt: ["execute", "complete-failure", "release"] });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "record-failure");
  assert.match((error.cause as Error).message, /外部执行失败，且失败终态未能保存/);
  assert.equal(error.retrySafety, "manual-only");
  assert.equal(error.partialResult.run?.status, "running");
  assert.equal(error.partialResult.externalSideEffectsStarted, true);
  assert.equal(state.getPersistedRun()?.status, "running");
  assert.equal(error.cleanupErrors.length, 1);
  assert.match((error.cleanupErrors[0] as Error).message, /租约释放失败/);
});

test("主流程成功且只有 releaseLease 失败时以 cleanup 作为主错误", async () => {
  const state = harness({ failAt: "release" });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "release-lease");
  assert.equal(error.retrySafety, "manual-only");
  assert.equal(error.partialResult.run?.status, "succeeded");
  assert.equal(state.getPersistedRun()?.status, "succeeded");
  assert.equal(error.cleanupErrors.length, 1);
  assert.match((error.cleanupErrors[0] as Error).message, /租约释放失败/);
  assert.deepEqual(state.calls.slice(-2), ["stop-renewal", "release-lease"]);
});

test("停止续租与释放租约同时失败时保留全部 cleanup diagnostics", async () => {
  const state = harness({ failAt: ["stop-renewal", "release"] });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "release-lease");
  assert.equal(error.partialResult.run?.status, "succeeded");
  assert.deepEqual(error.cleanupErrors.map((item) => (item as Error).message), [
    "续租计时器停止失败",
    "租约释放失败",
  ]);
  assert.ok(error.cause instanceof AggregateError);
  assert.equal(error.cause.errors.length, 2);
});

test("租约获取基础设施失败时不执行 cleanup 或外部调用", async () => {
  const state = harness({ failAt: "acquire" });
  const error = await applicationError(executeAutomationRun(runInput(state.dependencies)));
  assert.equal(error.step, "acquire-lease");
  assert.equal(error.retrySafety, "safe");
  assert.deepEqual(state.calls, ["acquire-lease"]);
});

test("后续 AI 失败时保留采集外部执行摘要且不泄漏 typed error cause", async () => {
  const state = harness({
    failAt: "execute",
    authorize: true,
    executeError: new AutomationExecutionProgressError(
      new AiProviderFailureError({ code: "provider_unavailable", provider: "deepseek", retry: "manual-only" }, "secret-token-123 Bearer raw-result prompt-secret"),
      acquiredExternalExecution,
    ),
  });
  const run = await executeAutomationRun(runInput(state.dependencies));

  assert.equal(run?.status, "failed");
  assert.equal(run?.unattendedAudit?.authorization, "ready");
  assert.equal(run?.unattendedAudit?.terminalState, "failed");
  assert.equal(run?.unattendedAudit?.externalCallCount, 3);
  assert.equal(run?.unattendedAudit?.successfulCallCount, 2);
  assert.equal(run?.unattendedAudit?.failedCallCount, 1);
  assert.deepEqual(run?.unattendedAudit?.mcpTools, acquiredExternalExecution.mcpTools);
  assert.deepEqual(run?.unattendedAudit?.httpOrigins, acquiredExternalExecution.httpOrigins);
  assert.equal(run?.unattendedAudit?.reasonCodes.includes("runtime_failed"), true);
  assert.doesNotMatch(JSON.stringify(run), /secret-token-123|Bearer|raw-result|prompt-secret/);
});
