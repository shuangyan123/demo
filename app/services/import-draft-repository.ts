import { reviewDb } from "../db/review-db";
import { draftToMistakeInput, toISODate } from "../lib/review-utils";
import type {
  ImportBatch,
  ImportBatchSource,
  ImportDraft,
  ImportDraftIssue,
  Mistake,
  PersistedImportDraft,
} from "../types/review";

type CreateBatchInput = {
  source: ImportBatchSource;
  fileNames: string[];
  fileCount: number;
  message: string;
};

type PersistDraftOptions = {
  batchId: string;
  fileName?: string;
  fileType?: string;
  rawText?: string;
  today: Date;
};

// 把临时导入草稿转换为 Dexie 可持久化记录，补齐批次、时间和粉笔专属字段。
function toPersistedDraft(draft: ImportDraft, options: PersistDraftOptions): PersistedImportDraft {
  const now = toISODate(options.today);
  return {
    ...draft,
    batchId: options.batchId,
    fileName: options.fileName ?? draft.fileName,
    fileType: options.fileType ?? draft.fileType,
    rawText: options.rawText ?? "",
    issues: draft.issues ?? [],
    options: draft.options ?? [],
    myAnswer: draft.myAnswer ?? "",
    createdAt: now,
    updatedAt: now,
  };
}

// 计算批次当前状态，所有草稿保存后批次才进入 saved。
function resolveBatchStatus(draftsLeft: number, savedCount: number): ImportBatch["status"] {
  if (draftsLeft > 0) return "parsed";
  return savedCount > 0 ? "saved" : "parsed";
}

export const importDraftRepository = {
  // 读取导入页启动所需的批次和持久草稿，按时间倒序展示最近工作。
  async load() {
    const [batches, drafts] = await Promise.all([
      reviewDb.importBatches.orderBy("updatedAt").reverse().toArray(),
      reviewDb.importDrafts.orderBy("createdAt").reverse().toArray(),
    ]);
    return { batches, drafts };
  },

  // 创建一个导入批次，解析过程中先写 queued/parsing 状态，便于 UI 展示进度。
  async createBatch(input: CreateBatchInput, today: Date): Promise<ImportBatch> {
    const now = toISODate(today);
    const batch: ImportBatch = {
      id: crypto.randomUUID(),
      source: input.source,
      fileNames: input.fileNames,
      fileCount: input.fileCount,
      status: "queued",
      parsedCount: 0,
      savedCount: 0,
      message: input.message,
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.importBatches.add(batch);
    return batch;
  },

  // 更新批次状态和提示文案；失败时错误信息只存本地，方便用户回看。
  async updateBatch(id: string, patch: Partial<Omit<ImportBatch, "id" | "createdAt">>, today: Date): Promise<void> {
    await reviewDb.importBatches.update(id, { ...patch, updatedAt: toISODate(today) });
  },

  // 持久化解析得到的草稿，刷新页面后仍可继续校对。
  async addDrafts(drafts: ImportDraft[], options: PersistDraftOptions): Promise<PersistedImportDraft[]> {
    const persisted = drafts.map((draft) => toPersistedDraft(draft, options));
    if (persisted.length) await reviewDb.importDrafts.bulkAdd(persisted);
    await this.updateBatch(options.batchId, { status: "parsed", parsedCount: persisted.length, message: `已生成 ${persisted.length} 条草稿` }, options.today);
    return persisted;
  },

  // 更新单条草稿字段，草稿仍处于未入库状态。
  async updateDraft(id: string, patch: Partial<ImportDraft>, today: Date): Promise<void> {
    await reviewDb.importDrafts.update(id, { ...patch, updatedAt: toISODate(today) });
  },

  // 批量更新草稿字段，用于批量改板块、来源、标签和勾选状态。
  async updateDrafts(ids: string[], patch: Partial<ImportDraft>, today: Date): Promise<void> {
    if (!ids.length) return;
    await reviewDb.transaction("rw", reviewDb.importDrafts, async () => {
      await Promise.all(ids.map((id) => reviewDb.importDrafts.update(id, { ...patch, updatedAt: toISODate(today) })));
    });
  },

  // 删除一条或多条草稿，不影响已经入库的错题。
  async removeDrafts(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await reviewDb.importDrafts.bulkDelete(ids);
  },

  // 把确认后的草稿写入错题库，并同步移除草稿、更新批次保存统计。
  async confirmDrafts(ids: string[], today: Date): Promise<Mistake[]> {
    if (!ids.length) return [];
    const now = toISODate(today);
    const drafts = await reviewDb.importDrafts.where("id").anyOf(ids).toArray();
    const validDrafts = drafts.filter((draft) => draft.stem.trim());
    const mistakes = validDrafts.map((draft) => ({
      ...draftToMistakeInput(draft),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));
    const batchIds = Array.from(new Set(validDrafts.map((draft) => draft.batchId)));

    await reviewDb.transaction("rw", reviewDb.mistakes, reviewDb.importDrafts, reviewDb.importBatches, async () => {
      if (mistakes.length) await reviewDb.mistakes.bulkAdd(mistakes);
      await reviewDb.importDrafts.bulkDelete(validDrafts.map((draft) => draft.id));
      await Promise.all(
        batchIds.map(async (batchId) => {
          const remaining = await reviewDb.importDrafts.where("batchId").equals(batchId).count();
          const batch = await reviewDb.importBatches.get(batchId);
          const newSavedCount = (batch?.savedCount ?? 0) + validDrafts.filter((draft) => draft.batchId === batchId).length;
          await reviewDb.importBatches.update(batchId, {
            savedCount: newSavedCount,
            status: resolveBatchStatus(remaining, newSavedCount),
            message: remaining ? `仍有 ${remaining} 条草稿待确认` : "草稿已确认入库",
            updatedAt: now,
          });
        }),
      );
    });

    return mistakes;
  },

  /** 仅供确认后 30 秒内的内存撤销凭据调用：删除本批新增错题并恢复原草稿。 */
  async undoConfirmation(mistakeIds: string[], drafts: PersistedImportDraft[], today: Date): Promise<void> {
    if (!mistakeIds.length || !drafts.length) return;
    const now = toISODate(today);
    const batchIds = Array.from(new Set(drafts.map((draft) => draft.batchId)));
    await reviewDb.transaction("rw", reviewDb.mistakes, reviewDb.importDrafts, reviewDb.importBatches, async () => {
      await reviewDb.mistakes.bulkDelete(mistakeIds);
      await reviewDb.importDrafts.bulkPut(drafts.map((draft) => ({ ...draft, updatedAt: now })));
      await Promise.all(batchIds.map(async (batchId) => {
        const restoredCount = drafts.filter((draft) => draft.batchId === batchId).length;
        const batch = await reviewDb.importBatches.get(batchId);
        await reviewDb.importBatches.update(batchId, {
          savedCount: Math.max(0, (batch?.savedCount ?? 0) - restoredCount),
          status: "parsed",
          message: `已撤销，恢复 ${restoredCount} 条草稿`,
          updatedAt: now,
        });
      }));
    });
  },

  // 为草稿追加问题标记，常用于重复题、低置信度等校对提示。
  async setDraftIssues(id: string, issues: ImportDraftIssue[], today: Date): Promise<void> {
    await reviewDb.importDrafts.update(id, { issues, needsReview: issues.length > 0, updatedAt: toISODate(today) });
  },
};
