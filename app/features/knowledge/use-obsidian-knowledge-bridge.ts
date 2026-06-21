"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { requestKnowledgeEvolutionProposals } from "../../services/knowledge-evolution-service";
import { buildObsidianUri } from "../../services/obsidian-markdown";
import { obsidianKnowledgeRepository } from "../../services/obsidian-knowledge-repository";
import type { ApiConnectionProfile, KnowledgeEntry, KnowledgeEvolutionProposal, ObsidianNoteMapping, ObsidianVaultSnapshot, PersonalizationSettings } from "../../types/review";

const EMPTY_SNAPSHOT: ObsidianVaultSnapshot = {
  id: "default", vaultName: "", managedRoot: "AI知识库", connected: false, permission: "denied",
  mappedCount: 0, conflictCount: 0, pendingProposalCount: 0, createdAt: "", updatedAt: "",
};

/** 编排 Obsidian 的可序列化 UI 状态；目录句柄和文件 I/O 始终留在仓储层。 */
export function useObsidianKnowledgeBridge({
  entries,
  personalization,
  textConnection,
  onChanged,
  onNotice,
}: {
  entries: KnowledgeEntry[];
  personalization: PersonalizationSettings;
  textConnection?: ApiConnectionProfile;
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<ObsidianVaultSnapshot>(EMPTY_SNAPSHOT);
  const [mappings, setMappings] = useState<ObsidianNoteMapping[]>([]);
  const [proposals, setProposals] = useState<KnowledgeEvolutionProposal[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextSnapshot, nextMappings, nextProposals] = await Promise.all([
      obsidianKnowledgeRepository.loadSnapshot(),
      obsidianKnowledgeRepository.listMappings(),
      obsidianKnowledgeRepository.listProposals(),
    ]);
    setSnapshot(nextSnapshot);
    setMappings(nextMappings);
    setProposals(nextProposals);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((error) => onNotice(error instanceof Error ? error.message : "Obsidian 状态读取失败"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onNotice, refresh]);

  const run = useCallback(async (task: () => Promise<string | void>, fallback: string) => {
    setBusy(true);
    try {
      const message = await task();
      await Promise.all([refresh(), onChanged()]);
      if (message) onNotice(message);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : fallback);
    } finally {
      setBusy(false);
    }
  }, [onChanged, onNotice, refresh]);

  const connect = useCallback((managedRoot: string) => run(async () => {
    await obsidianKnowledgeRepository.connect(managedRoot.trim() || "AI知识库");
    return "Obsidian Vault 已连接，托管目录已准备完成";
  }, "Obsidian Vault 连接失败"), [run]);

  const requestPermission = useCallback(() => run(async () => {
    await obsidianKnowledgeRepository.requestPermission();
    return "Obsidian Vault 权限已恢复";
  }, "Obsidian Vault 授权失败"), [run]);

  const sync = useCallback(() => run(async () => {
    const report = await obsidianKnowledgeRepository.sync();
    return `同步完成：导入 ${report.imported}、写回 ${report.exported}、冲突 ${report.conflicts}、断开 ${report.disconnected}`;
  }, "Obsidian 同步失败"), [run]);

  const importFiles = useCallback((files: File[]) => run(async () => {
    const count = await obsidianKnowledgeRepository.importMarkdownFiles(files);
    return `已一次性导入 ${count} 个 Markdown 文件`;
  }, "Markdown 文件夹导入失败"), [run]);

  const generateProposals = useCallback(() => run(async () => {
    if (!textConnection) throw new Error("请先配置默认文本连接，再生成知识演进提案");
    const sources = await obsidianKnowledgeRepository.loadEvolutionSources();
    const generated = await requestKnowledgeEvolutionProposals({ connection: textConnection, personalization, sources, entries });
    await obsidianKnowledgeRepository.saveProposals(generated);
    return `已生成 ${generated.length} 条知识演进提案，确认前不会写入 Vault`;
  }, "知识演进提案生成失败"), [entries, personalization, run, textConnection]);

  const acceptProposal = useCallback((id: string) => run(async () => {
    await obsidianKnowledgeRepository.acceptProposal(id);
    return "演进提案已确认并写入 Obsidian";
  }, "演进提案写入失败"), [run]);

  const rejectProposal = useCallback((id: string) => run(async () => {
    await obsidianKnowledgeRepository.rejectProposal(id);
    return "演进提案已忽略";
  }, "演进提案处理失败"), [run]);

  const resolveConflict = useCallback((path: string, choice: "vault" | "app") => run(async () => {
    await obsidianKnowledgeRepository.resolveConflict(path, choice);
    return choice === "vault" ? "已采用 Obsidian 版本" : "已采用应用版本并写回 Obsidian";
  }, "同步冲突处理失败"), [run]);

  const recreate = useCallback((path: string) => run(async () => {
    await obsidianKnowledgeRepository.recreateDisconnected(path);
    return "已在 Obsidian 中重新创建笔记";
  }, "笔记重新创建失败"), [run]);

  const detach = useCallback((path: string) => run(async () => {
    await obsidianKnowledgeRepository.detach(path);
    return "已解除 Obsidian 映射，本地知识资料仍然保留";
  }, "解除映射失败"), [run]);

  const pendingProposals = useMemo(() => proposals.filter((item) => item.status === "pending"), [proposals]);
  const issues = useMemo(() => mappings.filter((item) => item.status === "conflict" || item.status === "disconnected"), [mappings]);
  const uriForKnowledge = useCallback((knowledgeId: string) => {
    const mapping = mappings.find((item) => item.knowledgeId === knowledgeId);
    return mapping && snapshot.vaultName ? buildObsidianUri(snapshot.vaultName, snapshot.managedRoot, mapping.path) : undefined;
  }, [mappings, snapshot.managedRoot, snapshot.vaultName]);

  return useMemo(() => ({
    acceptProposal, busy, connect, detach, generateProposals, importFiles, issues, mappings, pendingProposals,
    recreate, refresh, rejectProposal, requestPermission, resolveConflict, snapshot, sync, uriForKnowledge,
  }), [acceptProposal, busy, connect, detach, generateProposals, importFiles, issues, mappings, pendingProposals, recreate, refresh, rejectProposal, requestPermission, resolveConflict, snapshot, sync, uriForKnowledge]);
}
