"use client";

import type { SyntheticEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  KnowledgeTrainingView,
  KnowledgeView,
  buildKnowledgeCategorySummaries,
  filterKnowledgeTrainingQueue,
} from "../knowledge/knowledge-workspace";
import { DashboardView } from "./review-dashboard-view";
import { EntryView } from "./review-entry-view";
import { ImportView } from "../import/review-import-view";
import { InterviewWorkspace } from "../interview/interview-workspace";
import { TutoringWorkspace } from "../tutoring/tutoring-workspace";
import { useImportDrafts } from "../import/use-import-drafts";
import { LibraryView } from "./review-library-view";
import { ReviewView } from "./review-session-view";
import { StatsView } from "./review-stats-view";
import { SettingsWorkspace } from "../settings/settings-workspace";
import { useAiConnections } from "../settings/use-ai-connections";
import { usePersonalizationSettings } from "../settings/use-personalization-settings";
import { useKnowledgeInternalization } from "../knowledge/use-knowledge-internalization";
import { AutomationView } from "../automation/automation-view";
import { useAutomationCenter } from "../automation/use-automation-center";
import { Button } from "../shared/ui-primitives";
import { SidebarNav, ViewHeader, WorkspaceShell } from "../shared/workspace-shell";
import { useWorkspaceNavigation } from "../shared/use-workspace-navigation";
import { useWorkspaceSidebar } from "../shared/use-workspace-sidebar";
import { useReviewTimer } from "./use-review-timer";
import { useReviewWorkspaceData } from "./use-review-workspace-data";
import { splitInput, textValue } from "../../lib/form-utils";
import {
  buildBoardStats,
  buildKnowledgeAssociationSummary,
  buildKnowledgeDueEntries,
  buildKnowledgeTagOptions,
  buildLocalAssociationMatches,
  buildLowKnowledgeEntries,
  buildLowMistakes,
  buildMistakeFilterOptions,
  buildReviewQueue,
  calculateAverageMastery,
  calculateCorrectRate,
  filterKnowledgeEntries,
  filterMistakes,
  resolveActiveKnowledgeId,
  resolveActiveMistakeId,
  type BoardStat,
} from "../../lib/review-selectors";
import { appearanceSettingsRepository, applyAppearanceSettings, createDefaultAppearanceSettings } from "../../services/appearance-settings-repository";
import { findRelatedKnowledgeEntries, findRelatedMistakesForKnowledge } from "../../services/association-matcher";
import { analyzeKnowledgeMistakeAssociations, analyzeMistakeKnowledgeAssociations } from "../../services/ai-association-service";
import { associationRepository, suggestionToLinkInput } from "../../services/association-repository";
import { downloadExportFile, exportKnowledgeEntries, exportMistakes } from "../../services/export-service";
import { knowledgeRepository } from "../../services/knowledge-repository";
import { obsidianKnowledgeRepository } from "../../services/obsidian-knowledge-repository";
import { reviewRepository } from "../../services/review-repository";
import {
  makeToday,
  toISODate,
} from "../../lib/review-utils";
import {
  type AssociationSuggestion,
  type AppearanceSettings,
  type Board,
  type ExportFormat,
  type ExportScope,
  type Filters,
  type KnowledgeCategory,
  type KnowledgeEntry,
  type KnowledgeFilters,
  type KnowledgeImportDraft,
  type KnowledgeQueueFilter,
  type Mistake,
  type ReviewResult,
  type ViewKey,
} from "../../types/review";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;
type NavIconName = "dashboard" | "library" | "review" | "knowledgeTraining" | "stats" | "knowledge" | "automation" | "interview" | "tutoring" | "import" | "entry" | "settings";

const navItems: Array<{ key: ViewKey; label: string; icon: NavIconName }> = [
  { key: "dashboard", label: "总览", icon: "dashboard" },
  { key: "library", label: "错题库", icon: "library" },
  { key: "review", label: "开始复盘", icon: "review" },
  { key: "knowledge", label: "知识库", icon: "knowledge" },
  { key: "knowledgeTraining", label: "知识训练", icon: "knowledgeTraining" },
  { key: "automation", label: "自动化", icon: "automation" },
  { key: "interview", label: "面试训练", icon: "interview" },
  { key: "tutoring", label: "AI 辅导", icon: "tutoring" },
  { key: "stats", label: "薄弱分析", icon: "stats" },
  { key: "import", label: "导入", icon: "import" },
  { key: "entry", label: "手动录入", icon: "entry" },
];

const viewTitles: Record<ViewKey, string> = {
  dashboard: "总览",
  library: "错题库",
  review: "开始复盘",
  knowledgeTraining: "知识训练",
  interview: "面试训练",
  tutoring: "AI 辅导",
  stats: "薄弱分析",
  knowledge: "知识库",
  automation: "自动化",
  import: "导入",
  entry: "手动录入",
  settings: "设置",
};

const initialFilters: Filters = {
  board: "全部",
  mastery: "all",
  search: "",
};

const initialKnowledgeFilters: KnowledgeFilters = {
  category: "全部",
  search: "",
  tag: "全部",
  favoriteOnly: false,
};

// 错题复盘应用的主工作台，集中管理视图切换、Dexie 数据和导入状态。
export function ReviewWorkspace() {
  const [today] = useState(() => makeToday());
  const {
    associationLinks,
    attempts,
    attemptsCount,
    correctCount,
    importJobs,
    knowledgeAttemptsCount,
    knowledgeCorrectCount,
    knowledgeEntries,
    loading,
    mistakes,
    notice,
    refreshData,
    setNotice,
  } = useReviewWorkspaceData(today);
  const aiConnections = useAiConnections(setNotice);
  const personalization = usePersonalizationSettings(setNotice);
  const automation = useAutomationCenter({
    connection: aiConnections.textConnection,
    personalization: personalization.settings,
    onChanged: refreshData,
    onNotice: setNotice,
  });
  const internalization = useKnowledgeInternalization({
    connection: aiConnections.textConnection,
    entries: knowledgeEntries,
    links: associationLinks,
    mistakes,
    personalization: personalization.settings,
    onConfirmed: async (entry) => {
      await refreshData();
      openKnowledgeEntry(entry);
    },
    onNotice: setNotice,
  });
  const [associationSuggestions, setAssociationSuggestions] = useState<AssociationSuggestion[]>([]);
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(() => createDefaultAppearanceSettings());
  const [settingsInitialSection, setSettingsInitialSection] = useState<"appearance" | "configuration">("appearance");
  const { lastAppView, setView, switchView: navigateView, view } = useWorkspaceNavigation<ViewKey>("dashboard", "settings");
  const { sidebarCollapsed, toggleSidebar } = useWorkspaceSidebar();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [knowledgeFilters, setKnowledgeFilters] = useState<KnowledgeFilters>(initialKnowledgeFilters);
  const [reasonFilter, setReasonFilter] = useState("全部");
  const [tagFilter, setTagFilter] = useState("全部");
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [knowledgeTrainingIndex, setKnowledgeTrainingIndex] = useState(0);
  const [knowledgeAnswerOpen, setKnowledgeAnswerOpen] = useState(false);
  const [knowledgeQueueFilter, setKnowledgeQueueFilter] = useState<KnowledgeQueueFilter>("due");
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<KnowledgeImportDraft[]>([]);
  const [associationBusy, setAssociationBusy] = useState(false);
  const importDraftFlow = useImportDrafts({
    textConnection: aiConnections.textConnection,
    visionConnection: aiConnections.visionConnection,
    importJobs,
    mistakes,
    onRefreshWorkspace: refreshData,
    setNotice,
    today,
  });

  useEffect(() => {
    let active = true;
    appearanceSettingsRepository
      .load()
      .then((settings) => {
        if (!active) return;
        setAppearanceSettings(settings);
        applyAppearanceSettings(settings);
      })
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "外观设置读取失败");
      });
    return () => {
      active = false;
    };
  }, [setNotice]);

  useEffect(() => {
    applyAppearanceSettings(appearanceSettings);
    if (typeof window === "undefined") return;
    const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleSystemAppearanceChange = () => applyAppearanceSettings(appearanceSettings);
    colorSchemeQuery.addEventListener("change", handleSystemAppearanceChange);
    reducedMotionQuery.addEventListener("change", handleSystemAppearanceChange);
    return () => {
      colorSchemeQuery.removeEventListener("change", handleSystemAppearanceChange);
      reducedMotionQuery.removeEventListener("change", handleSystemAppearanceChange);
    };
  }, [appearanceSettings]);

  const dueMistakes = useMemo(() => buildReviewQueue(mistakes, today), [mistakes, today]);
  const lowMistakes = useMemo(() => buildLowMistakes(mistakes), [mistakes]);
  const boardStats = useMemo<BoardStat[]>(() => buildBoardStats(mistakes, today), [mistakes, today]);
  const { reasonOptions, tagOptions } = useMemo(() => buildMistakeFilterOptions(mistakes), [mistakes]);
  const knowledgeTagOptions = useMemo(() => buildKnowledgeTagOptions(knowledgeEntries), [knowledgeEntries]);
  const avgMastery = useMemo(() => calculateAverageMastery(mistakes), [mistakes]);
  const correctRate = useMemo(() => calculateCorrectRate(attemptsCount, correctCount), [attemptsCount, correctCount]);
  const filteredMistakes = useMemo(
    () => filterMistakes(mistakes, filters, selectedBoard, reasonFilter, tagFilter),
    [filters, mistakes, reasonFilter, selectedBoard, tagFilter],
  );
  const activeSelectedId = resolveActiveMistakeId(selectedId, filteredMistakes);
  const selectedMistake = mistakes.find((item) => item.id === activeSelectedId) ?? null;
  const currentReview = dueMistakes[reviewIndex] ?? null;
  const filteredKnowledgeEntries = useMemo(() => filterKnowledgeEntries(knowledgeEntries, knowledgeFilters), [knowledgeEntries, knowledgeFilters]);
  const activeKnowledgeId = resolveActiveKnowledgeId(selectedKnowledgeId, filteredKnowledgeEntries);
  const selectedKnowledgeEntry = knowledgeEntries.find((item) => item.id === activeKnowledgeId) ?? null;
  const selectedMistakeKnowledge = useMemo(
    () => buildLocalAssociationMatches(selectedMistake, null, knowledgeEntries, mistakes).relatedKnowledge,
    [knowledgeEntries, mistakes, selectedMistake],
  );
  const currentReviewKnowledge = useMemo(
    () => buildLocalAssociationMatches(currentReview, null, knowledgeEntries, mistakes).relatedKnowledge,
    [currentReview, knowledgeEntries, mistakes],
  );
  const dueKnowledgeEntries = useMemo(() => buildKnowledgeDueEntries(knowledgeEntries, today), [knowledgeEntries, today]);
  const lowKnowledgeEntries = useMemo(() => buildLowKnowledgeEntries(knowledgeEntries), [knowledgeEntries]);
  const knowledgeCategorySummaries = useMemo(
    () => buildKnowledgeCategorySummaries(knowledgeEntries, dueKnowledgeEntries, lowKnowledgeEntries),
    [dueKnowledgeEntries, knowledgeEntries, lowKnowledgeEntries],
  );
  const knowledgeTrainingQueue = useMemo(
    () => filterKnowledgeTrainingQueue(knowledgeEntries, dueKnowledgeEntries, lowKnowledgeEntries, knowledgeQueueFilter),
    [dueKnowledgeEntries, knowledgeEntries, knowledgeQueueFilter, lowKnowledgeEntries],
  );
  const allKnowledgeTrainingQueue = useMemo(
    () => filterKnowledgeTrainingQueue(knowledgeEntries, dueKnowledgeEntries, lowKnowledgeEntries, "all"),
    [dueKnowledgeEntries, knowledgeEntries, lowKnowledgeEntries],
  );
  const selectedKnowledgeMistakes = useMemo(
    () => buildLocalAssociationMatches(null, selectedKnowledgeEntry, knowledgeEntries, mistakes).relatedMistakes,
    [knowledgeEntries, mistakes, selectedKnowledgeEntry],
  );
  const selectedMistakeAssociationSummary = useMemo(
    () => buildKnowledgeAssociationSummary(associationLinks, associationSuggestions, selectedMistake?.id ?? null, "mistake"),
    [associationLinks, associationSuggestions, selectedMistake],
  );
  const selectedKnowledgeAssociationSummary = useMemo(
    () => buildKnowledgeAssociationSummary(associationLinks, associationSuggestions, selectedKnowledgeEntry?.id ?? null, "knowledge"),
    [associationLinks, associationSuggestions, selectedKnowledgeEntry],
  );
  const currentReviewAssociationSummary = useMemo(
    () => buildKnowledgeAssociationSummary(associationLinks, associationSuggestions, currentReview?.id ?? null, "mistake"),
    [associationLinks, associationSuggestions, currentReview],
  );
  const reviewTimer = useReviewTimer(currentReview?.id ?? null);
  const currentReviewLinkedKnowledge = useMemo(() => {
    const knowledgeById = new Map(knowledgeEntries.map((entry) => [entry.id, entry]));
    return currentReviewAssociationSummary.links
      .map((link) => knowledgeById.get(link.knowledgeId))
      .filter((entry): entry is KnowledgeEntry => Boolean(entry));
  }, [currentReviewAssociationSummary.links, knowledgeEntries]);
  const currentKnowledgeTraining = knowledgeTrainingQueue[knowledgeTrainingIndex] ?? knowledgeTrainingQueue[0] ?? null;
  const knowledgeCorrectRate = useMemo(
    () => calculateCorrectRate(knowledgeAttemptsCount, knowledgeCorrectCount),
    [knowledgeAttemptsCount, knowledgeCorrectCount],
  );
  // 切换主视图，并在进入复盘时重置当前复盘会话状态。
  function switchView(nextView: ViewKey) {
    navigateView(nextView);
    if (nextView === "review") {
      setReviewIndex(0);
      setAnswerOpen(false);
    }
    if (nextView === "knowledgeTraining") {
      setKnowledgeTrainingIndex(0);
      setKnowledgeAnswerOpen(false);
    }
  }

  // 保存外观设置并立即写入 CSS 变量，实现设置页控件的即时反馈。
  function updateAppearanceSettings(nextSettings: AppearanceSettings) {
    setAppearanceSettings(nextSettings);
    applyAppearanceSettings(nextSettings);
    void appearanceSettingsRepository
      .save(nextSettings)
      .then((savedSettings) => {
        setAppearanceSettings(savedSettings);
        applyAppearanceSettings(savedSettings);
        setNotice("外观设置已保存");
      })
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "外观设置保存失败");
      });
  }

  // 从总览或板块卡片进入指定板块的错题列表。
  function openBoard(board: Board) {
    setSelectedBoard((current) => (current === board ? null : board));
    setFilters((current) => ({ ...current, board }));
    setView("library");
  }

  // 从错题详情或复盘页跳转到知识库资料，同时收窄分类并选中对应条目。
  function openKnowledgeEntry(entry: KnowledgeEntry) {
    setKnowledgeFilters({ ...initialKnowledgeFilters, category: entry.category });
    setSelectedKnowledgeId(entry.id);
    setView("knowledge");
  }

  // 跳转到 AI 连接分区并保留调用场景提示，避免被无关的关联分析文案覆盖。
  function openApiSettings(message = "请在 AI 连接中配置所需的默认连接后再继续") {
    setSettingsInitialSection("configuration");
    setView("settings");
    setNotice(message);
  }

  // 从知识库中枢进入指定分类，保留空状态但先把筛选切到目标分类。
  function openKnowledgeCategory(category: KnowledgeCategory) {
    setKnowledgeFilters({ ...initialKnowledgeFilters, category });
    setSelectedKnowledgeId(null);
    setView("knowledge");
  }

  // 从知识条目详情反向跳转到关联错题，自动切换板块和选中目标错题。
  function openRelatedMistake(mistake: Mistake) {
    setSelectedBoard(mistake.board);
    setFilters((current) => ({ ...current, board: mistake.board }));
    setSelectedId(mistake.id);
    setView("library");
  }

  // 从总览、知识库或统计页进入指定知识资料的训练卡片。
  function openKnowledgeTrainingEntry(entryId?: string) {
    const activeIndex = entryId ? knowledgeTrainingQueue.findIndex((entry) => entry.id === entryId) : 0;
    if (!entryId || activeIndex >= 0) {
      setKnowledgeTrainingIndex(Math.max(0, activeIndex));
    } else {
      const allIndex = allKnowledgeTrainingQueue.findIndex((entry) => entry.id === entryId);
      setKnowledgeQueueFilter("all");
      setKnowledgeTrainingIndex(Math.max(0, allIndex));
    }
    setKnowledgeAnswerOpen(false);
    setView("knowledgeTraining");
  }

  // 使用 AI 分析当前错题和本地候选资料之间的关系；结果只进入预览区，不直接写库。
  async function analyzeMistakeAssociations(mistake: Mistake) {
    if (!aiConnections.textConnection) {
      openApiSettings("请先配置默认文本连接，再使用 AI 关联分析");
      return;
    }
    const linkedKnowledgeIds = new Set(associationLinks.filter((link) => link.mistakeId === mistake.id).map((link) => link.knowledgeId));
    const candidates = findRelatedKnowledgeEntries(mistake, knowledgeEntries, 10)
      .map((match) => match.entry)
      .filter((entry) => !linkedKnowledgeIds.has(entry.id));
    if (!candidates.length) {
      setNotice("暂无可供 AI 分析的本地候选资料，请先补充知识库或标签");
      return;
    }

    setAssociationBusy(true);
    try {
      const suggestions = await analyzeMistakeKnowledgeAssociations({ mistake, candidates, connection: aiConnections.textConnection });
      setAssociationSuggestions((current) => [
        ...suggestions,
        ...current.filter((suggestion) => suggestion.mistakeId !== mistake.id),
      ]);
      setNotice(suggestions.length ? `AI 已生成 ${suggestions.length} 条关联建议，请确认后保存` : "AI 没有找到值得确认的关联");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 关联分析失败");
    } finally {
      setAssociationBusy(false);
    }
  }

  // 使用 AI 分析当前知识资料和本地候选错题之间的关系；只接受候选错题 ID，防止模型编造数据。
  async function analyzeKnowledgeAssociations(entry: KnowledgeEntry) {
    if (!aiConnections.textConnection) {
      openApiSettings("请先配置默认文本连接，再使用 AI 关联分析");
      return;
    }
    const linkedMistakeIds = new Set(associationLinks.filter((link) => link.knowledgeId === entry.id).map((link) => link.mistakeId));
    const candidates = findRelatedMistakesForKnowledge(entry, mistakes, 10)
      .map((match) => match.mistake)
      .filter((mistake) => !linkedMistakeIds.has(mistake.id));
    if (!candidates.length) {
      setNotice("暂无可供 AI 分析的本地候选错题，请先补充错题标签或错因");
      return;
    }

    setAssociationBusy(true);
    try {
      const suggestions = await analyzeKnowledgeMistakeAssociations({ entry, candidates, connection: aiConnections.textConnection });
      setAssociationSuggestions((current) => [
        ...suggestions,
        ...current.filter((suggestion) => suggestion.knowledgeId !== entry.id),
      ]);
      setNotice(suggestions.length ? `AI 已生成 ${suggestions.length} 条关联建议，请确认后保存` : "AI 没有找到值得确认的关联");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 关联分析失败");
    } finally {
      setAssociationBusy(false);
    }
  }

  // 切换 AI 建议是否保存，未勾选的建议只保留在预览区。
  function toggleAssociationSuggestion(id: string, selected: boolean) {
    setAssociationSuggestions((current) => current.map((suggestion) => (suggestion.id === id ? { ...suggestion, selected } : suggestion)));
  }

  // 从预览区移除单条 AI 建议，不影响已确认关联和本地推荐。
  function deleteAssociationSuggestion(id: string) {
    setAssociationSuggestions((current) => current.filter((suggestion) => suggestion.id !== id));
  }

  // 清空当前详情面板的 AI 预览建议，保留已经确认保存的关联。
  function clearAssociationSuggestions(targetId: string, mode: "mistake" | "knowledge") {
    setAssociationSuggestions((current) =>
      current.filter((suggestion) => (mode === "mistake" ? suggestion.mistakeId !== targetId : suggestion.knowledgeId !== targetId)),
    );
    setNotice("已清空当前 AI 关联预览");
  }

  // 把当前面板中勾选的 AI 建议保存为确认关联，保存后刷新 IndexedDB 快照。
  async function confirmAssociationSuggestions(suggestions: AssociationSuggestion[]) {
    const selected = suggestions.filter((suggestion) => suggestion.selected);
    if (!selected.length) {
      setNotice("请选择至少一条关联建议");
      return;
    }
    await associationRepository.saveLinks(selected.map(suggestionToLinkInput), today);
    const selectedIds = new Set(selected.map((suggestion) => suggestion.id));
    setAssociationSuggestions((current) => current.filter((suggestion) => !selectedIds.has(suggestion.id)));
    await refreshData();
    setNotice(`已确认 ${selected.length} 条关联`);
  }

  // 删除一条已确认关联；只解除关系，不删除错题或知识资料本身。
  async function removeAssociationLink(id: string) {
    await associationRepository.removeLink(id);
    await refreshData();
    setNotice("关联已取消");
  }

  // 切换知识训练队列类型，重置到第一张卡，避免旧索引落到空队列。
  function changeKnowledgeQueueFilter(filter: KnowledgeQueueFilter) {
    setKnowledgeQueueFilter(filter);
    setKnowledgeTrainingIndex(0);
    setKnowledgeAnswerOpen(false);
  }

  // 在知识训练队列中循环移动，上一条和下一条共用同一套边界逻辑。
  function moveKnowledgeTraining(delta: -1 | 1) {
    setKnowledgeTrainingIndex((current) => {
      if (!knowledgeTrainingQueue.length) return 0;
      return (current + delta + knowledgeTrainingQueue.length) % knowledgeTrainingQueue.length;
    });
    setKnowledgeAnswerOpen(false);
  }

  // 跳过本次知识训练不写记录，只把队列移动到下一条。
  function skipKnowledgeTraining() {
    moveKnowledgeTraining(1);
    setNotice("已跳过当前知识训练卡片");
  }

  // 新建知识库条目，并自动进入知识库视图查看刚写入的资料。
  async function addKnowledgeEntry(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const category = textValue(formData.get("category")) as KnowledgeCategory;
    const title = textValue(formData.get("title"));
    const content = textValue(formData.get("content"));
    const entry = await knowledgeRepository.create(
      {
        category,
        title,
        summary: textValue(formData.get("summary")) || content.slice(0, 120),
        content,
        tags: splitInput(formData.get("tags")),
        source: textValue(formData.get("source")) || "手动整理",
        favorite: false,
      },
      today,
    );
    form.reset();
    setSelectedKnowledgeId(entry.id);
    setKnowledgeFilters((current) => ({ ...current, category }));
    setView("knowledge");
    await refreshData();
    setNotice("知识条目已保存");
  }

  // 保存知识库条目的编辑结果，只更新知识库表，不影响错题库。
  async function updateKnowledgeEntry(id: string, patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">>) {
    await knowledgeRepository.update(id, patch, today);
    await refreshData();
    setNotice("知识条目已更新");
  }

  // 删除知识库条目并清理当前选中状态。
  async function deleteKnowledgeEntry(id: string) {
    const mapping = await obsidianKnowledgeRepository.mappingForKnowledge(id);
    const message = mapping ? "这条资料已映射到 Obsidian。确定同时删除 Vault 托管笔记、本地训练记录和关联吗？" : "确定删除这条知识资料吗？";
    if (!window.confirm(message)) return;
    if (mapping) await obsidianKnowledgeRepository.removeManagedNotes([id]);
    await knowledgeRepository.remove(id);
    setSelectedKnowledgeId(null);
    await refreshData();
    setNotice("知识条目已删除");
  }

  // 切换知识条目的收藏状态，用于后续快速筛选常用资料。
  async function toggleKnowledgeFavorite(entry: KnowledgeEntry) {
    await knowledgeRepository.toggleFavorite(entry, today);
    await refreshData();
    setNotice(entry.favorite ? "已取消收藏" : "已收藏知识条目");
  }

  // 把导入页粘贴的资料拆成可编辑草稿，确认前不写入知识库表。
  async function importKnowledgeText(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const rawText = textValue(formData.get("knowledgeText"));
    if (!rawText) {
      setNotice("请先粘贴知识库资料");
      return;
    }
    const category = textValue(formData.get("knowledgeCategory")) as KnowledgeCategory;
    const parsedDrafts = knowledgeRepository.parseImportDrafts({
      category,
      rawText,
      tags: splitInput(formData.get("knowledgeTags")),
      source: textValue(formData.get("knowledgeSource")) || "文本导入",
    });
    setKnowledgeDrafts(parsedDrafts);
    setNotice(`已生成 ${parsedDrafts.length} 条知识资料草稿，请确认后入库`);
  }

  // 更新知识库导入草稿的普通字段，供预览区编辑分类、标题、摘要和正文。
  function updateKnowledgeDraft(id: string, patch: Partial<KnowledgeImportDraft>) {
    setKnowledgeDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  // 更新知识库导入草稿的标签字段，统一复用逗号和换行拆分规则。
  function updateKnowledgeDraftList(id: string, value: string) {
    setKnowledgeDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, tags: splitInput(value) } : draft)));
  }

  // 删除单条知识库导入草稿，适合导入预览中剔除误切分内容。
  function deleteKnowledgeDraft(id: string) {
    setKnowledgeDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  // 把勾选的知识库导入草稿批量写入 Dexie，并跳转到第一条新资料。
  async function confirmKnowledgeDrafts() {
    const selectedDrafts = knowledgeDrafts.filter((draft) => draft.selected && draft.title.trim() && draft.content.trim());
    if (!selectedDrafts.length) {
      setNotice("请选择至少一条有效知识资料草稿");
      return;
    }
    const entries = await knowledgeRepository.addDrafts(selectedDrafts, today);
    setKnowledgeDrafts((current) => current.filter((draft) => !draft.selected));
    setKnowledgeFilters((current) => ({ ...current, category: entries[0]?.category ?? current.category }));
    setSelectedKnowledgeId(entries[0]?.id ?? null);
    setView("knowledge");
    await refreshData();
    setNotice(`已保存 ${entries.length} 条知识资料`);
  }

  // 生成知识库搭建模板草稿，供空库或新分类快速建立整理框架；草稿确认前不会写入 IndexedDB。
  function createKnowledgeStarterDrafts(category?: KnowledgeCategory) {
    const starterDrafts = knowledgeRepository.createStarterDrafts(category);
    setKnowledgeDrafts((current) => [...starterDrafts, ...current]);
    setKnowledgeFilters({ ...initialKnowledgeFilters, category: category ?? "全部" });
    setView("import");
    setNotice(`已生成 ${starterDrafts.length} 条知识库模板草稿，请编辑确认后入库`);
  }

  // 把当前错题沉淀为知识库草稿，用户确认前只停留在导入页预览区。
  function createKnowledgeDraftFromMistake(mistake: Mistake) {
    const draft = knowledgeRepository.createDraftFromMistake(mistake);
    setKnowledgeDrafts((current) => [draft, ...current]);
    setKnowledgeFilters({ ...initialKnowledgeFilters, category: draft.category });
    setView("import");
    setNotice("已从错题生成知识资料草稿，请编辑确认后入库");
  }

  // 记录一次复盘结果，并刷新列表、计数和队列。
  async function recordReview(result: "correct" | "uncertain" | "wrong") {
    if (!currentReview) return;
    const durationSec = reviewTimer.elapsedSec;
    await reviewRepository.recordReview(currentReview, result, today, durationSec);
    setAnswerOpen(false);
    await refreshData();
    reviewTimer.reset();
    setNotice("复盘记录已保存");
  }

  // 记录知识训练结果，更新资料掌握度、下次训练日期并写入知识训练历史。
  async function recordKnowledgeReview(result: ReviewResult) {
    if (!currentKnowledgeTraining) return;
    await knowledgeRepository.recordReview(currentKnowledgeTraining, result, today);
    setKnowledgeAnswerOpen(false);
    await refreshData();
    setNotice("知识训练记录已保存");
  }

  // 删除单道错题并清理关联复盘记录；删除前二次确认，避免误删本地资料。
  async function deleteMistake(mistake: Mistake) {
    if (!window.confirm("确定删除这道错题及其复盘记录吗？")) return;
    await reviewRepository.removeMistake(mistake.id);
    const nextMistake = mistakes.find((item) => item.id !== mistake.id && item.board === mistake.board) ?? null;
    setSelectedId(nextMistake?.id ?? null);
    if (currentReview?.id === mistake.id) {
      setReviewIndex(0);
      setAnswerOpen(false);
    }
    await refreshData();
    setNotice("错题已删除，关联复盘记录已清理");
  }

  // 批量删除错题；删除范围只来自当前筛选列表的显式选择，不会跨板块误删。
  async function deleteMistakes(ids: string[]) {
    if (!ids.length) {
      setNotice("请先选择要删除的错题");
      return;
    }
    const idSet = new Set(ids);
    await reviewRepository.removeMistakes(ids);
    const nextMistake = mistakes.find((item) => !idSet.has(item.id) && (!selectedBoard || item.board === selectedBoard)) ?? null;
    if (selectedId && idSet.has(selectedId)) {
      setSelectedId(nextMistake?.id ?? null);
    }
    if (currentReview && idSet.has(currentReview.id)) {
      setReviewIndex(0);
      setAnswerOpen(false);
    }
    await refreshData();
    setNotice(`已删除 ${ids.length} 道错题，并清理复盘记录和关联`);
  }

  // 批量删除知识资料；只清理资料、训练记录和关联，不影响错题库本体。
  async function deleteKnowledgeEntries(ids: string[]) {
    if (!ids.length) {
      setNotice("请先选择要删除的知识资料");
      return;
    }
    const mapped = (await Promise.all(ids.map((id) => obsidianKnowledgeRepository.mappingForKnowledge(id)))).filter(Boolean);
    if (mapped.length && !window.confirm(`其中 ${mapped.length} 条已映射到 Obsidian。继续会同时删除对应 Vault 托管笔记，确定继续吗？`)) return;
    if (mapped.length) await obsidianKnowledgeRepository.removeManagedNotes(ids);
    const idSet = new Set(ids);
    await knowledgeRepository.removeMany(ids);
    if (selectedKnowledgeId && idSet.has(selectedKnowledgeId)) {
      setSelectedKnowledgeId(null);
    }
    if (currentKnowledgeTraining && idSet.has(currentKnowledgeTraining.id)) {
      setKnowledgeTrainingIndex(0);
      setKnowledgeAnswerOpen(false);
    }
    await refreshData();
    setNotice(`已删除 ${ids.length} 条知识资料，并清理训练记录和关联`);
  }

  // 导出错题到本地文件；浏览器下载不会写入 IndexedDB，也不会包含 API 或外观设置。
  function exportMistakeItems(items: Mistake[], format: ExportFormat, scope: ExportScope) {
    if (!items.length) {
      setNotice("当前没有可导出的错题");
      return;
    }
    const file = exportMistakes(items, format, scope);
    downloadExportFile(file);
    setNotice(`已导出 ${items.length} 道错题：${file.filename}`);
  }

  // 导出知识库资料到本地文件；JSON 保留完整字段，CSV 和 Markdown 适合阅读整理。
  function exportKnowledgeItems(items: KnowledgeEntry[], format: ExportFormat, scope: ExportScope) {
    if (!items.length) {
      setNotice("当前没有可导出的知识资料");
      return;
    }
    const file = exportKnowledgeEntries(items, format, scope);
    downloadExportFile(file);
    setNotice(`已导出 ${items.length} 条知识资料：${file.filename}`);
  }

  // 处理手动录入表单提交，把错题写入 IndexedDB。
  async function addMistake(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const board = textValue(formData.get("board")) as Board;
    await reviewRepository.addMistake(
      {
        board,
        source: textValue(formData.get("source")) || "手动录入",
        stem: textValue(formData.get("stem")),
        answer: textValue(formData.get("answer")),
        explanation: textValue(formData.get("explanation")) || "待补充解析",
        reasons: splitInput(formData.get("reason")),
        tags: splitInput(formData.get("tags")),
        mastery: Number(formData.get("mastery")),
        nextReviewAt: toISODate(today),
      },
      today,
    );
    form.reset();
    await refreshData();
    setSelectedBoard(board);
    setFilters((current) => ({ ...current, board }));
    setView("library");
    setNotice("错题已保存到 IndexedDB");
  }

  // 清空本地题库和导入记录，保留 API 设置便于继续 OCR。
  async function clearLocalRecords() {
    if (!window.confirm("确定清空本地错题、复盘记录和导入任务吗？API 设置会保留。")) return;
    await reviewRepository.clearAll();
    setKnowledgeDrafts([]);
    await importDraftFlow.refreshImportDrafts();
    await refreshData();
    setNotice("本地错题与导入记录已清空");
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="ui-card px-5 py-4 shadow-sm">{notice}</div>
      </main>
    );
  }

  if (view === "settings") {
    return (
      <SettingsWorkspace
        appearanceSettings={appearanceSettings}
        initialSection={settingsInitialSection}
        sidebarCollapsed={sidebarCollapsed}
        onAppearanceChange={updateAppearanceSettings}
        onBack={() => {
          setSettingsInitialSection("appearance");
          switchView(lastAppView);
        }}
        onClearLocalRecords={clearLocalRecords}
        onConfigurationChanged={() => {
          void aiConnections.refresh();
          void refreshData();
        }}
        onPersonalizationChange={personalization.setSettings}
        onToggleSidebar={toggleSidebar}
      />
    );
  }

  return (
    <WorkspaceShell
      contentClassName="px-7 py-7 max-sm:px-4"
      sidebarCollapsed={sidebarCollapsed}
      sidebarClassName="flex flex-col overflow-hidden px-3 py-4 text-app-sidebar-text max-lg:overflow-visible max-lg:px-3 max-lg:py-2"
      title="错题复盘"
      onToggleSidebar={toggleSidebar}
      sidebar={
        <>
          <SidebarNav
            activeKey={view}
            items={navItems.map((item) => item.key === "automation" ? { ...item, badge: automation.snapshot.unreadCount || undefined } : item)}
            renderIcon={(icon) => <SidebarIcon name={icon as NavIconName} />}
            onSelect={switchView}
          />
          <button
            className="hidden min-h-10 min-w-36 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium hover:bg-chrome-hover max-lg:grid"
            type="button"
            onClick={() => switchView("settings")}
          >
            <SidebarIcon name="settings" />
            <span>设置</span>
          </button>

          <section className="mt-8 min-h-0 flex-1 overflow-y-auto pr-1 max-lg:hidden" aria-label="板块快捷入口">
            <p className="mb-2 px-3 text-xs font-medium text-muted">板块</p>
            <div className="grid gap-1">
              {boardStats.map((stat) => (
                <button
                  key={stat.board}
                  className={`grid min-h-10 grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-3 text-left text-sm ${
                    selectedBoard === stat.board ? "bg-chrome-selected" : "hover:bg-chrome-hover"
                  }`}
                  type="button"
                  onClick={() => openBoard(stat.board)}
                >
                  <span className="truncate">{stat.board}</span>
                  <span className="text-sm text-muted">{stat.total}</span>
                </button>
              ))}
            </div>
          </section>

          <button
            className="relative z-40 mt-3 grid min-h-10 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium hover:bg-chrome-hover max-lg:hidden"
            type="button"
            onClick={() => switchView("settings")}
          >
            <SidebarIcon name="settings" />
            <span>设置</span>
          </button>
        </>
      }
    >
        <ViewHeader
          actions={
            <>
              <Button variant="outline" onClick={() => switchView("import")}>
                导入
              </Button>
              <Button variant="primary" onClick={() => switchView("entry")}>
                手动录入
              </Button>
            </>
          }
          eyebrow={`${toISODate(today)} · ${notice}`}
          title={viewTitles[view]}
        />

        {view === "dashboard" && (
          <DashboardView
            avgMastery={avgMastery}
            boardStats={boardStats}
            correctRate={correctRate}
            dueKnowledgeEntries={dueKnowledgeEntries}
            dueMistakes={dueMistakes}
            knowledgeCategorySummaries={knowledgeCategorySummaries}
            knowledgeCorrectRate={knowledgeCorrectRate}
            lowMistakes={lowMistakes}
            onOpenBoard={openBoard}
            onOpenInterview={() => switchView("interview")}
            onOpenTutoring={() => switchView("tutoring")}
            onOpenKnowledgeCategory={openKnowledgeCategory}
            onOpenKnowledgeTraining={openKnowledgeTrainingEntry}
            onCreateKnowledgeStarterDrafts={createKnowledgeStarterDrafts}
            onOpenReview={(id) => {
              setReviewIndex(Math.max(0, dueMistakes.findIndex((item) => item.id === id)));
              setAnswerOpen(false);
              setView("review");
            }}
          />
        )}
        {view === "library" && (
          <LibraryView
            aiAssociationBusy={associationBusy}
            apiReady={Boolean(aiConnections.textConnection)}
            associationLinks={selectedMistakeAssociationSummary.links}
            associationSuggestions={selectedMistakeAssociationSummary.suggestions}
            boardStats={boardStats}
            filteredMistakes={filteredMistakes}
            filters={filters}
            knowledgeEntries={knowledgeEntries}
            mistakes={mistakes}
            relatedKnowledge={selectedMistakeKnowledge}
            reasonFilter={reasonFilter}
            reasonOptions={reasonOptions}
            selectedBoard={selectedBoard}
            selectedId={activeSelectedId}
            selectedMistake={selectedMistake}
            setFilters={setFilters}
            setReasonFilter={setReasonFilter}
            setSelectedBoard={setSelectedBoard}
            setSelectedId={setSelectedId}
            setTagFilter={setTagFilter}
            tagFilter={tagFilter}
            tagOptions={tagOptions}
            onAnalyzeMistakeAssociations={analyzeMistakeAssociations}
            onBulkDeleteMistakes={deleteMistakes}
            onClearAssociationSuggestions={(targetId) => clearAssociationSuggestions(targetId, "mistake")}
            onConfirmAssociationSuggestions={() => confirmAssociationSuggestions(selectedMistakeAssociationSummary.suggestions)}
            onCreateKnowledgeDraft={createKnowledgeDraftFromMistake}
            onDeleteAssociationSuggestion={deleteAssociationSuggestion}
            onDeleteMistake={deleteMistake}
            onExportMistakes={exportMistakeItems}
            onOpenKnowledgeEntry={openKnowledgeEntry}
            onOpenSettings={() => openApiSettings("请先配置默认文本连接，再使用 AI 关联分析")}
            onRemoveAssociationLink={removeAssociationLink}
            onToggleAssociationSuggestion={toggleAssociationSuggestion}
          />
        )}
        {view === "review" && (
          <ReviewView
            answerOpen={answerOpen}
            associatedKnowledge={currentReviewLinkedKnowledge}
            currentReview={currentReview}
            dueMistakes={dueMistakes}
            relatedKnowledge={currentReviewKnowledge}
            reviewIndex={reviewIndex}
            timer={reviewTimer}
            onCreateKnowledgeDraft={createKnowledgeDraftFromMistake}
            onOpenKnowledgeEntry={openKnowledgeEntry}
            onRecordReview={recordReview}
            onToggleAnswer={() => setAnswerOpen((value) => !value)}
          />
        )}
        {view === "knowledgeTraining" && (
          <KnowledgeTrainingView
            answerOpen={knowledgeAnswerOpen}
            attemptsCount={knowledgeAttemptsCount}
            correctRate={knowledgeCorrectRate}
            currentEntry={currentKnowledgeTraining}
            dueEntries={dueKnowledgeEntries}
            lowEntries={lowKnowledgeEntries}
            queueEntries={knowledgeTrainingQueue}
            queueFilter={knowledgeQueueFilter}
            trainingIndex={knowledgeTrainingIndex}
            onChangeQueueFilter={changeKnowledgeQueueFilter}
            onMove={moveKnowledgeTraining}
            onOpenKnowledgeEntry={openKnowledgeEntry}
            onRecordReview={recordKnowledgeReview}
            onSkip={skipKnowledgeTraining}
            onSelectEntry={openKnowledgeTrainingEntry}
            onToggleAnswer={() => setKnowledgeAnswerOpen((value) => !value)}
          />
        )}
        {view === "automation" && <AutomationView center={automation} onNotice={setNotice} />}
        {view === "stats" && (
          <StatsView
            attempts={attempts}
            attemptsCount={attemptsCount}
            boardStats={boardStats}
            knowledgeAttemptsCount={knowledgeAttemptsCount}
            knowledgeCorrectRate={knowledgeCorrectRate}
            knowledgeEntries={knowledgeEntries}
            lowKnowledgeEntries={lowKnowledgeEntries}
            mistakes={mistakes}
            onOpenKnowledgeEntry={openKnowledgeEntry}
            onOpenKnowledgeTraining={openKnowledgeTrainingEntry}
          />
        )}
        {view === "knowledge" && (
          <KnowledgeView
            aiAssociationBusy={associationBusy}
            apiReady={Boolean(aiConnections.textConnection)}
            associationLinks={selectedKnowledgeAssociationSummary.links}
            associationSuggestions={selectedKnowledgeAssociationSummary.suggestions}
            allKnowledgeEntries={knowledgeEntries}
            allMistakes={mistakes}
            entries={filteredKnowledgeEntries}
            filters={knowledgeFilters}
            internalization={internalization}
            relatedMistakes={selectedKnowledgeMistakes}
            selectedEntry={selectedKnowledgeEntry}
            summaries={knowledgeCategorySummaries}
            tagOptions={knowledgeTagOptions}
            onAddEntry={addKnowledgeEntry}
            onAnalyzeKnowledgeAssociations={analyzeKnowledgeAssociations}
            onChangeFilters={setKnowledgeFilters}
            onClearAssociationSuggestions={(targetId) => clearAssociationSuggestions(targetId, "knowledge")}
            onConfirmAssociationSuggestions={() => confirmAssociationSuggestions(selectedKnowledgeAssociationSummary.suggestions)}
            onBulkDeleteEntries={deleteKnowledgeEntries}
            onDeleteAssociationSuggestion={deleteAssociationSuggestion}
            onDeleteEntry={deleteKnowledgeEntry}
            onExportKnowledgeEntries={exportKnowledgeItems}
            onOpenRelatedMistake={openRelatedMistake}
            onOpenSettings={() => openApiSettings("请先配置默认文本连接，再使用 AI 关联分析")}
            onRemoveAssociationLink={removeAssociationLink}
            onSelectEntry={setSelectedKnowledgeId}
            onStartTraining={openKnowledgeTrainingEntry}
            onCreateStarterDrafts={createKnowledgeStarterDrafts}
            onToggleFavorite={toggleKnowledgeFavorite}
            onToggleAssociationSuggestion={toggleAssociationSuggestion}
            onUpdateEntry={updateKnowledgeEntry}
            onKnowledgeChanged={refreshData}
            onNotice={setNotice}
            personalizationSettings={personalization.settings}
            textConnection={aiConnections.textConnection}
          />
        )}
        {view === "interview" && (
          <InterviewWorkspace
            textConnection={aiConnections.textConnection}
            knowledgeEntries={knowledgeEntries}
            mistakes={mistakes}
            personalizationSettings={personalization.settings}
            speechConnection={aiConnections.speechConnection}
            onNotice={setNotice}
            onOpenSettings={() => openApiSettings("请先配置默认文本连接，再使用 AI 模拟面试")}
          />
        )}
        {view === "tutoring" && (
          <TutoringWorkspace
            textConnection={aiConnections.textConnection}
            visionConnection={aiConnections.visionConnection}
            knowledgeEntries={knowledgeEntries}
            mistakes={mistakes}
            personalizationSettings={personalization.settings}
            speechConnection={aiConnections.speechConnection}
            onNotice={setNotice}
            onOpenSettings={() => openApiSettings("请配置默认文本连接；关键帧分析还需要默认多模态连接")}
          />
        )}
        {view === "import" && (
          <ImportView
            textConnection={aiConnections.textConnection}
            visionConnection={aiConnections.visionConnection}
            batches={importDraftFlow.batches}
            drafts={importDraftFlow.drafts}
            importBusy={importDraftFlow.importBusy}
            importJobs={importJobs}
            knowledgeDrafts={knowledgeDrafts}
            onBulkUpdateDrafts={importDraftFlow.updateDrafts}
            onConfirmDrafts={importDraftFlow.confirmDrafts}
            onConfirmKnowledgeDrafts={confirmKnowledgeDrafts}
            onDeleteDrafts={importDraftFlow.deleteDrafts}
            onDeleteKnowledgeDraft={deleteKnowledgeDraft}
            onImportKnowledgeText={importKnowledgeText}
            onParseFileImport={importDraftFlow.parseFileImport}
            onParseTextImport={importDraftFlow.parseTextImport}
            onSwitchSettings={() => switchView("settings")}
            onUpdateDraft={importDraftFlow.updateDraft}
            onUpdateDraftList={importDraftFlow.updateDraftList}
            onUpdateKnowledgeDraft={updateKnowledgeDraft}
            onUpdateKnowledgeDraftList={updateKnowledgeDraftList}
          />
        )}
        {view === "entry" && <EntryView onSubmit={addMistake} />}
    </WorkspaceShell>
  );
}

// 渲染侧边栏线性图标，避免为少量导航图标额外引入依赖。
function SidebarIcon({ name }: { name: NavIconName }) {
  const common = {
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
    viewBox: "0 0 24 24",
  };

  if (name === "dashboard") {
    return (
      <svg aria-hidden="true" {...common}>
        <rect height="7" rx="1.8" width="7" x="3" y="3" />
        <rect height="7" rx="1.8" width="7" x="14" y="3" />
        <rect height="7" rx="1.8" width="7" x="3" y="14" />
        <rect height="7" rx="1.8" width="7" x="14" y="14" />
      </svg>
    );
  }

  if (name === "library") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 5.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3Z" />
        <path d="M8 4h9a2 2 0 0 1 2 2v12" />
        <path d="M8 9h8" />
        <path d="M8 13h6" />
      </svg>
    );
  }

  if (name === "knowledge") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h10.5v16H7a2.5 2.5 0 0 0-2.5 2.5Z" />
        <path d="M8 7h6.5" />
        <path d="M8 10.5h7.5" />
        <path d="m16.5 5.5 1 1 1.8-2.5" />
      </svg>
    );
  }

  if (name === "knowledgeTraining") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 4.5h10.5a2.5 2.5 0 0 1 2.5 2.5v13H7a2 2 0 0 1-2-2Z" />
        <path d="M8 8h5.5" />
        <path d="M8 11.5h4" />
        <path d="m14.5 14.5 1.6 1.6 3-3.3" />
      </svg>
    );
  }

  if (name === "automation") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M6 5.5h12v13H6z" />
        <path d="M9 3v4M15 3v4M8.5 10h7" />
        <path d="M9 14h2l1.2-2 1.4 4 1-2H17" />
      </svg>
    );
  }

  if (name === "review") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 12a7 7 0 1 0 2-4.9" />
        <path d="M5 4.5V8h3.5" />
        <path d="M12 8v4l2.5 2" />
      </svg>
    );
  }

  if (name === "interview") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M7 10.5a5 5 0 0 1 10 0v1.8" />
        <path d="M6 12h2v4H6a2 2 0 0 1-2-2 2 2 0 0 1 2-2Z" />
        <path d="M18 12h-2v4h2a2 2 0 0 0 2-2 2 2 0 0 0-2-2Z" />
        <path d="M9 19h6" />
        <path d="M12 16v3" />
      </svg>
    );
  }

  if (name === "tutoring") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M4.5 7.5h15v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z" />
        <path d="M8 7.5V5.8A2.8 2.8 0 0 1 10.8 3h2.4A2.8 2.8 0 0 1 16 5.8v1.7" />
        <path d="M8 12h3" />
        <path d="M8 15h5.5" />
        <path d="m15.5 12.2 1.1 1.1 2-2.3" />
      </svg>
    );
  }

  if (name === "stats") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M4 19V5" />
        <path d="M4 19h17" />
        <path d="m7 15 3.5-4 3 2.5L19 7" />
      </svg>
    );
  }

  if (name === "import") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M12 3v11" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
      </svg>
    );
  }

  if (name === "entry") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 19h4l10-10a2.2 2.2 0 0 0-3.1-3.1L5.9 15.9Z" />
        <path d="m14.5 6.5 3 3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" {...common}>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M12 3v3m0 12v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M3 12h3m12 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}
