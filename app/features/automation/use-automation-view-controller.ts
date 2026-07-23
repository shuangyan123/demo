"use client";

import { useMemo, useState } from "react";
import type { AutomationDefinition, AutomationRun, AutomationTemplateId } from "../../types/review";
import { deriveAutomationOverview, filterAutomationDefinitions, latestRunsByAutomation, type AutomationStatusFilter } from "./automation-view-model";
import type { AutomationCenter } from "./use-automation-center";

export type AutomationEditorState =
  | { mode: "closed" }
  | { mode: "create"; templateId: AutomationTemplateId; revision: number }
  | { mode: "edit"; definition: AutomationDefinition; revision: number };

/**
 * 已安排页面控制器。
 * 长期视图状态与纯派生数据集中在此处，组合组件只负责布局与接线。
 */
export function useAutomationViewController(center: AutomationCenter) {
  const [activeTab, setActiveTab] = useState<"tasks" | "inbox">("tasks");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AutomationStatusFilter>("all");
  const [inboxFilter, setInboxFilter] = useState<"all" | "unread" | "succeeded" | "failed">("all");
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string>();
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [editor, setEditor] = useState<AutomationEditorState>({ mode: "closed" });

  const latestRuns = useMemo(() => latestRunsByAutomation(center.snapshot.runs), [center.snapshot.runs]);
  const definitions = useMemo(
    () => filterAutomationDefinitions(center.snapshot.definitions, search, statusFilter, latestRuns),
    [center.snapshot.definitions, latestRuns, search, statusFilter],
  );
  const overview = useMemo(() => deriveAutomationOverview(center.snapshot), [center.snapshot]);
  const runs = useMemo(() => center.snapshot.runs.filter((run) => (
    inboxFilter === "all"
      || (inboxFilter === "unread" && run.unread)
      || run.status === inboxFilter
  )), [center.snapshot.runs, inboxFilter]);
  const selectedDefinition = center.snapshot.definitions.find((item) => item.id === selectedDefinitionId);
  const selectedRun: AutomationRun | undefined = selectedDefinition ? latestRuns.get(selectedDefinition.id) : undefined;

  /** 选择任务；移动端同时打开详情抽屉。 */
  function selectDefinition(definition: AutomationDefinition, openMobile = true): void {
    setSelectedDefinitionId(definition.id);
    if (openMobile) setMobileDetailOpen(true);
  }

  /** 打开新建编辑层并确保每次获得全新草稿。 */
  function startCreate(templateId: AutomationTemplateId = "daily_review"): void {
    setEditor((current) => ({
      mode: "create",
      templateId,
      revision: "revision" in current ? current.revision + 1 : 1,
    }));
  }

  /** 打开现有任务编辑层。 */
  function startEdit(definition: AutomationDefinition): void {
    setMobileDetailOpen(false);
    setEditor((current) => ({
      mode: "edit",
      definition,
      revision: "revision" in current ? current.revision + 1 : 1,
    }));
  }

  return {
    activeTab,
    definitions,
    editor,
    inboxFilter,
    latestRuns,
    mobileDetailOpen,
    overview,
    runs,
    search,
    selectedDefinition,
    selectedRun,
    statusFilter,
    closeEditor: () => setEditor({ mode: "closed" } as const),
    closeMobileDetail: () => setMobileDetailOpen(false),
    selectDefinition,
    setActiveTab,
    setInboxFilter,
    setSearch,
    setStatusFilter,
    startCreate,
    startEdit,
  };
}
