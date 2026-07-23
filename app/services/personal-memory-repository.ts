/**
 * 个性化记忆使用现有 personalization 单例持久化，不新增表或 Dexie 版本。
 * 自动提取只保存短事实与修订元数据，不保存完整对话、附件正文或厂商响应。
 */
import type { PersonalMemoryEntry, PersonalMemoryKind, PersonalMemoryRevision, PersonalMemoryScope, PersonalMemorySettings } from "../types/domains/personal-memory.ts";
import type { PersonalizationSettings } from "../types/domains/personalization.ts";
import { createDefaultPersonalizationSettings, personalizationSettingsRepository } from "./personalization-settings-repository.ts";

type AddMemoryInput = {
  kind: PersonalMemoryKind;
  scope: PersonalMemoryScope;
  title: string;
  content: string;
  moduleId?: string;
  sourceConversationId?: string;
};

export type AutomaticMemoryCandidate = AddMemoryInput & {
  canonicalKey?: string;
  confidence: number;
  sensitivity?: "normal" | "sensitive";
  sourceMessageIds?: string[];
};

export type AutomaticMemoryApplyResult = {
  settings: PersonalizationSettings;
  active: number;
  pending: number;
  discarded: number;
  lastRevisionId?: string;
};

const SECRET_PATTERN = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|密码|口令|密钥|token)\s*[:=：]\s*\S+|\b(?:sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{12,}|\d{17}[0-9Xx])\b/i;

/** 明确秘密永不进入记忆候选。 */
export function containsMemorySecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/** scope + canonicalKey 是稳定去重边界。 */
export function canonicalMemoryKey(input: Pick<AutomaticMemoryCandidate, "kind" | "scope" | "canonicalKey" | "title" | "content">): string {
  const raw = input.canonicalKey?.trim() || `${input.kind}:${input.title}:${input.content}`;
  return `${input.scope}:${raw.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 140)}`;
}

function revision(memoryId: string, action: PersonalMemoryRevision["action"], today: Date, previous?: PersonalMemoryRevision["previous"]): PersonalMemoryRevision {
  return { id: crypto.randomUUID(), memoryId, action, previous, createdAt: today.toISOString() };
}

/** 自动条目达到上限时优先保留手动记忆，不静默删除用户维护的内容。 */
function enforceEntryLimit(entries: PersonalMemoryEntry[], maxEntries: number): PersonalMemoryEntry[] {
  if (entries.length <= maxEntries) return entries;
  const manual = entries.filter((entry) => entry.source === "manual");
  if (manual.length >= maxEntries) return manual;
  const automatic = entries.filter((entry) => entry.source !== "manual")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  return [...manual, ...automatic.slice(0, maxEntries - manual.length)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

async function saveState(settings: PersonalizationSettings, entries: PersonalMemoryEntry[], revisions: PersonalMemoryRevision[], today = new Date()): Promise<PersonalizationSettings> {
  const maxEntries = Math.max(1, Math.min(100, settings.memorySettings?.maxEntries ?? 100));
  return personalizationSettingsRepository.save({
    ...settings,
    memoryVersion: 2,
    memoryEntries: enforceEntryLimit(entries, maxEntries),
    memoryRevisions: revisions.slice(0, 100),
  }, today);
}

function createEntry(
  input: AddMemoryInput,
  source: PersonalMemoryEntry["source"],
  status: PersonalMemoryEntry["status"],
  today: Date,
  metadata: Partial<PersonalMemoryEntry> = {},
): PersonalMemoryEntry {
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
    sensitivity: "normal",
    ...metadata,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const personalMemoryRepository = {
  /** 手动记忆直接生效。 */
  async addManual(input: AddMemoryInput, today = new Date()): Promise<PersonalizationSettings> {
    if (!input.title.trim() || !input.content.trim()) throw new Error("请填写记忆标题和内容");
    const settings = await personalizationSettingsRepository.load(today);
    const entry = createEntry(input, "manual", "active", today);
    const nextRevision = revision(entry.id, "add", today);
    return saveState(settings, [entry, ...(settings.memoryEntries ?? [])], [nextRevision, ...(settings.memoryRevisions ?? [])], today);
  },

  async update(id: string, input: AddMemoryInput, today = new Date()): Promise<PersonalizationSettings> {
    if (!input.title.trim() || !input.content.trim()) throw new Error("请填写记忆标题和内容");
    const settings = await personalizationSettingsRepository.load(today);
    const existing = (settings.memoryEntries ?? []).find((entry) => entry.id === id);
    if (!existing) throw new Error("记忆不存在，请刷新后重试");
    const nextRevision = revision(id, "update", today, { title: existing.title, content: existing.content, status: existing.status });
    const entries = (settings.memoryEntries ?? []).map((entry) => entry.id === id ? {
      ...entry,
      kind: input.kind,
      scope: input.scope,
      title: input.title.trim().slice(0, 80),
      content: input.content.trim().slice(0, 2000),
      moduleId: input.scope === "module" ? input.moduleId?.trim() || undefined : undefined,
      sourceConversationId: input.scope === "conversation" ? input.sourceConversationId?.trim() || undefined : undefined,
      updatedAt: today.toISOString(),
    } : entry);
    return saveState(settings, entries, [nextRevision, ...(settings.memoryRevisions ?? [])], today);
  },

  /** 兼容旧建议入口：所有建议仍进入待处理。 */
  async addSuggested(input: AddMemoryInput, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    if (!(settings.memorySettings?.autoMemoryEnabled ?? settings.memorySettings?.suggestionsEnabled)) throw new Error("自动记忆当前已关闭");
    if (!input.title.trim() || !input.content.trim()) throw new Error("记忆建议缺少标题或内容");
    const entry = createEntry(input, "suggested", "pending", today);
    return saveState(settings, [entry, ...(settings.memoryEntries ?? [])], [revision(entry.id, "add", today), ...(settings.memoryRevisions ?? [])], today);
  },

  async confirm(id: string, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    const existing = (settings.memoryEntries ?? []).find((entry) => entry.id === id);
    if (!existing) return settings;
    const entries = (settings.memoryEntries ?? []).map((entry) => entry.id === id ? { ...entry, status: "active" as const, updatedAt: today.toISOString() } : entry);
    return saveState(settings, entries, [revision(id, "restore", today, { title: existing.title, content: existing.content, status: existing.status }), ...(settings.memoryRevisions ?? [])], today);
  },

  async updateStatus(id: string, status: "archived" | "active", today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    const existing = (settings.memoryEntries ?? []).find((entry) => entry.id === id);
    if (!existing) return settings;
    const action = status === "archived" ? "archive" : "restore";
    const entries = (settings.memoryEntries ?? []).map((entry) => entry.id === id ? { ...entry, status, updatedAt: today.toISOString() } : entry);
    return saveState(settings, entries, [revision(id, action, today, { title: existing.title, content: existing.content, status: existing.status }), ...(settings.memoryRevisions ?? [])], today);
  },

  async remove(id: string, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    return saveState(settings, (settings.memoryEntries ?? []).filter((entry) => entry.id !== id), settings.memoryRevisions ?? [], today);
  },

  async updateSettings(memorySettings: PersonalMemorySettings, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    const enabled = memorySettings.autoMemoryEnabled ?? memorySettings.suggestionsEnabled;
    return personalizationSettingsRepository.save({ ...settings, memoryVersion: 2, memorySettings: { ...memorySettings, suggestionsEnabled: enabled, autoMemoryEnabled: enabled } }, today);
  },

  /** 应用自动候选：高置信稳定事实生效，学习、敏感或冲突内容进入待处理。 */
  async applyAutomaticCandidates(candidates: AutomaticMemoryCandidate[], today = new Date()): Promise<AutomaticMemoryApplyResult> {
    const settings = await personalizationSettingsRepository.load(today);
    if (!(settings.memorySettings?.autoMemoryEnabled ?? settings.memorySettings?.suggestionsEnabled)) return { settings, active: 0, pending: 0, discarded: candidates.length };
    let entries = [...(settings.memoryEntries ?? [])];
    let revisions = [...(settings.memoryRevisions ?? [])];
    let active = 0;
    let pending = 0;
    let discarded = 0;
    let lastRevisionId: string | undefined;

    for (const candidate of candidates) {
      if (!candidate.title.trim() || !candidate.content.trim() || containsMemorySecret(`${candidate.title}\n${candidate.content}`)) { discarded += 1; continue; }
      const key = canonicalMemoryKey(candidate);
      const existing = entries.find((entry) => entry.canonicalKey === key && entry.status !== "archived");
      if (existing?.content.trim() === candidate.content.trim()) { discarded += 1; continue; }
      const sensitivity = candidate.sensitivity === "sensitive" ? "sensitive" : "normal";
      const canActivate = !existing && candidate.confidence >= 0.9 && candidate.kind !== "study" && sensitivity === "normal";
      const entry = createEntry(candidate, canActivate ? "auto" : "suggested", canActivate ? "active" : "pending", today, {
        canonicalKey: key,
        confidence: Math.max(0, Math.min(1, candidate.confidence)),
        sensitivity,
        supersedesId: existing?.id,
        sourceMessageIds: candidate.sourceMessageIds?.slice(0, 12),
      });
      const nextRevision = revision(entry.id, "add", today);
      entries = [entry, ...entries];
      revisions = [nextRevision, ...revisions];
      lastRevisionId = nextRevision.id;
      if (canActivate) active += 1; else pending += 1;
    }
    const saved = await saveState(settings, entries, revisions, today);
    return { settings: saved, active, pending, discarded, lastRevisionId };
  },

  /** 30 秒内撤销最近自动新增；调用方负责展示时间窗。 */
  async undoRevision(revisionId: string, today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    const target = (settings.memoryRevisions ?? []).find((item) => item.id === revisionId);
    if (!target || today.getTime() - Date.parse(target.createdAt) > 30_000) throw new Error("撤销时间已超过 30 秒");
    let entries = [...(settings.memoryEntries ?? [])];
    if (target.action === "add") entries = entries.filter((entry) => entry.id !== target.memoryId || entry.source === "manual");
    else if (target.previous) entries = entries.map((entry) => entry.id === target.memoryId ? { ...entry, ...target.previous, updatedAt: today.toISOString() } : entry);
    return saveState(settings, entries, (settings.memoryRevisions ?? []).filter((item) => item.id !== revisionId), today);
  },

  async clear(today = new Date()): Promise<PersonalizationSettings> {
    const settings = await personalizationSettingsRepository.load(today);
    return saveState(settings, [], [], today);
  },

  async resetRoles(today = new Date()): Promise<PersonalizationSettings> {
    const current = await personalizationSettingsRepository.load(today);
    const defaults = createDefaultPersonalizationSettings(today);
    return personalizationSettingsRepository.save({ ...defaults, memoryVersion: 2, memorySettings: current.memorySettings, memoryEntries: current.memoryEntries, memoryRevisions: current.memoryRevisions }, today);
  },

  async resetAll(today = new Date()): Promise<PersonalizationSettings> {
    return personalizationSettingsRepository.save(createDefaultPersonalizationSettings(today), today);
  },
};
