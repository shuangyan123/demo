"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { KnowledgeEvolutionGenerationResult, KnowledgeEvolutionProposal, ObsidianGraphSnapshot, ObsidianNoteMapping, ObsidianVaultSnapshot } from "../../types/domains/obsidian.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { emitAiActivity } from "../../services/ai-activity-events";
import { obsidianSyncRuntime } from "../../services/obsidian-sync-runtime.ts";
import { useObsidianSyncRuntimeSnapshot } from "./obsidian-sync-runtime-host.tsx";
import { useUiReviewData } from "../shared/ui-review-data-context.tsx";
import { assertSettingsPluginEnabled, settingsPluginPreferencesRepository } from "../../services/settings-plugin-preferences-repository.ts";

const EMPTY_SNAPSHOT: ObsidianVaultSnapshot = {
  id: "default", vaultName: "", managedRoot: "AI知识库", connected: false, permission: "denied",
  recovery: "none",
  mappedCount: 0, conflictCount: 0, pendingProposalCount: 0, createdAt: "", updatedAt: "",
};

const EMPTY_GRAPH: ObsidianGraphSnapshot = { nodes: [], edges: [], syncedCount: 0, externalCount: 0, issueCount: 0 };

/** 编排 Obsidian 的可序列化 UI 状态；目录句柄和文件 I/O 始终留在仓储层。 */
async function loadObsidianKnowledgeRepository() {
  return (await import("../../services/obsidian-knowledge-repository")).obsidianKnowledgeRepository;
}

function buildKnowledgeObsidianUri(vaultName: string, managedRoot: string, relativePath: string): string {
  const file = [managedRoot, relativePath].filter(Boolean).join("/");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

export function useObsidianKnowledgeBridge({
  entries,
  personalization,
  textConnection,
  onChanged,
  onNotice,
  onOpenPlugins = () => undefined,
  sampleMode = false,
}: {
  entries: KnowledgeEntry[];
  personalization: PersonalizationSettings;
  textConnection?: ApiConnectionProfile;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onOpenPlugins?: () => void;
  sampleMode?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ObsidianVaultSnapshot>(EMPTY_SNAPSHOT);
  const [mappings, setMappings] = useState<ObsidianNoteMapping[]>([]);
  const [graph, setGraph] = useState<ObsidianGraphSnapshot>(EMPTY_GRAPH);
  const [proposals, setProposals] = useState<KnowledgeEvolutionProposal[]>([]);
  const [lastGenerationResult, setLastGenerationResult] = useState<KnowledgeEvolutionGenerationResult>();
  const [busy, setBusy] = useState(false);
  const syncRuntime = useObsidianSyncRuntimeSnapshot();
  const uiReview = useUiReviewData();
  const safeMode = sampleMode || Boolean(uiReview?.active);
  const pluginPreferences = useSyncExternalStore(
    settingsPluginPreferencesRepository.subscribe,
    settingsPluginPreferencesRepository.getSnapshot,
    settingsPluginPreferencesRepository.getServerSnapshot,
  );
  const pluginEnabled = pluginPreferences.enabled["obsidian-vault"];

  const refresh = useCallback(async () => {
    if (safeMode) {
      setSnapshot(EMPTY_SNAPSHOT);
      setMappings([]);
      setGraph(EMPTY_GRAPH);
      setProposals([]);
      return;
    }
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    const [nextSnapshot, nextMappings, nextGraph, nextProposals] = await Promise.all([
      obsidianKnowledgeRepository.loadSnapshot(),
      obsidianKnowledgeRepository.listMappings(),
      obsidianKnowledgeRepository.loadGraphSnapshot(),
      obsidianKnowledgeRepository.listProposals(),
    ]);
    setSnapshot(nextSnapshot);
    setMappings(nextMappings);
    setGraph(nextGraph);
    setProposals(nextProposals);
  }, [safeMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((error) => onNotice(error instanceof Error ? error.message : "Obsidian 状态读取失败"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onNotice, refresh]);

  const run = useCallback(async (task: () => Promise<string | void>, fallback: string) => {
    try {
      assertSettingsPluginEnabled("obsidian-vault");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Obsidian Vault 插件已停用，请在插件页重新启用。");
      onOpenPlugins();
      return;
    }
    if (safeMode) {
      onNotice("示例模式禁止访问真实 Vault 或调用 AI。");
      return;
    }
    setBusy(true);
    try {
      const message = await task();
      await obsidianSyncRuntime.restart();
      const refreshResults = await Promise.allSettled([refresh(), onChanged()]);
      if (refreshResults.some((result) => result.status === "rejected")) {
        onNotice("操作已完成，但界面状态刷新失败；请手动刷新页面确认最新结果");
      } else if (message) {
        // 父级刷新可能写入通用状态；成功文案必须最后发布，避免真实写入结果被覆盖。
        onNotice(message);
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : fallback);
    } finally {
      setBusy(false);
    }
  }, [onChanged, onNotice, onOpenPlugins, refresh, safeMode]);

  const connect = useCallback((managedRoot: string) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    await obsidianKnowledgeRepository.connect(managedRoot.trim() || "AI知识库");
    return "Obsidian Vault 已连接，托管目录已准备完成";
  }, "Obsidian Vault 连接失败"), [run]);

  const requestPermission = useCallback(() => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    await obsidianKnowledgeRepository.requestPermission();
    return "Obsidian Vault 权限已恢复";
  }, "Obsidian Vault 授权失败"), [run]);

  const sync = useCallback(() => run(async () => {
    const report = await obsidianSyncRuntime.syncNow();
    if (!report) return "Obsidian 同步已并入正在执行的任务";
    const warning = report.warnings.length ? `；提示：${report.warnings.join("、")}` : "";
    return `同步完成：导入 ${report.imported}、写回 ${report.exported}、冲突 ${report.conflicts}、断开 ${report.disconnected}${warning}`;
  }, "Obsidian 同步失败"), [run]);

  const importFiles = useCallback((files: File[]) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    const count = await obsidianKnowledgeRepository.importMarkdownFiles(files);
    return `已一次性导入 ${count} 个 Markdown 文件`;
  }, "Markdown 文件夹导入失败"), [run]);

  const generateProposals = useCallback(() => run(async () => {
    if (!textConnection) throw new Error("请先配置默认文本连接，再生成知识演进提案");
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    const { requestKnowledgeEvolutionProposals } = await import("../../services/knowledge-evolution-service");
    const { aiConnectionsRepository } = await import("../../services/ai-connections-repository");
    const activityRunId = crypto.randomUUID();
    const sources = await obsidianKnowledgeRepository.loadEvolutionSources();
    if (!sources.length) {
      const emptyResult: KnowledgeEvolutionGenerationResult = {
        proposals: [], diagnostics: [{ id: "no-sources", tone: "info", message: "没有未消费且包含正文的学习记录。已忽略的提案来源允许再次使用。" }],
        parsedCount: 0, filteredCount: 0, sourceCount: 0, emptyKind: "no_sources", emptyReason: "暂无可用于演进的新来源。",
      };
      setLastGenerationResult(emptyResult);
      return emptyResult.emptyReason!;
    }
    const graphSnapshot = await obsidianKnowledgeRepository.loadGraphSnapshot();
    const modelId = await aiConnectionsRepository.resolveRuntimeModel(textConnection, "text");
    assertSettingsPluginEnabled("obsidian-vault");
    const result = await requestKnowledgeEvolutionProposals({ connection: textConnection, modelId, personalization, sources, entries, graph: graphSnapshot, activityRunId });
    emitAiActivity({ runId: activityRunId, module: "Obsidian 插件", purpose: "知识演进提案", presentation: "background", phase: "waiting", label: `${textConnection.provider} · ${modelId}`, stepId: "save", connectionLabel: textConnection.label, model: modelId, text: `正在保存 ${result.proposals.length} 条 pending 提案` });
    await obsidianKnowledgeRepository.saveProposals(result.proposals);
    setLastGenerationResult(result);
    emitAiActivity({ runId: activityRunId, module: "Obsidian 插件", purpose: "知识演进提案", presentation: "background", phase: "done", label: `${textConnection.provider} · ${modelId}`, stepId: "saved", connectionLabel: textConnection.label, model: modelId, text: result.proposals.length ? `已保存 ${result.proposals.length} 条待确认提案` : result.emptyReason });
    const diagnosticSuffix = result.diagnostics.length ? `；诊断 ${result.diagnostics.length} 条` : "";
    return result.proposals.length
      ? `已生成 ${result.proposals.length} 条知识演进提案，确认前不会写入 Vault${diagnosticSuffix}`
      : `${result.emptyReason ?? "未生成可用提案"}${diagnosticSuffix}`;
  }, "知识演进提案生成失败"), [entries, personalization, run, textConnection]);

  const acceptProposal = useCallback((id: string) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    const { verifyAcquisitionProposalSources } = await import("../../services/acquisition-source-service");
    const result = await obsidianKnowledgeRepository.acceptProposals([id], { verifySource: verifyAcquisitionProposalSources });
    if (!result.acceptedIds.length) throw new Error(result.failures[0]?.message || "演进提案写入失败");
    return "演进提案已确认并写入 Obsidian";
  }, "演进提案写入失败"), [run]);

  const acceptProposals = useCallback((ids: string[]) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    const { verifyAcquisitionProposalSources } = await import("../../services/acquisition-source-service");
    const result = await obsidianKnowledgeRepository.acceptProposals(ids, { verifySource: verifyAcquisitionProposalSources });
    const suffix = result.failures.length ? `；${result.failures.length} 条失败并保持待确认` : "";
    return `已写入 ${result.acceptedIds.length} 条提案${suffix}`;
  }, "批量确认失败"), [run]);

  const updateProposal = useCallback((id: string, patch: Pick<KnowledgeEvolutionProposal, "title" | "summary" | "content" | "tags" | "proposedLinks">) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    await obsidianKnowledgeRepository.updateProposal(id, patch);
    return "提案生成稿已保存，证据与评分保持不变";
  }, "提案修改保存失败"), [run]);

  const rejectProposal = useCallback((id: string) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    await obsidianKnowledgeRepository.rejectProposal(id);
    return "演进提案已忽略";
  }, "演进提案处理失败"), [run]);

  const resolveConflict = useCallback((path: string, choice: "vault" | "app") => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    await obsidianKnowledgeRepository.resolveConflict(path, choice);
    return choice === "vault" ? "已采用 Obsidian 版本" : "已采用应用版本并写回 Obsidian";
  }, "同步冲突处理失败"), [run]);

  const recreate = useCallback((path: string) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    await obsidianKnowledgeRepository.recreateDisconnected(path);
    return "已在 Obsidian 中重新创建笔记";
  }, "笔记重新创建失败"), [run]);

  const detach = useCallback((path: string) => run(async () => {
    const obsidianKnowledgeRepository = await loadObsidianKnowledgeRepository();
    await obsidianKnowledgeRepository.detach(path);
    return "已解除 Obsidian 映射，本地知识资料仍然保留";
  }, "解除映射失败"), [run]);

  const pendingProposals = useMemo(() => proposals.filter((item) => item.status === "pending"), [proposals]);
  const issues = useMemo(() => mappings.filter((item) => item.status === "conflict" || item.status === "disconnected"), [mappings]);
  const uriForKnowledge = useCallback((knowledgeId: string) => {
    const mapping = mappings.find((item) => item.knowledgeId === knowledgeId);
    return mapping && snapshot.vaultName ? buildKnowledgeObsidianUri(snapshot.vaultName, snapshot.managedRoot, mapping.path) : undefined;
  }, [mappings, snapshot.managedRoot, snapshot.vaultName]);

  return useMemo(() => ({
    acceptProposal, acceptProposals, busy, connect, detach, generateProposals, graph, importFiles, issues, lastGenerationResult, mappings, onOpenPlugins, pendingProposals, pluginEnabled,
    recreate, refresh, rejectProposal, requestPermission, resolveConflict, snapshot, sync, syncRuntime, updateProposal, uriForKnowledge,
  }), [acceptProposal, acceptProposals, busy, connect, detach, generateProposals, graph, importFiles, issues, lastGenerationResult, mappings, onOpenPlugins, pendingProposals, pluginEnabled, recreate, refresh, rejectProposal, requestPermission, resolveConflict, snapshot, sync, syncRuntime, updateProposal, uriForKnowledge]);
}
