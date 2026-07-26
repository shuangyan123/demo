"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { knowledgeInternalizationRepository } from "../../services/knowledge-internalization-repository";
import { rankInternalizationCandidates, requestKnowledgeInternalization } from "../../services/knowledge-internalization-service";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { KnowledgeEntry, KnowledgeInternalizationDraft } from "../../types/domains/knowledge.ts";
import type { KnowledgeMistakeLink } from "../../types/domains/association.ts";
import type { Mistake } from "../../types/domains/review.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";

// 把错题内化的草稿恢复、生成、编辑和确认集中在独立 hook，避免继续膨胀主工作台。
export function useKnowledgeInternalization({
  connection,
  entries,
  links,
  mistakes,
  personalization,
  onConfirmed,
  onNotice,
}: {
  connection?: ApiConnectionProfile;
  entries: KnowledgeEntry[];
  links: KnowledgeMistakeLink[];
  mistakes: Mistake[];
  personalization: PersonalizationSettings;
  onConfirmed: (entry: KnowledgeEntry) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [drafts, setDrafts] = useState<KnowledgeInternalizationDraft[]>([]);
  const [selectedMistakeIds, setSelectedMistakeIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const refreshDrafts = useCallback(async () => {
    setDrafts(await knowledgeInternalizationRepository.listDrafts());
  }, []);

  useEffect(() => {
    let active = true;
    knowledgeInternalizationRepository
      .listDrafts()
      .then((saved) => {
        if (active) setDrafts(saved);
      })
      .catch((error) => {
        if (active) onNotice(error instanceof Error ? error.message : "内化草稿恢复失败");
      });
    return () => {
      active = false;
    };
  }, [onNotice]);

  const duplicateMistakeIds = useMemo(() => {
    const ids = new Set(links.filter((link) => link.kind === "internalized").map((link) => link.mistakeId));
    drafts.forEach((draft) => draft.sourceMistakeIds.forEach((id) => ids.add(id)));
    return ids;
  }, [drafts, links]);

  function toggleMistake(id: string, selected: boolean) {
    setSelectedMistakeIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function generateDraft() {
    if (!connection) {
      onNotice("请先为默认文本能力分配一个可用 AI 连接");
      return;
    }
    const selectedMistakes = mistakes.filter((mistake) => selectedMistakeIds.has(mistake.id));
    if (!selectedMistakes.length) {
      onNotice("请至少选择一道需要内化的错题");
      return;
    }
    const repeatedCount = selectedMistakes.filter((mistake) => duplicateMistakeIds.has(mistake.id)).length;
    if (repeatedCount) onNotice(`其中 ${repeatedCount} 道错题已有内化关联或待确认草稿，请在预览中检查重复内容`);

    setBusy(true);
    try {
      const draft = await requestKnowledgeInternalization({
        mistakes: selectedMistakes,
        candidates: rankInternalizationCandidates(selectedMistakes, entries),
        connection,
        personalization,
      });
      await knowledgeInternalizationRepository.saveDraft(draft);
      await refreshDrafts();
      setSelectedMistakeIds(new Set());
      onNotice("AI 内化草稿已保存，请预览并确认后再写入知识库");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "生成内化草稿失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateDraft(id: string, patch: Partial<KnowledgeInternalizationDraft>) {
    // 先更新内存预览保证输入流畅，再异步落盘；无需每次键入后重新查询整张表。
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch, updatedAt: new Date().toISOString() } : draft)));
    await knowledgeInternalizationRepository.updateDraft(id, patch);
  }

  async function removeDraft(id: string) {
    await knowledgeInternalizationRepository.removeDraft(id);
    await refreshDrafts();
    onNotice("内化草稿已忽略");
  }

  async function confirmDraft(id: string) {
    try {
      const entry = await knowledgeInternalizationRepository.confirmDraft(id);
      await refreshDrafts();
      await onConfirmed(entry);
      onNotice("内化资料与来源错题关联已在同一事务中保存");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "确认内化草稿失败");
    }
  }

  return {
    busy,
    drafts,
    duplicateMistakeIds,
    selectedMistakeIds,
    confirmDraft,
    generateDraft,
    removeDraft,
    toggleMistake,
    updateDraft,
  };
}

export type KnowledgeInternalizationController = ReturnType<typeof useKnowledgeInternalization>;
