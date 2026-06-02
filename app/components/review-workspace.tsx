"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SettingsWorkspace } from "./settings-workspace";
import { providerPresets } from "../services/api-client";
import { saveApiSetting as saveEncryptedApiSetting, updateApiSettingTestStatus } from "../services/api-settings-repository";
import { appearanceSettingsRepository, applyAppearanceSettings, createDefaultAppearanceSettings } from "../services/appearance-settings-repository";
import { parseImportFile, parseTextWithAi, testAiConnection } from "../services/ocr-import-service";
import { reviewRepository } from "../services/review-repository";
import {
  countBy,
  draftToMistakeInput,
  formatShortDate,
  isDue,
  makeToday,
  masteryLabel,
  toISODate,
} from "../lib/review-utils";
import {
  BOARD_OPTIONS,
  type ApiProvider,
  type ApiSetting,
  type ApiSettingsForm,
  type AppearanceSettings,
  type Board,
  type Filters,
  type ImportDraft,
  type ImportJob,
  type Mistake,
  type ViewKey,
} from "../types/review";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;
type NavIconName = "dashboard" | "library" | "review" | "stats" | "import" | "entry" | "settings";

const navItems: Array<{ key: ViewKey; label: string; icon: NavIconName }> = [
  { key: "dashboard", label: "总览", icon: "dashboard" },
  { key: "library", label: "错题库", icon: "library" },
  { key: "review", label: "开始复盘", icon: "review" },
  { key: "stats", label: "薄弱分析", icon: "stats" },
  { key: "import", label: "导入", icon: "import" },
  { key: "entry", label: "手动录入", icon: "entry" },
  { key: "settings", label: "设置", icon: "settings" },
];

const viewTitles: Record<ViewKey, string> = {
  dashboard: "总览",
  library: "错题库",
  review: "开始复盘",
  stats: "薄弱分析",
  import: "导入",
  entry: "手动录入",
  settings: "设置",
};

const colors = ["#2f6fed", "#1a9b71", "#d79018", "#d45145", "#7a5bd4", "#1c8c9a"];

const initialFilters: Filters = {
  board: "全部",
  mastery: "all",
  search: "",
};

type BoardStat = {
  board: Board;
  total: number;
  due: number;
  weak: number;
};

// 把用户输入的逗号、顿号或换行分隔内容整理成字符串数组。
function splitInput(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 从 FormData 中安全读取并裁剪文本值。
function textValue(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

// 生成首次打开 API 设置页时使用的默认厂商配置。
function defaultApiForm(): ApiSettingsForm {
  const preset = providerPresets[0];
  return {
    provider: preset.provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: "",
  };
}

// 把已保存的加密 API 设置映射回表单可编辑字段。
function apiFormFromSetting(setting?: ApiSetting): ApiSettingsForm {
  if (!setting) return defaultApiForm();
  return {
    provider: setting.provider,
    baseUrl: setting.baseUrl,
    model: setting.model,
    apiKey: "",
  };
}

// 把草稿中的错因或标签数组显示为可编辑文本。
function toListText(items: string[]): string {
  return items.join("，");
}

// 错题复盘应用的主工作台，集中管理视图切换、Dexie 数据和导入状态。
export function ReviewWorkspace() {
  const [today] = useState(() => makeToday());
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [attemptsCount, setAttemptsCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [apiSetting, setApiSetting] = useState<ApiSetting | undefined>();
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(() => createDefaultAppearanceSettings());
  const [view, setView] = useState<ViewKey>("dashboard");
  const [lastAppView, setLastAppView] = useState<ViewKey>("dashboard");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [reasonFilter, setReasonFilter] = useState("全部");
  const [tagFilter, setTagFilter] = useState("全部");
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("正在读取本地题库");
  const [importBusy, setImportBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsForm, setSettingsForm] = useState<ApiSettingsForm>(() => defaultApiForm());

  // 从 repository 读取最新快照，并同步页面上所有派生计数的基础数据。
  const refreshData = useCallback(async () => {
    const snapshot = await reviewRepository.loadSnapshot(today);
    setMistakes(snapshot.mistakes);
    setImportJobs(snapshot.importJobs);
    setApiSetting(snapshot.apiSetting);
    setSettingsForm(apiFormFromSetting(snapshot.apiSetting));
    setAttemptsCount(snapshot.attempts.length);
    setCorrectCount(snapshot.attempts.filter((item) => item.result === "correct").length);
    setNotice("本地题库已同步");
    setLoading(false);
  }, [today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshData().catch((error) => {
      setNotice(error instanceof Error ? error.message : "读取失败");
      setLoading(false);
    });
  }, [refreshData]);

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
  }, []);

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

  const dueMistakes = useMemo(
    () => mistakes.filter((item) => isDue(item, today)).sort((a, b) => a.mastery - b.mastery || a.nextReviewAt.localeCompare(b.nextReviewAt)),
    [mistakes, today],
  );

  const lowMistakes = useMemo(() => mistakes.filter((item) => item.mastery <= 2), [mistakes]);

  const boardStats = useMemo<BoardStat[]>(
    () =>
      BOARD_OPTIONS.map((board) => {
        const boardMistakes = mistakes.filter((item) => item.board === board);
        return {
          board,
          total: boardMistakes.length,
          due: boardMistakes.filter((item) => isDue(item, today)).length,
          weak: boardMistakes.filter((item) => item.mastery <= 2).length,
        };
      }),
    [mistakes, today],
  );

  const reasonOptions = useMemo(() => ["全部", ...countBy(mistakes.flatMap((item) => item.reasons), (reason) => reason).map(([reason]) => reason)], [mistakes]);
  const tagOptions = useMemo(() => ["全部", ...countBy(mistakes.flatMap((item) => item.tags), (tag) => tag).map(([tag]) => tag)], [mistakes]);
  const avgMastery = mistakes.length ? (mistakes.reduce((sum, item) => sum + item.mastery, 0) / mistakes.length).toFixed(1) : "0.0";
  const correctRate = attemptsCount ? Math.round((correctCount / attemptsCount) * 100) : 0;

  const filteredMistakes = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    const activeBoard = selectedBoard ?? (filters.board === "全部" ? null : filters.board);
    return mistakes.filter((item) => {
      const matchesBoard = !activeBoard || item.board === activeBoard;
      const matchesMastery =
        filters.mastery === "all" ||
        (filters.mastery === "low" && item.mastery <= 2) ||
        (filters.mastery === "mid" && item.mastery === 3) ||
        (filters.mastery === "high" && item.mastery >= 4);
      const matchesReason = reasonFilter === "全部" || item.reasons.includes(reasonFilter);
      const matchesTag = tagFilter === "全部" || item.tags.includes(tagFilter);
      const haystack = [item.stem, item.answer, item.explanation, item.source, item.board, ...item.tags, ...item.reasons].join(" ").toLowerCase();
      return matchesBoard && matchesMastery && matchesReason && matchesTag && (!term || haystack.includes(term));
    });
  }, [filters, mistakes, reasonFilter, selectedBoard, tagFilter]);

  const activeSelectedId = selectedId && filteredMistakes.some((item) => item.id === selectedId) ? selectedId : filteredMistakes[0]?.id ?? null;
  const selectedMistake = mistakes.find((item) => item.id === activeSelectedId) ?? null;
  const currentReview = dueMistakes[reviewIndex] ?? null;

  // 切换主视图，并在进入复盘时重置当前复盘会话状态。
  function switchView(nextView: ViewKey) {
    if (nextView !== "settings") {
      setLastAppView(nextView);
    }
    setView(nextView);
    if (nextView === "review") {
      setReviewIndex(0);
      setAnswerOpen(false);
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

  // 记录一次复盘结果，并刷新列表、计数和队列。
  async function recordReview(result: "correct" | "uncertain" | "wrong") {
    if (!currentReview) return;
    await reviewRepository.recordReview(currentReview, result, today);
    setAnswerOpen(false);
    await refreshData();
    setNotice("复盘记录已保存");
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

  // 处理粘贴文本导入，根据按钮选择本地解析或 AI 结构化解析。
  async function parseTextImport(event: SubmitReactEvent, mode: "local" | "ai") {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const rawText = textValue(formData.get("rawText"));
    if (!rawText) return;

    setImportBusy(true);
    try {
      const parsedDrafts = mode === "ai" ? await parseTextWithAi(rawText, requireApiSetting(apiSetting)) : await parseImportFile(new File([rawText], "paste.txt", { type: "text/plain" }), apiSetting);
      setDrafts(parsedDrafts);
      await reviewRepository.createImportJob(
        {
          type: "text",
          rawText,
          status: "parsed",
          parsedCount: parsedDrafts.length,
          message: mode === "ai" ? "AI 已生成可编辑草稿" : "文本已生成可编辑草稿",
        },
        today,
      );
      await refreshData();
      setNotice(`已生成 ${parsedDrafts.length} 条导入草稿`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      await reviewRepository.createImportJob(
        {
          type: "text",
          rawText,
          status: "failed",
          parsedCount: 0,
          message,
          error: message,
        },
        today,
      );
      await refreshData();
      setNotice(message);
    } finally {
      setImportBusy(false);
    }
  }

  // 处理文件导入，图片走多模态 OCR，文本类文件优先本地解析。
  async function parseFileImport(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return;

    setImportBusy(true);
    try {
      const parsedDrafts = await parseImportFile(file, apiSetting);
      const rawText = file.type.startsWith("text/") || file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".json") ? await file.text() : "";
      setDrafts(parsedDrafts);
      await reviewRepository.createImportJob(
        {
          type: file.type.startsWith("image/") ? "ocr" : "file",
          fileName: file.name,
          fileType: file.type || "unknown",
          rawText,
          status: "parsed",
          parsedCount: parsedDrafts.length,
          message: `${file.name} 已生成可编辑草稿`,
        },
        today,
      );
      form.reset();
      await refreshData();
      setNotice(`已从文件生成 ${parsedDrafts.length} 条草稿`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "文件导入失败";
      await reviewRepository.createImportJob(
        {
          type: file.type.startsWith("image/") ? "ocr" : "file",
          fileName: file.name,
          fileType: file.type || "unknown",
          rawText: "",
          status: "failed",
          parsedCount: 0,
          message,
          error: message,
        },
        today,
      );
      await refreshData();
      setNotice(message);
    } finally {
      setImportBusy(false);
    }
  }

  // 更新某条导入草稿的局部字段。
  function updateDraft(id: string, patch: Partial<ImportDraft>) {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  // 把草稿中的错因或标签文本重新拆分为数组。
  function updateDraftList(id: string, key: "reasons" | "tags", value: string) {
    updateDraft(id, { [key]: splitInput(value) });
  }

  // 将选中的导入草稿批量确认入库。
  async function confirmDrafts() {
    const selectedDrafts = drafts.filter((draft) => draft.selected && draft.stem.trim());
    if (!selectedDrafts.length) {
      setNotice("请选择至少一条有效草稿");
      return;
    }
    await reviewRepository.addMistakes(selectedDrafts.map(draftToMistakeInput), today);
    await reviewRepository.createImportJob(
      {
        type: "text",
        rawText: "",
        status: "saved",
        parsedCount: selectedDrafts.length,
        message: `${selectedDrafts.length} 条草稿已确认入库`,
      },
      today,
    );
    setDrafts((current) => current.filter((draft) => !draft.selected));
    await refreshData();
    setNotice(`${selectedDrafts.length} 条错题已入库`);
  }

  // 保存 API 设置；只有填写新 Key 时才重新加密写入。
  async function saveApiSettings(event: SubmitReactEvent) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const provider = textValue(formData.get("provider")) as ApiProvider;
    const baseUrl = textValue(formData.get("baseUrl"));
    const model = textValue(formData.get("model"));
    const apiKey = textValue(formData.get("apiKey"));
    if (!baseUrl || !model) {
      setNotice("请填写 Base URL 和模型名称");
      return;
    }
    if (!apiKey && !apiSetting) {
      setNotice("首次保存需要填写 API Key");
      return;
    }

    setSettingsBusy(true);
    try {
      if (apiKey) {
        await saveEncryptedApiSetting({ provider, baseUrl, model, apiKey, today });
      } else if (apiSetting) {
        await reviewRepository.saveApiSetting({
          ...apiSetting,
          provider,
          baseUrl: baseUrl.replace(/\/$/, ""),
          model,
          testStatus: "idle",
          testMessage: undefined,
          updatedAt: toISODate(today),
        });
      }
      await refreshData();
      setNotice("API 设置已保存，Key 仅以加密形式写入 IndexedDB");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "API 设置保存失败");
    } finally {
      setSettingsBusy(false);
    }
  }

  // 使用当前保存的 API 设置发起一次连接测试。
  async function testCurrentApiSetting() {
    if (!apiSetting) {
      setNotice("请先保存 API 设置");
      return;
    }
    setSettingsBusy(true);
    try {
      const message = await testAiConnection(apiSetting);
      await updateApiSettingTestStatus("success", `连接成功：${message.slice(0, 80)}`);
      await refreshData();
      setNotice("API 连接测试成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接测试失败";
      await updateApiSettingTestStatus("failed", message);
      await refreshData();
      setNotice(message);
    } finally {
      setSettingsBusy(false);
    }
  }

  // 清空本地题库和导入记录，保留 API 设置便于继续 OCR。
  async function clearLocalRecords() {
    if (!window.confirm("确定清空本地错题、复盘记录和导入任务吗？API 设置会保留。")) return;
    await reviewRepository.clearAll();
    setDrafts([]);
    await refreshData();
    setNotice("本地错题与导入记录已清空");
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="rounded-lg border border-line bg-white px-5 py-4 shadow-sm">{notice}</div>
      </main>
    );
  }

  if (view === "settings") {
    return (
      <SettingsWorkspace
        apiSetting={apiSetting}
        appearanceSettings={appearanceSettings}
        form={settingsForm}
        settingsBusy={settingsBusy}
        onAppearanceChange={updateAppearanceSettings}
        onBack={() => switchView(lastAppView)}
        onChangeForm={setSettingsForm}
        onClearLocalRecords={clearLocalRecords}
        onSaveApi={saveApiSettings}
        onTestApi={testCurrentApiSetting}
      />
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-[292px_minmax(0,1fr)] bg-background max-lg:grid-cols-1">
      <aside className="sticky top-0 z-30 flex h-screen flex-col overflow-hidden bg-[var(--app-sidebar-bg)] px-3 py-3 text-[var(--app-sidebar-text)] max-lg:static max-lg:h-auto max-lg:overflow-visible max-lg:px-3 max-lg:py-2">
        <nav className="scrollbar-none grid gap-1.5 max-lg:flex max-lg:overflow-x-auto max-lg:pb-1" aria-label="主导航">
          {navItems
            .filter((item) => item.key !== "settings")
            .map((item) => (
              <button
                key={item.key}
                className={`grid min-h-12 grid-cols-[28px_1fr] items-center gap-3 rounded-xl px-3 text-left text-[17px] font-medium transition max-lg:min-w-36 ${
                  view === item.key ? "bg-[var(--settings-selected-bg)]" : "hover:bg-[var(--app-sidebar-hover)]"
                }`}
                type="button"
                onClick={() => switchView(item.key)}
              >
                <SidebarIcon name={item.icon} />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          <button
            className="hidden min-h-12 min-w-36 grid-cols-[28px_1fr] items-center gap-3 rounded-xl px-3 text-left text-[17px] font-medium transition hover:bg-[var(--app-sidebar-hover)] max-lg:grid"
            type="button"
            onClick={() => switchView("settings")}
          >
            <SidebarIcon name="settings" />
            <span>设置</span>
          </button>
        </nav>

        <section className="mt-7 min-h-0 flex-1 overflow-y-auto pr-1 max-lg:hidden" aria-label="板块快捷入口">
          <p className="mb-2 px-3 text-sm font-semibold text-muted">板块</p>
          <div className="grid gap-1">
            {boardStats.map((stat) => (
              <button
                key={stat.board}
                className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                  selectedBoard === stat.board ? "bg-[var(--settings-selected-bg)]" : "hover:bg-[var(--app-sidebar-hover)]"
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
          className="relative z-40 mt-3 grid min-h-12 grid-cols-[28px_1fr] items-center gap-3 rounded-xl px-3 text-left text-[17px] font-medium transition hover:bg-[var(--app-sidebar-hover)] max-lg:hidden"
          type="button"
          onClick={() => switchView("settings")}
        >
          <SidebarIcon name="settings" />
          <span>设置</span>
        </button>
      </aside>

      <main className="min-w-0 px-7 py-7 max-sm:px-4">
        <header className="mb-5 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
          <div>
            <p className="text-xs font-extrabold uppercase text-[#344b75]">
              {toISODate(today)} · {notice}
            </p>
            <h2 className="mt-1 text-3xl font-extrabold text-foreground">{viewTitles[view]}</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-extrabold" type="button" onClick={() => switchView("import")}>
              导入
            </button>
            <button className="rounded-lg bg-blue px-4 py-2 text-sm font-extrabold text-white" type="button" onClick={() => switchView("entry")}>
              手动录入
            </button>
          </div>
        </header>

        {view === "dashboard" && (
          <DashboardView
            avgMastery={avgMastery}
            boardStats={boardStats}
            correctRate={correctRate}
            dueMistakes={dueMistakes}
            lowMistakes={lowMistakes}
            onOpenBoard={openBoard}
            onOpenReview={(id) => {
              setReviewIndex(Math.max(0, dueMistakes.findIndex((item) => item.id === id)));
              setAnswerOpen(false);
              setView("review");
            }}
          />
        )}
        {view === "library" && (
          <LibraryView
            boardStats={boardStats}
            filteredMistakes={filteredMistakes}
            filters={filters}
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
          />
        )}
        {view === "review" && (
          <ReviewView
            answerOpen={answerOpen}
            currentReview={currentReview}
            dueMistakes={dueMistakes}
            reviewIndex={reviewIndex}
            onRecordReview={recordReview}
            onToggleAnswer={() => setAnswerOpen((value) => !value)}
          />
        )}
        {view === "stats" && <StatsView attemptsCount={attemptsCount} boardStats={boardStats} mistakes={mistakes} />}
        {view === "import" && (
          <ImportView
            apiSetting={apiSetting}
            drafts={drafts}
            importBusy={importBusy}
            importJobs={importJobs}
            onConfirmDrafts={confirmDrafts}
            onDeleteDraft={(id) => setDrafts((current) => current.filter((draft) => draft.id !== id))}
            onParseFileImport={parseFileImport}
            onParseTextImport={parseTextImport}
            onSwitchSettings={() => switchView("settings")}
            onUpdateDraft={updateDraft}
            onUpdateDraftList={updateDraftList}
          />
        )}
        {view === "entry" && <EntryView onSubmit={addMistake} />}
      </main>
    </div>
  );
}

// 在需要 AI 能力前校验 API 设置，避免无配置时发起无效请求。
function requireApiSetting(setting?: ApiSetting): ApiSetting {
  if (!setting) throw new Error("请先在 API 设置中保存可用配置，再使用 AI 解析。");
  return setting;
}

// 渲染总览顶部的单个指标卡片。
function MetricCard({ label, value, hint, tone }: { label: string; value: string | number; hint: string; tone: string }) {
  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <span className="text-sm text-muted">{label}</span>
      <strong className="mt-2 block text-3xl leading-none">{value}</strong>
      <small className={`mt-3 flex items-center gap-2 ${tone}`}>
        <span className="h-2 w-2 rounded-full bg-current" />
        {hint}
      </small>
    </article>
  );
}

// 渲染标签、错因和状态使用的小型胶囊。
function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "yellow" | "red" }) {
  const className = {
    neutral: "bg-slate-100 text-slate-600",
    blue: "bg-blue/10 text-blue",
    green: "bg-emerald-50 text-green",
    yellow: "bg-amber-50 text-yellow",
    red: "bg-red/10 text-red",
  }[tone];

  return <span className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-xs ${className}`}>{children}</span>;
}

// 用五段短条展示错题掌握度。
function MasteryDots({ value }: { value: number }) {
  return (
    <span className="flex gap-1" aria-label={`掌握度 ${value}/5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <i key={index} className={`h-2 w-3 rounded-sm ${index < value ? "bg-green" : "bg-slate-300"}`} />
      ))}
    </span>
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

  if (name === "review") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 12a7 7 0 1 0 2-4.9" />
        <path d="M5 4.5V8h3.5" />
        <path d="M12 8v4l2.5 2" />
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

// 渲染总览页，包括指标、六大板块概览和今日复盘队列。
function DashboardView({
  avgMastery,
  boardStats,
  correctRate,
  dueMistakes,
  lowMistakes,
  onOpenBoard,
  onOpenReview,
}: {
  avgMastery: string;
  boardStats: BoardStat[];
  correctRate: number;
  dueMistakes: Mistake[];
  lowMistakes: Mistake[];
  onOpenBoard: (board: Board) => void;
  onOpenReview: (id: string) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <MetricCard label="今日待复盘" value={dueMistakes.length} hint="按到期和薄弱度排序" tone="text-blue" />
        <MetricCard label="薄弱错题" value={lowMistakes.length} hint="掌握度 1-2 的题" tone="text-red" />
        <MetricCard label="平均掌握度" value={avgMastery} hint="满分 5 分" tone="text-green" />
        <MetricCard label="复盘正确率" value={`${correctRate}%`} hint="基于历史复盘记录" tone="text-yellow" />
      </div>

      <Panel title="六大板块概览" eyebrow="Board Overview">
        <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
          {boardStats.map((item, index) => (
            <button
              key={item.board}
              className="grid min-h-28 rounded-lg border border-slate-100 bg-slate-50 p-4 text-left transition hover:border-blue/40 hover:bg-blue/5"
              type="button"
              onClick={() => onOpenBoard(item.board)}
            >
              <span className="flex items-center justify-between gap-3">
                <strong className="text-lg">{item.board}</strong>
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />
              </span>
              <span className="mt-4 grid grid-cols-3 gap-2 text-sm text-muted">
                <span>
                  <b className="block text-xl text-foreground">{item.total}</b>总数
                </span>
                <span>
                  <b className="block text-xl text-blue">{item.due}</b>待复盘
                </span>
                <span>
                  <b className="block text-xl text-red">{item.weak}</b>薄弱
                </span>
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4 max-xl:grid-cols-1">
        <Panel title="今日队列" eyebrow="Review Queue">
          <div className="grid gap-3">
            {dueMistakes.length ? (
              dueMistakes.slice(0, 5).map((item) => (
                <article key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="min-w-0">
                    <strong className="block truncate">{item.stem}</strong>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip tone="blue">{item.board}</Chip>
                      <Chip>{item.reasons[0] ?? "待归因"}</Chip>
                      <Chip tone="yellow">掌握度 {item.mastery}</Chip>
                    </div>
                  </div>
                  <button className="rounded-lg border border-blue/20 bg-blue/10 px-3 py-2 text-sm font-extrabold text-blue" type="button" onClick={() => onOpenReview(item.id)}>
                    复盘
                  </button>
                </article>
              ))
            ) : (
              <EmptyState>今天没有到期错题</EmptyState>
            )}
          </div>
        </Panel>

        <Panel title="薄弱板块" eyebrow="Weak Spots">
          <div className="grid gap-3">
            {boardStats.some((item) => item.weak > 0) ? (
              boardStats
                .filter((item) => item.weak > 0)
                .sort((a, b) => b.weak - a.weak)
                .map((item, index) => {
                  const maxWeak = Math.max(1, ...boardStats.map((stat) => stat.weak));
                  return (
                    <div key={item.board} className="grid grid-cols-[130px_minmax(0,1fr)_42px] items-center gap-3 text-sm">
                      <strong className="truncate">{item.board}</strong>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full" style={{ width: `${(item.weak / maxWeak) * 100}%`, background: colors[index % colors.length] }} />
                      </div>
                      <span>{item.weak}</span>
                    </div>
                  );
                })
            ) : (
              <EmptyState>暂无薄弱板块</EmptyState>
            )}
          </div>
        </Panel>
      </div>
    </section>
  );
}

// 渲染错题库页的六大板块列表和展开后的错题表格。
function LibraryView({
  boardStats,
  filteredMistakes,
  filters,
  reasonFilter,
  reasonOptions,
  selectedBoard,
  selectedId,
  selectedMistake,
  setFilters,
  setReasonFilter,
  setSelectedBoard,
  setSelectedId,
  setTagFilter,
  tagFilter,
  tagOptions,
}: {
  boardStats: BoardStat[];
  filteredMistakes: Mistake[];
  filters: Filters;
  reasonFilter: string;
  reasonOptions: string[];
  selectedBoard: Board | null;
  selectedId: string | null;
  selectedMistake: Mistake | null;
  setFilters: (updater: (current: Filters) => Filters) => void;
  setReasonFilter: (value: string) => void;
  setSelectedBoard: (value: Board | null) => void;
  setSelectedId: (value: string | null) => void;
  setTagFilter: (value: string) => void;
  tagFilter: string;
  tagOptions: string[];
}) {
  return (
    <section className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex min-h-[78px] items-center justify-between bg-gradient-to-r from-[#3cb5ff] via-[#2f80ff] to-[#ffffff] px-7 text-white max-sm:px-4">
          <strong className="text-2xl">专项练习</strong>
          <button className="rounded-lg bg-white/80 px-3 py-2 text-sm font-extrabold text-[#7180a4]" type="button">
            自定义刷题
          </button>
        </div>
        <div className="px-7 py-4 max-sm:px-4">
          {boardStats.map((item) => {
            const expanded = selectedBoard === item.board;
            return (
              <div key={item.board} className="border-b border-slate-100 last:border-b-0">
                <button
                  className="grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-5 py-5 text-left"
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    setSelectedBoard(expanded ? null : item.board);
                    setFilters((current) => ({ ...current, board: item.board }));
                  }}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-blue/10 text-blue">{expanded ? "v" : ">"}</span>
                  <strong className="text-2xl font-medium text-[#1d3854] max-sm:text-xl">{item.board}</strong>
                  <span className="text-sm text-muted">
                    {item.total} 题 · {item.due} 待复盘 · {item.weak} 薄弱
                  </span>
                </button>
                {expanded && (
                  <div className="pb-5">
                    <LibraryBoardList
                      filteredMistakes={filteredMistakes}
                      filters={filters}
                      reasonFilter={reasonFilter}
                      reasonOptions={reasonOptions}
                      selectedId={selectedId}
                      selectedMistake={selectedMistake}
                      setFilters={setFilters}
                      setReasonFilter={setReasonFilter}
                      setSelectedId={setSelectedId}
                      setTagFilter={setTagFilter}
                      tagFilter={tagFilter}
                      tagOptions={tagOptions}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </section>
  );
}

// 渲染某个板块展开后的筛选区、错题列表和详情栏。
function LibraryBoardList({
  filteredMistakes,
  filters,
  reasonFilter,
  reasonOptions,
  selectedId,
  selectedMistake,
  setFilters,
  setReasonFilter,
  setSelectedId,
  setTagFilter,
  tagFilter,
  tagOptions,
}: {
  filteredMistakes: Mistake[];
  filters: Filters;
  reasonFilter: string;
  reasonOptions: string[];
  selectedId: string | null;
  selectedMistake: Mistake | null;
  setFilters: (updater: (current: Filters) => Filters) => void;
  setReasonFilter: (value: string) => void;
  setSelectedId: (value: string | null) => void;
  setTagFilter: (value: string) => void;
  tagFilter: string;
  tagOptions: string[];
}) {
  return (
    <div className="space-y-4 rounded-lg bg-slate-50 p-4">
      <div className="grid grid-cols-[150px_150px_150px_minmax(220px,1fr)] gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <SelectField
          label="掌握度"
          value={filters.mastery}
          onChange={(value) => setFilters((prev) => ({ ...prev, mastery: value as Filters["mastery"] }))}
          options={[
            ["all", "全部"],
            ["low", "薄弱"],
            ["mid", "巩固中"],
            ["high", "较稳"],
          ]}
        />
        <SelectField label="错因" value={reasonFilter} onChange={setReasonFilter} options={reasonOptions} />
        <SelectField label="标签" value={tagFilter} onChange={setTagFilter} options={tagOptions} />
        <label className="grid gap-2 text-sm font-bold text-slate-700">
          搜索
          <input
            className="rounded-lg border border-line bg-white px-3 py-2.5"
            placeholder="题干、答案、解析、来源"
            type="search"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-xl:grid-cols-1">
        <section className="overflow-hidden rounded-lg border border-line bg-white">
          <div className="grid min-h-12 grid-cols-[minmax(260px,1fr)_150px_120px_96px] items-center gap-3 bg-slate-50 px-4 text-xs font-extrabold text-muted max-lg:hidden">
            <span>题目</span>
            <span>错因</span>
            <span>下次复盘</span>
            <span>掌握</span>
          </div>
          {filteredMistakes.length ? (
            filteredMistakes.map((item) => (
              <button
                key={item.id}
                className={`grid w-full grid-cols-[minmax(260px,1fr)_150px_120px_96px] items-center gap-3 border-t border-slate-100 px-4 py-3 text-left hover:bg-blue/5 max-lg:grid-cols-1 ${
                  item.id === selectedId ? "bg-blue/5" : "bg-white"
                }`}
                type="button"
                onClick={() => setSelectedId(item.id)}
              >
                <span className="min-w-0">
                  <strong className="block truncate">{item.stem}</strong>
                  <span className="mt-1 block text-xs text-muted">{item.source}</span>
                </span>
                <span>{item.reasons.slice(0, 2).join(" / ")}</span>
                <span>{formatShortDate(item.nextReviewAt)}</span>
                <MasteryDots value={item.mastery} />
              </button>
            ))
          ) : (
            <div className="m-4">
              <EmptyState>没有匹配的错题</EmptyState>
            </div>
          )}
        </section>

        <MistakeDetail selectedMistake={selectedMistake} />
      </div>
    </div>
  );
}

// 渲染右侧错题详情，展示答案、解析、错因和复盘计划。
function MistakeDetail({ selectedMistake }: { selectedMistake: Mistake | null }) {
  return (
    <aside className="min-h-[460px] rounded-lg border border-line bg-white p-4 max-xl:min-h-0">
      {selectedMistake ? (
        <>
          <p className="text-xs font-extrabold uppercase text-muted">
            {selectedMistake.board} · {selectedMistake.source}
          </p>
          <h3 className="mt-2 text-lg font-extrabold leading-relaxed">{selectedMistake.stem}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedMistake.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>
          <DetailBlock title="答案">{selectedMistake.answer}</DetailBlock>
          <DetailBlock title="解析">{selectedMistake.explanation}</DetailBlock>
          <DetailBlock title="错因">
            <div className="flex flex-wrap gap-2">
              {selectedMistake.reasons.map((reason) => (
                <Chip key={reason} tone="yellow">
                  {reason}
                </Chip>
              ))}
            </div>
          </DetailBlock>
          <DetailBlock title="计划">
            下次复盘 {selectedMistake.nextReviewAt} · {masteryLabel(selectedMistake.mastery)}
          </DetailBlock>
        </>
      ) : (
        <EmptyState>选择一道错题查看详情</EmptyState>
      )}
    </aside>
  );
}

// 渲染复盘页，并提供会做、犹豫、不会三个复盘动作。
function ReviewView({
  answerOpen,
  currentReview,
  dueMistakes,
  reviewIndex,
  onRecordReview,
  onToggleAnswer,
}: {
  answerOpen: boolean;
  currentReview: Mistake | null;
  dueMistakes: Mistake[];
  reviewIndex: number;
  onRecordReview: (result: "correct" | "uncertain" | "wrong") => void;
  onToggleAnswer: () => void;
}) {
  if (!currentReview) {
    return (
      <Panel title="今日队列已清空" eyebrow="Review Complete">
        <EmptyState>可以去错题库按板块挑选，或录入新的错题。</EmptyState>
      </Panel>
    );
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 max-lg:grid-cols-1">
      <div className="min-h-[570px] rounded-lg border border-line bg-white p-4">
        <p className="text-xs font-extrabold text-muted">
          {currentReview.board} · {currentReview.source}
        </p>
        <h3 className="mt-1 text-xl font-extrabold">
          第 {reviewIndex + 1} 题 / {dueMistakes.length}
        </h3>
        <div className="my-5 rounded-lg border border-slate-100 bg-slate-50 p-5 text-lg leading-loose">{currentReview.stem}</div>
        <div className="flex flex-wrap gap-2">
          {currentReview.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
          <Chip tone="yellow">掌握度 {currentReview.mastery}</Chip>
        </div>
        <div className="mt-5 flex flex-wrap gap-3 border-b border-slate-100 pb-4">
          <button className="rounded-lg border border-line bg-white px-4 py-2 font-extrabold" type="button" onClick={onToggleAnswer}>
            {answerOpen ? "收起答案" : "查看答案"}
          </button>
          <button className="rounded-lg border border-emerald-200 px-4 py-2 font-extrabold text-green" type="button" onClick={() => onRecordReview("correct")}>
            会做
          </button>
          <button className="rounded-lg border border-amber-200 px-4 py-2 font-extrabold text-yellow" type="button" onClick={() => onRecordReview("uncertain")}>
            犹豫
          </button>
          <button className="rounded-lg border border-red/30 px-4 py-2 font-extrabold text-red" type="button" onClick={() => onRecordReview("wrong")}>
            不会
          </button>
        </div>
        {answerOpen && (
          <div className="mt-5 leading-relaxed">
            <strong className="block">答案</strong>
            <p>{currentReview.answer}</p>
            <strong className="mt-3 block">解析</strong>
            <p>{currentReview.explanation}</p>
          </div>
        )}
      </div>

      <Panel title="本轮队列" eyebrow="Session">
        <div className="grid gap-3">
          {dueMistakes.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[34px_1fr] gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-blue/10 text-sm font-extrabold text-blue">{index + 1}</span>
              <p className="min-w-0">
                <strong className="block truncate">{item.board}</strong>
                <span className="text-muted">{item.reasons.join(" / ")}</span>
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

// 渲染薄弱分析页，展示板块分布和优先处理清单。
function StatsView({ attemptsCount, boardStats, mistakes }: { attemptsCount: number; boardStats: BoardStat[]; mistakes: Mistake[] }) {
  const priorities = [...mistakes].sort((a, b) => a.mastery - b.mastery || a.nextReviewAt.localeCompare(b.nextReviewAt)).slice(0, 6);
  const total = Math.max(1, mistakes.length);
  const gradient = boardStats
    .reduce<{ cursor: number; parts: string[] }>(
      (acc, item, index) => {
        const end = acc.cursor + (item.total / total) * 100;
        return {
          cursor: end,
          parts: [...acc.parts, `${colors[index % colors.length]} ${acc.cursor}% ${end}%`],
        };
      },
      { cursor: 0, parts: [] },
    )
    .parts.join(", ");

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)] gap-4 max-xl:grid-cols-1">
        <Panel title="板块分布" eyebrow="Board Load">
          <div className="grid grid-cols-[180px_1fr] items-center gap-5 max-sm:grid-cols-1">
            <div className="relative h-44 w-44 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
              <span className="absolute inset-9 rounded-full border border-slate-100 bg-white" />
            </div>
            <div className="grid gap-3">
              {boardStats.map((item, index) => (
                <div key={item.board} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />
                  <span>{item.board}</span>
                  <strong>{item.total}</strong>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="复盘记录" eyebrow="Attempts">
          <div className="grid h-44 place-items-center rounded-lg border border-dashed border-slate-300 text-center text-muted">
            已记录 {attemptsCount} 次复盘。后续可按日期聚合展示趋势图。
          </div>
        </Panel>
      </div>

      <Panel title="优先处理清单" eyebrow="Action List">
        <div className="grid gap-3">
          {priorities.length ? (
            priorities.map((item) => (
              <article key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-100 p-3">
                <div className="min-w-0">
                  <strong className="block truncate">
                    {item.board} · {item.stem}
                  </strong>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip tone="yellow">{item.reasons[0] ?? "待归因"}</Chip>
                    <Chip tone="green">{formatShortDate(item.nextReviewAt)} 复盘</Chip>
                  </div>
                </div>
                <MasteryDots value={item.mastery} />
              </article>
            ))
          ) : (
            <EmptyState>暂无错题</EmptyState>
          )}
        </div>
      </Panel>
    </section>
  );
}

// 渲染导入页，负责文本解析、文件上传入口和导入任务展示。
function ImportView({
  apiSetting,
  drafts,
  importBusy,
  importJobs,
  onConfirmDrafts,
  onDeleteDraft,
  onParseFileImport,
  onParseTextImport,
  onSwitchSettings,
  onUpdateDraft,
  onUpdateDraftList,
}: {
  apiSetting?: ApiSetting;
  drafts: ImportDraft[];
  importBusy: boolean;
  importJobs: ImportJob[];
  onConfirmDrafts: () => void;
  onDeleteDraft: (id: string) => void;
  onParseFileImport: (event: SubmitReactEvent) => void;
  onParseTextImport: (event: SubmitReactEvent, mode: "local" | "ai") => void;
  onSwitchSettings: () => void;
  onUpdateDraft: (id: string, patch: Partial<ImportDraft>) => void;
  onUpdateDraftList: (id: string, key: "reasons" | "tags", value: string) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-xl:grid-cols-1">
        <form
          className="rounded-lg border border-line bg-white p-4"
          onSubmit={(event) => {
            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            onParseTextImport(event, submitter?.dataset.mode === "ai" ? "ai" : "local");
          }}
        >
          <p className="text-xs font-extrabold uppercase text-muted">Import</p>
          <h3 className="mt-1 text-lg font-extrabold">文本导入</h3>
          <label className="mt-4 grid gap-2 text-sm font-bold text-slate-700">
            原始文本
            <textarea className="min-h-56 resize-y rounded-lg border border-line bg-white px-3 py-2.5" name="rawText" placeholder="粘贴题干、答案、解析；支持用空行分隔多题" />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="rounded-lg bg-blue px-4 py-2 font-extrabold text-white disabled:opacity-60" type="submit" data-mode="local" disabled={importBusy}>
              本地解析
            </button>
            <button className="rounded-lg border border-blue/20 bg-blue/10 px-4 py-2 font-extrabold text-blue disabled:opacity-60" type="submit" data-mode="ai" disabled={importBusy}>
              AI 解析
            </button>
          </div>
        </form>

        <Panel title="API 与文件" eyebrow="OCR">
          <div className="grid gap-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <span className="text-xs text-muted">当前 API</span>
              <strong className="mt-1 block">{apiSetting ? `${apiSetting.model} · ${apiSetting.maskedKey}` : "未配置"}</strong>
              <button className="mt-3 rounded-lg border border-line bg-white px-3 py-2 text-sm font-extrabold" type="button" onClick={onSwitchSettings}>
                设置 API
              </button>
            </div>
            <form className="grid gap-3" onSubmit={onParseFileImport}>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                文件导入
                <input className="rounded-lg border border-line bg-white px-3 py-2.5" name="file" type="file" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json" />
              </label>
              <button className="rounded-lg bg-blue px-4 py-2 font-extrabold text-white disabled:opacity-60" type="submit" disabled={importBusy}>
                上传并解析
              </button>
              <p className="text-xs leading-5 text-muted">图片会调用多模态 OCR；txt、csv、json 本地解析；PDF 和 Word 会尝试提取文本。</p>
            </form>
          </div>
        </Panel>
      </div>

      <ImportDrafts
        drafts={drafts}
        onConfirmDrafts={onConfirmDrafts}
        onDeleteDraft={onDeleteDraft}
        onUpdateDraft={onUpdateDraft}
        onUpdateDraftList={onUpdateDraftList}
      />

      <Panel title="导入任务" eyebrow="Jobs">
        <div className="grid gap-3">
          {importJobs.length ? (
            importJobs.map((job) => (
              <article key={job.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-3">
                  <strong>{job.fileName ?? job.type.toUpperCase()}</strong>
                  <Chip tone={job.status === "failed" ? "red" : job.status === "saved" ? "green" : "blue"}>{job.status}</Chip>
                </div>
                <p className="mt-2 text-sm text-muted">{job.message}</p>
                <small className="mt-2 block text-muted">
                  {job.createdAt} · {job.parsedCount} 条
                </small>
              </article>
            ))
          ) : (
            <EmptyState>暂无导入任务</EmptyState>
          )}
        </div>
      </Panel>
    </section>
  );
}

// 渲染导入后的可编辑草稿列表，确认后才能批量入库。
function ImportDrafts({
  drafts,
  onConfirmDrafts,
  onDeleteDraft,
  onUpdateDraft,
  onUpdateDraftList,
}: {
  drafts: ImportDraft[];
  onConfirmDrafts: () => void;
  onDeleteDraft: (id: string) => void;
  onUpdateDraft: (id: string, patch: Partial<ImportDraft>) => void;
  onUpdateDraftList: (id: string, key: "reasons" | "tags", value: string) => void;
}) {
  return (
    <Panel title="可编辑草稿" eyebrow="Drafts">
      <div className="mb-4 flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <p className="text-sm text-muted">AI 无法判断板块时会默认归入常识判断，并标记为需确认。</p>
        <button className="rounded-lg bg-blue px-4 py-2 font-extrabold text-white disabled:opacity-60" type="button" disabled={!drafts.some((draft) => draft.selected)} onClick={onConfirmDrafts}>
          确认入库
        </button>
      </div>
      {drafts.length ? (
        <div className="grid gap-4">
          {drafts.map((draft) => (
            <article key={draft.id} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-bold">
                  <input checked={draft.selected} type="checkbox" onChange={(event) => onUpdateDraft(draft.id, { selected: event.target.checked })} />
                  选中
                </label>
                <div className="flex flex-wrap gap-2">
                  {draft.needsReview && <Chip tone="yellow">需确认</Chip>}
                  {typeof draft.confidence === "number" && <Chip>置信度 {Math.round(draft.confidence * 100)}%</Chip>}
                  <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-extrabold text-red" type="button" onClick={() => onDeleteDraft(draft.id)}>
                    删除
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                <SelectField label="板块" value={draft.board} onChange={(value) => onUpdateDraft(draft.id, { board: value as Board, needsReview: false })} options={[...BOARD_OPTIONS]} />
                <TextField label="来源" value={draft.source} onChange={(value) => onUpdateDraft(draft.id, { source: value })} />
                <TextField label="掌握度" type="number" value={String(draft.mastery)} onChange={(value) => onUpdateDraft(draft.id, { mastery: Number(value) })} />
              </div>
              <TextAreaField className="mt-3" label="题干" value={draft.stem} onChange={(value) => onUpdateDraft(draft.id, { stem: value })} />
              <div className="mt-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                <TextAreaField label="答案" value={draft.answer} onChange={(value) => onUpdateDraft(draft.id, { answer: value })} />
                <TextAreaField label="解析" value={draft.explanation} onChange={(value) => onUpdateDraft(draft.id, { explanation: value })} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                <TextField label="错因" value={toListText(draft.reasons)} onChange={(value) => onUpdateDraftList(draft.id, "reasons", value)} />
                <TextField label="标签" value={toListText(draft.tags)} onChange={(value) => onUpdateDraftList(draft.id, "tags", value)} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState>导入后会先生成可编辑草稿</EmptyState>
      )}
    </Panel>
  );
}

// 渲染手动录入表单，所有新增错题都必须选择固定板块。
function EntryView({ onSubmit }: { onSubmit: (event: SubmitReactEvent) => void }) {
  return (
    <form className="grid max-w-5xl gap-4 rounded-lg border border-line bg-white p-4" onSubmit={onSubmit}>
      <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <SelectField label="板块" name="board" defaultValue="常识判断" options={[...BOARD_OPTIONS]} />
        <TextField label="来源" name="source" placeholder="专项练习 / 模拟卷 / 截图整理" />
        <TextField label="标签" name="tags" placeholder="增长率、比重、易混概念" />
        <SelectField
          label="初始掌握度"
          name="mastery"
          defaultValue="3"
          options={[
            ["1", "1 - 需要重学"],
            ["2", "2 - 有印象"],
            ["3", "3 - 巩固中"],
            ["4", "4 - 较稳定"],
            ["5", "5 - 已掌握"],
          ]}
        />
      </div>
      <TextAreaField label="题干" name="stem" placeholder="粘贴题干或复盘摘要" required />
      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <TextAreaField label="答案" name="answer" placeholder="B / 13.3%" required />
        <TextField label="错因" name="reason" placeholder="审题偏差、公式混淆" required />
      </div>
      <TextAreaField label="解析" name="explanation" placeholder="错在哪里、下次怎么识别、关键公式" />
      <div className="flex justify-end gap-3">
        <button className="rounded-lg border border-line bg-white px-4 py-2 font-extrabold" type="reset">
          清空
        </button>
        <button className="rounded-lg bg-blue px-4 py-2 font-extrabold text-white" type="submit">
          保存错题
        </button>
      </div>
    </form>
  );
}

// 渲染通用内容面板，统一标题和边框样式。
function Panel({ children, eyebrow, title }: { children: ReactNode; eyebrow: string; title: string }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-extrabold uppercase text-muted">{eyebrow}</p>
      <h3 className="mb-4 mt-1 text-lg font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

// 渲染空状态提示。
function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-muted">{children}</div>;
}

// 渲染详情页中的分段内容。
function DetailBlock({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <strong className="mb-2 block">{title}</strong>
      <div className="leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

// 渲染通用单行输入框，兼容受控和非受控用法。
function TextField({
  label,
  name,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-slate-700">
      {label}
      <input
        className="rounded-lg border border-line bg-white px-3 py-2.5"
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  );
}

// 渲染通用多行输入框，兼容导入草稿和表单录入。
function TextAreaField({
  className = "",
  label,
  name,
  onChange,
  placeholder,
  required,
  value,
}: {
  className?: string;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value?: string;
}) {
  return (
    <label className={`grid gap-2 text-sm font-bold text-slate-700 ${className}`}>
      {label}
      <textarea
        className="min-h-32 resize-y rounded-lg border border-line bg-white px-3 py-2.5"
        name={name}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  );
}

// 渲染通用下拉框，统一选项格式和样式。
function SelectField({
  defaultValue,
  label,
  name,
  onChange,
  options,
  value,
}: {
  defaultValue?: string;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  options: Array<string | [string, string]>;
  value?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-slate-700">
      {label}
      <select
        className="rounded-lg border border-line bg-white px-3 py-2.5"
        defaultValue={defaultValue}
        name={name}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {options.map((option) => {
          const [optionValue, labelText] = Array.isArray(option) ? option : [option, option];
          return (
            <option key={optionValue} value={optionValue}>
              {labelText}
            </option>
          );
        })}
      </select>
    </label>
  );
}
