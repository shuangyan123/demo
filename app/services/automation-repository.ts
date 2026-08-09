import { reviewDb } from "../db/review-db.ts";
import type { AutomationDefinition, AutomationRun, AutomationSnapshot } from "../types/domains/automation.ts";
import { calculateDueAutomation, nextAutomationRun, validateAutomationSchedule } from "./automation-schedule.ts";

const LEASE_DURATION_MS = 5 * 60 * 1000;

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

/** 单次执行所需的原子持久化端口；跨步骤顺序由 Application Layer 负责。 */
export const automationExecutionRepository = {
  acquireLease({ automationId, leaseOwner, now, expectedUpdatedAt }: {
    automationId: string;
    leaseOwner: string;
    now: Date;
    expectedUpdatedAt?: string;
  }): Promise<AutomationDefinition | undefined> {
    return acquireLease(automationId, leaseOwner, now, expectedUpdatedAt);
  },

  renewLease(automationId: string, leaseOwner: string): Promise<boolean> {
    return renewAutomationLease(automationId, leaseOwner);
  },

  releaseLease(automationId: string, leaseOwner: string): Promise<void> {
    return releaseLease(automationId, leaseOwner);
  },

  createRun(run: AutomationRun): Promise<void> {
    return reviewDb.automationRuns.add(run).then(() => undefined);
  },

  async completeRun({ automationId, leaseOwner, nextRunAt, run }: {
    automationId: string;
    leaseOwner: string;
    nextRunAt?: string;
    run: AutomationRun;
  }): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.automationDefinitions, reviewDb.automationRuns], async () => {
      await reviewDb.automationRuns.put(run);
      const current = await reviewDb.automationDefinitions.get(automationId);
      if (current?.leaseOwner === leaseOwner) {
        await reviewDb.automationDefinitions.update(automationId, {
          lastRunAt: run.finishedAt,
          nextRunAt,
          updatedAt: run.finishedAt,
        });
      }
    });
  },
};

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

  async markRead(id: string): Promise<void> {
    await reviewDb.automationRuns.update(id, { unread: false });
  },

  async markAllRead(): Promise<void> {
    await reviewDb.automationRuns.filter((item) => item.unread).modify({ unread: false });
  },
};
