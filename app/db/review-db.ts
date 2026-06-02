import Dexie, { type Table } from "dexie";
import type { ApiSetting, AppearanceSettings, Attempt, ImportJob, Mistake } from "../types/review";

// 定义错题应用使用的 IndexedDB 数据库表结构。
class ReviewDexieDatabase extends Dexie {
  mistakes!: Table<Mistake, string>;
  attempts!: Table<Attempt, string>;
  importJobs!: Table<ImportJob, string>;
  apiSettings!: Table<ApiSetting, string>;
  appearanceSettings!: Table<AppearanceSettings, string>;

  // 初始化 Dexie 数据库版本；当前版本只使用六大板块字段 board。
  constructor() {
    super("review_workspace");
    this.version(2).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
    });
    this.version(3).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
    });
  }
}

// 导出单例数据库，保证各 repository 共享同一个 IndexedDB 连接。
export const reviewDb = new ReviewDexieDatabase();
