import { reviewDb } from "../db/review-db.ts";
import { toISODate } from "../lib/review-utils.ts";
import type {
  AiConnectionDefaults,
  AiConnectionPurpose,
  AiConnectionSnapshot,
  AiCapability,
  ApiConnectionProfile,
  ApiProvider,
} from "../types/review";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto-service.ts";
import { getProviderContract } from "./provider-contracts.ts";
import { createProfileFromLegacySetting } from "./legacy-ai-settings-migration.ts";

export type SaveConnectionInput = {
  id?: string;
  label: string;
  provider: ApiProvider;
  capabilities?: AiCapability[];
  baseUrl: string;
  model: string;
  apiKey?: string;
  providerOptions?: Record<string, string>;
  today: Date;
};

// 创建尚未分配任何连接的默认能力映射。
function emptyDefaults(today: Date): AiConnectionDefaults {
  return { id: "default", updatedAt: toISODate(today) };
}

// 清理不存在或能力不匹配的默认连接，避免编辑连接能力后继续把错误档案注入业务模块。
function normalizeDefaults(
  profiles: ApiConnectionProfile[],
  input: AiConnectionDefaults,
  today: Date,
): { changed: boolean; defaults: AiConnectionDefaults } {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const defaults = { ...input };
  let changed = false;
  for (const purpose of ["text", "vision", "speech"] as const) {
    const key = `${purpose}ConnectionId` as const;
    const connectionId = defaults[key];
    if (connectionId && !profilesById.get(connectionId)?.capabilities.includes(purpose)) {
      defaults[key] = undefined;
      changed = true;
    }
  }
  if (changed) defaults.updatedAt = toISODate(today);
  return { changed, defaults };
}

// 把文本默认连接同步到旧表，供旧版本回退读取；新业务流程不得直接访问该表。
async function syncLegacyTextSetting(profile: ApiConnectionProfile | undefined, updatedAt: string): Promise<void> {
  if (!profile) {
    // 用户主动清空默认文本连接时同步删除旧记录，防止下一次启动把它重新迁回。
    await reviewDb.apiSettings.delete("default");
    return;
  }
  await reviewDb.apiSettings.put({
    id: "default",
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    encryptedKey: profile.encryptedKey,
    iv: profile.iv,
    maskedKey: profile.maskedKey,
    testStatus: profile.testStatus,
    testMessage: profile.testMessage,
    updatedAt,
  });
}

export const aiConnectionsRepository = {
  // 读取全部连接和能力默认值；若升级过程只留下旧表，则补做一次运行时兼容迁移。
  async loadSnapshot(today = new Date()): Promise<AiConnectionSnapshot> {
    const [savedProfiles, savedDefaults, legacySetting, personalizationSettings] = await Promise.all([
      reviewDb.apiConnectionProfiles.orderBy("updatedAt").reverse().toArray(),
      reviewDb.apiConnectionDefaults.get("default"),
      reviewDb.apiSettings.get("default"),
      reviewDb.personalizationSettings.get("default"),
    ]);
    let profiles = savedProfiles;
    let defaults = savedDefaults;
    if (!profiles.length && legacySetting) {
      const profile = createProfileFromLegacySetting(legacySetting);
      defaults = {
        id: "default",
        textConnectionId: profile.capabilities.includes("text") ? profile.id : undefined,
        visionConnectionId: profile.capabilities.includes("vision") ? profile.id : undefined,
        speechConnectionId: profile.capabilities.includes("speech") ? profile.id : undefined,
        updatedAt: legacySetting.updatedAt,
      };
      await reviewDb.transaction("rw", [reviewDb.apiConnectionProfiles, reviewDb.apiConnectionDefaults], async () => {
        await reviewDb.apiConnectionProfiles.put(profile);
        await reviewDb.apiConnectionDefaults.put(defaults!);
      });
      profiles = [profile];
    }
    const legacyVoice = (personalizationSettings as unknown as { voice?: Record<string, unknown> } | undefined)?.voice;
    const legacySpeechConnectionId = typeof legacyVoice?.cloudConnectionId === "string" ? legacyVoice.cloudConnectionId : undefined;
    const legacySpeechConnection = profiles.find(
      (profile) => profile.id === legacySpeechConnectionId && profile.capabilities.includes("speech"),
    );
    if (!defaults?.speechConnectionId && legacySpeechConnection) {
      // 旧个性化页曾单独保存语音连接；迁移一次后改由默认语音连接统一管理。
      defaults = {
        ...(defaults ?? emptyDefaults(today)),
        speechConnectionId: legacySpeechConnection.id,
        updatedAt: toISODate(today),
      };
      await reviewDb.transaction("rw", [reviewDb.apiConnectionDefaults], async () => {
        await reviewDb.apiConnectionDefaults.put(defaults!);
      });
    }
    const previousTextConnectionId = defaults?.textConnectionId;
    const normalized = normalizeDefaults(profiles, defaults ?? emptyDefaults(today), today);
    if (normalized.changed) {
      await reviewDb.apiConnectionDefaults.put(normalized.defaults);
      if (previousTextConnectionId !== normalized.defaults.textConnectionId) {
        const textProfile = profiles.find((profile) => profile.id === normalized.defaults.textConnectionId);
        await syncLegacyTextSetting(textProfile, normalized.defaults.updatedAt);
      }
    }
    // 这里只读取旧连接 ID；全局音色复制和旧字段清理统一由个性化 repository 一次性完成，避免并发加载时丢失迁移源。
    return { profiles, defaults: normalized.defaults };
  },

  // 新增或更新连接；未输入新 Key 时沿用原有密文，避免设置页回填明文。
  async saveProfile(input: SaveConnectionInput): Promise<ApiConnectionProfile> {
    const existing = input.id ? await reviewDb.apiConnectionProfiles.get(input.id) : undefined;
    const providedSecret = input.apiKey?.trim() ?? "";
    const existingSecret = existing && !providedSecret ? await decryptSecret(existing.encryptedKey, existing.iv) : "";
    if (input.provider !== "custom" && !providedSecret && !existingSecret) throw new Error("该厂商连接必须填写 API Key");
    // 自定义连接允许无鉴权，但仍加密空字符串以保持连接档案结构稳定，避免引入第二套密钥存储形态。
    const encrypted = providedSecret ? await encryptSecret(providedSecret) : existing ?? await encryptSecret("");
    const contract = getProviderContract(input.provider);
    const capabilities = (input.capabilities ?? existing?.capabilities ?? contract.capabilities).filter((capability) => contract.capabilities.includes(capability));
    if (!capabilities.length) throw new Error("请至少选择一项连接能力");
    const timestamp = toISODate(input.today);
    const profile: ApiConnectionProfile = {
      id: input.id ?? crypto.randomUUID(),
      label: input.label.trim() || contract.label,
      provider: input.provider,
      apiFormat: contract.apiFormat,
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      model: input.model.trim(),
      capabilities,
      encryptedKey: encrypted.encryptedKey,
      iv: encrypted.iv,
      maskedKey: providedSecret ? maskSecret(providedSecret) : existing?.maskedKey ?? (input.provider === "custom" ? "无鉴权" : "未配置"),
      providerOptions: input.providerOptions ?? existing?.providerOptions ?? {},
      testStatus: "idle",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.apiConnectionProfiles.put(profile);
    const snapshot = await this.loadSnapshot(input.today);
    if (!snapshot.defaults.textConnectionId && profile.capabilities.includes("text")) {
      await this.setDefault("text", profile.id, input.today);
    } else if (snapshot.defaults.textConnectionId === profile.id) {
      // 默认文本连接的地址、模型或密钥变化时同步刷新旧表，保证旧版本回退读取的是最新配置。
      await syncLegacyTextSetting(profile, timestamp);
    }
    return profile;
  },

  // 删除连接并清理引用它的默认能力；不影响其他连接或业务数据。
  async removeProfile(id: string, today = new Date()): Promise<void> {
    const defaults = (await reviewDb.apiConnectionDefaults.get("default")) ?? emptyDefaults(today);
    const nextDefaults: AiConnectionDefaults = {
      ...defaults,
      textConnectionId: defaults.textConnectionId === id ? undefined : defaults.textConnectionId,
      visionConnectionId: defaults.visionConnectionId === id ? undefined : defaults.visionConnectionId,
      speechConnectionId: defaults.speechConnectionId === id ? undefined : defaults.speechConnectionId,
      updatedAt: toISODate(today),
    };
    const clearsLegacyText = defaults.textConnectionId === id;
    await reviewDb.transaction("rw", [reviewDb.apiConnectionProfiles, reviewDb.apiConnectionDefaults, reviewDb.apiSettings], async () => {
      await reviewDb.apiConnectionProfiles.delete(id);
      await reviewDb.apiConnectionDefaults.put(nextDefaults);
      if (clearsLegacyText) await reviewDb.apiSettings.delete("default");
    });
  },

  // 为文本、视觉或语音能力指定默认连接，并验证连接确实声明了该能力。
  async setDefault(purpose: AiConnectionPurpose, connectionId: string | undefined, today = new Date()): Promise<AiConnectionDefaults> {
    const profile = connectionId ? await reviewDb.apiConnectionProfiles.get(connectionId) : undefined;
    if (connectionId && !profile?.capabilities.includes(purpose)) throw new Error(`该连接不支持${purpose}能力`);
    const current = (await reviewDb.apiConnectionDefaults.get("default")) ?? emptyDefaults(today);
    const key = `${purpose}ConnectionId` as const;
    const next = { ...current, [key]: connectionId, updatedAt: toISODate(today) };
    await reviewDb.apiConnectionDefaults.put(next);
    if (purpose === "text") await syncLegacyTextSetting(profile, next.updatedAt);
    return next;
  },

  // 仅在发起请求前解密指定连接的 Key，不把明文写回 React 状态或 IndexedDB。
  async resolveSecret(profile: ApiConnectionProfile): Promise<string> {
    return decryptSecret(profile.encryptedKey, profile.iv);
  },

  // 保存最近一次连接测试状态，供配置页展示。
  async updateTestStatus(id: string, status: "success" | "failed", message: string): Promise<void> {
    await reviewDb.apiConnectionProfiles.update(id, { testStatus: status, testMessage: message });
  },
};
