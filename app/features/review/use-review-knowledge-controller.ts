"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { buildKnowledgeCategorySummaries, filterKnowledgeTrainingQueue } from "../knowledge/knowledge-workspace";
import { useKnowledgeInternalization } from "../knowledge/use-knowledge-internalization";
import { splitInput, textValue } from "../../lib/form-utils";
import {
  buildKnowledgeAssociationSummary,
  buildKnowledgeDueEntries,
  buildKnowledgeTagOptions,
  buildLocalAssociationMatches,
  buildLowKnowledgeEntries,
  calculateCorrectRate,
  filterKnowledgeEntries,
  resolveActiveKnowledgeId,
} from "../../lib/review-selectors";
import { findRelatedKnowledgeEntries, findRelatedMistakesForKnowledge } from "../../services/association-matcher";
import { associationRepository, suggestionToLinkInput } from "../../services/association-repository";
import { downloadExportFile, exportKnowledgeEntries } from "../../services/export-service";
import { knowledgeRepository } from "../../services/knowledge-repository";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { AssociationSuggestion, KnowledgeMistakeLink } from "../../types/domains/association.ts";
import type { ExportFormat, ExportScope, Mistake, ReviewResult } from "../../types/domains/review.ts";
import type { KnowledgeCategory, KnowledgeEntry, KnowledgeFilters, KnowledgeImportDraft, KnowledgeQueueFilter } from "../../types/domains/knowledge.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { useLearningSubmission } from "./use-learning-submission.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

type UseReviewKnowledgeControllerInput = {
  associationLinks: KnowledgeMistakeLink[];
  currentReview: Mistake | null;
  entries: KnowledgeEntry[];
  knowledgeAttemptsCount: number;
  knowledgeCorrectCount: number;
  mistakes: Mistake[];
  onNotice: (message: string) => void;
  onOpenApiSettings: (message: string) => void;
  onRefresh: () => Promise<void>;
  onSelectView: (view: ViewKey) => void;
  personalization: PersonalizationSettings;
  selectedMistake: Mistake | null;
  textConnection?: ApiConnectionProfile;
  today: Date;
};

const INITIAL_FILTERS: KnowledgeFilters = { category: "全部", search: "", tag: "全部", favoriteOnly: false };

async function loadObsidianKnowledgeRepository() {
  const { obsidianKnowledgeRepository } = await import("../../services/obsidian-knowledge-repository");
  return obsidianKnowledgeRepository;
}

/** 管理知识筛选、训练、导入草稿和错题关联，所有持久化仍委托既有 repository。 */
export function useReviewKnowledgeController(input: UseReviewKnowledgeControllerInput) {
  const {
    associationLinks,
    currentReview,
    entries,
    knowledgeAttemptsCount,
    knowledgeCorrectCount,
    mistakes,
    onNotice,
    onOpenApiSettings,
    onRefresh,
    onSelectView,
    personalization,
    selectedMistake,
    textConnection,
    today,
  } = input;
  const [filters, setFilters] = useState<KnowledgeFilters>(INITIAL_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trainingIndex, setTrainingIndex] = useState(0);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState<KnowledgeQueueFilter>("due");
  const [drafts, setDrafts] = useState<KnowledgeImportDraft[]>([]);
  const [associationSuggestions, setAssociationSuggestions] = useState<AssociationSuggestion[]>([]);
  const [associationBusy, setAssociationBusy] = useState(false);
  const submission = useLearningSubmission(onRefresh, onNotice);
  const [explicitTrainingId, setExplicitTrainingId] = useState<string | null>(null);

  const tagOptions = useMemo(() => buildKnowledgeTagOptions(entries), [entries]);
  const filteredEntries = useMemo(() => filterKnowledgeEntries(entries, filters), [entries, filters]);
  const activeId = resolveActiveKnowledgeId(selectedId, filteredEntries);
  const selectedEntry = entries.find((item) => item.id === activeId) ?? null;
  const selectedMistakeKnowledge = useMemo(
    () => buildLocalAssociationMatches(selectedMistake, null, entries, mistakes).relatedKnowledge,
    [entries, mistakes, selectedMistake],
  );
  const currentReviewKnowledge = useMemo(
    () => buildLocalAssociationMatches(currentReview, null, entries, mistakes).relatedKnowledge,
    [currentReview, entries, mistakes],
  );
  const dueEntries = useMemo(() => buildKnowledgeDueEntries(entries, today), [entries, today]);
  const lowEntries = useMemo(() => buildLowKnowledgeEntries(entries), [entries]);
  const categorySummaries = useMemo(
    () => buildKnowledgeCategorySummaries(entries, dueEntries, lowEntries),
    [dueEntries, entries, lowEntries],
  );
  const candidateTrainingQueue = useMemo(
    () => filterKnowledgeTrainingQueue(entries, dueEntries, lowEntries, queueFilter),
    [dueEntries, entries, lowEntries, queueFilter],
  );
  const allTrainingQueue = useMemo(
    () => filterKnowledgeTrainingQueue(entries, dueEntries, lowEntries, "all"),
    [dueEntries, entries, lowEntries],
  );
  const trainingQueue = (explicitTrainingId ? entries.filter((item) => item.id === explicitTrainingId) : candidateTrainingQueue)
    .filter((item) => !submission.committedIds.includes(item.id));
  const selectedEntryMistakes = useMemo(
    () => buildLocalAssociationMatches(null, selectedEntry, entries, mistakes).relatedMistakes,
    [entries, mistakes, selectedEntry],
  );
  const selectedMistakeAssociation = useMemo(
    () => buildKnowledgeAssociationSummary(associationLinks, associationSuggestions, selectedMistake?.id ?? null, "mistake"),
    [associationLinks, associationSuggestions, selectedMistake],
  );
  const selectedEntryAssociation = useMemo(
    () => buildKnowledgeAssociationSummary(associationLinks, associationSuggestions, selectedEntry?.id ?? null, "knowledge"),
    [associationLinks, associationSuggestions, selectedEntry],
  );
  const currentReviewAssociation = useMemo(
    () => buildKnowledgeAssociationSummary(associationLinks, associationSuggestions, currentReview?.id ?? null, "mistake"),
    [associationLinks, associationSuggestions, currentReview],
  );
  const currentReviewLinkedEntries = useMemo(() => {
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    return currentReviewAssociation.links
      .map((link) => entriesById.get(link.knowledgeId))
      .filter((entry): entry is KnowledgeEntry => Boolean(entry));
  }, [currentReviewAssociation.links, entries]);
  const currentTraining = trainingQueue[trainingIndex] ?? trainingQueue[0] ?? null;
  const correctRate = calculateCorrectRate(knowledgeAttemptsCount, knowledgeCorrectCount);

  function openEntry(entry: KnowledgeEntry) {
    setFilters({ ...INITIAL_FILTERS, category: entry.category });
    setSelectedId(entry.id);
    onSelectView("knowledge");
  }

  function openCategory(category: KnowledgeCategory) {
    setFilters({ ...INITIAL_FILTERS, category });
    setSelectedId(null);
    onSelectView("knowledge");
  }

  function resetTraining() {
    submission.reset();
    setExplicitTrainingId(null);
    setTrainingIndex(0);
    setAnswerOpen(false);
  }

  function openTraining(entryId?: string) {
    if (submission.busy || submission.refreshFailed) return;
    if (entryId && !entries.some((item) => item.id === entryId)) return onNotice("这条知识已不可用，请刷新学习数据。");
    resetTraining();
    const activeIndex = entryId ? candidateTrainingQueue.findIndex((entry) => entry.id === entryId) : 0;
    if (entryId && activeIndex < 0) setExplicitTrainingId(entryId);
    setTrainingIndex(Math.max(0, activeIndex));
    setAnswerOpen(false);
    onSelectView("knowledgeTraining");
  }

  function changeQueueFilter(filter: KnowledgeQueueFilter) {
    if (submission.busy || submission.refreshFailed) return;
    setQueueFilter(filter);
    resetTraining();
  }

  function moveTraining(delta: -1 | 1) {
    if (submission.busy || submission.refreshFailed) return;
    setTrainingIndex((current) => trainingQueue.length ? (current + delta + trainingQueue.length) % trainingQueue.length : 0);
    setAnswerOpen(false);
  }

  function skipTraining() {
    moveTraining(1);
    onNotice("已跳过当前知识训练卡片");
  }

  async function recordTraining(result: ReviewResult) {
    if (!currentTraining) return;
    await submission.record(currentTraining.id, async () => {
      await knowledgeRepository.recordReview(currentTraining, result, today);
      setTrainingIndex(0);
      setAnswerOpen(false);
    }, "知识训练记录已保存");
  }

  async function addEntry(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const category = textValue(formData.get("category")) as KnowledgeCategory;
    const content = textValue(formData.get("content"));
    const entry = await knowledgeRepository.create({
      category,
      title: textValue(formData.get("title")),
      summary: textValue(formData.get("summary")) || content.slice(0, 120),
      content,
      tags: splitInput(formData.get("tags")),
      source: textValue(formData.get("source")) || "手动整理",
      favorite: false,
    }, today);
    form.reset();
    setSelectedId(entry.id);
    setFilters((current) => ({ ...current, category }));
    onSelectView("knowledge");
    await onRefresh();
    onNotice("知识条目已保存");
  }

  async function updateEntry(id: string, patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">>) {
    await knowledgeRepository.update(id, patch, today);
    await onRefresh();
    onNotice("知识条目已更新");
  }

  async function deleteEntry(id: string) {
    const obsidian = await loadObsidianKnowledgeRepository();
    const mapping = await obsidian.mappingForKnowledge(id);
    const message = mapping ? "这条资料已映射到 Obsidian。确定同时删除 Vault 托管笔记、本地训练记录和关联吗？" : "确定删除这条知识资料吗？";
    if (!window.confirm(message)) return;
    if (mapping) await obsidian.removeManagedNotes([id]);
    await knowledgeRepository.remove(id);
    setSelectedId(null);
    await onRefresh();
    onNotice("知识条目已删除");
  }

  async function deleteEntries(ids: string[]) {
    if (!ids.length) {
      onNotice("请先选择要删除的知识资料");
      return;
    }
    const obsidian = await loadObsidianKnowledgeRepository();
    const mapped = (await Promise.all(ids.map((id) => obsidian.mappingForKnowledge(id)))).filter(Boolean);
    if (mapped.length && !window.confirm(`其中 ${mapped.length} 条已映射到 Obsidian。继续会同时删除对应 Vault 托管笔记，确定继续吗？`)) return;
    if (mapped.length) await obsidian.removeManagedNotes(ids);
    const idSet = new Set(ids);
    await knowledgeRepository.removeMany(ids);
    if (selectedId && idSet.has(selectedId)) setSelectedId(null);
    if (currentTraining && idSet.has(currentTraining.id)) resetTraining();
    await onRefresh();
    onNotice(`已删除 ${ids.length} 条知识资料，并清理训练记录和关联`);
  }

  async function toggleFavorite(entry: KnowledgeEntry) {
    await knowledgeRepository.toggleFavorite(entry, today);
    await onRefresh();
    onNotice(entry.favorite ? "已取消收藏" : "已收藏知识条目");
  }

  async function importText(event: SubmitReactEvent, noticeSink: (message: string) => void = onNotice) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rawText = textValue(formData.get("knowledgeText"));
    if (!rawText) return noticeSink("请先粘贴知识库资料");
    const parsed = knowledgeRepository.parseImportDrafts({
      category: textValue(formData.get("knowledgeCategory")) as KnowledgeCategory,
      rawText,
      tags: splitInput(formData.get("knowledgeTags")),
      source: textValue(formData.get("knowledgeSource")) || "文本导入",
    });
    setDrafts(parsed);
    noticeSink(`已生成 ${parsed.length} 条知识资料草稿，请确认后入库`);
  }

  function updateDraft(id: string, patch: Partial<KnowledgeImportDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function updateDraftList(id: string, value: string) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, tags: splitInput(value) } : draft));
  }

  function deleteDraft(id: string) {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  async function confirmDrafts() {
    const selected = drafts.filter((draft) => draft.selected && draft.title.trim() && draft.content.trim());
    if (!selected.length) return onNotice("请选择至少一条有效知识资料草稿");
    const saved = await knowledgeRepository.addDrafts(selected, today);
    setDrafts((current) => current.filter((draft) => !draft.selected));
    setFilters((current) => ({ ...current, category: saved[0]?.category ?? current.category }));
    setSelectedId(saved[0]?.id ?? null);
    onSelectView("knowledge");
    await onRefresh();
    onNotice(`已保存 ${saved.length} 条知识资料`);
  }

  function createStarterDrafts(category?: KnowledgeCategory) {
    const starterDrafts = knowledgeRepository.createStarterDrafts(category);
    setDrafts((current) => [...starterDrafts, ...current]);
    setFilters({ ...INITIAL_FILTERS, category: category ?? "全部" });
    onSelectView("import");
    onNotice(`已生成 ${starterDrafts.length} 条知识库模板草稿，请在导入资料中编辑确认后入库`);
  }

  function createDraftFromMistake(mistake: Mistake) {
    const draft = knowledgeRepository.createDraftFromMistake(mistake);
    setDrafts((current) => [draft, ...current]);
    setFilters({ ...INITIAL_FILTERS, category: draft.category });
    onSelectView("import");
    onNotice("已从错题生成知识资料草稿，请在导入资料中编辑确认后入库");
  }

  function exportItems(items: KnowledgeEntry[], format: ExportFormat, scope: ExportScope) {
    if (!items.length) return onNotice("当前没有可导出的知识资料");
    const file = exportKnowledgeEntries(items, format, scope);
    downloadExportFile(file);
    onNotice(`已导出 ${items.length} 条知识资料：${file.filename}`);
  }

  async function analyzeMistake(mistake: Mistake) {
    if (!textConnection) return onOpenApiSettings("请先配置默认文本连接，再使用 AI 关联分析");
    const linkedIds = new Set(associationLinks.filter((link) => link.mistakeId === mistake.id).map((link) => link.knowledgeId));
    const candidates = findRelatedKnowledgeEntries(mistake, entries, 10).map((match) => match.entry).filter((entry) => !linkedIds.has(entry.id));
    if (!candidates.length) return onNotice("暂无可供 AI 分析的本地候选资料，请先补充知识库或标签");
    setAssociationBusy(true);
    try {
      const { analyzeMistakeKnowledgeAssociations } = await import("../../services/ai-association-service");
      const suggestions = await analyzeMistakeKnowledgeAssociations({ mistake, candidates, connection: textConnection });
      setAssociationSuggestions((current) => [...suggestions, ...current.filter((item) => item.mistakeId !== mistake.id)]);
      onNotice(suggestions.length ? `AI 已生成 ${suggestions.length} 条关联建议，请确认后保存` : "AI 没有找到值得确认的关联");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "AI 关联分析失败");
    } finally {
      setAssociationBusy(false);
    }
  }

  async function analyzeEntry(entry: KnowledgeEntry) {
    if (!textConnection) return onOpenApiSettings("请先配置默认文本连接，再使用 AI 关联分析");
    const linkedIds = new Set(associationLinks.filter((link) => link.knowledgeId === entry.id).map((link) => link.mistakeId));
    const candidates = findRelatedMistakesForKnowledge(entry, mistakes, 10).map((match) => match.mistake).filter((item) => !linkedIds.has(item.id));
    if (!candidates.length) return onNotice("暂无可供 AI 分析的本地候选错题，请先补充错题标签或错因");
    setAssociationBusy(true);
    try {
      const { analyzeKnowledgeMistakeAssociations } = await import("../../services/ai-association-service");
      const suggestions = await analyzeKnowledgeMistakeAssociations({ entry, candidates, connection: textConnection });
      setAssociationSuggestions((current) => [...suggestions, ...current.filter((item) => item.knowledgeId !== entry.id)]);
      onNotice(suggestions.length ? `AI 已生成 ${suggestions.length} 条关联建议，请确认后保存` : "AI 没有找到值得确认的关联");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "AI 关联分析失败");
    } finally {
      setAssociationBusy(false);
    }
  }

  function clearSuggestions(targetId: string, mode: "mistake" | "knowledge") {
    setAssociationSuggestions((current) => current.filter((item) => mode === "mistake" ? item.mistakeId !== targetId : item.knowledgeId !== targetId));
    onNotice("已清空当前 AI 关联预览");
  }

  async function confirmSuggestions(suggestions: AssociationSuggestion[]) {
    const selected = suggestions.filter((item) => item.selected);
    if (!selected.length) return onNotice("请选择至少一条关联建议");
    await associationRepository.saveLinks(selected.map(suggestionToLinkInput), today);
    const selectedIds = new Set(selected.map((item) => item.id));
    setAssociationSuggestions((current) => current.filter((item) => !selectedIds.has(item.id)));
    await onRefresh();
    onNotice(`已确认 ${selected.length} 条关联`);
  }

  async function removeLink(id: string) {
    await associationRepository.removeLink(id);
    await onRefresh();
    onNotice("关联已取消");
  }

  const internalization = useKnowledgeInternalization({
    connection: textConnection,
    entries,
    links: associationLinks,
    mistakes,
    personalization,
    onConfirmed: async (entry) => {
      await onRefresh();
      openEntry(entry);
    },
    onNotice,
  });

  return {
    actions: {
      addEntry, analyzeEntry, analyzeMistake, changeQueueFilter, clearSuggestions, confirmDrafts, confirmSuggestions,
      createDraftFromMistake, createStarterDrafts, deleteDraft, deleteEntries, deleteEntry,
      deleteSuggestion: (id: string) => setAssociationSuggestions((current) => current.filter((item) => item.id !== id)),
      exportItems, importText, moveTraining, openCategory, openEntry, openTraining, recordTraining, removeLink,
      resetTraining, setAnswerOpen, setDrafts, setFilters, setSelectedId, skipTraining,
      selectTraining: (id?: string) => {
        if (submission.busy || submission.refreshFailed) return;
        setTrainingIndex(Math.max(0, trainingQueue.findIndex((entry) => entry.id === id)));
        setAnswerOpen(false);
      },
      toggleFavorite,
      toggleSuggestion: (id: string, selected: boolean) => setAssociationSuggestions((current) => current.map((item) => item.id === id ? { ...item, selected } : item)),
      updateDraft, updateDraftList, updateEntry,
    },
    snapshot: {
      activeId, allTrainingQueue, answerOpen, associationBusy, categorySummaries, correctRate, currentReviewLinkedEntries,
      currentReviewKnowledge, currentTraining, drafts, dueEntries, filteredEntries, filters, internalization, lowEntries,
      queueFilter, selectedEntry, selectedEntryAssociation, selectedEntryMistakes, selectedMistakeAssociation,
      selectedMistakeKnowledge, tagOptions, trainingIndex, trainingQueue,
      submission,
    },
  };
}

export type ReviewKnowledgeController = ReturnType<typeof useReviewKnowledgeController>;
