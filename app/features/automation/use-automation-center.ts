"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { automationRepository, type AutomationDefinitionInput } from "../../services/automation-repository";
import { previewAutomationDefinition, trialAutomationDefinition } from "../../services/automation-executor";
import { classifyAutomationError } from "../../services/automation-failure";
import { previewCollectionConfig } from "../../services/acquisition-source-service";
import type { ApiConnectionProfile, AiConnectionSnapshot } from "../../types/domains/ai-connection.ts";
import type { AutomationContextSummary, AutomationDefinition, AutomationFailureCategory, AutomationRecoveryAction, AutomationRun, AutomationSnapshot } from "../../types/domains/automation.ts";
import type { AcquisitionRunSummary } from "../../types/domains/acquisition.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { filterWorkspaceRecords, isUiReviewRecordId, type WorkspaceDataScope } from "../../services/workspace-data-scope";

const EMPTY_SNAPSHOT: AutomationSnapshot = { definitions: [], runs: [], unreadCount: 0 };

export type AutomationPreviewResult = {
  summary: AutomationContextSummary[];
  contextCharCount: number;
  collection?: { sourceLabels: string[]; allowedOrigins: string[]; estimatedDocuments: number };
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
  collectionSummary?: AcquisitionRunSummary;
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
  const body = run.status === "succeeded" ? run.result || "已安排任务已完成" : run.error || "已安排任务执行失败";
  new Notification(run.automationName, { body: body.slice(0, 180), tag: `automation-${run.id}` });
}

/** 将尚未保存的表单草稿转换成只供试运行使用的临时定义，不写入仓储。 */
function draftToTrialDefinition(input: AutomationDefinitionInput): AutomationDefinition {
  const timestamp = new Date().toISOString();
  return {
    ...input,
    id: `trial-${crypto.randomUUID()}`,
    name: input.name.trim() || "试运行已安排任务",
    prompt: input.prompt.trim(),
    sourceScopes: [...input.sourceScopes],
    collectionConfig: input.collectionConfig ? structuredClone(input.collectionConfig) : undefined,
    schedule: { ...input.schedule },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** 已安排 hook 只维护可序列化快照，调度、租约和执行均委托给服务层。 */
export function useAutomationCenter({
  connection,
  aiSnapshot,
  personalization,
  onChanged,
  onNotice,
  scope,
}: {
  connection?: ApiConnectionProfile;
  aiSnapshot: AiConnectionSnapshot;
  personalization: PersonalizationSettings;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  scope: WorkspaceDataScope;
}) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>(EMPTY_SNAPSHOT);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const schedulerRunning = useRef(false);

  const refresh = useCallback(async () => {
    const loaded = await automationRepository.loadSnapshot();
    const definitions = filterWorkspaceRecords(loaded.definitions, scope);
    const runs = filterWorkspaceRecords(loaded.runs, scope);
    setSnapshot({ definitions, runs, unreadCount: runs.filter((run) => run.unread).length });
  }, [scope]);

  const runDefinition = useCallback(async (definitionId: string, scheduled?: { scheduledAt: string; nextRunAt: string; missedCount: number; expectedUpdatedAt: string }) => {
    if (scope.kind === "sample" || isUiReviewRecordId(definitionId)) {
      onNotice("UI 审查任务只用于检查界面，不会调用真实 AI、MCP 或外部来源。");
      return undefined;
    }
    const definition = (await automationRepository.loadSnapshot()).definitions.find((item) => item.id === definitionId);
    if (!definition) throw new Error("已安排任务不存在");
    setBusyIds((current) => current.includes(definitionId) ? current : [...current, definitionId]);
    try {
      const run = await withBrowserLock(`review-automation:${definitionId}`, () => automationRepository.run({
        definition,
        connection,
        aiSnapshot,
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
  }, [aiSnapshot, connection, onChanged, onNotice, personalization, refresh, scope.kind]);

  const processDue = useCallback(async () => {
    if (scope.kind === "sample") return;
    if (schedulerRunning.current || document.visibilityState === "hidden" || !navigator.onLine) return;
    schedulerRunning.current = true;
    try {
      const due = await automationRepository.listDue();
      for (const item of due) {
        if (isUiReviewRecordId(item.definition.id)) continue;
        await runDefinition(item.definition.id, item);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "已安排调度失败");
    } finally {
      schedulerRunning.current = false;
    }
  }, [onNotice, runDefinition, scope.kind]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void refresh().then(processDue).catch((error) => onNotice(error instanceof Error ? error.message : "已安排读取失败"));
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
    onNotice(id ? "已安排任务已更新" : "已安排任务已创建");
  }, [onNotice, refresh]);

  const preview = useCallback(async (input: AutomationDefinitionInput): Promise<AutomationPreviewResult> => {
    if (scope.kind === "sample") return { summary: [], contextCharCount: 0 };
    const result = await previewAutomationDefinition(input);
    return { ...result, collection: input.collectionConfig ? previewCollectionConfig(input.collectionConfig) : undefined };
  }, [scope.kind]);

  const trialRun = useCallback(async (input: AutomationDefinitionInput): Promise<AutomationTrialResult> => {
    if (scope.kind === "sample") {
      return { status: "failed", error: "示例模式不会调用真实 AI", proposalCount: 0, contextSummary: [], contextCharCount: 0 };
    }
    const previewResult = await previewAutomationDefinition(input);
    try {
      const output = await trialAutomationDefinition({
        definition: draftToTrialDefinition(input),
        connection,
        aiSnapshot,
        personalization,
      });
      return {
        status: "succeeded",
        result: output.result,
        proposalCount: output.proposalIds.length,
        contextSummary: output.contextSummary,
        contextCharCount: output.contextCharCount,
        collectionSummary: output.collectionSummary,
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
  }, [aiSnapshot, connection, personalization, scope.kind]);

  const remove = useCallback(async (id: string) => {
    await automationRepository.remove(id);
    await refresh();
    onNotice("已安排任务及其运行记录已删除");
  }, [onNotice, refresh]);

  const duplicate = useCallback(async (id: string) => {
    await automationRepository.duplicate(id);
    await refresh();
    onNotice("已创建停用的已安排任务副本");
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
    aiSnapshot, busyIds, duplicate, markAllRead, markRead, processDue, refresh, remove, requestNotifications,
    preview, runNow: runDefinition, save, snapshot, toggle, trialRun,
  }), [aiSnapshot, busyIds, duplicate, markAllRead, markRead, preview, processDue, refresh, remove, requestNotifications, runDefinition, save, snapshot, toggle, trialRun]);
}

/** 自动化子组件共享的 hook 返回类型。 */
export type AutomationCenter = ReturnType<typeof useAutomationCenter>;
