import Dexie, { type Table } from "dexie";
import type { InstalledExtensionRecord } from "../types/domains/declarative-extension.ts";

export const EXTENSION_DB_NAME = "review_extensions";

/** 扩展使用独立数据库，避免改变核心 review_workspace v16。 */
class ExtensionDexieDatabase extends Dexie {
  extensions!: Table<InstalledExtensionRecord, string>;

  constructor() {
    super(EXTENSION_DB_NAME);
    this.version(1).stores({
      extensions: "&id, kind, enabled, installedAt, updatedAt",
    });
  }
}

export const extensionDb = new ExtensionDexieDatabase();
