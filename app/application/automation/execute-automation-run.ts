import type { AutomationExecutionResult } from "../../services/automation-executor.ts";
import { executeAutomation, previewAutomationDefinition } from "../../services/automation-executor.ts";
import type { AutomationFailureDiagnosis } from "../../services/automation-failure.ts";
import { classifyAutomationError } from "../../services/automation-failure.ts";
import { automationExecutionRepository } from "../../services/automation-repository.ts";
import type { ApiConnectionProfile, AiConnectionSnapshot } from "../../types/domains/ai-connection.ts";
import type { AutomationContextSummary, AutomationDefinition, AutomationRun, AutomationRunTrigger } from "../../types/domains/automation.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { AutomationApplicationError, type AutomationApplicationStep, type AutomationExecutionPartialResult } from "./automation-application.ts";

const LEASE_RENEW_INTERVAL_MS = 60 * 1000;

type AutomationPreview = {
  summary: AutomationContextSummary[];
  contextCharCount: number;
};

export type ExecuteAutomationRunDependencies = {
  acquireLease: (input: {
    automationId: string;
    leaseOwner: string;
    now: Date;
    expectedUpdatedAt?: string;
  }) => Promise<AutomationDefinition | undefined>;
  renewLease: (automationId: string, leaseOwner: string) => Promise<boolean>;
  releaseLease: (automationId: string, leaseOwner: string) => Promise<void>;
  createRun: (run: AutomationRun) => Promise<void>;
  completeRun: (input: {
    automationId: string;
    leaseOwner: string;
    nextRunAt?: string;
    run: AutomationRun;
  }) => Promise<void>;
  previewDefinition: (definition: AutomationDefinition) => Promise<AutomationPreview>;
  execute: (input: {
    definition: AutomationDefinition;
    connection?: ApiConnectionProfile;
    aiSnapshot?: AiConnectionSnapshot;
    personalization: PersonalizationSettings;
  }) => Promise<AutomationExecutionResult>;
  classifyError: (error: unknown, environment?: { online?: boolean }) => AutomationFailureDiagnosis;
  createLeaseOwner: () => string;
  now: () => Date;
  startLeaseRenewal: (renew: () => Promise<boolean>) => () => void;
};

export type ExecuteAutomationRunInput = {
  definition: AutomationDefinition;
  connection?: ApiConnectionProfile;
  aiSnapshot?: AiConnectionSnapshot;
  personalization: PersonalizationSettings;
  trigger: AutomationRunTrigger;
  scheduledAt?: string;
  nextRunAt?: string;
  missedCount?: number;
  expectedUpdatedAt?: string;
  now?: Date;
  online?: boolean;
  dependencies?: ExecuteAutomationRunDependencies;
};

function startDefaultLeaseRenewal(renew: () => Promise<boolean>): () => void {
  const timer = setInterval(() => {
    // 续租失败不能自动重放外部执行；终态提交仍会再次校验租约所有者。
    void renew().catch(() => undefined);
  }, LEASE_RENEW_INTERVAL_MS);
  return () => clearInterval(timer);
}

const defaultDependencies: ExecuteAutomationRunDependencies = {
  ...automationExecutionRepository,
  previewDefinition: previewAutomationDefinition,
  execute: executeAutomation,
  classifyError: classifyAutomationError,
  createLeaseOwner: () => crypto.randomUUID(),
  now: () => new Date(),
  startLeaseRenewal: startDefaultLeaseRenewal,
};

function applicationError(
  step: AutomationApplicationStep,
  cause: unknown,
  partialResult: AutomationExecutionPartialResult,
  cleanupErrors: readonly unknown[] = [],
): AutomationApplicationError {
  return new AutomationApplicationError(
    step,
    cause,
    partialResult,
    partialResult.externalSideEffectsStarted || partialResult.run ? "manual-only" : "safe",
    cleanupErrors,
  );
}

/**
 * 执行一次真实 Automation：租约 → running 记录 → 外部执行 → 终态记录 → 清理。
 * 外部执行开始后不做整流程自动重试；任何部分提交都通过稳定错误边界暴露。
 */
export async function executeAutomationRun(input: ExecuteAutomationRunInput): Promise<AutomationRun | undefined> {
  const dependencies = input.dependencies ?? defaultDependencies;
  const leaseOwner = dependencies.createLeaseOwner();
  const startedAt = input.now ?? dependencies.now();
  const emptyPartial: AutomationExecutionPartialResult = { externalSideEffectsStarted: false };

  let definition: AutomationDefinition | undefined;
  try {
    definition = await dependencies.acquireLease({
      automationId: input.definition.id,
      leaseOwner,
      now: startedAt,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
  } catch (error) {
    throw applicationError("acquire-lease", error, emptyPartial);
  }
  if (!definition) return undefined;

  const partialResult: AutomationExecutionPartialResult = {
    definition,
    externalSideEffectsStarted: false,
  };
  let stopLeaseRenewal: (() => void) | undefined;
  let primaryError: unknown;

  try {
    let preview: AutomationPreview;
    try {
      preview = await dependencies.previewDefinition(definition);
    } catch (error) {
      throw applicationError("preview", error, partialResult);
    }

    const timestamp = startedAt.toISOString();
    const running: AutomationRun = {
      id: leaseOwner,
      automationId: definition.id,
      automationName: definition.name,
      status: "running",
      trigger: input.trigger,
      scheduledAt: input.scheduledAt ?? timestamp,
      startedAt: timestamp,
      unread: false,
      missedCount: input.missedCount ?? 0,
      proposalIds: [],
      contextSummary: preview.summary,
      contextCharCount: preview.contextCharCount,
      createdAt: timestamp,
    };
    try {
      await dependencies.createRun(running);
      partialResult.run = running;
    } catch (error) {
      throw applicationError("create-run", error, partialResult);
    }

    try {
      stopLeaseRenewal = dependencies.startLeaseRenewal(
        () => dependencies.renewLease(definition.id, leaseOwner),
      );
    } catch (error) {
      throw applicationError("start-lease-renewal", error, partialResult);
    }

    partialResult.externalSideEffectsStarted = true;
    let output: AutomationExecutionResult;
    try {
      output = await dependencies.execute({
        definition,
        connection: input.connection,
        aiSnapshot: input.aiSnapshot,
        personalization: input.personalization,
      });
      partialResult.output = output;
    } catch (executionError) {
      const diagnosis = dependencies.classifyError(executionError, { online: input.online });
      const finishedAt = dependencies.now().toISOString();
      const failed: AutomationRun = {
        ...running,
        status: "failed",
        error: diagnosis.message,
        failureCategory: diagnosis.category,
        failureRecoveryAction: diagnosis.recoveryAction,
        unread: true,
        finishedAt,
      };
      try {
        await dependencies.completeRun({
          automationId: definition.id,
          leaseOwner,
          nextRunAt: input.nextRunAt ?? definition.nextRunAt,
          run: failed,
        });
        partialResult.run = failed;
      } catch (persistenceError) {
        throw applicationError(
          "record-failure",
          new AggregateError([executionError, persistenceError], "外部执行失败，且失败终态未能保存"),
          partialResult,
        );
      }
      return failed;
    }

    const finishedAt = dependencies.now().toISOString();
    const completed: AutomationRun = {
      ...running,
      status: "succeeded",
      result: output.result,
      proposalIds: output.proposalIds,
      contextSummary: output.contextSummary,
      contextCharCount: output.contextCharCount,
      collectionSummary: output.collectionSummary,
      unread: true,
      finishedAt,
    };
    try {
      await dependencies.completeRun({
        automationId: definition.id,
        leaseOwner,
        nextRunAt: input.nextRunAt ?? definition.nextRunAt,
        run: completed,
      });
      partialResult.run = completed;
    } catch (error) {
      throw applicationError("complete-run", error, partialResult);
    }
    return completed;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      stopLeaseRenewal?.();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await dependencies.releaseLease(definition.id, leaseOwner);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) {
      if (primaryError instanceof AutomationApplicationError) {
        primaryError.attachCleanupErrors(cleanupErrors);
      } else if (primaryError === undefined) {
        throw applicationError(
          "release-lease",
          cleanupErrors.length === 1 ? cleanupErrors[0] : new AggregateError(cleanupErrors, "自动化租约清理失败"),
          partialResult,
          cleanupErrors,
        );
      }
    }
  }
}
