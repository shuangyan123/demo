"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { conversationRepository } from "../../services/conversation-repository";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model.ts";
import type { AiConversation } from "../../types/domains/conversation.ts";

/** 对话模型选择只保存连接引用、模型 ID 与归一化运行值，不复制连接密钥。 */
export type ConversationModelSelectionValue = {
  connectionId: string;
  modelId: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
};

type OptimisticSelection = {
  revision: number;
  value: ConversationModelSelectionValue;
};

type ConversationSelectionWriteCoordinator = {
  error?: string;
  lastCommitted?: ConversationModelSelectionValue;
  latestFailedRevision?: number;
  latestRevision: number;
  listeners: Set<() => void>;
  nextRevision: number;
  optimistic?: OptimisticSelection;
  pendingWrites: number;
  queue: Promise<void>;
  version: number;
};

/** Workspace 会按对话切换重挂载；共享协调器确保旧实例写入也服从全局点击顺序。 */
const selectionWriteCoordinators = new Map<string, ConversationSelectionWriteCoordinator>();

function getSelectionWriteCoordinator(conversationId: string): ConversationSelectionWriteCoordinator {
  const current = selectionWriteCoordinators.get(conversationId);
  if (current) return current;
  const created: ConversationSelectionWriteCoordinator = {
    latestRevision: 0,
    listeners: new Set(),
    nextRevision: 0,
    pendingWrites: 0,
    queue: Promise.resolve(),
    version: 0,
  };
  selectionWriteCoordinators.set(conversationId, created);
  return created;
}

/** 将跨 Workspace 实例的乐观值同步给当前订阅者。 */
function notifySelectionCoordinator(coordinator: ConversationSelectionWriteCoordinator) {
  coordinator.version += 1;
  for (const listener of coordinator.listeners) listener();
}

type UseConversationModelSelectionOptions = {
  activeConversation: AiConversation | null;
  conversations: AiConversation[];
  fallbackSelection?: ConversationModelSelectionValue;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
};

function conversationSelection(conversation: AiConversation): ConversationModelSelectionValue | undefined {
  if (!conversation.selectedConnectionId || !conversation.selectedModelId) return undefined;
  return {
    connectionId: conversation.selectedConnectionId,
    modelId: conversation.selectedModelId,
    selectedRuntimeValues: conversation.selectedRuntimeValues,
  };
}

function runtimeValuesEqual(left?: AiSelectedRuntimeValues, right?: AiSelectedRuntimeValues): boolean {
  return left?.reasoning === right?.reasoning && left?.speed === right?.speed;
}

function selectionsEqual(left: ConversationModelSelectionValue | undefined, right: ConversationModelSelectionValue | undefined): boolean {
  return left?.connectionId === right?.connectionId
    && left?.modelId === right?.modelId
    && runtimeValuesEqual(left?.selectedRuntimeValues, right?.selectedRuntimeValues);
}

/**
 * 隔离空白草稿与各对话的乐观模型选择，并按点击顺序串行写入 IndexedDB。
 * 较旧写入完成时不会覆盖较新的界面值；写入失败只回滚对应对话的最新选择。
 */
export function useConversationModelSelection({
  activeConversation,
  conversations,
  fallbackSelection,
  onNotice,
  onRefresh,
}: UseConversationModelSelectionOptions) {
  const [draftSelection, setDraftSelection] = useState<ConversationModelSelectionValue>();
  const activeConversationId = activeConversation?.id;
  const subscribeOptimisticSelection = useCallback((listener: () => void) => {
    if (!activeConversationId) return () => undefined;
    const coordinator = getSelectionWriteCoordinator(activeConversationId);
    coordinator.listeners.add(listener);
    return () => {
      coordinator.listeners.delete(listener);
      if (!coordinator.listeners.size && !coordinator.optimistic && !coordinator.error && !coordinator.pendingWrites) selectionWriteCoordinators.delete(activeConversationId);
    };
  }, [activeConversationId]);
  const readCoordinatorVersion = useCallback(
    () => activeConversationId ? getSelectionWriteCoordinator(activeConversationId).version : 0,
    [activeConversationId],
  );
  useSyncExternalStore(
    subscribeOptimisticSelection,
    readCoordinatorVersion,
    () => 0,
  );
  const activeCoordinator = activeConversationId ? getSelectionWriteCoordinator(activeConversationId) : undefined;
  const optimisticSelection = activeCoordinator?.optimistic;
  const selectionError = activeCoordinator?.error;

  useEffect(() => {
    for (const conversation of conversations) {
      const coordinator = selectionWriteCoordinators.get(conversation.id);
      if (!coordinator?.optimistic || !selectionsEqual(coordinator.optimistic.value, conversationSelection(conversation))) continue;
      coordinator.optimistic = undefined;
      notifySelectionCoordinator(coordinator);
      if (!coordinator.listeners.size && !coordinator.error && !coordinator.pendingWrites) selectionWriteCoordinators.delete(conversation.id);
    }
  }, [conversations]);

  const selection = activeConversation
    ? optimisticSelection?.value ?? conversationSelection(activeConversation)
    : draftSelection ?? fallbackSelection;

  const selectModel = useCallback((value: ConversationModelSelectionValue) => {
    if (!activeConversation) {
      setDraftSelection(value);
      return;
    }

    const conversationId = activeConversation.id;
    const coordinator = getSelectionWriteCoordinator(conversationId);
    if (!coordinator.optimistic) coordinator.lastCommitted = conversationSelection(activeConversation);
    const revision = ++coordinator.nextRevision;
    coordinator.latestRevision = revision;
    coordinator.latestFailedRevision = undefined;
    coordinator.error = undefined;
    coordinator.optimistic = { revision, value };
    coordinator.pendingWrites += 1;
    notifySelectionCoordinator(coordinator);

    coordinator.queue = coordinator.queue.then(async () => {
      try {
        await conversationRepository.setConversationModelSelection(
          conversationId,
          value.connectionId,
          value.modelId,
          value.selectedRuntimeValues,
        );
      } catch (error) {
        if (coordinator.latestRevision === revision) {
          const message = error instanceof Error ? `模型选择保存失败：${error.message}` : "模型选择保存失败，已恢复原值";
          coordinator.latestFailedRevision = revision;
          coordinator.error = message;
          coordinator.optimistic = coordinator.lastCommitted
            ? { revision, value: coordinator.lastCommitted }
            : undefined;
          notifySelectionCoordinator(coordinator);
          onNotice(message);
          try {
            await onRefresh();
          } catch (refreshError) {
            onNotice(refreshError instanceof Error ? `模型选择回滚后刷新失败：${refreshError.message}` : "模型选择回滚后刷新失败");
          }
        }
        return;
      }

      coordinator.lastCommitted = value;
      if (coordinator.latestRevision !== revision) return;
      coordinator.latestFailedRevision = undefined;
      try {
        await onRefresh();
      } catch (error) {
        onNotice(error instanceof Error ? `模型已保存，但刷新失败：${error.message}` : "模型已保存，但刷新失败");
      }
    }).finally(() => {
      coordinator.pendingWrites -= 1;
      if (!coordinator.listeners.size && !coordinator.optimistic && !coordinator.error && !coordinator.pendingWrites) {
        selectionWriteCoordinators.delete(conversationId);
      }
    });
  }, [activeConversation, onNotice, onRefresh]);

  const flushPendingSelection = useCallback(async (): Promise<{
    ok: boolean;
    selection?: ConversationModelSelectionValue;
  }> => {
    if (!activeConversation) return { ok: true, selection: draftSelection ?? fallbackSelection };
    const coordinator = getSelectionWriteCoordinator(activeConversation.id);
    let pending: Promise<void>;
    do {
      pending = coordinator.queue;
      await pending;
    } while (pending !== coordinator.queue);
    return {
      ok: coordinator.latestFailedRevision !== coordinator.latestRevision,
      selection: coordinator.optimistic?.value ?? conversationSelection(activeConversation),
    };
  }, [activeConversation, draftSelection, fallbackSelection]);

  return { flushPendingSelection, selection, selectionError, selectModel };
}
