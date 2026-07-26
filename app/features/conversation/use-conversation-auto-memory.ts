"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { extractAutomaticMemories, extractExplicitMemory, type AutomaticMemoryTurn } from "../../services/automatic-memory-service";
import { personalMemoryRepository } from "../../services/personal-memory-repository";

type UseConversationAutoMemoryInput = {
  connection?: ApiConnectionProfile;
  modelId?: string;
  settings: PersonalizationSettings;
  onSettingsChange?: (settings: PersonalizationSettings) => void;
  onNotice: (message: string) => void;
};

/** 连续三轮或空闲 45 秒批量提取；失败保留队列并在下次触发时重试。 */
export function useConversationAutoMemory(input: UseConversationAutoMemoryInput) {
  const queueRef = useRef<AutomaticMemoryTurn[]>([]);
  const timerRef = useRef<number | undefined>(undefined);
  const runningRef = useRef(false);
  const latestRef = useRef(input);
  useEffect(() => { latestRef.current = input; }, [input]);

  const flush = useCallback(async () => {
    const current = latestRef.current;
    if (runningRef.current || !queueRef.current.length || !current.connection || !current.modelId) return;
    if (!(current.settings.memorySettings?.autoMemoryEnabled ?? current.settings.memorySettings?.suggestionsEnabled)) return;
    runningRef.current = true;
    const batch = queueRef.current.splice(0, 3);
    try {
      const candidates = await extractAutomaticMemories({ connection: current.connection, modelId: current.modelId, turns: batch });
      const result = await personalMemoryRepository.applyAutomaticCandidates(candidates);
      current.onSettingsChange?.(result.settings);
      if (result.active || result.pending) current.onNotice(`自动记忆：${result.active} 条已生效，${result.pending} 条待处理，可在 30 秒内撤销`);
    } catch {
      queueRef.current = [...batch, ...queueRef.current].slice(-9);
    } finally {
      runningRef.current = false;
    }
  }, []);

  const recordCompletedTurn = useCallback((turn: AutomaticMemoryTurn) => {
    const current = latestRef.current;
    if (!(current.settings.memorySettings?.autoMemoryEnabled ?? current.settings.memorySettings?.suggestionsEnabled)) return;
    const explicit = extractExplicitMemory(turn);
    if (explicit) {
      void personalMemoryRepository.applyAutomaticCandidates([explicit]).then((result) => {
        current.onSettingsChange?.(result.settings);
        if (result.active) current.onNotice("已记住这项偏好，可在个性化 → 记忆中撤销");
      });
      return;
    }
    queueRef.current.push(turn);
    if (queueRef.current.length >= 3) void flush();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), 45_000);
  }, [flush]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    void flush();
  }, [flush]);

  return { flush, recordCompletedTurn };
}
