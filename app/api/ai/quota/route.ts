import { getQuotaProviderAdapter, serializeQuotaError } from "../../../server/ai/quota-adapters";
import type { AiQuotaAction, AiQuotaCredentialKey } from "../../../types/domains/ai-quota.ts";
import type { ApiProvider } from "../../../types/domains/ai-provider.ts";
import {
  RouteSecurityError,
  apiErrorResponse,
  apiJsonResponse,
  readRouteJson,
} from "../../../server/http/route-security.ts";

type QuotaRequest = {
  action?: AiQuotaAction;
  provider?: ApiProvider | "manual";
  credentials?: Partial<Record<AiQuotaCredentialKey, string>>;
  period?: { start?: string; end?: string };
  monthlyBudget?: number;
  apiKey?: string;
};

/**
 * 额度接口只代理官方只读管理与余额 API，并在边界归一化错误和指标。
 * 旧 OpenAI `apiKey` 请求仍按 refresh 处理，但不会把凭据或原始响应返回给客户端。
 */
export async function POST(request: Request) {
  try {
    const body = await readRouteJson<QuotaRequest>(request);
    if (!body.provider || body.provider === "manual") {
      return apiErrorResponse(
        new RouteSecurityError("unsupported_account", "该厂商仅支持控制台或手动记录", 400),
        { code: "unsupported_account", message: "该厂商仅支持控制台或手动记录", status: 400 },
      );
    }
    const adapter = getQuotaProviderAdapter(body.provider);
    if (!adapter) {
      return apiErrorResponse(
        new RouteSecurityError("unsupported_account", "该厂商暂无稳定官方额度 API", 400),
        { code: "unsupported_account", message: "该厂商暂无稳定官方额度 API", status: 400 },
      );
    }
    const credentials = { ...(body.credentials ?? {}) };
    if (body.apiKey && body.provider === "openai" && !credentials.adminKey) credentials.adminKey = body.apiKey;
    const input = { provider: body.provider, credentials, period: body.period, monthlyBudget: body.monthlyBudget, signal: request.signal };
    const result = body.action === "validate" ? await adapter.validate(input) : await adapter.refresh(input);
    return apiJsonResponse(result);
  } catch (error) {
    const serialized = serializeQuotaError(error);
    return apiErrorResponse(error, {
      code: serialized.code,
      message: serialized.message,
      status: serialized.status,
      retryable: serialized.status === 429 || serialized.status >= 500,
    });
  }
}
