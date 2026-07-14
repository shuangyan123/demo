import { reviewDb } from "../db/review-db.ts";
import { toISODate } from "../lib/review-utils.ts";
import type { CustomPersonaViewMode, PersonaCustomization, PersonaDisplayMode, PersonaModule, PersonaProfile, PersonalMemoryEntry, PersonalMemorySettings, PersonalizationSettings, VoiceProfile } from "../types/review";

type LegacyVoiceProfile = Partial<VoiceProfile> & {
  mode?: "system" | "cloud";
  language?: string;
  localVoiceUri?: string;
  pitch?: number;
  fallbackToSystem?: boolean;
  cloudConnectionId?: string;
  cloudModel?: string;
  cloudVoiceId?: string;
  cloudStyle?: string;
};

type LegacyPersonalizationSettings = Omit<Partial<PersonalizationSettings>, "personaDisplayMode"> & {
  personaDisplayMode?: PersonaDisplayMode | "basic" | "flashcard";
  personaCardRatio?: "3:4" | "1:1" | string;
  voice?: LegacyVoiceProfile;
  personaVoices?: Record<string, LegacyVoiceProfile>;
  personaAvatarDataUrls?: Record<string, string>;
};

export const PERSONA_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PERSONA_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const DEFAULT_PERSONAL_MEMORY_SETTINGS: PersonalMemorySettings = {
  suggestionsEnabled: false,
  maxEntries: 100,
  contextCharacterLimit: 1500,
};

export const BUILT_IN_PERSONA_AVATARS: Record<string, string> = {
  "patient-teacher": "/personas/patient-teacher-avatar.webp",
  "strict-coach": "/personas/strict-coach-avatar.webp",
  "socratic-teacher": "/personas/socratic-teacher-avatar.webp",
  "concise-analyst": "/personas/concise-analyst-avatar.webp",
};

export const BUILT_IN_PERSONAS: PersonaProfile[] = [
  {
    id: "patient-teacher",
    name: "耐心讲师",
    role: "循序渐进的学习辅导老师",
    teachingStyle: "先确认学生卡点，再用简洁例子逐步解释",
    questioningStyle: "一次只追问一个关键问题",
    strictness: "gentle",
    verbosity: "balanced",
    customInstructions: "避免直接给出未经解释的结论。",
    builtIn: true,
  },
  {
    id: "strict-coach",
    name: "严格教练",
    role: "重视证据、结构和时间控制的训练教练",
    teachingStyle: "明确指出漏洞并要求给出可验证的修正",
    questioningStyle: "连续追问论证依据和边界条件",
    strictness: "strict",
    verbosity: "concise",
    customInstructions: "评价要具体，不使用空泛鼓励。",
    builtIn: true,
  },
  {
    id: "socratic-teacher",
    name: "苏格拉底式老师",
    role: "通过问题帮助学生自己推出结论的老师",
    teachingStyle: "优先提问和搭建推理台阶，必要时才补充讲解",
    questioningStyle: "从定义、证据、反例和迁移场景逐层追问",
    strictness: "balanced",
    verbosity: "balanced",
    customInstructions: "每轮最多提出两个问题。",
    builtIn: true,
  },
  {
    id: "concise-analyst",
    name: "简洁分析师",
    role: "擅长压缩信息和提炼框架的分析师",
    teachingStyle: "先给结论和框架，再补充必要依据",
    questioningStyle: "只询问影响结论的缺失信息",
    strictness: "balanced",
    verbosity: "concise",
    customInstructions: "避免重复和过长铺垫。",
    builtIn: true,
  },
];

// 把旧版本机/云端语音字段归一化为连接驱动配置；浏览器音色与回退字段不会进入业务状态。
export function normalizeVoiceProfile(input?: LegacyVoiceProfile): VoiceProfile {
  return {
    rate: Number.isFinite(input?.rate) ? Number(input?.rate) : 0.95,
    volume: Number.isFinite(input?.volume) ? Number(input?.volume) : 1,
    model: input?.model?.trim() || input?.cloudModel?.trim() || "",
    voiceId: input?.voiceId?.trim() || input?.cloudVoiceId?.trim() || "",
    style: input?.style?.trim() || input?.cloudStyle?.trim() || "",
  };
}

// 创建个性化默认值；未配置默认语音连接时保持静音，不选择任何浏览器系统音色。
export function createDefaultPersonalizationSettings(today = new Date()): PersonalizationSettings {
  return {
    id: "default",
    personaDisplayMode: "default",
    customPersonaViewMode: "flashcard",
    defaultPersonaId: BUILT_IN_PERSONAS[0].id,
    modulePersonaIds: {},
    customPersonas: [],
    personaCustomizations: {},
    memoryVersion: 1,
    memorySettings: { ...DEFAULT_PERSONAL_MEMORY_SETTINGS },
    memoryEntries: [],
    updatedAt: toISODate(today),
  };
}

/** 归一化记忆字段并限制条数，避免旧数据或导入内容绕过产品边界。 */
function normalizeMemoryEntries(input: PersonalMemoryEntry[] | undefined): PersonalMemoryEntry[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !entry.id || !entry.title?.trim() || !entry.content?.trim()) return [];
    if (!["profile", "preference", "goal", "study"].includes(entry.kind)) return [];
    if (!["global", "module", "conversation"].includes(entry.scope)) return [];
    if (!["manual", "suggested"].includes(entry.source) || !["pending", "active", "archived"].includes(entry.status)) return [];
    return [{
      ...entry,
      title: entry.title.trim().slice(0, 80),
      content: entry.content.trim().slice(0, 2000),
      moduleId: entry.scope === "module" ? entry.moduleId?.trim() || undefined : undefined,
      sourceConversationId: entry.scope === "conversation" ? entry.sourceConversationId?.trim() || undefined : undefined,
    }];
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)).slice(0, 100);
}

/** 缺少字段的旧配置默认关闭建议，并恢复固定的安全上限。 */
function normalizeMemorySettings(input: PersonalMemorySettings | undefined): PersonalMemorySettings {
  return {
    suggestionsEnabled: input?.suggestionsEnabled === true,
    maxEntries: Math.max(1, Math.min(100, Number(input?.maxEntries) || DEFAULT_PERSONAL_MEMORY_SETTINGS.maxEntries)),
    contextCharacterLimit: Math.max(200, Math.min(1500, Number(input?.contextCharacterLimit) || DEFAULT_PERSONAL_MEMORY_SETTINGS.contextCharacterLimit)),
  };
}

// 把旧版展示模式映射为“默认 / 定制”，并拒绝意外字符串进入界面状态。
function normalizeDisplayMode(value: LegacyPersonalizationSettings["personaDisplayMode"]): PersonaDisplayMode {
  if (value === "custom" || value === "flashcard") return "custom";
  return "default";
}

/** 未保存或异常的定制视图统一回到闪卡，保证旧数据无需升级表版本。 */
function normalizeCustomPersonaViewMode(value: CustomPersonaViewMode | undefined): CustomPersonaViewMode {
  return value === "avatar" ? "avatar" : "flashcard";
}

// 归一化每个人设的覆盖字段，并把旧版头像、音色字典合并到同一份定制记录。
function normalizePersonaCustomizations(input: LegacyPersonalizationSettings): Record<string, PersonaCustomization> {
  const result: Record<string, PersonaCustomization> = {};
  const ids = new Set([
    ...Object.keys(input.personaCustomizations ?? {}),
    ...Object.keys(input.personaVoices ?? {}),
    ...Object.keys(input.personaAvatarDataUrls ?? {}),
  ]);
  for (const id of ids) {
    const customization = input.personaCustomizations?.[id] ?? {};
    const imageDataUrl = customization.imageDataUrl ?? input.personaAvatarDataUrls?.[id];
    const voice = customization.voice ?? input.personaVoices?.[id];
    result[id] = {
      ...customization,
      imageDataUrl: imageDataUrl?.trim() || undefined,
      voice: voice ? normalizeVoiceProfile(voice) : undefined,
    };
  }

  // 旧全局音色只迁移一次：复制为每个人设的独立配置，保存后不再保留全局字段。
  const legacyGlobalVoice = input.voice ? normalizeVoiceProfile(input.voice) : undefined;
  if (legacyGlobalVoice?.voiceId) {
    const personaIds = [
      ...BUILT_IN_PERSONAS.map((persona) => persona.id),
      ...(Array.isArray(input.customPersonas) ? input.customPersonas.map((persona) => persona.id) : []),
    ];
    for (const id of personaIds) {
      result[id] = {
        ...result[id],
        voice: result[id]?.voice ?? { ...legacyGlobalVoice },
      };
    }
  }
  return result;
}

// 归一化完整人设配置，供读取、保存和旧数据迁移共同使用。
export function normalizePersonalizationSettings(input?: LegacyPersonalizationSettings | null, today = new Date()): PersonalizationSettings {
  const defaults = createDefaultPersonalizationSettings(today);
  if (!input) return defaults;
  return {
    ...defaults,
    id: "default",
    personaDisplayMode: normalizeDisplayMode(input.personaDisplayMode),
    customPersonaViewMode: normalizeCustomPersonaViewMode(input.customPersonaViewMode),
    defaultPersonaId: input.defaultPersonaId ?? defaults.defaultPersonaId,
    modulePersonaIds: input.modulePersonaIds ?? {},
    customPersonas: Array.isArray(input.customPersonas) ? input.customPersonas : [],
    personaCustomizations: normalizePersonaCustomizations(input),
    memoryVersion: 1,
    memorySettings: normalizeMemorySettings(input.memorySettings),
    memoryEntries: normalizeMemoryEntries(input.memoryEntries),
    updatedAt: input.updatedAt ?? defaults.updatedAt,
  };
}

function hasLegacyPersonalizationFields(input: LegacyPersonalizationSettings): boolean {
  return ["voice", "personaCardRatio", "personaVoices", "personaAvatarDataUrls"].some((key) => Object.prototype.hasOwnProperty.call(input, key))
    || input.memoryVersion !== 1
    || !input.memorySettings
    || !Array.isArray(input.memoryEntries);
}

export const personalizationSettingsRepository = {
  // 读取个性化设置并合并新增默认字段，兼容后续小版本扩展。
  async load(today = new Date()): Promise<PersonalizationSettings> {
    const saved = await reviewDb.personalizationSettings.get("default");
    const legacy = saved as LegacyPersonalizationSettings | undefined;
    const normalized = normalizePersonalizationSettings(legacy, today);
    if (legacy && hasLegacyPersonalizationFields(legacy)) await reviewDb.personalizationSettings.put(normalized);
    return normalized;
  },

  // 保存个性化设置；这里只持久化文本配置和音色标识，不存音频或声纹。
  async save(settings: PersonalizationSettings, today = new Date()): Promise<PersonalizationSettings> {
    const saved = normalizePersonalizationSettings({ ...settings, updatedAt: toISODate(today) }, today);
    await reviewDb.personalizationSettings.put(saved);
    return saved;
  },
};

// 按模块解析人设，模块未覆盖时回退到全局默认人设。
export function resolvePersona(settings: PersonalizationSettings, module: PersonaModule): PersonaProfile {
  const selectedId = settings.modulePersonaIds[module] ?? settings.defaultPersonaId;
  return resolvePersonaById(settings, selectedId);
}

// 按 ID 合并不可变基础定义与用户覆盖，供闪卡编辑和模块解析共同复用。
export function resolvePersonaById(settings: PersonalizationSettings, personaId: string): PersonaProfile {
  const personas = [...BUILT_IN_PERSONAS, ...settings.customPersonas];
  const basePersona = personas.find((persona) => persona.id === personaId) ?? BUILT_IN_PERSONAS[0];
  const customization = settings.personaCustomizations[basePersona.id];
  if (!customization) return basePersona;
  return {
    ...basePersona,
    name: customization.name ?? basePersona.name,
    role: customization.role ?? basePersona.role,
    teachingStyle: customization.teachingStyle ?? basePersona.teachingStyle,
    questioningStyle: customization.questioningStyle ?? basePersona.questioningStyle,
    strictness: customization.strictness ?? basePersona.strictness,
    verbosity: customization.verbosity ?? basePersona.verbosity,
    customInstructions: customization.customInstructions ?? basePersona.customInstructions,
  };
}

// 解析人设图片：用户上传优先，内置人设没有覆盖时使用统一真人教师头像。
export function resolvePersonaImage(settings: PersonalizationSettings, personaId: string): string | undefined {
  return settings.personaCustomizations[personaId]?.imageDataUrl || BUILT_IN_PERSONA_AVATARS[personaId];
}

// 新建卡先停留在内存草稿中，选图成功后再加入 customPersonas 持久化列表。
export function createCustomPersonaDraft(id: string): PersonaProfile {
  return {
    id,
    name: "未命名角色",
    role: "自定义学习助手",
    teachingStyle: "根据学生反馈调整讲解层次",
    questioningStyle: "围绕关键卡点逐步追问",
    strictness: "balanced",
    verbosity: "balanced",
    customInstructions: "",
    builtIn: false,
  };
}

// 只解析当前人设自己的音色；未配置时保持静音，不跨人设或回退全局配置。
export function resolvePersonaVoice(settings: PersonalizationSettings, module: PersonaModule): VoiceProfile | undefined {
  const persona = resolvePersona(settings, module);
  const dedicatedVoice = settings.personaCustomizations[persona.id]?.voice;
  return dedicatedVoice ? normalizeVoiceProfile(dedicatedVoice) : undefined;
}

// 返回头像文件的具体错误，组件和契约测试共享同一套限制。
export function getPersonaImageValidationError(file: { size: number; type: string }): string | undefined {
  if (!PERSONA_IMAGE_TYPES.includes(file.type as (typeof PERSONA_IMAGE_TYPES)[number])) return "仅支持 PNG、JPEG 或 WebP 图片";
  if (file.size > PERSONA_IMAGE_MAX_BYTES) return "原图不能超过 20MB";
  return undefined;
}

// 删除自定义人设时同步清理定制、默认选择和所有模块引用。
export function removeCustomPersona(settings: PersonalizationSettings, personaId: string): PersonalizationSettings {
  const personaCustomizations = { ...settings.personaCustomizations };
  delete personaCustomizations[personaId];
  return {
    ...settings,
    customPersonas: settings.customPersonas.filter((persona) => persona.id !== personaId),
    personaCustomizations,
    defaultPersonaId: settings.defaultPersonaId === personaId ? BUILT_IN_PERSONAS[0].id : settings.defaultPersonaId,
    modulePersonaIds: Object.fromEntries(Object.entries(settings.modulePersonaIds).filter(([, selectedId]) => selectedId !== personaId)),
  };
}

// 把人设转换为受控提示词片段，任务约束应始终放在人设片段之前。
export function buildPersonaPrompt(persona: PersonaProfile): string {
  return [
    `交流角色：${persona.role}`,
    `教学风格：${persona.teachingStyle}`,
    `追问方式：${persona.questioningStyle}`,
    `严格程度：${persona.strictness}`,
    `回答长度：${persona.verbosity}`,
    persona.customInstructions ? `补充要求：${persona.customInstructions}` : "",
  ].filter(Boolean).join("\n");
}
