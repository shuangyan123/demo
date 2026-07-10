"use client";

import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  KnowledgeTrainingView,
  KnowledgeView,
  buildKnowledgeCategorySummaries,
  filterKnowledgeTrainingQueue,
} from "../knowledge/knowledge-workspace";
import { DashboardView } from "./review-dashboard-view";
import { EntryView } from "./review-entry-view";
import { LibraryView } from "./review-library-view";
import { ReviewView } from "./review-session-view";
import { StatsView } from "./review-stats-view";
import { useAiConnections } from "../settings/use-ai-connections";
import { usePersonalizationSettings } from "../settings/use-personalization-settings";
import { useKnowledgeInternalization } from "../knowledge/use-knowledge-internalization";
import { useAutomationCenter } from "../automation/use-automation-center";
import { ConfigurationHealthPanel } from "../onboarding/configuration-health-panel";
import { useWorkspaceNavigation } from "../shared/use-workspace-navigation";
import { useWorkspaceSidebar } from "../shared/use-workspace-sidebar";
import { useReviewWorkspaceHealth } from "./use-review-workspace-health";
import { useReviewWorkspaceRecoveryNavigation } from "./use-review-workspace-recovery-navigation";
import { ReviewWorkspaceShell } from "./review-workspace-shell";
import { useReviewNotice } from "./use-review-notice";
import { useReviewTimer } from "./use-review-timer";
import { useReviewWorkspaceData } from "./use-review-workspace-data";
import { CommandSearchPalette } from "../conversation/command-search-palette";
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
import { associationRepository, suggestionToLinkInput } from "../../services/association-repository";
import { buildCommandSearchResults } from "../../services/command-search";
import { conversationRepository, type ConversationSnapshot } from "../../services/conversation-repository";
import { downloadExportFile, exportKnowledgeEntries, exportMistakes } from "../../services/export-service";
import { knowledgeRepository } from "../../services/knowledge-repository";
import { reviewRepository } from "../../services/review-repository";
import {
  makeToday,
  toISODate,
} from "../../lib/review-utils";
import {
  type AssociationSuggestion,
  type AiConversation,
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

// 低频工作区用动态加载保持首屏包体收敛；loading 只占位，不触发业务读取。
function WorkspaceViewLoading() {
  return <div className="ui-card px-5 py-4 text-sm font-bold text-muted">正在加载模块...</div>;
}

const SettingsWorkspace = dynamic(() => import("../settings/settings-workspace").then((module) => module.SettingsWorkspace), { loading: WorkspaceViewLoading });
const AutomationView = dynamic(() => import("../automation/automation-view").then((module) => module.AutomationView), { loading: WorkspaceViewLoading });
const InterviewWorkspace = dynamic(() => import("../interview/interview-workspace").then((module) => module.InterviewWorkspace), { loading: WorkspaceViewLoading });
const TutoringWorkspace = dynamic(() => import("../tutoring/tutoring-workspace").then((module) => module.TutoringWorkspace), { loading: WorkspaceViewLoading });
const ImportWorkspace = dynamic(() => import("../import/import-workspace").then((module) => module.ImportWorkspace), { loading: WorkspaceViewLoading });
const ConversationWorkspace = dynamic(() => import("../conversation/conversation-workspace").then((module) => module.ConversationWorkspace), { loading: WorkspaceViewLoading });

// Obsidian 仓库只在删除映射资料时加载，避免总览首屏携带 Vault 同步实现。
async function loadObsidianKnowledgeRepository() {
  const { obsidianKnowledgeRepository } = await import("../../services/obsidian-knowledge-repository");
  return obsidianKnowledgeRepository;
}

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
  const { markReadFailed, markSynced, notice, setNotice } = useReviewNotice();
  const dataNotice = useMemo(() => ({ onReadFailed: markReadFailed, onSynced: markSynced }), [markReadFailed, markSynced]);
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
    readError: dataReadError,
    refreshData,
  } = useReviewWorkspaceData(today, dataNotice);
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
  const [conversationSnapshot, setConversationSnapshot] = useState<ConversationSnapshot>({ projects: [], folders: [], conversations: [], attachments: [], messages: [], runSteps: [] });
  const [activeConversationId, setActiveConversationId] = useState<string | null | undefined>();
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [commandSearchQuery, setCommandSearchQuery] = useState("");

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

  const refreshConversationSnapshot = useCallback(async () => {
    const snapshot = await conversationRepository.loadSnapshot(today);
    setConversationSnapshot(snapshot);
    setActiveConversationId((current) => current === null ? null : current ?? snapshot.conversations.find((conversation) => conversation.status === "active")?.id);
  }, [today]);

  useEffect(() => {
    let active = true;
    conversationRepository
      .loadSnapshot(today)
      .then((snapshot) => {
        if (!active) return;
        setConversationSnapshot(snapshot);
        setActiveConversationId((current) => current === null ? null : current ?? snapshot.conversations.find((conversation) => conversation.status === "active")?.id);
      })
      .catch((error) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : "对话读取失败");
      });
    return () => {
      active = false;
    };
  }, [setNotice, today]);

  function openBlankConversation() {
    setActiveConversationId(null);
    switchView("conversation");
  }

  async function createConversationForFirstMessage(input?: { selectedConnectionId?: string }): Promise<AiConversation> {
    const conversation = await conversationRepository.createConversation({ today, kind: "general", selectedConnectionId: input?.selectedConnectionId ?? aiConnections.textConnection?.id });
    await refreshConversationSnapshot();
    setActiveConversationId(conversation.id);
    return conversation;
  }

  function openConversation(id: string) {
    setActiveConversationId(id);
    switchView("conversation");
  }

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
  const {
    openApiSettings,
    openConfigurationHealthAction,
    openDiagnosticsTarget,
    openMcpSettings,
    resetSettingsSection,
    settingsInitialSection,
  } = useReviewWorkspaceRecoveryNavigation({ setNotice, switchView });
  const { configurationHealth, diagnosticsInput, obsidianSnapshot, refreshWorkspaceAndObsidianHealth } = useReviewWorkspaceHealth({
    aiReadError: aiConnections.readError,
    aiSnapshot: aiConnections.snapshot,
    automationSnapshot: automation.snapshot,
    dataReadError,
    dueKnowledgeCount: dueKnowledgeEntries.length,
    dueMistakeCount: dueMistakes.length,
    importJobs,
    knowledgeEntries,
    mistakes,
    refreshData,
  });
  const commandSearchResults = useMemo(
    () => buildCommandSearchResults({
      projects: conversationSnapshot.projects,
      conversations: conversationSnapshot.conversations,
      mistakes,
      knowledgeEntries,
      automationSnapshot: automation.snapshot,
    }, commandSearchQuery),
    [automation.snapshot, commandSearchQuery, conversationSnapshot.conversations, conversationSnapshot.projects, knowledgeEntries, mistakes],
  );

  async function selectCommandSearchResult(result: (typeof commandSearchResults)[number]) {
    setCommandSearchOpen(false);
    if (result.conversationId) {
      openConversation(result.conversationId);
      return;
    }
    if (result.settingsSection === "configuration") {
      openApiSettings("已打开 AI 连接设置");
      return;
    }
    if (result.settingsSection === "mcp") {
      openMcpSettings("已打开 MCP 设置");
      return;
    }
    if (result.view) switchView(result.view);
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandSearchOpen(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openBlankConversation();
      }
      if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key) && commandSearchOpen) {
        const result = commandSearchResults[Number(event.key) - 1];
        if (result) {
          event.preventDefault();
          void selectCommandSearchResult(result);
        }
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });
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
      const { analyzeMistakeKnowledgeAssociations } = await import("../../services/ai-association-service");
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
      const { analyzeKnowledgeMistakeAssociations } = await import("../../services/ai-association-service");
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
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
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
  async function importKnowledgeText(event: SubmitReactEvent, noticeSink: (message: string) => void = setNotice) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const rawText = textValue(formData.get("knowledgeText"));
    if (!rawText) {
      noticeSink("请先粘贴知识库资料");
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
    noticeSink(`已生成 ${parsedDrafts.length} 条知识资料草稿，请确认后入库`);
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
    switchView("import");
    setNotice(`已生成 ${starterDrafts.length} 条知识库模板草稿，请在导入资料中编辑确认后入库`);
  }

  // 把当前错题沉淀为知识库草稿，用户确认前只停留在导入页预览区。
  function createKnowledgeDraftFromMistake(mistake: Mistake) {
    const draft = knowledgeRepository.createDraftFromMistake(mistake);
    setKnowledgeDrafts((current) => [draft, ...current]);
    setKnowledgeFilters({ ...initialKnowledgeFilters, category: draft.category });
    switchView("import");
    setNotice("已从错题生成知识资料草稿，请在导入资料中编辑确认后入库");
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
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
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
        diagnosticsInput={diagnosticsInput}
        initialSection={settingsInitialSection}
        sidebarCollapsed={sidebarCollapsed}
        onAppearanceChange={updateAppearanceSettings}
        onBack={() => {
          resetSettingsSection();
          switchView(lastAppView);
        }}
        onClearLocalRecords={clearLocalRecords}
        onConfigurationChanged={() => {
          void aiConnections.refresh();
          void refreshData();
        }}
        onOpenDiagnosticsTarget={openDiagnosticsTarget}
        onPersonalizationChange={personalization.setSettings}
        onToggleSidebar={toggleSidebar}
      />
    );
  }

  return (
    <ReviewWorkspaceShell
      automationUnreadCount={automation.snapshot.unreadCount}
      boardStats={boardStats}
      activeConversationId={activeConversationId}
      conversations={conversationSnapshot.conversations.filter((conversation) => conversation.status === "active")}
      folders={conversationSnapshot.folders}
      notice={notice}
      selectedBoard={selectedBoard}
      sidebarCollapsed={sidebarCollapsed}
      today={today}
      view={view}
      onOpenBoard={openBoard}
      onOpenConversation={openConversation}
      onOpenEntry={() => switchView("entry")}
      onOpenImport={() => switchView("import")}
      onOpenSearch={() => setCommandSearchOpen(true)}
      onOpenSettings={() => switchView("settings")}
      onNotice={setNotice}
      onRefreshConversations={refreshConversationSnapshot}
      onSelectView={switchView}
      onToggleSidebar={toggleSidebar}
    >
        {view === "conversation" && (
          <ConversationWorkspace
            activeConversationId={activeConversationId}
            connections={aiConnections.snapshot.profiles}
            knowledgeEntries={knowledgeEntries}
            scheduledCount={automation.snapshot.definitions.filter((definition) => definition.enabled).length}
            snapshot={conversationSnapshot}
            textConnection={aiConnections.textConnection}
            transcriptionConnection={aiConnections.snapshot.profiles.find((connection) => connection.id === aiConnections.snapshot.defaults.transcriptionConnectionId)}
            onConversationSelected={setActiveConversationId}
            onCreateConversation={createConversationForFirstMessage}
            onNotice={setNotice}
            onOpenConnections={() => openApiSettings("请先配置默认文本连接，再继续使用对话")}
            onOpenKnowledge={() => switchView("knowledge")}
            onRefresh={refreshConversationSnapshot}
          />
        )}
        {view === "dashboard" && (
          <DashboardView
            avgMastery={avgMastery}
            automationActiveCount={automation.snapshot.definitions.filter((definition) => definition.enabled).length}
            automationUnreadCount={automation.snapshot.unreadCount}
            boardStats={boardStats}
            configurationHealth={<ConfigurationHealthPanel health={configurationHealth} onAction={openConfigurationHealthAction} />}
            correctRate={correctRate}
            dueKnowledgeEntries={dueKnowledgeEntries}
            dueMistakes={dueMistakes}
            importDraftCount={knowledgeDrafts.length}
            importJobCount={importJobs.length}
            knowledgeCategorySummaries={knowledgeCategorySummaries}
            knowledgeCorrectRate={knowledgeCorrectRate}
            lowMistakes={lowMistakes}
            obsidianConnected={obsidianSnapshot.connected}
            pendingProposalCount={obsidianSnapshot.pendingProposalCount}
            onOpenAutomation={() => switchView("automation")}
            onOpenBoard={openBoard}
            onOpenImport={() => switchView("import")}
            onOpenKnowledge={() => switchView("knowledge")}
            onOpenInterview={() => switchView("interview")}
            onOpenTutoring={() => switchView("tutoring")}
            onOpenKnowledgeCategory={openKnowledgeCategory}
            onOpenKnowledgeTraining={openKnowledgeTrainingEntry}
            onCreateKnowledgeStarterDrafts={createKnowledgeStarterDrafts}
            onOpenReviewQueue={() => {
              setAnswerOpen(false);
              setView("review");
            }}
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
        {view === "automation" && (
          <AutomationView
            center={automation}
            onNotice={setNotice}
            onOpenEntry={() => switchView("entry")}
            onOpenImport={() => switchView("import")}
            onOpenKnowledge={() => switchView("knowledge")}
            onOpenSettings={() => openApiSettings("请先配置默认文本连接，再运行自动化")}
          />
        )}
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
            onKnowledgeChanged={refreshWorkspaceAndObsidianHealth}
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
          <ImportWorkspace
            textConnection={aiConnections.textConnection}
            visionConnection={aiConnections.visionConnection}
            importJobs={importJobs}
            knowledgeDrafts={knowledgeDrafts}
            mistakes={mistakes}
            today={today}
            onConfirmKnowledgeDrafts={confirmKnowledgeDrafts}
            onDeleteKnowledgeDraft={deleteKnowledgeDraft}
            onImportKnowledgeText={importKnowledgeText}
            onRefreshWorkspace={refreshData}
            onSwitchSettings={() => switchView("settings")}
            onUpdateKnowledgeDraft={updateKnowledgeDraft}
            onUpdateKnowledgeDraftList={updateKnowledgeDraftList}
            setNotice={setNotice}
          />
        )}
        {view === "entry" && <EntryView onSubmit={addMistake} />}
        <CommandSearchPalette
          open={commandSearchOpen}
          results={commandSearchResults}
          onClose={() => setCommandSearchOpen(false)}
          onQueryChange={setCommandSearchQuery}
          onSelect={(result) => void selectCommandSearchResult(result)}
        />
    </ReviewWorkspaceShell>
  );
}
