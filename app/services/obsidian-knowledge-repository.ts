import { reviewDb } from "../db/review-db.ts";
import type {
  KnowledgeEntry,
  KnowledgeEvolutionProposal,
  ObsidianNoteMapping,
  ObsidianSyncReport,
  ObsidianVaultConfig,
  ObsidianVaultSnapshot,
} from "../types/review";
import {
  applyAiEvolutionSection,
  buildObsidianNotePath,
  hashObsidianState,
  parseObsidianMarkdown,
  serializeObsidianEntry,
  toKnowledgeSemanticState,
} from "./obsidian-markdown.ts";
import { obsidianVaultAdapter } from "./obsidian-vault-adapter.ts";

const DEFAULT_MANAGED_ROOT = "AI知识库";

export type KnowledgeEvolutionSource = {
  id: string;
  type: KnowledgeEvolutionProposal["sourceType"];
  title: string;
  content: string;
  tags: string[];
};

function nowStamp(today = new Date()): string {
  return today.toISOString();
}

function entryFromNote(note: Awaited<ReturnType<typeof parseObsidianMarkdown>>, path: string, today: Date, existing?: KnowledgeEntry): KnowledgeEntry {
  const now = nowStamp(today);
  return {
    id: existing?.id ?? note.reviewId ?? crypto.randomUUID(),
    category: note.category,
    title: note.title,
    summary: note.summary,
    content: note.content,
    tags: note.tags,
    source: `Obsidian / ${path}`,
    favorite: existing?.favorite ?? false,
    mastery: existing?.mastery ?? 2,
    nextReviewAt: existing?.nextReviewAt ?? now,
    lastReviewedAt: existing?.lastReviewedAt,
    reviewCount: existing?.reviewCount ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function semanticHash(entry: KnowledgeEntry, wikilinks: string[]): Promise<string> {
  return hashObsidianState(toKnowledgeSemanticState(entry, wikilinks));
}

async function requireConnectedConfig(requestPermission = false): Promise<ObsidianVaultConfig> {
  const config = await reviewDb.obsidianVaultConfigs.get("default");
  if (!config?.directoryHandle) throw new Error("请先连接 Obsidian Vault");
  const permission = await obsidianVaultAdapter.permission(config.directoryHandle, requestPermission);
  if (permission !== "granted") throw new Error("Obsidian Vault 写入权限不可用，请重新授权");
  return config;
}

async function writeMappedEntry(config: ObsidianVaultConfig, entry: KnowledgeEntry, mapping: ObsidianNoteMapping, today: Date): Promise<ObsidianNoteMapping> {
  const markdown = await serializeObsidianEntry(entry, mapping.wikilinks, mapping.sourceRefs);
  await obsidianVaultAdapter.writeMarkdown(config.directoryHandle!, config.managedRoot, mapping.path, markdown);
  const hash = await semanticHash(entry, mapping.wikilinks);
  const timestamp = nowStamp(today);
  const updated = { ...mapping, baseHash: hash, vaultHash: hash, appHash: hash, status: "synced" as const, conflictVaultMarkdown: undefined, conflictAppMarkdown: undefined, lastSyncedAt: timestamp, updatedAt: timestamp };
  await reviewDb.obsidianNoteMappings.put(updated);
  return updated;
}

/** Obsidian 桥接仓储：统一处理目录句柄、三方哈希、冲突和演进提案。 */
export const obsidianKnowledgeRepository = {
  async loadSnapshot(): Promise<ObsidianVaultSnapshot> {
    const config = await reviewDb.obsidianVaultConfigs.get("default");
    const [mappedCount, conflictCount, pendingProposalCount] = await Promise.all([
      reviewDb.obsidianNoteMappings.count(),
      reviewDb.obsidianNoteMappings.where("status").equals("conflict").count(),
      reviewDb.knowledgeEvolutionProposals.where("status").equals("pending").count(),
    ]);
    const permission = config?.directoryHandle ? await obsidianVaultAdapter.permission(config.directoryHandle) : obsidianVaultAdapter.isSupported() ? "denied" : "unsupported";
    return {
      id: "default",
      vaultName: config?.vaultName ?? "",
      managedRoot: config?.managedRoot ?? DEFAULT_MANAGED_ROOT,
      lastSyncedAt: config?.lastSyncedAt,
      createdAt: config?.createdAt ?? "",
      updatedAt: config?.updatedAt ?? "",
      connected: Boolean(config?.directoryHandle),
      permission,
      mappedCount,
      conflictCount,
      pendingProposalCount,
    };
  },

  async connect(managedRoot = DEFAULT_MANAGED_ROOT, today = new Date()): Promise<ObsidianVaultSnapshot> {
    const handle = await obsidianVaultAdapter.chooseVault();
    await obsidianVaultAdapter.ensureManagedTree(handle, managedRoot);
    const timestamp = nowStamp(today);
    await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: handle.name, managedRoot, directoryHandle: handle, createdAt: timestamp, updatedAt: timestamp });
    return this.loadSnapshot();
  },

  async requestPermission(): Promise<ObsidianVaultSnapshot> {
    await requireConnectedConfig(true);
    return this.loadSnapshot();
  },

  async sync(today = new Date()): Promise<ObsidianSyncReport> {
    const config = await requireConnectedConfig();
    const files = await obsidianVaultAdapter.listMarkdown(config.directoryHandle!, config.managedRoot);
    const mappings = await reviewDb.obsidianNoteMappings.toArray();
    const mappingByPath = new Map(mappings.map((item) => [item.path, item]));
    const mappingByKnowledge = new Map(mappings.map((item) => [item.knowledgeId, item]));
    const seenPaths = new Set<string>();
    const seenKnowledgeIds = new Set<string>();
    const report: ObsidianSyncReport = { imported: 0, exported: 0, unchanged: 0, conflicts: 0, disconnected: 0 };

    for (const file of files) {
      const note = await parseObsidianMarkdown(file.markdown, file.path);
      let mapping = mappingByPath.get(file.path) ?? (note.reviewId ? mappingByKnowledge.get(note.reviewId) : undefined);
      if (mapping && mapping.path !== file.path) {
        await reviewDb.obsidianNoteMappings.delete(mapping.path);
        mapping = { ...mapping, path: file.path };
      }
      seenPaths.add(file.path);
      const existing = mapping ? await reviewDb.knowledgeEntries.get(mapping.knowledgeId) : note.reviewId ? await reviewDb.knowledgeEntries.get(note.reviewId) : undefined;
      const vaultEntry = entryFromNote(note, file.path, today, existing);
      if (mapping) seenKnowledgeIds.add(mapping.knowledgeId);
      const vaultHash = await semanticHash(vaultEntry, note.wikilinks);

      if (!mapping || !existing) {
        await reviewDb.knowledgeEntries.put(vaultEntry);
        const timestamp = nowStamp(today);
        const created: ObsidianNoteMapping = {
          path: file.path,
          knowledgeId: vaultEntry.id,
          category: vaultEntry.category,
          baseHash: vaultHash,
          vaultHash,
          appHash: vaultHash,
          status: "synced",
          wikilinks: note.wikilinks,
          sourceRefs: note.sourceRefs,
          lastSyncedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await reviewDb.obsidianNoteMappings.put(created);
        mappingByPath.set(file.path, created);
        mappingByKnowledge.set(vaultEntry.id, created);
        seenKnowledgeIds.add(vaultEntry.id);
        report.imported += 1;
        continue;
      }

      const appHash = await semanticHash(existing, mapping.wikilinks);
      const vaultChanged = vaultHash !== mapping.baseHash;
      const appChanged = appHash !== mapping.baseHash;
      if (vaultChanged && appChanged && vaultHash !== appHash) {
        const conflictAppMarkdown = await serializeObsidianEntry(existing, mapping.wikilinks, mapping.sourceRefs);
        await reviewDb.obsidianNoteMappings.put({ ...mapping, vaultHash, appHash, status: "conflict", conflictVaultMarkdown: file.markdown, conflictAppMarkdown, updatedAt: nowStamp(today) });
        report.conflicts += 1;
      } else if (vaultChanged) {
        await reviewDb.knowledgeEntries.put(vaultEntry);
        await reviewDb.obsidianNoteMappings.put({ ...mapping, category: vaultEntry.category, baseHash: vaultHash, vaultHash, appHash: vaultHash, status: "synced", wikilinks: note.wikilinks, sourceRefs: note.sourceRefs, conflictVaultMarkdown: undefined, conflictAppMarkdown: undefined, lastSyncedAt: nowStamp(today), updatedAt: nowStamp(today) });
        report.imported += 1;
      } else if (appChanged) {
        await writeMappedEntry(config, existing, { ...mapping, appHash }, today);
        report.exported += 1;
      } else {
        await reviewDb.obsidianNoteMappings.put({ ...mapping, vaultHash, appHash, status: "synced", lastSyncedAt: nowStamp(today), updatedAt: nowStamp(today) });
        report.unchanged += 1;
      }
    }

    for (const mapping of mappings) {
      if (seenPaths.has(mapping.path) || seenKnowledgeIds.has(mapping.knowledgeId)) continue;
      await reviewDb.obsidianNoteMappings.put({ ...mapping, status: "disconnected", updatedAt: nowStamp(today) });
      report.disconnected += 1;
    }
    await reviewDb.obsidianVaultConfigs.update("default", { lastSyncedAt: nowStamp(today), updatedAt: nowStamp(today) });
    return report;
  },

  async importMarkdownFiles(files: File[], today = new Date()): Promise<number> {
    const markdownFiles = files.filter((file) => /\.md$/i.test(file.name));
    for (const file of markdownFiles) {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const note = await parseObsidianMarkdown(await file.text(), path);
      await reviewDb.knowledgeEntries.put(entryFromNote(note, path, today));
    }
    return markdownFiles.length;
  },

  async listMappings(): Promise<ObsidianNoteMapping[]> {
    return reviewDb.obsidianNoteMappings.orderBy("updatedAt").reverse().toArray();
  },

  async mappingForKnowledge(knowledgeId: string): Promise<ObsidianNoteMapping | undefined> {
    return reviewDb.obsidianNoteMappings.where("knowledgeId").equals(knowledgeId).first();
  },

  async markLocalChanged(knowledgeId: string, today = new Date()): Promise<void> {
    const mapping = await this.mappingForKnowledge(knowledgeId);
    if (mapping && mapping.status === "synced") await reviewDb.obsidianNoteMappings.update(mapping.path, { status: "local_changed", updatedAt: nowStamp(today) });
  },

  async removeManagedNotes(knowledgeIds: string[]): Promise<void> {
    const mappings = (await reviewDb.obsidianNoteMappings.where("knowledgeId").anyOf(knowledgeIds).toArray());
    if (!mappings.length) return;
    const config = await requireConnectedConfig();
    for (const mapping of mappings) await obsidianVaultAdapter.removeMarkdown(config.directoryHandle!, config.managedRoot, mapping.path);
    await reviewDb.obsidianNoteMappings.bulkDelete(mappings.map((item) => item.path));
  },

  async listProposals(): Promise<KnowledgeEvolutionProposal[]> {
    return reviewDb.knowledgeEvolutionProposals.orderBy("createdAt").reverse().toArray();
  },

  /** 自动收集已完成学习记录，但只形成候选上下文，不调用 AI 或写入 Vault。 */
  async loadEvolutionSources(limit = 12): Promise<KnowledgeEvolutionSource[]> {
    const [mistakes, evaluations, tutoringSessions, knowledgeEntries, proposals] = await Promise.all([
      reviewDb.mistakes.orderBy("updatedAt").reverse().limit(limit).toArray(),
      reviewDb.interviewEvaluations.orderBy("updatedAt").reverse().limit(limit).toArray(),
      reviewDb.tutoringSessions.orderBy("updatedAt").reverse().limit(limit).toArray(),
      reviewDb.knowledgeEntries.orderBy("updatedAt").reverse().limit(limit).toArray(),
      reviewDb.knowledgeEvolutionProposals.toArray(),
    ]);
    const used = new Set(proposals.flatMap((item) => item.sourceIds));
    const sources: KnowledgeEvolutionSource[] = [
      ...mistakes.map((item) => ({ id: `mistake:${item.id}`, type: "mistake" as const, title: item.stem.slice(0, 80), content: [item.answer, item.explanation, item.reasons.join("、")].filter(Boolean).join("\n"), tags: [item.board, ...item.tags, ...item.reasons] })),
      ...evaluations.map((item) => ({ id: `interview:${item.id}`, type: "interview" as const, title: `面试复盘 ${item.totalScore} 分`, content: [...item.problems, ...item.suggestions, ...item.evidence].join("\n"), tags: [item.type, ...item.strengths] })),
      ...tutoringSessions.filter((item) => item.status === "completed" && item.summary).map((item) => ({ id: `tutoring:${item.id}`, type: "tutoring" as const, title: item.topic, content: [item.summary, ...item.nextActions].join("\n"), tags: [item.topic] })),
      ...knowledgeEntries.map((item) => ({ id: `knowledge:${item.id}`, type: "knowledge" as const, title: item.title, content: [item.summary, item.content].join("\n"), tags: [item.category, ...item.tags] })),
    ];
    return sources.filter((item) => !used.has(item.id) && item.content.trim()).slice(0, limit);
  },

  async saveProposals(proposals: KnowledgeEvolutionProposal[]): Promise<void> {
    if (proposals.length) await reviewDb.knowledgeEvolutionProposals.bulkPut(proposals);
  },

  async resolveConflict(path: string, choice: "vault" | "app", today = new Date()): Promise<void> {
    const mapping = await reviewDb.obsidianNoteMappings.get(path);
    if (!mapping || mapping.status !== "conflict") throw new Error("同步冲突已不存在");
    const entry = await reviewDb.knowledgeEntries.get(mapping.knowledgeId);
    if (!entry) throw new Error("冲突对应的知识资料不存在");
    if (choice === "vault") {
      if (!mapping.conflictVaultMarkdown) throw new Error("Vault 冲突内容不可用");
      const note = await parseObsidianMarkdown(mapping.conflictVaultMarkdown, path);
      const nextEntry = entryFromNote(note, path, today, entry);
      const hash = await semanticHash(nextEntry, note.wikilinks);
      await reviewDb.transaction("rw", [reviewDb.knowledgeEntries, reviewDb.obsidianNoteMappings], async () => {
        await reviewDb.knowledgeEntries.put(nextEntry);
        await reviewDb.obsidianNoteMappings.put({ ...mapping, baseHash: hash, vaultHash: hash, appHash: hash, status: "synced", wikilinks: note.wikilinks, sourceRefs: note.sourceRefs, conflictVaultMarkdown: undefined, conflictAppMarkdown: undefined, lastSyncedAt: nowStamp(today), updatedAt: nowStamp(today) });
      });
    } else {
      await writeMappedEntry(await requireConnectedConfig(), entry, mapping, today);
    }
  },

  async recreateDisconnected(path: string, today = new Date()): Promise<void> {
    const mapping = await reviewDb.obsidianNoteMappings.get(path);
    if (!mapping) throw new Error("笔记映射不存在");
    const entry = await reviewDb.knowledgeEntries.get(mapping.knowledgeId);
    if (!entry) throw new Error("知识资料不存在");
    await writeMappedEntry(await requireConnectedConfig(), entry, mapping, today);
  },

  async detach(path: string): Promise<void> {
    await reviewDb.obsidianNoteMappings.delete(path);
  },

  async acceptProposal(id: string, today = new Date()): Promise<KnowledgeEntry> {
    const proposal = await reviewDb.knowledgeEvolutionProposals.get(id);
    if (!proposal || proposal.status !== "pending") throw new Error("演进提案已处理或不存在");
    const config = await requireConnectedConfig();
    const timestamp = nowStamp(today);
    let entry: KnowledgeEntry;
    if (proposal.mode === "create" || !proposal.targetKnowledgeId) {
      entry = {
        id: crypto.randomUUID(), category: proposal.category, title: proposal.title, summary: proposal.summary,
        content: applyAiEvolutionSection(`# ${proposal.title}`, proposal.content), tags: proposal.tags,
        source: `知识演进 / ${proposal.sourceType}`, favorite: false, mastery: 2, nextReviewAt: timestamp,
        reviewCount: 0, createdAt: timestamp, updatedAt: timestamp,
      };
      const path = buildObsidianNotePath(entry);
      const mapping: ObsidianNoteMapping = { path, knowledgeId: entry.id, category: entry.category, baseHash: "", vaultHash: "", appHash: "", status: "local_changed", wikilinks: proposal.proposedLinks, sourceRefs: proposal.sourceIds, createdAt: timestamp, updatedAt: timestamp };
      await reviewDb.knowledgeEntries.add(entry);
      await writeMappedEntry(config, entry, mapping, today);
    } else {
      const current = await reviewDb.knowledgeEntries.get(proposal.targetKnowledgeId);
      if (!current) throw new Error("演进目标知识不存在");
      entry = { ...current, summary: proposal.summary || current.summary, content: applyAiEvolutionSection(current.content, proposal.content), tags: Array.from(new Set([...current.tags, ...proposal.tags])), updatedAt: timestamp };
      await reviewDb.knowledgeEntries.put(entry);
      let mapping = await reviewDb.obsidianNoteMappings.where("knowledgeId").equals(entry.id).first();
      if (!mapping) {
        const path = buildObsidianNotePath(entry);
        mapping = { path, knowledgeId: entry.id, category: entry.category, baseHash: "", vaultHash: "", appHash: "", status: "local_changed", wikilinks: [], sourceRefs: [], createdAt: timestamp, updatedAt: timestamp };
      }
      mapping = { ...mapping, wikilinks: Array.from(new Set([...mapping.wikilinks, ...proposal.proposedLinks])), sourceRefs: Array.from(new Set([...mapping.sourceRefs, ...proposal.sourceIds])) };
      await writeMappedEntry(config, entry, mapping, today);
    }
    await reviewDb.knowledgeEvolutionProposals.update(id, { status: "accepted", updatedAt: timestamp });
    return entry;
  },

  async rejectProposal(id: string, today = new Date()): Promise<void> {
    await reviewDb.knowledgeEvolutionProposals.update(id, { status: "rejected", updatedAt: nowStamp(today) });
  },
};
