import { reviewDb } from "../db/review-db.ts";
import type { ApiConnectionProfile, AiConnectionSnapshot } from "../types/domains/ai-connection.ts";
import type { AutomationDefinition, AutomationRun, AutomationRunTrigger, AutomationSnapshot } from "../types/domains/automation.ts";
import type { PersonalizationSettings } from "../types/domains/personalization.ts";
import { calculateDueAutomation, nextAutomationRun, validateAutomationSchedule } from "./automation-schedule.ts";
import { executeAutomation, previewAutomationDefinition } from "./automation-executor.ts";
import { classifyAutomationError } from "./automation-failure.ts";

const LEASE_DURATION_MS = 5 * 60 * 1000;
const LEASE_RENEW_INTERVAL_MS = 60 * 1000;

export type AutomationDefinitionInput = Omit<AutomationDefinition, "id" | "nextRunAt" | "lastRunAt" | "leaseOwner" | "leaseExpiresAt" | "createdAt" | "updatedAt">;
export type DueAutomation = {
  definition: AutomationDefinition;
  scheduledAt: string;
  nextRunAt: string;
  missedCount: number;
  expectedUpdatedAt: string;
};

function nowIso(now = new Date()): string {
  return now.toISOString();
}

/** 原子获取执行租约，并返回事务内读取到的最新任务定义。 */
async function acquireLease(
  id: string,
  owner: string,
  now: Date,
  expectedUpdatedAt?: string,
): Promise<AutomationDefinition | undefined> {
  return reviewDb.transaction("rw", reviewDb.automationDefinitions, async () => {
    const definition = await reviewDb.automationDefinitions.get(id);
    if (!definition) return undefined;
    if (expectedUpdatedAt && (!definition.enabled || definition.updatedAt !== expectedUpdatedAt)) return undefined;
    const leaseActive = definition.leaseExpiresAt && new Date(definition.leaseExpiresAt).getTime() > now.getTime();
    if (leaseActive && definition.leaseOwner !== owner) return undefined;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
    await reviewDb.automationDefinitions.update(id, {
      leaseOwner: owner,
      leaseExpiresAt,
    });
    return { ...definition, leaseOwner: owner, leaseExpiresAt };
  });
}

/** 在长时间 AI 请求期间续租；所有者变化时立即停止续租。 */
export async function renewAutomationLease(id: string, owner: string, now = new Date()): Promise<boolean> {
  return reviewDb.transaction("rw", reviewDb.automationDefinitions, async () => {
    const definition = await reviewDb.automationDefinitions.get(id);
    if (definition?.leaseOwner !== owner) return false;
    await reviewDb.automationDefinitions.update(id, {
      leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
    });
    return true;
  });
}

/** 仅由当前所有者释放租约，避免旧执行覆盖后来者。 */
async function releaseLease(id: string, owner: string): Promise<void> {
  const definition = await reviewDb.automationDefinitions.get(id);
  if (definition?.leaseOwner === owner) await reviewDb.automationDefinitions.update(id, { leaseOwner: undefined, leaseExpiresAt: undefined });
}

/** 已安排仓储统一管理定义、运行收件箱、租约和调度推进。 */
export const automationRepository = {
  async loadSnapshot(): Promise<AutomationSnapshot> {
    const [definitions, runs, unreadCount] = await Promise.all([
      reviewDb.automationDefinitions.orderBy("updatedAt").reverse().toArray(),
      reviewDb.automationRuns.orderBy("createdAt").reverse().limit(100).toArray(),
      reviewDb.automationRuns.filter((item) => item.unread).count(),
    ]);
    return { definitions, runs, unreadCount };
  },

  async create(input: AutomationDefinitionInput, now = new Date()): Promise<AutomationDefinition> {
    await validateAutomationSchedule(input.schedule, input.timeZone, now);
    const timestamp = nowIso(now);
    const definition: AutomationDefinition = {
      ...input,
      id: crypto.randomUUID(),
      nextRunAt: (await nextAutomationRun(input.schedule, input.timeZone, now)).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.automationDefinitions.add(definition);
    return definition;
  },

  async update(id: string, input: AutomationDefinitionInput, now = new Date()): Promise<void> {
    const current = await reviewDb.automationDefinitions.get(id);
    if (!current) throw new Error("已安排任务不存在");
    await validateAutomationSchedule(input.schedule, input.timeZone, now);
    await reviewDb.automationDefinitions.put({
      ...current,
      ...input,
      nextRunAt: input.enabled ? (await nextAutomationRun(input.schedule, input.timeZone, now)).toISOString() : current.nextRunAt,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: nowIso(now),
    });
  },

  async duplicate(id: string, now = new Date()): Promise<AutomationDefinition> {
    const current = await reviewDb.automationDefinitions.get(id);
    if (!current) throw new Error("已安排任务不存在");
    return this.create({
      name: `${current.name} 副本`, templateId: current.templateId, prompt: current.prompt,
      sourceScopes: [...current.sourceScopes], collectionConfig: current.collectionConfig ? structuredClone(current.collectionConfig) : undefined,
      enabled: false, timeZone: current.timeZone, schedule: { ...current.schedule },
    }, now);
  },

  async toggle(id: string, enabled: boolean, now = new Date()): Promise<void> {
    const definition = await reviewDb.automationDefinitions.get(id);
    if (!definition) throw new Error("已安排任务不存在");
    await reviewDb.automationDefinitions.update(id, {
      enabled,
      nextRunAt: enabled ? (await nextAutomationRun(definition.schedule, definition.timeZone, now)).toISOString() : definition.nextRunAt,
      updatedAt: nowIso(now),
    });
  },

  async remove(id: string): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.automationDefinitions, reviewDb.automationRuns], async () => {
      await reviewDb.automationDefinitions.delete(id);
      await reviewDb.automationRuns.where("automationId").equals(id).delete();
    });
  },

  async listDue(now = new Date()): Promise<DueAutomation[]> {
    const definitions = await reviewDb.automationDefinitions.filter((item) => item.enabled).toArray();
    const due = await Promise.all(definitions.map(async (definition) => ({ definition, state: await calculateDueAutomation(definition, now) })));
    return due.filter((item) => item.state.due && item.state.scheduledAt).map((item) => ({
      definition: item.definition,
      scheduledAt: item.state.scheduledAt!,
      nextRunAt: item.state.nextRunAt,
      missedCount: item.state.missedCount,
      expectedUpdatedAt: item.definition.updatedAt,
    }));
  },

  async run(input: {
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
  }): Promise<AutomationRun | undefined> {
    const now = input.now ?? new Date();
    const owner = crypto.randomUUID();
    const definition = await acquireLease(input.definition.id, owner, now, input.expectedUpdatedAt);
    if (!definition) return undefined;
    const timestamp = nowIso(now);
    const preview = await previewAutomationDefinition(definition);
    const run: AutomationRun = {
      id: owner,
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
    await reviewDb.automationRuns.add(run);
    const leaseTimer = setInterval(() => {
      void renewAutomationLease(definition.id, owner).catch(() => undefined);
    }, LEASE_RENEW_INTERVAL_MS);
    try {
      const output = await executeAutomation({ definition, connection: input.connection, aiSnapshot: input.aiSnapshot, personalization: input.personalization });
      const finishedAt = nowIso();
      const completed: AutomationRun = {
        ...run,
        status: "succeeded",
        result: output.result,
        proposalIds: output.proposalIds,
        contextSummary: output.contextSummary,
        contextCharCount: output.contextCharCount,
        collectionSummary: output.collectionSummary,
        unread: true,
        finishedAt,
      };
      await reviewDb.transaction("rw", [reviewDb.automationDefinitions, reviewDb.automationRuns], async () => {
        await reviewDb.automationRuns.put(completed);
        const current = await reviewDb.automationDefinitions.get(definition.id);
        if (current?.leaseOwner === owner) {
          await reviewDb.automationDefinitions.update(definition.id, { lastRunAt: finishedAt, nextRunAt: input.nextRunAt ?? definition.nextRunAt, updatedAt: finishedAt });
        }
      });
      return completed;
    } catch (error) {
      const finishedAt = nowIso();
      const diagnosis = classifyAutomationError(error, { online: typeof navigator === "undefined" ? undefined : navigator.onLine });
      const failed: AutomationRun = {
        ...run,
        status: "failed",
        error: diagnosis.message,
        failureCategory: diagnosis.category,
        failureRecoveryAction: diagnosis.recoveryAction,
        unread: true,
        finishedAt,
      };
      await reviewDb.transaction("rw", [reviewDb.automationDefinitions, reviewDb.automationRuns], async () => {
        await reviewDb.automationRuns.put(failed);
        const current = await reviewDb.automationDefinitions.get(definition.id);
        if (current?.leaseOwner === owner) {
          await reviewDb.automationDefinitions.update(definition.id, { lastRunAt: finishedAt, nextRunAt: input.nextRunAt ?? definition.nextRunAt, updatedAt: finishedAt });
        }
      });
      return failed;
    } finally {
      clearInterval(leaseTimer);
      await releaseLease(definition.id, owner);
    }
  },

  async markRead(id: string): Promise<void> {
    await reviewDb.automationRuns.update(id, { unread: false });
  },

  async markAllRead(): Promise<void> {
    await reviewDb.automationRuns.filter((item) => item.unread).modify({ unread: false });
  },
};
