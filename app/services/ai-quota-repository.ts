import { toISODate } from "../lib/review-utils.ts";
import type { AiQuotaCredentialKey, AiQuotaPluginConfig, AiQuotaMetric, AiQuotaSnapshot, AiQuotaVerificationResult, ApiProvider } from "../types/review";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto-service.ts";
import { aiQuotaProviderPlugins, getAiQuotaPlugin } from "./ai-quota-plugins.ts";

export type SaveQuotaPluginInput = {
  id: ApiProvider | "manual";
  enabled: boolean;
  apiKey?: string;
  credentials?: Partial<Record<AiQuotaCredentialKey, string>>;
  monthlyBudget?: number;
  manualRemaining?: number;
  today: Date;
};

export const AI_QUOTA_CONFIG_STORAGE_KEY = "review-workspace:ai-quota-plugin-configs";
export const AI_QUOTA_SNAPSHOT_STORAGE_KEY = "review-workspace:ai-quota-snapshots";
const activeQuotaIds = new Set(aiQuotaProviderPlugins.map((plugin) => plugin.id));

function readJsonArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(key: string, value: T[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

/** 读取时清理已下线额度插件的孤立配置；不影响对应厂商的历史 AI 连接。 */
function readActiveQuotaRecords<T extends { id: string }>(key: string): T[] {
  const records = readJsonArray<T>(key);
  const active = records.filter((record) => activeQuotaIds.has(record.id as ApiProvider | "manual"));
  if (active.length !== records.length) writeJsonArray(key, active);
  return active;
}

async function getConfig(id: ApiProvider | "manual"): Promise<AiQuotaPluginConfig | undefined> {
  return readActiveQuotaRecords<AiQuotaPluginConfig>(AI_QUOTA_CONFIG_STORAGE_KEY).find((config) => config.id === id);
}

async function decryptCredentials(config: AiQuotaPluginConfig): Promise<Partial<Record<AiQuotaCredentialKey, string>>> {
  const credentials: Partial<Record<AiQuotaCredentialKey, string>> = { teamId: config.parameters?.teamId };
  for (const [key, encrypted] of Object.entries(config.encryptedCredentials ?? {})) {
    if (!encrypted) continue;
    credentials[key as AiQuotaCredentialKey] = await decryptSecret(encrypted.encryptedKey, encrypted.iv);
  }
  // 旧单密钥配置只在读取边界转换，不回写 Dexie 或复制到连接密钥。
  if (config.encryptedKey && config.iv && !Object.keys(config.encryptedCredentials ?? {}).length) {
    const legacy = await decryptSecret(config.encryptedKey, config.iv);
    credentials[config.id === "openai" || config.id === "anthropic" ? "adminKey" : "apiKey"] = legacy;
  }
  return credentials;
}

async function requestViaRoute(config: AiQuotaPluginConfig, action: "validate" | "refresh", signal?: AbortSignal): Promise<AiQuotaSnapshot | AiQuotaVerificationResult> {
  const credentials = await decryptCredentials(config);
  const timeoutMs = getAiQuotaPlugin(config.id).fetchStrategies.find((strategy) => strategy.kind === "official_api")?.timeoutMs ?? 12_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch("/api/ai/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      provider: config.id,
      credentials,
      monthlyBudget: config.monthlyBudget,
    }),
    signal: requestSignal,
  });
  const result = (await response.json()) as (AiQuotaSnapshot | AiQuotaVerificationResult) & { message?: string };
  if (!response.ok) {
    const message = result.message || "额度插件刷新失败";
    throw new Error(message);
  }
  return result;
}

function normalizeSnapshot(snapshot: AiQuotaSnapshot): AiQuotaSnapshot {
  if (snapshot.metrics?.length) return snapshot;
  const metrics: AiQuotaMetric[] = [];
  if (typeof snapshot.usedAmount === "number") metrics.push({ id: "used_cost", label: "已用费用", value: snapshot.usedAmount, unit: snapshot.currency ?? "USD", source: snapshot.source === "official" ? "official" : "manual" });
  if (typeof snapshot.remainingAmount === "number") metrics.push({ id: "remaining_balance", label: "剩余额度", value: snapshot.remainingAmount, unit: snapshot.currency ?? "USD", source: snapshot.officialRemainingAvailable ? "official" : snapshot.source === "manual" ? "manual" : "estimated" });
  return { ...snapshot, metrics };
}

function unsupportedSnapshot(config: AiQuotaPluginConfig, message: string, today = new Date()): AiQuotaSnapshot {
  const usedAmount = config.monthlyBudget !== undefined && config.manualRemaining !== undefined
    ? Math.max(0, config.monthlyBudget - config.manualRemaining)
    : undefined;
  const usageRatio = config.monthlyBudget ? Math.min(1, (usedAmount ?? 0) / config.monthlyBudget) : undefined;
  return {
    id: config.id,
    provider: config.provider,
    label: config.label,
    status: "unsupported",
    source: config.id === "manual" ? "manual" : "unavailable",
    usedAmount,
    remainingAmount: config.manualRemaining,
    currency: config.currency,
    periodLabel: config.id === "manual" ? "手动周期" : "官方未开放",
    sourceLabel: config.id === "manual" ? "手动维护" : "unsupported",
    usageRatio,
    officialRemainingAvailable: false,
    message,
    documentationUrl: getAiQuotaPlugin(config.id).documentationUrl,
    refreshedAt: toISODate(today),
  };
}

export const aiQuotaRepository = {
  loadSync(): { configs: AiQuotaPluginConfig[]; snapshots: AiQuotaSnapshot[] } {
    return {
      configs: readActiveQuotaRecords<AiQuotaPluginConfig>(AI_QUOTA_CONFIG_STORAGE_KEY),
      snapshots: readActiveQuotaRecords<AiQuotaSnapshot>(AI_QUOTA_SNAPSHOT_STORAGE_KEY).map(normalizeSnapshot),
    };
  },

  async load(): Promise<{ configs: AiQuotaPluginConfig[]; snapshots: AiQuotaSnapshot[] }> {
    return this.loadSync();
  },

  async saveConfig(input: SaveQuotaPluginInput): Promise<AiQuotaPluginConfig> {
    const configs = readActiveQuotaRecords<AiQuotaPluginConfig>(AI_QUOTA_CONFIG_STORAGE_KEY);
    const existing = configs.find((config) => config.id === input.id);
    const plugin = getAiQuotaPlugin(input.id);
    const submitted = { ...(input.credentials ?? {}) };
    if (input.apiKey && !Object.keys(submitted).length) submitted.apiKey = input.apiKey;
    const encryptedCredentials = { ...(existing?.encryptedCredentials ?? {}) };
    for (const key of ["apiKey", "adminKey", "managementKey"] as const) {
      const value = submitted[key]?.trim();
      if (!value) continue;
      const encrypted = await encryptSecret(value);
      encryptedCredentials[key] = { ...encrypted, maskedKey: maskSecret(value) };
    }
    const config: AiQuotaPluginConfig = {
      id: input.id,
      provider: plugin.provider,
      label: plugin.label,
      enabled: input.enabled,
      encryptedCredentials,
      parameters: { teamId: submitted.teamId?.trim() || existing?.parameters?.teamId },
      monthlyBudget: Number.isFinite(input.monthlyBudget) ? input.monthlyBudget : undefined,
      manualRemaining: Number.isFinite(input.manualRemaining) ? input.manualRemaining : undefined,
      currency: existing?.currency ?? "USD",
      updatedAt: toISODate(input.today),
    };
    writeJsonArray(AI_QUOTA_CONFIG_STORAGE_KEY, [config, ...configs.filter((item) => item.id !== input.id)]);
    return config;
  },

  async validate(id: ApiProvider | "manual", signal?: AbortSignal) {
    const config = await getConfig(id);
    if (!config?.enabled) throw new Error("请先保存并启用该额度来源");
    return requestViaRoute(config, "validate", signal) as Promise<AiQuotaVerificationResult>;
  },

  async refresh(id: ApiProvider | "manual", today = new Date(), signal?: AbortSignal): Promise<AiQuotaSnapshot> {
    const config = await getConfig(id);
    const plugin = getAiQuotaPlugin(id);
    if (!config?.enabled) throw new Error("请先启用该额度插件");
    let snapshot: AiQuotaSnapshot;
    if (plugin.supportsOfficialRefresh) {
      snapshot = await requestViaRoute(config, "refresh", signal) as AiQuotaSnapshot;
    } else {
      snapshot = unsupportedSnapshot(config, plugin.describeUnsupported ?? "该厂商暂不支持官方实时额度查询。", today);
    }
    const snapshots = readActiveQuotaRecords<AiQuotaSnapshot>(AI_QUOTA_SNAPSHOT_STORAGE_KEY);
    writeJsonArray(AI_QUOTA_SNAPSHOT_STORAGE_KEY, [snapshot, ...snapshots.filter((item) => item.id !== snapshot.id)]);
    return snapshot;
  },

  /** 判断必填凭据是否已安全保存，运行时不会把明文凭据暴露给 React。 */
  isConfigured(id: ApiProvider | "manual"): boolean {
    const config = readActiveQuotaRecords<AiQuotaPluginConfig>(AI_QUOTA_CONFIG_STORAGE_KEY).find((item) => item.id === id);
    if (!config) return false;
    const plugin = getAiQuotaPlugin(id);
    return plugin.credentialFields.filter((field) => field.required).every((field) => {
      if (field.key === "teamId") return Boolean(config.parameters?.teamId);
      if (config.encryptedCredentials?.[field.key]) return true;
      return Boolean(config.encryptedKey && config.iv);
    });
  },

  plugins: aiQuotaProviderPlugins,
};
