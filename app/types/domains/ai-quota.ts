import type { ApiProvider } from "./ai-provider";

/** 额度服务支持的只读动作。 */
export type AiQuotaAction = "validate" | "refresh";

/** 普通推理密钥与管理、账单凭据保持明确分离。 */
export type AiQuotaCredentialKey = "apiKey" | "adminKey" | "managementKey" | "teamId";

export type AiQuotaErrorCode =
  | "invalid_credential"
  | "insufficient_permission"
  | "unsupported_account"
  | "rate_limited"
  | "provider_unavailable"
  | "malformed_response";

/** 归一化额度指标，不持久化厂商原始响应。 */
export type AiQuotaMetric = {
  id: "used_cost" | "remaining_balance" | "spend_limit" | "token_usage";
  label: string;
  value: number;
  unit: string;
  source: "official" | "estimated" | "manual";
  periodStart?: string;
  periodEnd?: string;
};

export type AiQuotaVerificationResult = {
  valid: boolean;
  provider: ApiProvider;
  teamId?: string;
  error?: AiQuotaErrorCode;
  message: string;
};

export type AiQuotaAdapterInput = {
  provider: ApiProvider;
  credentials: Partial<Record<AiQuotaCredentialKey, string>>;
  period?: { start?: string; end?: string };
  monthlyBudget?: number;
  signal?: AbortSignal;
};

export interface AiQuotaProviderAdapter {
  validate(input: AiQuotaAdapterInput): Promise<AiQuotaVerificationResult>;
  refresh(input: AiQuotaAdapterInput): Promise<AiQuotaSnapshot>;
}

export type EncryptedQuotaCredential = {
  encryptedKey: string;
  iv: string;
  maskedKey: string;
};

/** 本地额度配置；旧单密钥字段仅用于读取兼容。 */
export type AiQuotaPluginConfig = {
  id: ApiProvider | "manual";
  provider: ApiProvider | "custom";
  label: string;
  enabled: boolean;
  encryptedCredentials?: Partial<Record<Exclude<AiQuotaCredentialKey, "teamId">, EncryptedQuotaCredential>>;
  parameters?: { teamId?: string };
  encryptedKey?: string;
  iv?: string;
  maskedKey?: string;
  monthlyBudget?: number;
  manualRemaining?: number;
  currency: string;
  updatedAt: string;
};

export type AiQuotaSourceMode = "official_api" | "manual" | "unsupported";

export type AiQuotaProviderDescriptor = {
  id: ApiProvider | "manual";
  label: string;
  shortLabel: string;
  documentationUrl: string;
  dashboardUrl?: string;
  statusUrl?: string;
  defaultEnabled: boolean;
  refreshCadenceSeconds: number;
  sourceModes: AiQuotaSourceMode[];
  branding: { color: string; iconLabel: string };
};

export type AiQuotaFetchStrategy = {
  id: string;
  kind: AiQuotaSourceMode;
  label: string;
  sourceLabel: string;
  timeoutMs: number;
  unsupportedReason?: string;
};

/** 新指标结构与旧金额字段并存一轮，repository 读取时负责互转。 */
export type AiQuotaSnapshot = {
  id: string;
  provider: ApiProvider | "custom";
  label: string;
  status: "ready" | "unsupported" | "error";
  source: "official" | "manual" | "unavailable";
  metrics?: AiQuotaMetric[];
  error?: AiQuotaErrorCode;
  usedAmount?: number;
  remainingAmount?: number;
  currency?: string;
  periodLabel?: string;
  resetAt?: string;
  sourceLabel?: string;
  usageRatio?: number;
  officialRemainingAvailable: boolean;
  message: string;
  documentationUrl?: string;
  refreshedAt: string;
  /** 运行时临时失败时保留上次成功数据，并明确标记为过期。 */
  stale?: boolean;
};
