"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { automationRepository, type AutomationDefinitionInput } from "../../services/automation-repository";
import { previewAutomationDefinition, trialAutomationDefinition } from "../../services/automation-executor";
import { classifyAutomationError } from "../../services/automation-failure";
import type {
  ApiConnectionProfile,
  AutomationContextSummary,
  AutomationDefinition,
  AutomationFailureCategory,
  AutomationRecoveryAction,
  AutomationRun,
  AutomationSnapshot,
  PersonalizationSettings,
} from "../../types/review";

const EMPTY_SNAPSHOT: AutomationSnapshot = { definitions: [], runs: [], unreadCount: 0 };

export type AutomationPreviewResult = {
  summary: AutomationContextSummary[];
  contextCharCount: number;
};

export type AutomationTrialResult = {
  status: "succeeded" | "failed";
  result?: string;
  error?: string;
  proposalCount: number;
  contextSummary: AutomationContextSummary[];
  contextCharCount: number;
  failureCategory?: AutomationFailureCategory;
  failureRecoveryAction?: AutomationRecoveryAction;
};

/** 浏览器支持 Web Locks 时只允许当前标签页立即获得的任务进入 repository。 */
async function withBrowserLock<T>(name: string, task: () => Promise<T>): Promise<T | undefined> {
  if (!("locks" in navigator)) return task();
  let output: T | undefined;
  await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
    if (lock) output = await task();
  });
  return output;
}

/** 在用户主动授权后发送运行结果通知，通知正文只截取收件箱文本。 */
function notifyRun(run: AutomationRun): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const body = run.status === "succeeded" ? run.result || "自动化已完成" : run.error || "自动化执行失败";
  new Notification(run.automationName, { body: body.slice(0, 180), tag: `automation-${run.id}` });
}

/** 将尚未保存的表单草稿转换成只供试运行使用的临时定义，不写入仓储。 */
function draftToTrialDefinition(input: AutomationDefinitionInput): AutomationDefinition {
  const timestamp = new Date().toISOString();
  return {
    ...input,
    id: `trial-${crypto.randomUUID()}`,
    name: input.name.trim() || "试运行自动化",
    prompt: input.prompt.trim(),
    sourceScopes: [...input.sourceScopes],
    schedule: { ...input.schedule },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** 自动化中心 hook 只维护可序列化快照，调度、租约和执行均委托给服务层。 */
export function useAutomationCenter({
  connection,
  personalization,
  onChanged,
  onNotice,
}: {
  connection?: ApiConnectionProfile;
  personalization: PersonalizationSettings;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>(EMPTY_SNAPSHOT);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const schedulerRunning = useRef(false);

  const refresh = useCallback(async () => setSnapshot(await automationRepository.loadSnapshot()), []);

  const runDefinition = useCallback(async (definitionId: string, scheduled?: { scheduledAt: string; nextRunAt: string; missedCount: number; expectedUpdatedAt: string }) => {
    const definition = (await automationRepository.loadSnapshot()).definitions.find((item) => item.id === definitionId);
    if (!definition) throw new Error("自动化任务不存在");
    setBusyIds((current) => current.includes(definitionId) ? current : [...current, definitionId]);
    try {
      const run = await withBrowserLock(`review-automation:${definitionId}`, () => automationRepository.run({
        definition,
        connection,
        personalization,
        trigger: scheduled ? scheduled.missedCount > 0 ? "catchup" : "scheduled" : "manual",
        scheduledAt: scheduled?.scheduledAt,
        nextRunAt: scheduled?.nextRunAt,
        missedCount: scheduled?.missedCount,
        expectedUpdatedAt: scheduled?.expectedUpdatedAt,
      }));
      if (run) {
        notifyRun(run);
        await onChanged();
        onNotice(run.status === "succeeded" ? `${run.automationName} 已完成` : `${run.automationName}：${run.error}`);
      }
      await refresh();
      return run;
    } finally {
      setBusyIds((current) => current.filter((id) => id !== definitionId));
    }
  }, [connection, onChanged, onNotice, personalization, refresh]);

  const processDue = useCallback(async () => {
    if (schedulerRunning.current || document.visibilityState === "hidden" || !navigator.onLine) return;
    schedulerRunning.current = true;
    try {
      const due = await automationRepository.listDue();
      for (const item of due) {
        await runDefinition(item.definition.id, item);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "自动化调度失败");
    } finally {
      schedulerRunning.current = false;
    }
  }, [onNotice, runDefinition]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void refresh().then(processDue).catch((error) => onNotice(error instanceof Error ? error.message : "自动化读取失败"));
    }, 0);
    const interval = window.setInterval(() => void processDue(), 60_000);
    const handleResume = () => void processDue();
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("online", handleResume);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("online", handleResume);
    };
  }, [onNotice, processDue, refresh]);

  const save = useCallback(async (input: AutomationDefinitionInput, id?: string) => {
    if (id) await automationRepository.update(id, input);
    else await automationRepository.create(input);
    await refresh();
    onNotice(id ? "自动化已更新" : "自动化已创建");
  }, [onNotice, refresh]);

  const preview = useCallback(async (input: AutomationDefinitionInput): Promise<AutomationPreviewResult> => {
    return previewAutomationDefinition(input);
  }, []);

  const trialRun = useCallback(async (input: AutomationDefinitionInput): Promise<AutomationTrialResult> => {
    const previewResult = await previewAutomationDefinition(input);
    try {
      const output = await trialAutomationDefinition({
        definition: draftToTrialDefinition(input),
        connection,
        personalization,
      });
      return {
        status: "succeeded",
        result: output.result,
        proposalCount: output.proposalIds.length,
        contextSummary: output.contextSummary,
        contextCharCount: output.contextCharCount,
      };
    } catch (error) {
      const diagnosis = classifyAutomationError(error, { online: navigator.onLine });
      return {
        status: "failed",
        error: diagnosis.message,
        proposalCount: 0,
        contextSummary: previewResult.summary,
        contextCharCount: previewResult.contextCharCount,
        failureCategory: diagnosis.category,
        failureRecoveryAction: diagnosis.recoveryAction,
      };
    }
  }, [connection, personalization]);

  const remove = useCallback(async (id: string) => {
    await automationRepository.remove(id);
    await refresh();
    onNotice("自动化及其运行记录已删除");
  }, [onNotice, refresh]);

  const duplicate = useCallback(async (id: string) => {
    await automationRepository.duplicate(id);
    await refresh();
    onNotice("已创建停用的自动化副本");
  }, [onNotice, refresh]);

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    await automationRepository.toggle(id, enabled);
    await refresh();
  }, [refresh]);

  const markRead = useCallback(async (id: string) => {
    await automationRepository.markRead(id);
    await refresh();
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    await automationRepository.markAllRead();
    await refresh();
  }, [refresh]);

  const requestNotifications = useCallback(async () => {
    if (!("Notification" in window)) throw new Error("当前浏览器不支持通知");
    const permission = await Notification.requestPermission();
    onNotice(permission === "granted" ? "浏览器通知已开启" : "浏览器通知未获授权");
  }, [onNotice]);

  return useMemo(() => ({
    busyIds, duplicate, markAllRead, markRead, processDue, refresh, remove, requestNotifications,
    preview, runNow: runDefinition, save, snapshot, toggle, trialRun,
  }), [busyIds, duplicate, markAllRead, markRead, preview, processDue, refresh, remove, requestNotifications, runDefinition, save, snapshot, toggle, trialRun]);
}

/** 自动化子组件共享的 hook 返回类型。 */
export type AutomationCenter = ReturnType<typeof useAutomationCenter>;
