import assert from "node:assert/strict";
import test from "node:test";
import {
  addStudyModule,
  getEnabledStudyModuleIds,
  loadStudyModulePreferences,
  removeStudyModule,
  resetStudyModulePreferences,
  saveEnabledStudyModuleIds,
  STUDY_MODULE_PREFERENCES_STORAGE_KEY,
} from "./study-module-preferences-repository.ts";
import { getDefaultEnabledStudyModuleIds } from "../features/study/study-registry.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  },
});

test.beforeEach(() => {
  localStorage.clear();
});

test("缺少项目偏好时使用稳定默认模块集合", () => {
  assert.deepEqual([...getEnabledStudyModuleIds("civil-service")], getDefaultEnabledStudyModuleIds("civil-service"));
  assert.deepEqual([...loadStudyModulePreferences()["civil-service"].enabledModuleIds], getDefaultEnabledStudyModuleIds("civil-service"));
});

test("保存偏好时只保留已注册 ID、去重并按 registry 顺序持久化", () => {
  assert.deepEqual([...saveEnabledStudyModuleIds("civil-service", ["stats", "stats", "unknown"])], ["dashboard", "stats"]);
  assert.deepEqual(JSON.parse(localStorage.getItem(STUDY_MODULE_PREFERENCES_STORAGE_KEY) ?? "null"), {
    "civil-service": { enabledModuleIds: ["dashboard", "stats"] },
  });
});

test("添加和移除模块只改变项目侧栏 ID，dashboard 始终保留", () => {
  assert.deepEqual([...addStudyModule("civil-service", "import")], [
    "dashboard",
    "fenbi",
    "import",
    "library",
    "review",
    "knowledgeTraining",
    "interview",
  ]);
  assert.deepEqual([...removeStudyModule("civil-service", "import")], getDefaultEnabledStudyModuleIds("civil-service"));
  assert.deepEqual([...removeStudyModule("civil-service", "dashboard")], getDefaultEnabledStudyModuleIds("civil-service"));
});

test("恢复默认模块并重新读取时保留正确的项目偏好", () => {
  addStudyModule("civil-service", "stats");
  assert.deepEqual([...resetStudyModulePreferences("civil-service")], getDefaultEnabledStudyModuleIds("civil-service"));
  assert.deepEqual([...loadStudyModulePreferences()["civil-service"].enabledModuleIds], getDefaultEnabledStudyModuleIds("civil-service"));

  localStorage.setItem(STUDY_MODULE_PREFERENCES_STORAGE_KEY, JSON.stringify({
    "civil-service": { enabledModuleIds: ["tutoring", "tutoring", "unknown"] },
  }));
  assert.deepEqual([...loadStudyModulePreferences()["civil-service"].enabledModuleIds], ["dashboard", "tutoring"]);
});
