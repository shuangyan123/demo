import type { AutomationExternalExecutionSummary } from "../types/domains/automation.ts";

export type AutomationAuthorizationErrorPayload = {
  status: "ready" | "blocked" | "invalid";
  reasonCodes: readonly string[];
  missingPermissions: readonly string[];
  disabledResources: readonly string[];
  staleResources: readonly string[];
  invalidScopes: readonly string[];
};

/** 授权解析失败与运行期失败分离，避免调度器把阻断误报为普通模型错误。 */
export class AutomationAuthorizationError extends Error {
  readonly authorization: AutomationAuthorizationErrorPayload;

  constructor(authorization: AutomationAuthorizationErrorPayload) {
    super("自动化外部授权前置条件未满足");
    this.name = "AutomationAuthorizationError";
    this.authorization = authorization;
  }
}

/**
 * 外部调用已经开始但后续编排阶段失败时，继续携带已知的脱敏执行摘要。
 * cause 只留在当前调用栈中，不能被写入 AutomationRun 或审计摘要。
 */
export class AutomationExecutionProgressError extends Error {
  readonly externalExecution?: AutomationExternalExecutionSummary;
  readonly cause: unknown;

  constructor(cause: unknown, externalExecution?: AutomationExternalExecutionSummary) {
    super("自动化外部执行失败", { cause });
    this.name = "AutomationExecutionProgressError";
    this.cause = cause;
    this.externalExecution = externalExecution ? cloneAutomationExternalExecution(externalExecution) : undefined;
  }
}

function cloneAutomationExternalExecution(summary: AutomationExternalExecutionSummary): AutomationExternalExecutionSummary {
  return {
    sourceKinds: [...summary.sourceKinds],
    mcpTools: summary.mcpTools.map((item) => ({ ...item })),
    httpOrigins: [...summary.httpOrigins],
    externalCallCount: summary.externalCallCount,
    successfulCallCount: summary.successfulCallCount,
    failedCallCount: summary.failedCallCount,
  };
}

/** 合并独立执行阶段的摘要；同一个累计摘要不得重复传入。 */
export function mergeAutomationExternalExecution(
  ...summaries: Array<AutomationExternalExecutionSummary | undefined>
): AutomationExternalExecutionSummary | undefined {
  const present = summaries.filter((summary): summary is AutomationExternalExecutionSummary => Boolean(summary));
  if (!present.length) return undefined;
  const sourceKinds = [...new Set(present.flatMap((summary) => summary.sourceKinds))];
  const mcpTools = [...new Map(
    present.flatMap((summary) => summary.mcpTools)
      .map((item) => [`${item.serverId}\u0000${item.toolName}`, item] as const),
  ).values()].map((item) => ({ ...item }));
  const httpOrigins = [...new Set(present.flatMap((summary) => summary.httpOrigins))];
  return {
    sourceKinds,
    mcpTools,
    httpOrigins,
    externalCallCount: present.reduce((total, summary) => total + summary.externalCallCount, 0),
    successfulCallCount: present.reduce((total, summary) => total + summary.successfulCallCount, 0),
    failedCallCount: present.reduce((total, summary) => total + summary.failedCallCount, 0),
  };
}

/** 读取 typed progress error 的底层错误，保持现有 provider/网络分类语义。 */
export function automationExecutionCause(error: unknown): unknown {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof AutomationExecutionProgressError && !seen.has(current)) {
    seen.add(current);
    current = current.cause;
  }
  return current;
}

/** 从当前错误链提取最近一次已知的脱敏执行摘要。 */
export function automationExternalExecution(error: unknown): AutomationExternalExecutionSummary | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof AutomationExecutionProgressError && !seen.has(current)) {
    seen.add(current);
    if (current.externalExecution) return cloneAutomationExternalExecution(current.externalExecution);
    current = current.cause;
  }
  return undefined;
}

/** 已有 progress error 优先保留，避免同一累计摘要在多层 catch 中重复计数。 */
export function wrapAutomationExecutionProgress(error: unknown, externalExecution?: AutomationExternalExecutionSummary): unknown {
  if (error instanceof AutomationAuthorizationError) return error;
  if (error instanceof AutomationExecutionProgressError) {
    return error.externalExecution || !externalExecution
      ? error
      : new AutomationExecutionProgressError(error.cause, externalExecution);
  }
  return new AutomationExecutionProgressError(error, externalExecution);
}
