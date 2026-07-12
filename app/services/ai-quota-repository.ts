import { toISODate } from "../lib/review-utils.ts";
import type { AiQuotaPluginConfig, AiQuotaSnapshot, ApiProvider } from "../types/review";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto-service.ts";
import { aiQuotaProviderPlugins, getAiQuotaPlugin } from "./ai-quota-plugins.ts";
import { emitAiActivity } from "./ai-activity-events.ts";

export type SaveQuotaPluginInput = {
  id: ApiProvider | "manual";
  enabled: boolean;
  apiKey?: string;
  monthlyBudget?: number;
  manualRemaining?: number;
  today: Date;
};

const CONFIG_STORAGE_KEY = "review-workspace:ai-quota-plugin-configs";
const SNAPSHOT_STORAGE_KEY = "review-workspace:ai-quota-snapshots";
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
  return readActiveQuotaRecords<AiQuotaPluginConfig>(CONFIG_STORAGE_KEY).find((config) => config.id === id);
}

async function refreshViaRoute(config: AiQuotaPluginConfig): Promise<AiQuotaSnapshot> {
  const apiKey = config.encryptedKey && config.iv ? await decryptSecret(config.encryptedKey, config.iv) : "";
  emitAiActivity({ phase: "started", label: `${config.label} 额度插件`, text: "正在查询厂商官方费用接口" });
  const response = await fetch("/api/ai/quota", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: config.id,
      apiKey,
      monthlyBudget: config.monthlyBudget,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    emitAiActivity({ phase: "error", label: `${config.label} 额度插件`, text: text || "额度插件刷新失败" });
    throw new Error(text || "额度插件刷新失败");
  }
  const snapshot = (await response.json()) as AiQuotaSnapshot;
  emitAiActivity({ phase: "done", label: `${config.label} 额度插件`, text: snapshot.message });
  return snapshot;
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
      configs: readActiveQuotaRecords<AiQuotaPluginConfig>(CONFIG_STORAGE_KEY),
      snapshots: readActiveQuotaRecords<AiQuotaSnapshot>(SNAPSHOT_STORAGE_KEY),
    };
  },

  async load(): Promise<{ configs: AiQuotaPluginConfig[]; snapshots: AiQuotaSnapshot[] }> {
    return this.loadSync();
  },

  async saveConfig(input: SaveQuotaPluginInput): Promise<AiQuotaPluginConfig> {
    const configs = readActiveQuotaRecords<AiQuotaPluginConfig>(CONFIG_STORAGE_KEY);
    const existing = configs.find((config) => config.id === input.id);
    const plugin = getAiQuotaPlugin(input.id);
    const providedSecret = input.apiKey?.trim() ?? "";
    const encrypted = providedSecret ? await encryptSecret(providedSecret) : existing?.encryptedKey && existing.iv ? { encryptedKey: existing.encryptedKey, iv: existing.iv } : undefined;
    const config: AiQuotaPluginConfig = {
      id: input.id,
      provider: plugin.provider,
      label: plugin.label,
      enabled: input.enabled,
      encryptedKey: encrypted?.encryptedKey,
      iv: encrypted?.iv,
      maskedKey: providedSecret ? maskSecret(providedSecret) : existing?.maskedKey,
      monthlyBudget: Number.isFinite(input.monthlyBudget) ? input.monthlyBudget : undefined,
      manualRemaining: Number.isFinite(input.manualRemaining) ? input.manualRemaining : undefined,
      currency: existing?.currency ?? "USD",
      updatedAt: toISODate(input.today),
    };
    writeJsonArray(CONFIG_STORAGE_KEY, [config, ...configs.filter((item) => item.id !== input.id)]);
    return config;
  },

  async refresh(id: ApiProvider | "manual", today = new Date()): Promise<AiQuotaSnapshot> {
    const config = await getConfig(id);
    const plugin = getAiQuotaPlugin(id);
    if (!config?.enabled) throw new Error("请先启用该额度插件");
    let snapshot: AiQuotaSnapshot;
    if (plugin.supportsOfficialRefresh) {
      snapshot = await refreshViaRoute(config);
    } else {
      snapshot = unsupportedSnapshot(config, plugin.describeUnsupported ?? "该厂商暂不支持官方实时额度查询。", today);
    }
    const snapshots = readActiveQuotaRecords<AiQuotaSnapshot>(SNAPSHOT_STORAGE_KEY);
    writeJsonArray(SNAPSHOT_STORAGE_KEY, [snapshot, ...snapshots.filter((item) => item.id !== snapshot.id)]);
    return snapshot;
  },

  plugins: aiQuotaProviderPlugins,
};
