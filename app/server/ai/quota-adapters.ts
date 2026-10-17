import { outboundFetch } from "../http/outbound-fetch.ts";
import type {
  AiQuotaAdapterInput,
  AiQuotaErrorCode,
  AiQuotaMetric,
  AiQuotaProviderAdapter,
  AiQuotaSnapshot,
  AiQuotaVerificationResult,
} from "../../types/domains/ai-quota.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";

const TIMEOUT_MS = 12_000;

class QuotaAdapterError extends Error {
  readonly code: AiQuotaErrorCode;
  readonly status: number;

  constructor(code: AiQuotaErrorCode, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function errorFromStatus(status: number): QuotaAdapterError {
  if (status === 401) return new QuotaAdapterError("invalid_credential", "额度凭据无效", 401);
  if (status === 403) return new QuotaAdapterError("insufficient_permission", "额度凭据权限不足", 403);
  if (status === 404) return new QuotaAdapterError("unsupported_account", "当前账户不支持官方额度接口", 400);
  if (status === 429) return new QuotaAdapterError("rate_limited", "厂商额度接口请求过于频繁", 429);
  return new QuotaAdapterError("provider_unavailable", "厂商额度接口暂时不可用", 502);
}

async function requestJson(url: string | URL, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await outboundFetch(url, { ...init, cache: "no-store", redirect: "error", signal: combinedSignal }, { allowLoopback: false, allowPrivateNetwork: false });
  } catch {
    throw new QuotaAdapterError("provider_unavailable", "厂商额度接口连接失败", 502);
  }
  if (!response.ok) { await response.body?.cancel(); throw errorFromStatus(response.status); }
  try {
    return await response.json();
  } catch {
    throw new QuotaAdapterError("malformed_response", "厂商额度接口返回格式异常", 502);
  }
}

function requiredCredential(input: AiQuotaAdapterInput, key: "apiKey" | "adminKey" | "managementKey"): string {
  const value = input.credentials[key]?.trim();
  if (!value) throw new QuotaAdapterError("invalid_credential", "缺少额度查询凭据", 400);
  return value;
}

function currentPeriod(input: AiQuotaAdapterInput) {
  const now = new Date();
  const start = input.period?.start ? new Date(input.period.start) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = input.period?.end ? new Date(input.period.end) : now;
  return { start, end };
}

function numberSum(value: unknown, keys: string[]): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + numberSum(item, keys), 0);
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  let directTotal = 0;
  let hasDirectValue = false;
  for (const key of keys) {
    const numeric = Number(record[key]);
    if (!Number.isFinite(numeric)) continue;
    directTotal += numeric;
    hasDirectValue = true;
  }
  if (hasDirectValue) return directTotal;
  return Object.values(record).reduce<number>((sum, item) => sum + numberSum(item, keys), 0);
}

function snapshot(provider: ApiProvider, label: string, metrics: AiQuotaMetric[], message: string): AiQuotaSnapshot {
  const used = metrics.find((metric) => metric.id === "used_cost");
  const remaining = metrics.find((metric) => metric.id === "remaining_balance");
  return {
    id: provider,
    provider,
    label,
    status: "ready",
    source: "official",
    metrics,
    usedAmount: used?.value,
    remainingAmount: remaining?.value,
    currency: used?.unit ?? remaining?.unit,
    periodLabel: "本月",
    sourceLabel: "官方只读 API",
    officialRemainingAvailable: Boolean(remaining?.source === "official"),
    message,
    refreshedAt: new Date().toISOString(),
  };
}

function valid(provider: ApiProvider, teamId?: string): AiQuotaVerificationResult {
  return { valid: true, provider, teamId, message: "额度凭据验证通过" };
}

const openAiAdapter: AiQuotaProviderAdapter = {
  async validate(input) {
    const key = requiredCredential(input, "adminKey");
    const { start } = currentPeriod(input);
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "1");
    await requestJson(url, { headers: { Authorization: `Bearer ${key}` } }, input.signal);
    return valid("openai");
  },
  async refresh(input) {
    const key = requiredCredential(input, "adminKey");
    const { start, end } = currentPeriod(input);
    const common = new URLSearchParams({
      start_time: String(Math.floor(start.getTime() / 1000)),
      end_time: String(Math.floor(end.getTime() / 1000)),
      bucket_width: "1d",
    });
    const headers = { Authorization: `Bearer ${key}` };
    const [costs, usage] = await Promise.all([
      requestJson(`https://api.openai.com/v1/organization/costs?${common}`, { headers }, input.signal),
      requestJson(`https://api.openai.com/v1/organization/usage/completions?${common}`, { headers }, input.signal),
    ]);
    const usedCost = numberSum(costs, ["value", "amount"]);
    const metrics: AiQuotaMetric[] = [
      { id: "used_cost", label: "本月费用", value: usedCost, unit: "USD", source: "official", periodStart: start.toISOString(), periodEnd: end.toISOString() },
      { id: "token_usage", label: "Token 用量", value: numberSum(usage, ["input_tokens", "output_tokens", "num_model_requests"]), unit: "tokens", source: "official", periodStart: start.toISOString(), periodEnd: end.toISOString() },
    ];
    if (Number.isFinite(input.monthlyBudget)) {
      metrics.push({ id: "spend_limit", label: "本地预算", value: input.monthlyBudget!, unit: "USD", source: "manual" });
      metrics.push({ id: "remaining_balance", label: "预算剩余估算", value: Math.max(0, input.monthlyBudget! - usedCost), unit: "USD", source: "estimated" });
    }
    return snapshot("openai", "OpenAI", metrics, "已读取官方费用与用量；剩余值仅按本地预算估算");
  },
};

const anthropicAdapter: AiQuotaProviderAdapter = {
  async validate(input) {
    const key = requiredCredential(input, "adminKey");
    await requestJson("https://api.anthropic.com/v1/organizations/me", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }, input.signal);
    return valid("anthropic");
  },
  async refresh(input) {
    const key = requiredCredential(input, "adminKey");
    const { start, end } = currentPeriod(input);
    const query = new URLSearchParams({ starting_at: start.toISOString(), ending_at: end.toISOString(), bucket_width: "1d" });
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    const [usage, costs] = await Promise.all([
      requestJson(`https://api.anthropic.com/v1/organizations/usage_report/messages?${query}`, { headers }, input.signal),
      requestJson(`https://api.anthropic.com/v1/organizations/cost_report?${query}`, { headers }, input.signal),
    ]);
    return snapshot("anthropic", "Anthropic Claude", [
      { id: "used_cost", label: "本月费用", value: numberSum(costs, ["amount", "value"]), unit: "USD", source: "official", periodStart: start.toISOString(), periodEnd: end.toISOString() },
      { id: "token_usage", label: "Token 用量", value: numberSum(usage, ["input_tokens", "output_tokens"]), unit: "tokens", source: "official", periodStart: start.toISOString(), periodEnd: end.toISOString() },
    ], "已读取 Anthropic 官方费用与用量");
  },
};

const deepSeekAdapter: AiQuotaProviderAdapter = {
  async validate(input) {
    const key = requiredCredential(input, "apiKey");
    await requestJson("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${key}` } }, input.signal);
    return valid("deepseek");
  },
  async refresh(input) {
    const key = requiredCredential(input, "apiKey");
    const payload = await requestJson("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${key}` } }, input.signal);
    const balances = payload && typeof payload === "object" && Array.isArray((payload as { balance_infos?: unknown[] }).balance_infos)
      ? (payload as { balance_infos: Array<Record<string, unknown>> }).balance_infos : [];
    const metrics: AiQuotaMetric[] = balances.flatMap((item) => {
      const value = Number(item.total_balance ?? item.granted_balance ?? item.topped_up_balance);
      return Number.isFinite(value) ? [{ id: "remaining_balance" as const, label: "官方可用余额", value, unit: String(item.currency ?? "CNY"), source: "official" as const }] : [];
    });
    return snapshot("deepseek", "DeepSeek", metrics, "已读取 DeepSeek 官方可用状态与余额");
  },
};

function extractTeamId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const direct = record.team_id ?? record.teamId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return Object.values(record).map(extractTeamId).find(Boolean);
}

const xaiAdapter: AiQuotaProviderAdapter = {
  async validate(input) {
    const key = requiredCredential(input, "managementKey");
    const payload = await requestJson("https://management-api.x.ai/auth/management-keys/validation", { headers: { Authorization: `Bearer ${key}` } }, input.signal);
    return valid("xai", input.credentials.teamId?.trim() || extractTeamId(payload));
  },
  async refresh(input) {
    const key = requiredCredential(input, "managementKey");
    const validation = await this.validate(input);
    const teamId = input.credentials.teamId?.trim() || validation.teamId;
    if (!teamId) throw new QuotaAdapterError("unsupported_account", "无法从管理密钥推导 Team ID，请手动填写", 400);
    const headers = { Authorization: `Bearer ${key}` };
    const { start, end } = currentPeriod(input);
    const [balance, usage] = await Promise.all([
      requestJson(`https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`, { headers }, input.signal),
      requestJson(`https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}/usage`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ start_time: start.toISOString(), end_time: end.toISOString() }),
      }, input.signal),
    ]);
    return snapshot("xai", "xAI Grok", [
      { id: "remaining_balance", label: "官方预付余额", value: numberSum(balance, ["balance", "amount", "value"]), unit: "USD", source: "official" },
      { id: "used_cost", label: "本月用量费用", value: numberSum(usage, ["cost", "amount", "value"]), unit: "USD", source: "official", periodStart: start.toISOString(), periodEnd: end.toISOString() },
    ], "已读取 xAI 官方预付余额与用量");
  },
};

export const quotaProviderAdapters = new Map<ApiProvider, AiQuotaProviderAdapter>([
  ["openai", openAiAdapter],
  ["anthropic", anthropicAdapter],
  ["deepseek", deepSeekAdapter],
  ["xai", xaiAdapter],
]);

export function getQuotaProviderAdapter(provider: ApiProvider): AiQuotaProviderAdapter | undefined {
  return quotaProviderAdapters.get(provider);
}

export function serializeQuotaError(error: unknown): { code: AiQuotaErrorCode; message: string; status: number } {
  if (error instanceof QuotaAdapterError) return { code: error.code, message: error.message, status: error.status };
  return { code: "provider_unavailable", message: "额度服务暂时不可用", status: 502 };
}
