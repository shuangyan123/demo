import type { AutomationExecutionResult } from "../../services/automation-executor.ts";
import type { AutomationDefinition, AutomationRun } from "../../types/domains/automation.ts";

export type AutomationApplicationStep =
  | "acquire-lease"
  | "preview"
  | "create-run"
  | "start-lease-renewal"
  | "execute"
  | "complete-run"
  | "record-failure"
  | "release-lease";

export type AutomationRetrySafety = "safe" | "manual-only";

export type AutomationExecutionPartialResult = {
  definition?: AutomationDefinition;
  run?: AutomationRun;
  output?: AutomationExecutionResult;
  externalSideEffectsStarted: boolean;
};

/**
 * 自动化跨 IndexedDB 与外部服务，无法提供整流程事务。
 * partialResult 只暴露已确认提交的记录；manual-only 表示禁止调用方隐式重放整个流程。
 */
export class AutomationApplicationError extends Error {
  private readonly cleanupDiagnostics: unknown[];

  readonly partialResult: AutomationExecutionPartialResult;
  readonly retrySafety: AutomationRetrySafety;
  readonly step: AutomationApplicationStep;

  constructor(
    step: AutomationApplicationStep,
    cause: unknown,
    partialResult: AutomationExecutionPartialResult,
    retrySafety: AutomationRetrySafety,
    cleanupErrors: readonly unknown[] = [],
  ) {
    super(cause instanceof Error ? cause.message : "自动化执行失败", { cause });
    this.name = "AutomationApplicationError";
    this.cleanupDiagnostics = [...cleanupErrors];
    this.step = step;
    this.partialResult = { ...partialResult };
    this.retrySafety = retrySafety;
  }

  /** cleanup 失败是次级诊断，不改写已经确定的主步骤、cause 或重试语义。 */
  get cleanupErrors(): readonly unknown[] {
    return this.cleanupDiagnostics;
  }

  attachCleanupErrors(errors: readonly unknown[]): void {
    this.cleanupDiagnostics.push(...errors);
  }
}
