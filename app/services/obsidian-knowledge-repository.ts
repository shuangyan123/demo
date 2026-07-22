import { reviewDb } from "../db/review-db.ts";
import { isAcquisitionProposalConfirmable } from "./acquisition-trust.ts";
import type {
  KnowledgeEntry,
  KnowledgeEvolutionProposal,
  ObsidianGraphNode,
  ObsidianNoteMapping,
  ObsidianGraphSnapshot,
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
import {
  normalizeObsidianPath,
  ObsidianVaultError,
  obsidianVaultAdapter,
} from "./obsidian-vault-adapter.ts";

const DEFAULT_MANAGED_ROOT = "AI知识库";
let activeDirectoryHandle: FileSystemDirectoryHandle | undefined;
const runningOperations = new Set<string>();

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

/** 知识训练日期沿用知识库的 YYYY-MM-DD 契约，避免完整时间戳破坏列表格式化。 */
function dayStamp(today = new Date()): string {
  return today.toISOString().slice(0, 10);
}

/** 兼容早期 Obsidian 导入写入的完整时间戳，并保持无效值不会进入训练队列。 */
function normalizeKnowledgeDay(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : dayStamp(parsed);
}

/** Wikilink 不允许指向当前笔记自身，避免模型提案制造无意义自环。 */
function withoutSelfLinks(links: string[], title: string): string[] {
  return links.filter((link) => link.trim() && link.trim() !== title.trim());
}

function noteTitleFromPath(path: string): string {
  return path.split("/").at(-1)?.replace(/--[a-f0-9-]{8}\.md$/i, "").replace(/\.md$/i, "") ?? path;
}

function entryFromNote(note: Awaited<ReturnType<typeof parseObsidianMarkdown>>, path: string, today: Date, existing?: KnowledgeEntry): KnowledgeEntry {
  const now = dayStamp(today);
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
    nextReviewAt: normalizeKnowledgeDay(existing?.nextReviewAt, now),
    lastReviewedAt: existing?.lastReviewedAt,
    reviewCount: existing?.reviewCount ?? 0,
    createdAt: normalizeKnowledgeDay(existing?.createdAt, now),
    updatedAt: now,
  };
}

async function semanticHash(entry: KnowledgeEntry, wikilinks: string[]): Promise<string> {
  return hashObsidianState(toKnowledgeSemanticState(entry, wikilinks));
}

/** 防止同一 repository 操作被双击或多组件并发执行。 */
async function withOperationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  if (runningOperations.has(key)) throw new Error("同一 Obsidian 操作正在进行，请等待完成后再试");
  runningOperations.add(key);
  try {
    return await task();
  } finally {
    runningOperations.delete(key);
  }
}

async function requireConnectedConfig(): Promise<ObsidianVaultConfig> {
  const config = await reviewDb.obsidianVaultConfigs.get("default");
  if (!config?.directoryHandle) throw new Error("请先连接 Obsidian Vault");
  activeDirectoryHandle = config.directoryHandle;
  const permission = await obsidianVaultAdapter.permission(config.directoryHandle);
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

/** 在覆盖 Vault 或应用前重新读取双方，拒绝使用已经过期的同步/冲突快照。 */
async function assertMappingRevision(config: ObsidianVaultConfig, mapping: ObsidianNoteMapping, entry: KnowledgeEntry, expectedStatus: ObsidianNoteMapping["status"]): Promise<void> {
  if (mapping.status !== expectedStatus) throw new Error(`笔记当前状态为 ${mapping.status}，请先完成同步或冲突处理`);
  const latestAppHash = await semanticHash(entry, mapping.wikilinks);
  const latestMarkdown = await obsidianVaultAdapter.readMarkdown(config.directoryHandle!, config.managedRoot, mapping.path);
  const latestNote = await parseObsidianMarkdown(latestMarkdown, mapping.path);
  const latestVaultHash = await semanticHash(entryFromNote(latestNote, mapping.path, new Date(), entry), latestNote.wikilinks);
  const expectedAppHash = expectedStatus === "conflict" ? mapping.appHash : mapping.baseHash;
  const expectedVaultHash = expectedStatus === "conflict" ? mapping.vaultHash : mapping.baseHash;
  if (latestAppHash !== expectedAppHash || latestVaultHash !== expectedVaultHash) {
    throw new Error("应用或 Vault 内容在页面显示后又发生变化。为避免覆盖，请重新同步后再操作");
  }
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
    let permission: ObsidianVaultSnapshot["permission"] = obsidianVaultAdapter.isSupported() ? "denied" : "unsupported";
    let recovery: ObsidianVaultSnapshot["recovery"] = permission === "unsupported" ? "unsupported" : "none";
    if (config?.directoryHandle) {
      activeDirectoryHandle = config.directoryHandle;
      try {
        permission = await obsidianVaultAdapter.permission(config.directoryHandle);
        recovery = permission === "granted" ? "none" : permission === "unsupported" ? "unsupported" : "reauthorize";
      } catch (error) {
        permission = "denied";
        recovery = error instanceof ObsidianVaultError && error.code === "handle_invalid" ? "reselect" : "reauthorize";
      }
    }
    return {
      id: "default",
      vaultName: config?.vaultName ?? "",
      managedRoot: config?.managedRoot ?? DEFAULT_MANAGED_ROOT,
      lastSyncedAt: config?.lastSyncedAt,
      createdAt: config?.createdAt ?? "",
      updatedAt: config?.updatedAt ?? "",
      connected: Boolean(config?.directoryHandle),
      permission,
      recovery,
      mappedCount,
      conflictCount,
      pendingProposalCount,
    };
  },

  async connect(managedRoot = DEFAULT_MANAGED_ROOT, today = new Date()): Promise<ObsidianVaultSnapshot> {
    const normalizedRoot = normalizeObsidianPath(managedRoot || DEFAULT_MANAGED_ROOT, "托管目录");
    const handle = await obsidianVaultAdapter.chooseVault();
    await obsidianVaultAdapter.ensureManagedTree(handle, normalizedRoot);
    const timestamp = nowStamp(today);
    const previous = await reviewDb.obsidianVaultConfigs.get("default");
    await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: handle.name, managedRoot: normalizedRoot, directoryHandle: handle, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp });
    activeDirectoryHandle = handle;
    return this.loadSnapshot();
  },

  async requestPermission(): Promise<ObsidianVaultSnapshot> {
    if (!activeDirectoryHandle) throw new Error("已保存的 Vault 句柄尚未恢复，请刷新页面或重新选择 Vault");
    const permission = await obsidianVaultAdapter.permission(activeDirectoryHandle, true);
    if (permission !== "granted") throw new Error("Vault 仍未获得读写权限，请重新授权或重新选择 Vault");
    return this.loadSnapshot();
  },

  async sync(today = new Date()): Promise<ObsidianSyncReport> {
    return withOperationLock("sync", async () => {
      const config = await requireConnectedConfig();
      const files = await obsidianVaultAdapter.listMarkdown(config.directoryHandle!, config.managedRoot);
      const parsedFiles = await Promise.all(files.map(async (file) => {
        const note = await parseObsidianMarkdown(file.markdown, file.path);
        return { file, note };
      }));

      // 同一 review-id 出现在多个文件时无法安全判断重命名，必须在任何写入前终止。
      const reviewIdPaths = new Map<string, string[]>();
      for (const { file, note } of parsedFiles) {
        if (!note.reviewId) continue;
        reviewIdPaths.set(note.reviewId, [...(reviewIdPaths.get(note.reviewId) ?? []), file.path]);
      }
      const duplicate = Array.from(reviewIdPaths.entries()).find(([, paths]) => paths.length > 1);
      if (duplicate) throw new Error(`检测到重复 review-id“${duplicate[0]}”：${duplicate[1].join("、")}。请修正后重新同步，当前数据未修改。`);

      const [mappings, entries] = await Promise.all([
        reviewDb.obsidianNoteMappings.toArray(),
        reviewDb.knowledgeEntries.toArray(),
      ]);
      const entryById = new Map(entries.map((item) => [item.id, item]));
      const mappingByPath = new Map(mappings.map((item) => [item.path, item]));
      const mappingByKnowledge = new Map(mappings.map((item) => [item.knowledgeId, item]));
      const seenPaths = new Set<string>();
      const seenKnowledgeIds = new Set<string>();
      const mappingDeletes = new Set<string>();
      const mappingPuts: ObsidianNoteMapping[] = [];
      const entryPuts: KnowledgeEntry[] = [];
      const vaultWrites: Array<{ path: string; markdown: string }> = [];
      const report: ObsidianSyncReport = { imported: 0, exported: 0, unchanged: 0, conflicts: 0, disconnected: 0, warnings: [] };
      const timestamp = nowStamp(today);

      for (const { file, note } of parsedFiles) {
        let mapping = mappingByPath.get(file.path) ?? (note.reviewId ? mappingByKnowledge.get(note.reviewId) : undefined);
        if (mapping && mapping.path !== file.path) {
          mappingDeletes.add(mapping.path);
          mapping = { ...mapping, path: file.path };
        }
        seenPaths.add(file.path);
        const existing = mapping ? entryById.get(mapping.knowledgeId) : note.reviewId ? entryById.get(note.reviewId) : undefined;
        const vaultEntry = entryFromNote(note, file.path, today, existing);
        if (mapping) seenKnowledgeIds.add(mapping.knowledgeId);
        const vaultHash = await semanticHash(vaultEntry, note.wikilinks);

        if (!mapping || !existing) {
          const created: ObsidianNoteMapping = {
            path: file.path, knowledgeId: vaultEntry.id, category: vaultEntry.category,
            baseHash: vaultHash, vaultHash, appHash: vaultHash, status: "synced",
            wikilinks: note.wikilinks, sourceRefs: note.sourceRefs,
            lastSyncedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
          };
          entryPuts.push(vaultEntry);
          mappingPuts.push(created);
          mappingByPath.set(file.path, created);
          mappingByKnowledge.set(vaultEntry.id, created);
          seenKnowledgeIds.add(vaultEntry.id);
          report.imported += 1;
          continue;
        }

        const normalizedExisting = {
          ...existing,
          nextReviewAt: normalizeKnowledgeDay(existing.nextReviewAt, dayStamp(today)),
          createdAt: normalizeKnowledgeDay(existing.createdAt, dayStamp(today)),
        };
        const normalizedDatesChanged = normalizedExisting.nextReviewAt !== existing.nextReviewAt || normalizedExisting.createdAt !== existing.createdAt;
        const appHash = await semanticHash(normalizedExisting, mapping.wikilinks);
        const vaultChanged = vaultHash !== mapping.baseHash;
        const appChanged = appHash !== mapping.baseHash;
        if (vaultChanged && appChanged && vaultHash !== appHash) {
          if (normalizedDatesChanged) entryPuts.push(normalizedExisting);
          mappingPuts.push({ ...mapping, vaultHash, appHash, status: "conflict", conflictVaultMarkdown: file.markdown, conflictAppMarkdown: await serializeObsidianEntry(normalizedExisting, mapping.wikilinks, mapping.sourceRefs), updatedAt: timestamp });
          report.conflicts += 1;
        } else if (vaultChanged) {
          entryPuts.push(vaultEntry);
          mappingPuts.push({ ...mapping, category: vaultEntry.category, baseHash: vaultHash, vaultHash, appHash: vaultHash, status: "synced", wikilinks: note.wikilinks, sourceRefs: note.sourceRefs, conflictVaultMarkdown: undefined, conflictAppMarkdown: undefined, lastSyncedAt: timestamp, updatedAt: timestamp });
          report.imported += 1;
        } else if (appChanged) {
          if (normalizedDatesChanged) entryPuts.push(normalizedExisting);
          vaultWrites.push({ path: mapping.path, markdown: await serializeObsidianEntry(normalizedExisting, mapping.wikilinks, mapping.sourceRefs) });
          mappingPuts.push({ ...mapping, baseHash: appHash, vaultHash: appHash, appHash, status: "synced", conflictVaultMarkdown: undefined, conflictAppMarkdown: undefined, lastSyncedAt: timestamp, updatedAt: timestamp });
          report.exported += 1;
        } else {
          if (normalizedDatesChanged) entryPuts.push(normalizedExisting);
          mappingPuts.push({ ...mapping, vaultHash, appHash, status: "synced", lastSyncedAt: timestamp, updatedAt: timestamp });
          report.unchanged += 1;
        }
      }

      for (const entry of entries) {
        if (seenKnowledgeIds.has(entry.id) || mappingByKnowledge.has(entry.id)) continue;
        const path = buildObsidianNotePath(entry);
        if (seenPaths.has(path)) {
          report.warnings.push(`本地知识“${entry.title}”目标路径已存在，已跳过首次写回`);
          continue;
        }
        const hash = await semanticHash(entry, []);
        vaultWrites.push({ path, markdown: await serializeObsidianEntry(entry, [], []) });
        const created: ObsidianNoteMapping = {
          path, knowledgeId: entry.id, category: entry.category,
          baseHash: hash, vaultHash: hash, appHash: hash, status: "synced",
          wikilinks: [], sourceRefs: [],
          lastSyncedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
        };
        mappingPuts.push(created);
        mappingByPath.set(path, created);
        mappingByKnowledge.set(entry.id, created);
        seenPaths.add(path);
        seenKnowledgeIds.add(entry.id);
        report.exported += 1;
      }

      for (const mapping of mappings) {
        if (seenPaths.has(mapping.path) || seenKnowledgeIds.has(mapping.knowledgeId)) continue;
        mappingPuts.push({ ...mapping, status: "disconnected", updatedAt: timestamp });
        report.disconnected += 1;
      }

      // 文件系统无法参与 IndexedDB 事务；先写 Vault，失败时不提交任何新基线，下一次同步可安全恢复。
      for (const write of vaultWrites) {
        await obsidianVaultAdapter.writeMarkdown(config.directoryHandle!, config.managedRoot, write.path, write.markdown);
      }
      await reviewDb.transaction("rw", [reviewDb.knowledgeEntries, reviewDb.obsidianNoteMappings, reviewDb.obsidianVaultConfigs], async () => {
        if (mappingDeletes.size) await reviewDb.obsidianNoteMappings.bulkDelete(Array.from(mappingDeletes));
        if (entryPuts.length) await reviewDb.knowledgeEntries.bulkPut(entryPuts);
        if (mappingPuts.length) await reviewDb.obsidianNoteMappings.bulkPut(mappingPuts);
        await reviewDb.obsidianVaultConfigs.update("default", { lastSyncedAt: timestamp, updatedAt: timestamp });
      });
      return report;
    });
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

  async loadGraphSnapshot(): Promise<ObsidianGraphSnapshot> {
    const [mappings, entries] = await Promise.all([
      reviewDb.obsidianNoteMappings.toArray(),
      reviewDb.knowledgeEntries.toArray(),
    ]);
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const titleToNodeId = new Map<string, string>();
    const nodes: ObsidianGraphNode[] = mappings.map((mapping) => {
      const entry = entryById.get(mapping.knowledgeId);
      const title = entry?.title ?? noteTitleFromPath(mapping.path);
      const node = {
        id: mapping.knowledgeId,
        title,
        category: mapping.category,
        knowledgeId: mapping.knowledgeId,
        path: mapping.path,
        status: mapping.status === "synced" ? "synced" as const : "issue" as const,
      };
      titleToNodeId.set(title, node.id);
      return node;
    });
    const externalNodes = new Map<string, ObsidianGraphNode>();
    const edges = mappings.flatMap((mapping) => {
      const source = entryById.get(mapping.knowledgeId);
      const sourceTitle = source?.title ?? noteTitleFromPath(mapping.path);
      return withoutSelfLinks(mapping.wikilinks, sourceTitle).map((link) => {
        const targetId = titleToNodeId.get(link) ?? `external:${link}`;
        if (!titleToNodeId.has(link) && !externalNodes.has(targetId)) {
          externalNodes.set(targetId, { id: targetId, title: link, status: "external" as const });
        }
        return { id: `${mapping.knowledgeId}->${targetId}`, sourceId: mapping.knowledgeId, targetId, label: link };
      });
    });
    const graphNodes = [...nodes, ...externalNodes.values()];
    return {
      nodes: graphNodes,
      edges,
      syncedCount: nodes.filter((node) => node.status === "synced").length,
      issueCount: nodes.filter((node) => node.status === "issue").length,
      externalCount: externalNodes.size,
    };
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

  /** 自动收集已完成学习记录；传入范围时不会读取未授权业务表。 */
  async loadEvolutionSources(limit = 12, scopes?: KnowledgeEvolutionSource["type"][]): Promise<KnowledgeEvolutionSource[]> {
    const allowed = scopes ? new Set(scopes) : undefined;
    const [mistakes, evaluations, tutoringSessions, knowledgeEntries, proposals] = await Promise.all([
      !allowed || allowed.has("mistake") ? reviewDb.mistakes.orderBy("updatedAt").reverse().limit(limit).toArray() : Promise.resolve([]),
      !allowed || allowed.has("interview") ? reviewDb.interviewEvaluations.orderBy("updatedAt").reverse().limit(limit).toArray() : Promise.resolve([]),
      !allowed || allowed.has("tutoring") ? reviewDb.tutoringSessions.orderBy("updatedAt").reverse().limit(limit).toArray() : Promise.resolve([]),
      !allowed || allowed.has("knowledge") ? reviewDb.knowledgeEntries.orderBy("updatedAt").reverse().limit(limit).toArray() : Promise.resolve([]),
      reviewDb.knowledgeEvolutionProposals.toArray(),
    ]);
    // 已忽略提案不再永久消耗来源，用户可以修正连接或提示后重新生成。
    const used = new Set(proposals.filter((item) => item.status === "pending" || item.status === "accepted").flatMap((item) => item.sourceIds));
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

  /** 用户可在确认前修订生成稿，但不能改写证据、评分或审计字段。 */
  async updateProposal(id: string, patch: Pick<KnowledgeEvolutionProposal, "title" | "summary" | "content" | "tags" | "proposedLinks">, today = new Date()): Promise<void> {
    const proposal = await reviewDb.knowledgeEvolutionProposals.get(id);
    if (!proposal || proposal.status !== "pending") throw new Error("演进提案已处理或不存在");
    await reviewDb.knowledgeEvolutionProposals.update(id, { ...patch, updatedAt: nowStamp(today) });
  },

  async resolveConflict(path: string, choice: "vault" | "app", today = new Date()): Promise<void> {
    await withOperationLock(`conflict:${path}`, async () => {
      const [mapping, config] = await Promise.all([reviewDb.obsidianNoteMappings.get(path), requireConnectedConfig()]);
      if (!mapping || mapping.status !== "conflict") throw new Error("同步冲突已不存在");
      const entry = await reviewDb.knowledgeEntries.get(mapping.knowledgeId);
      if (!entry) throw new Error("冲突对应的知识资料不存在");
      await assertMappingRevision(config, mapping, entry, "conflict");
      if (choice === "vault") {
        const latestMarkdown = await obsidianVaultAdapter.readMarkdown(config.directoryHandle!, config.managedRoot, path);
        const note = await parseObsidianMarkdown(latestMarkdown, path);
        const nextEntry = entryFromNote(note, path, today, entry);
        const hash = await semanticHash(nextEntry, note.wikilinks);
        await reviewDb.transaction("rw", [reviewDb.knowledgeEntries, reviewDb.obsidianNoteMappings], async () => {
          await reviewDb.knowledgeEntries.put(nextEntry);
          await reviewDb.obsidianNoteMappings.put({ ...mapping, baseHash: hash, vaultHash: hash, appHash: hash, status: "synced", wikilinks: note.wikilinks, sourceRefs: note.sourceRefs, conflictVaultMarkdown: undefined, conflictAppMarkdown: undefined, lastSyncedAt: nowStamp(today), updatedAt: nowStamp(today) });
        });
      } else {
        await writeMappedEntry(config, entry, mapping, today);
      }
    });
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
    return withOperationLock(`proposal:${id}`, async () => {
      const [proposal, config] = await Promise.all([reviewDb.knowledgeEvolutionProposals.get(id), requireConnectedConfig()]);
      if (!proposal || proposal.status !== "pending") throw new Error("演进提案已处理或不存在");
      if (!isAcquisitionProposalConfirmable(proposal)) throw new Error(proposal.provenance?.trust.blockingIssues.join("；") || "该提案存在争议，不能确认");
      const timestamp = nowStamp(today);
      const entryDate = dayStamp(today);
      let entry: KnowledgeEntry;
      let mapping: ObsidianNoteMapping;

      if (proposal.mode === "create" || !proposal.targetKnowledgeId) {
        entry = {
          id: proposal.id, category: proposal.category, title: proposal.title, summary: proposal.summary,
          content: applyAiEvolutionSection(`# ${proposal.title}`, proposal.content), tags: proposal.tags,
          source: `知识演进 / ${proposal.sourceType}`, favorite: false, mastery: 2, nextReviewAt: entryDate,
          reviewCount: 0, createdAt: entryDate, updatedAt: entryDate,
        };
        mapping = {
          path: buildObsidianNotePath(entry), knowledgeId: entry.id, category: entry.category,
          baseHash: "", vaultHash: "", appHash: "", status: "local_changed",
          wikilinks: withoutSelfLinks(proposal.proposedLinks, entry.title), sourceRefs: proposal.sourceIds,
          createdAt: timestamp, updatedAt: timestamp,
        };
      } else {
        const current = await reviewDb.knowledgeEntries.get(proposal.targetKnowledgeId);
        if (!current) throw new Error("演进目标知识不存在");
        const existingMapping = await reviewDb.obsidianNoteMappings.where("knowledgeId").equals(current.id).first();
        if (existingMapping) await assertMappingRevision(config, existingMapping, current, "synced");
        entry = proposal.mode === "link" ? current : {
          ...current,
          summary: proposal.summary || current.summary,
          content: applyAiEvolutionSection(current.content, proposal.content),
          tags: Array.from(new Set([...current.tags, ...proposal.tags])),
          updatedAt: entryDate,
        };
        mapping = existingMapping ?? {
          path: buildObsidianNotePath(entry), knowledgeId: entry.id, category: entry.category,
          baseHash: "", vaultHash: "", appHash: "", status: "local_changed",
          wikilinks: [], sourceRefs: [], createdAt: timestamp, updatedAt: timestamp,
        };
        mapping = {
          ...mapping,
          wikilinks: Array.from(new Set([...mapping.wikilinks, ...withoutSelfLinks(proposal.proposedLinks, entry.title)])),
          sourceRefs: Array.from(new Set([...mapping.sourceRefs, ...proposal.sourceIds])),
        };
      }

      const markdown = await serializeObsidianEntry(entry, mapping.wikilinks, mapping.sourceRefs);
      await obsidianVaultAdapter.writeMarkdown(config.directoryHandle!, config.managedRoot, mapping.path, markdown);
      const hash = await semanticHash(entry, mapping.wikilinks);
      const syncedMapping: ObsidianNoteMapping = { ...mapping, baseHash: hash, vaultHash: hash, appHash: hash, status: "synced", conflictVaultMarkdown: undefined, conflictAppMarkdown: undefined, lastSyncedAt: timestamp, updatedAt: timestamp };
      await reviewDb.transaction("rw", [reviewDb.knowledgeEntries, reviewDb.obsidianNoteMappings, reviewDb.knowledgeEvolutionProposals], async () => {
        const latest = await reviewDb.knowledgeEvolutionProposals.get(id);
        if (!latest || latest.status !== "pending") throw new Error("演进提案已被其他操作处理");
        await reviewDb.knowledgeEntries.put(entry);
        await reviewDb.obsidianNoteMappings.put(syncedMapping);
        await reviewDb.knowledgeEvolutionProposals.update(id, { status: "accepted", updatedAt: timestamp });
      });
      return entry;
    });
  },

  /** 批量确认先统一复读目标与来源状态，再逐项写入并返回部分成功结果。 */
  async acceptProposals(
    ids: string[],
    options: { verifySource?: (proposal: KnowledgeEvolutionProposal) => Promise<void>; today?: Date } = {},
  ): Promise<{ acceptedIds: string[]; failures: Array<{ id: string; message: string }> }> {
    const uniqueIds = [...new Set(ids)];
    const proposals = await reviewDb.knowledgeEvolutionProposals.bulkGet(uniqueIds);
    const config = await requireConnectedConfig();
    const failures: Array<{ id: string; message: string }> = [];
    const ready: KnowledgeEvolutionProposal[] = [];
    for (let index = 0; index < uniqueIds.length; index += 1) {
      const id = uniqueIds[index];
      const proposal = proposals[index];
      try {
        if (!proposal || proposal.status !== "pending") throw new Error("提案已处理或不存在");
        if (!isAcquisitionProposalConfirmable(proposal)) throw new Error(proposal.provenance?.trust.blockingIssues.join("；") || "提案存在争议");
        if (proposal.targetKnowledgeId) {
          const entry = await reviewDb.knowledgeEntries.get(proposal.targetKnowledgeId);
          if (!entry) throw new Error("演进目标知识不存在");
          const mapping = await reviewDb.obsidianNoteMappings.where("knowledgeId").equals(entry.id).first();
          if (mapping) await assertMappingRevision(config, mapping, entry, "synced");
        }
        if (options.verifySource) await options.verifySource(proposal);
        ready.push(proposal);
      } catch (error) {
        const message = error instanceof Error ? error.message : "批量确认预检失败";
        if (proposal?.provenance && /来源 URL 无法验证|来源内容哈希已变化/.test(message)) {
          const blockingIssues = [...new Set([...proposal.provenance.trust.blockingIssues, message.split("：")[0]])];
          await reviewDb.knowledgeEvolutionProposals.update(id, { provenance: { ...proposal.provenance, trust: { ...proposal.provenance.trust, blockingIssues } }, updatedAt: nowStamp(options.today) });
        }
        failures.push({ id, message });
      }
    }

    const acceptedIds: string[] = [];
    for (const proposal of ready) {
      try {
        await this.acceptProposal(proposal.id, options.today);
        acceptedIds.push(proposal.id);
      } catch (error) {
        failures.push({ id: proposal.id, message: error instanceof Error ? error.message : "写入 Vault 失败" });
      }
    }
    return { acceptedIds, failures };
  },

  async rejectProposal(id: string, today = new Date()): Promise<void> {
    const proposal = await reviewDb.knowledgeEvolutionProposals.get(id);
    if (!proposal || proposal.status !== "pending") throw new Error("演进提案已处理或不存在");
    await reviewDb.knowledgeEvolutionProposals.update(id, { status: "rejected", updatedAt: nowStamp(today) });
  },
};
