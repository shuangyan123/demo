import {
  getDefaultEnabledStudyModuleIds,
  getStudyDomainDefinition,
  getStudyModuleCatalog,
  resolveEnabledStudyModuleIds,
  studyDomainDefinitions,
  type StudyModuleId,
} from "../features/study/study-registry.ts";
import type { StudyDomainId } from "../types/domains/workspace.ts";

export const STUDY_MODULE_PREFERENCES_STORAGE_KEY = "review-workspace:study-module-preferences:v1";

type StudyModulePreferenceRecord = Readonly<{
  enabledModuleIds: readonly StudyModuleId[];
}>;

export type StudyModulePreferencesSnapshot = Readonly<Record<StudyDomainId, StudyModulePreferenceRecord>>;

const EMPTY_STUDY_MODULE_PREFERENCES = Object.freeze({}) as StudyModulePreferencesSnapshot;
let cachedRaw: string | null | undefined;
let cachedSnapshot: StudyModulePreferencesSnapshot = EMPTY_STUDY_MODULE_PREFERENCES;

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STUDY_MODULE_PREFERENCES_STORAGE_KEY);
  } catch {
    // 隐私模式或宿主策略可能禁止 localStorage；调用方继续使用 registry 默认值。
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredIds(parsed: unknown, domainId: StudyDomainId): readonly string[] | undefined {
  if (!isRecord(parsed)) return undefined;
  const domain = parsed[domainId];
  if (!isRecord(domain) || !Array.isArray(domain.enabledModuleIds)) return undefined;
  return domain.enabledModuleIds.filter((id): id is string => typeof id === "string");
}

function parseSnapshot(raw: string | null): StudyModulePreferencesSnapshot {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  const snapshot = Object.fromEntries(studyDomainDefinitions.map((domain) => [
    domain.id,
    Object.freeze({
      enabledModuleIds: Object.freeze(resolveEnabledStudyModuleIds(domain.id, readStoredIds(parsed, domain.id))),
    }),
  ])) as StudyModulePreferencesSnapshot;
  return Object.freeze(snapshot);
}

export function getStudyModulePreferencesSnapshot(): StudyModulePreferencesSnapshot {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  cachedSnapshot = parseSnapshot(raw);
  return cachedSnapshot;
}

/** 服务端固定返回空快照，首次水合仍由 registry 默认模块提供稳定内容。 */
export function getStudyModulePreferencesServerSnapshot(): StudyModulePreferencesSnapshot {
  return EMPTY_STUDY_MODULE_PREFERENCES;
}

export function loadStudyModulePreferences(): StudyModulePreferencesSnapshot {
  return getStudyModulePreferencesSnapshot();
}

function emitChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("review-workspace:study-module-preferences-change"));
}

function writeSnapshot(snapshot: StudyModulePreferencesSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = Object.fromEntries(Object.entries(snapshot).map(([domainId, record]) => [
      domainId,
      { enabledModuleIds: [...record.enabledModuleIds] },
    ]));
    window.localStorage.setItem(STUDY_MODULE_PREFERENCES_STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    throw new Error("项目模块偏好保存失败，请检查浏览器本地存储权限。");
  }
}

export function saveEnabledStudyModuleIds(domainId: StudyDomainId, moduleIds: readonly string[]): readonly StudyModuleId[] {
  if (!getStudyDomainDefinition(domainId)) throw new Error("未知学习项目：" + domainId);
  const enabledModuleIds = resolveEnabledStudyModuleIds(domainId, moduleIds);
  const current = getStudyModulePreferencesSnapshot();
  const next = {
    ...current,
    [domainId]: Object.freeze({ enabledModuleIds: Object.freeze(enabledModuleIds) }),
  } as StudyModulePreferencesSnapshot;
  writeSnapshot(next);
  emitChange();
  return enabledModuleIds;
}

export function getEnabledStudyModuleIds(domainId: StudyDomainId): readonly StudyModuleId[] {
  return getStudyModulePreferencesSnapshot()[domainId]?.enabledModuleIds ?? getDefaultEnabledStudyModuleIds(domainId);
}

export function addStudyModule(domainId: StudyDomainId, moduleId: string): readonly StudyModuleId[] {
  if (!getStudyModuleCatalog(domainId).some((module) => module.id === moduleId)) return getEnabledStudyModuleIds(domainId);
  const current = getEnabledStudyModuleIds(domainId);
  if (current.includes(moduleId as StudyModuleId)) return current;
  return saveEnabledStudyModuleIds(domainId, [...current, moduleId]);
}

export function removeStudyModule(domainId: StudyDomainId, moduleId: string): readonly StudyModuleId[] {
  const current = getEnabledStudyModuleIds(domainId);
  return saveEnabledStudyModuleIds(domainId, current.filter((id) => id !== moduleId));
}

export function resetStudyModulePreferences(domainId: StudyDomainId): readonly StudyModuleId[] {
  return saveEnabledStudyModuleIds(domainId, getDefaultEnabledStudyModuleIds(domainId));
}

export function subscribeToStudyModulePreferences(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STUDY_MODULE_PREFERENCES_STORAGE_KEY) listener();
  };
  const changeEvent = "review-workspace:study-module-preferences-change";
  window.addEventListener("storage", handleStorage);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(changeEvent, listener);
  };
}
