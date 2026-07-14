/**
 * 个性化记忆通过现有 personalization 单例持久化，避免新增表和 Dexie 版本。
 * AI 建议只能进入 pending，确认动作由用户显式触发。
 */
import type { PersonalMemoryEntry, PersonalMemoryKind, PersonalMemoryScope, PersonalMemorySettings, PersonalizationSettings } from "../types/review";
import { createDefaultPersonalizationSettings, personalizationSettingsRepository } from "./personalization-settings-repository.ts";

type AddMemoryInput = {
  kind: PersonalMemoryKind;
  scope: PersonalMemoryScope;
  title: string;
  content: string;
  moduleId?: string;
  sourceConversationId?: string;
};

/** 保存记忆列表前统一更新 personalization 时间戳并通知调用方最新快照。 */
async function saveEntries(settings: PersonalizationSettings, entries: PersonalMemoryEntry[], today = new Date()): Promise<PersonalizationSettings> {
  return personalizationSettingsRepository.save({ ...settings, memoryVersion: 1, memoryEntries: entries }, today);
}

/** 构造经长度约束的记忆条目。 */
function createEntry(input: AddMemoryInput, source: PersonalMemoryEntry["source"], status: PersonalMemoryEntry["status"], today: Date): PersonalMemoryEntry {
  const timestamp = today.toISOString();
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    scope: input.scope,
    title: input.title.trim().slice(0, 80),
    content: input.content.trim().slice(0, 2000),
    source,
    status,
    moduleId: input.scope === "module" ? input.moduleId?.trim() || undefined : undefined,
    sourceConversationId: input.scope === "conversation" ? input.sourceConversationId?.trim() || undefined : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const personalMemoryRepository = {
  /** 手动记忆直接进入 active，但仍要求标题和内容。 */
  async addManual(input: AddMemoryInput, today = new Date()): Promise<PersonalizationSettings> {
    if (!input.title.trim() || !input.content.trim()) throw new Error("请填写记忆标题和内容");
    const settings = await personalizationSettingsRepository.load(today);
    const entry = createEntry(input, "manual", "active", today);
    return saveEntries(settings, [entry, ...(settings.memoryEntries ?? [])], today);
  },

  /** AI 仅能新增待确认建议，关闭建议开关时拒绝写入。 */
  async addSuggested(input: AddMemoryInput, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    if (!settings.memorySettings?.suggestionsEnabled) throw new Error("自动记忆建议当前已关闭");
    if (!input.title.trim() || !input.content.trim()) throw new Error("记忆建议缺少标题或内容");
    const entry = createEntry(input, "suggested", "pending", today);
    return saveEntries(settings, [entry, ...(settings.memoryEntries ?? [])], today);
  },

  /** 用户确认后建议才会进入可注入上下文的 active 状态。 */
  async confirm(id: string, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    return saveEntries(settings, (settings.memoryEntries ?? []).map((entry) => entry.id === id ? { ...entry, status: "active", updatedAt: today.toISOString() } : entry), today);
  },

  /** 忽略、归档和删除都不会影响角色设置。 */
  async updateStatus(id: string, status: "archived" | "active", today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    return saveEntries(settings, (settings.memoryEntries ?? []).map((entry) => entry.id === id ? { ...entry, status, updatedAt: today.toISOString() } : entry), today);
  },

  async remove(id: string, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    return saveEntries(settings, (settings.memoryEntries ?? []).filter((entry) => entry.id !== id), today);
  },

  async updateSettings(memorySettings: PersonalMemorySettings, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    return personalizationSettingsRepository.save({ ...settings, memoryVersion: 1, memorySettings }, today);
  },

  async clear(today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    return saveEntries(settings, [], today);
  },

  /** 重置角色只替换人设字段，记忆和建议开关保持原样。 */
  async resetRoles(today = new Date()): Promise<PersonalizationSettings> {
    const current = await personalizationSettingsRepository.load(today);
    const defaults = createDefaultPersonalizationSettings(today);
    return personalizationSettingsRepository.save({
      ...defaults,
      memoryVersion: current.memoryVersion,
      memorySettings: current.memorySettings,
      memoryEntries: current.memoryEntries,
    }, today);
  },

  /** 完整个性化重置同时恢复默认角色、清空记忆并关闭建议。 */
  async resetAll(today = new Date()): Promise<PersonalizationSettings> {
    return personalizationSettingsRepository.save(createDefaultPersonalizationSettings(today), today);
  },
};
