import { reviewDb } from "../db/review-db";
import { buildAttempt, nextStateAfterReview, normalizeBoard, toISODate } from "../lib/review-utils";
import type { ApiSetting, ImportJob, Mistake, ReviewResult, ReviewSnapshot } from "../types/review";

type LegacyMistake = Mistake & {
  module?: string;
  subject?: string;
};

// 清理早期 demo 数据，并把旧版 subject/module 数据归一到六大板块 board。
async function cleanupDemoData(today: Date) {
  const demoMistakes = await reviewDb.mistakes.filter((item) => item.id.startsWith("demo-")).toArray();
  const legacyMistakes = await reviewDb.mistakes
    .filter((item) => !item.board)
    .toArray() as LegacyMistake[];
  const ids = demoMistakes.map((item) => item.id);
  await reviewDb.transaction("rw", reviewDb.mistakes, reviewDb.attempts, async () => {
    if (ids.length) {
      await reviewDb.mistakes.bulkDelete(ids);
      await reviewDb.attempts.where("mistakeId").anyOf(ids).delete();
    }
    if (legacyMistakes.length) {
      await reviewDb.mistakes.bulkPut(
        legacyMistakes.map((item) => ({
          ...item,
          board: normalizeBoard(item.board ?? item.module ?? item.subject).board,
          source: item.source || "历史数据",
          reasons: item.reasons?.length ? item.reasons : ["待归因"],
          tags: item.tags ?? [],
          mastery: item.mastery || 2,
          nextReviewAt: item.nextReviewAt || toISODate(today),
          updatedAt: toISODate(today),
        })),
      );
    }
  });
}

export const reviewRepository = {
  // 读取页面启动所需的完整快照，统一在这里做历史数据兼容。
  async loadSnapshot(today: Date): Promise<ReviewSnapshot> {
    await cleanupDemoData(today);
    const [mistakes, attempts, importJobs, apiSetting] = await Promise.all([
      reviewDb.mistakes.orderBy("createdAt").reverse().toArray(),
      reviewDb.attempts.orderBy("reviewedAt").reverse().toArray(),
      reviewDb.importJobs.orderBy("createdAt").reverse().toArray(),
      reviewDb.apiSettings.get("default"),
    ]);

    return { mistakes, attempts, importJobs, apiSetting };
  },

  // 新增单条错题，调用方负责提供已校验的六大板块字段。
  async addMistake(input: Omit<Mistake, "id" | "createdAt" | "updatedAt">, today: Date): Promise<Mistake> {
    const now = toISODate(today);
    const mistake: Mistake = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.mistakes.add(mistake);
    return mistake;
  },

  // 记录一次复盘结果，并同步更新错题掌握度和下次复盘日期。
  async recordReview(mistake: Mistake, result: ReviewResult, today: Date) {
    const nextState = nextStateAfterReview(mistake, result, today);
    const attempt = buildAttempt(mistake.id, result, nextState.mastery, today);

    await reviewDb.transaction("rw", reviewDb.mistakes, reviewDb.attempts, async () => {
      await reviewDb.mistakes.update(mistake.id, nextState);
      await reviewDb.attempts.add(attempt);
    });
  },

  // 批量写入导入草稿确认后的错题。
  async addMistakes(inputs: Array<Omit<Mistake, "id" | "createdAt" | "updatedAt">>, today: Date): Promise<Mistake[]> {
    const now = toISODate(today);
    const mistakes = inputs.map((input) => ({
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));
    await reviewDb.mistakes.bulkAdd(mistakes);
    return mistakes;
  },

  // 记录一次导入任务，保留导入类型、状态、解析数量和错误信息。
  async createImportJob(input: Omit<ImportJob, "id" | "createdAt">, today: Date): Promise<ImportJob> {
    const job: ImportJob = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: toISODate(today),
    };
    await reviewDb.importJobs.add(job);
    return job;
  },

  // 保存已加密的 API 设置，用于保留旧 Key 时只更新厂商、模型或地址。
  async saveApiSetting(setting: ApiSetting) {
    await reviewDb.apiSettings.put(setting);
  },

  // 清空本地错题、复盘记录和导入任务，但保留 API 设置。
  async clearAll() {
    await reviewDb.transaction("rw", reviewDb.mistakes, reviewDb.attempts, reviewDb.importJobs, async () => {
      await reviewDb.mistakes.clear();
      await reviewDb.attempts.clear();
      await reviewDb.importJobs.clear();
    });
  },
};
