import type { AiQuotaCredentialKey, AiQuotaFetchStrategy, AiQuotaProviderDescriptor, AiQuotaSnapshot, AiQuotaSourceMode, ApiProvider } from "../types/review";

export type AiQuotaCredentialField = {
  key: AiQuotaCredentialKey;
  label: string;
  secret: boolean;
  required: boolean;
};

export type AiQuotaRefreshInput = {
  apiKey?: string;
  monthlyBudget?: number;
  manualRemaining?: number;
};

export type AiQuotaProviderPlugin = {
  id: ApiProvider | "manual";
  provider: ApiProvider | "custom";
  label: string;
  descriptor: AiQuotaProviderDescriptor;
  documentationUrl: string;
  dashboardUrl?: string;
  statusUrl?: string;
  sourceModes: AiQuotaSourceMode[];
  fetchStrategies: AiQuotaFetchStrategy[];
  supportsOfficialRefresh: boolean;
  refreshStrategy: "official_api" | "manual" | "unsupported";
  supportsUsageHistory: boolean;
  supportsResetWindow: boolean;
  credentialFields: AiQuotaCredentialField[];
  describeUnsupported?: string;
  unsupportedReason?: string;
};

function makeDescriptor(input: {
  id: ApiProvider | "manual";
  label: string;
  shortLabel: string;
  documentationUrl: string;
  dashboardUrl?: string;
  statusUrl?: string;
  sourceModes: AiQuotaSourceMode[];
  color: string;
  iconLabel: string;
  defaultEnabled?: boolean;
  refreshCadenceSeconds?: number;
}): AiQuotaProviderDescriptor {
  return {
    id: input.id,
    label: input.label,
    shortLabel: input.shortLabel,
    documentationUrl: input.documentationUrl,
    dashboardUrl: input.dashboardUrl,
    statusUrl: input.statusUrl,
    defaultEnabled: input.defaultEnabled ?? false,
    refreshCadenceSeconds: input.refreshCadenceSeconds ?? 300,
    sourceModes: input.sourceModes,
    branding: {
      color: input.color,
      iconLabel: input.iconLabel,
    },
  };
}

function makeStrategy(input: {
  id: string;
  kind: AiQuotaSourceMode;
  label: string;
  sourceLabel: string;
  unsupportedReason?: string;
  timeoutMs?: number;
}): AiQuotaFetchStrategy {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    sourceLabel: input.sourceLabel,
    timeoutMs: input.timeoutMs ?? 12_000,
    unsupportedReason: input.unsupportedReason,
  };
}

const unsupportedMessage = "该厂商额度插件已预留；未确认稳定官方账单 API 前，不抓取网页后台，也不伪造实时余额。";
const quotaDocumentationUrls: Partial<Record<ApiProvider, string>> = {
  deepseek: "https://api-docs.deepseek.com/zh-cn/api/get-user-balance/",
  google: "https://ai.google.dev/gemini-api/docs/billing",
  anthropic: "https://platform.claude.com/docs/en/manage-claude/usage-cost-api",
  xai: "https://docs.x.ai/developers/rest-api-reference/management/billing",
  minimax: "https://platform.minimax.io/docs/faq/about-account",
  zhipu: "https://docs.bigmodel.cn/cn/coding-plan/usage-notes",
};

export const aiQuotaProviderPlugins: AiQuotaProviderPlugin[] = [
  {
    id: "openai",
    provider: "openai",
    label: "OpenAI",
    documentationUrl: "https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/",
    dashboardUrl: "https://platform.openai.com/usage",
    statusUrl: "https://status.openai.com/",
    sourceModes: ["official_api", "manual"],
    descriptor: makeDescriptor({
      id: "openai",
      label: "OpenAI",
      shortLabel: "OpenAI",
      documentationUrl: "https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/",
      dashboardUrl: "https://platform.openai.com/usage",
      statusUrl: "https://status.openai.com/",
      sourceModes: ["official_api", "manual"],
      color: "#10a37f",
      iconLabel: "OA",
      defaultEnabled: true,
    }),
    fetchStrategies: [
      makeStrategy({
        id: "openai.admin-costs",
        kind: "official_api",
        label: "Admin Usage/Costs API",
        sourceLabel: "OpenAI Admin Costs API",
      }),
      makeStrategy({
        id: "openai.manual-budget",
        kind: "manual",
        label: "用户预算估算",
        sourceLabel: "本地预算",
      }),
    ],
    supportsOfficialRefresh: true,
    refreshStrategy: "official_api",
    supportsUsageHistory: true,
    supportsResetWindow: false,
    credentialFields: [{ key: "adminKey", label: "OpenAI Admin Key", secret: true, required: true }],
  },
  ...([
    ["deepseek", "DeepSeek", "https://platform.deepseek.com/usage", ""],
    ["google", "Google Gemini", "https://aistudio.google.com/usage", "https://status.cloud.google.com/"],
    ["anthropic", "Anthropic", "https://console.anthropic.com/settings/usage", "https://status.anthropic.com/"],
    ["xai", "xAI", "https://console.x.ai/", "https://status.x.ai/"],
    ["minimax", "MiniMax", "https://platform.minimax.io/", ""],
    ["zhipu", "GLM / 智谱", "https://bigmodel.cn/usercenter/proj-mgmt/apikeys", ""],
  ] as const).map(([provider, label, dashboardUrl, statusUrl]) => ({
    id: provider,
    provider,
    label,
    documentationUrl: quotaDocumentationUrls[provider] ?? "",
    dashboardUrl,
    statusUrl: statusUrl || undefined,
    sourceModes: (["deepseek", "anthropic", "xai"] as string[]).includes(provider) ? ["official_api", "manual"] as AiQuotaSourceMode[] : ["unsupported", "manual"] as AiQuotaSourceMode[],
    descriptor: makeDescriptor({
      id: provider,
      label,
      shortLabel: label.split(" ")[0],
      documentationUrl: quotaDocumentationUrls[provider] ?? "",
      dashboardUrl,
      statusUrl: statusUrl || undefined,
      sourceModes: (["deepseek", "anthropic", "xai"] as string[]).includes(provider) ? ["official_api", "manual"] : ["unsupported", "manual"],
      color: "#64748b",
      iconLabel: label.slice(0, 2).toUpperCase(),
    }),
    fetchStrategies: [
      makeStrategy({
        id: `${provider}.unsupported`,
        kind: "unsupported",
        label: "官方实时查询未启用",
        sourceLabel: "unsupported",
        unsupportedReason: unsupportedMessage,
      }),
      makeStrategy({
        id: `${provider}.manual`,
        kind: "manual",
        label: "手动额度",
        sourceLabel: "手动维护",
      }),
    ],
    supportsOfficialRefresh: (["deepseek", "anthropic", "xai"] as string[]).includes(provider),
    refreshStrategy: (["deepseek", "anthropic", "xai"] as string[]).includes(provider) ? "official_api" as const : "unsupported" as const,
    supportsUsageHistory: provider === "anthropic" || provider === "xai",
    supportsResetWindow: false,
    credentialFields: provider === "deepseek"
      ? [{ key: "apiKey" as const, label: "DeepSeek API Key", secret: true, required: true }]
      : provider === "anthropic"
        ? [{ key: "adminKey" as const, label: "Anthropic Admin Key", secret: true, required: true }]
        : provider === "xai"
          ? [
              { key: "managementKey" as const, label: "xAI Management Key", secret: true, required: true },
              { key: "teamId" as const, label: "Team ID（无法自动推导时填写）", secret: false, required: false },
            ]
          : [],
    describeUnsupported: unsupportedMessage,
    unsupportedReason: unsupportedMessage,
  })),
  {
    id: "manual",
    provider: "custom",
    label: "自定义 / 手动额度",
    documentationUrl: "",
    dashboardUrl: "",
    sourceModes: ["manual"],
    descriptor: makeDescriptor({
      id: "manual",
      label: "自定义 / 手动额度",
      shortLabel: "手动",
      documentationUrl: "",
      sourceModes: ["manual"],
      color: "#0f766e",
      iconLabel: "手",
    }),
    fetchStrategies: [
      makeStrategy({
        id: "manual.local",
        kind: "manual",
        label: "手动维护",
        sourceLabel: "手动维护",
      }),
    ],
    supportsOfficialRefresh: false,
    refreshStrategy: "manual",
    supportsUsageHistory: false,
    supportsResetWindow: true,
    credentialFields: [],
    describeUnsupported: "自定义兼容服务不声明官方实时余额；可手动维护预算和剩余额度。",
    unsupportedReason: "自定义兼容服务不声明官方实时余额；可手动维护预算和剩余额度。",
  },
];

export function getAiQuotaPlugin(id: ApiProvider | "manual"): AiQuotaProviderPlugin {
  return aiQuotaProviderPlugins.find((plugin) => plugin.id === id) ?? aiQuotaProviderPlugins.at(-1)!;
}

function sumAmounts(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((total, item) => total + sumAmounts(item), 0);
  const record = value as Record<string, unknown>;
  const amount = record.amount;
  if (amount && typeof amount === "object") {
    const amountRecord = amount as Record<string, unknown>;
    const numeric = Number(amountRecord.value ?? amountRecord.amount);
    if (Number.isFinite(numeric)) return numeric;
  }
  return Object.values(record).reduce<number>((total, item) => total + sumAmounts(item), 0);
}

export function normalizeOpenAiCostsSnapshot(payload: unknown, input: { monthlyBudget?: number; refreshedAt: string }): AiQuotaSnapshot {
  const costPayload = payload && typeof payload === "object" && "costs" in payload ? (payload as { costs: unknown }).costs : payload;
  const usedAmount = sumAmounts(costPayload);
  const remainingAmount = Number.isFinite(input.monthlyBudget) && input.monthlyBudget !== undefined
    ? Math.max(0, input.monthlyBudget - usedAmount)
    : undefined;
  const usageRatio = Number.isFinite(input.monthlyBudget) && input.monthlyBudget
    ? Math.min(1, usedAmount / input.monthlyBudget)
    : undefined;
  return {
    id: "openai",
    provider: "openai",
    label: "OpenAI",
    status: "ready",
    source: "official",
    usedAmount,
    remainingAmount,
    currency: "USD",
    periodLabel: "本月",
    sourceLabel: "OpenAI Admin Costs API",
    usageRatio,
    officialRemainingAvailable: false,
    message: remainingAmount === undefined
      ? "已读取官方费用数据；OpenAI Admin Costs API 未返回账户剩余额度字段。"
      : "已读取官方费用数据；剩余额度按你配置的月预算估算。",
    documentationUrl: getAiQuotaPlugin("openai").documentationUrl,
    refreshedAt: input.refreshedAt,
  };
}
