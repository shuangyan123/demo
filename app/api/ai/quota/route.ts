import { NextResponse } from "next/server";
import { getQuotaProviderAdapter, serializeQuotaError } from "../../../server/ai/quota-adapters";
import type { AiQuotaAction, AiQuotaCredentialKey } from "../../../types/domains/ai-quota";
import type { ApiProvider } from "../../../types/domains/ai-provider";

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
    const body = (await request.json()) as QuotaRequest;
    if (!body.provider || body.provider === "manual") {
      return NextResponse.json({ error: "unsupported_account", message: "该厂商仅支持控制台或手动记录" }, { status: 400 });
    }
    const adapter = getQuotaProviderAdapter(body.provider);
    if (!adapter) {
      return NextResponse.json({ error: "unsupported_account", message: "该厂商暂无稳定官方额度 API" }, { status: 400 });
    }
    const credentials = { ...(body.credentials ?? {}) };
    if (body.apiKey && body.provider === "openai" && !credentials.adminKey) credentials.adminKey = body.apiKey;
    const input = { provider: body.provider, credentials, period: body.period, monthlyBudget: body.monthlyBudget, signal: request.signal };
    const result = body.action === "validate" ? await adapter.validate(input) : await adapter.refresh(input);
    return NextResponse.json(result);
  } catch (error) {
    const serialized = serializeQuotaError(error);
    return NextResponse.json({ error: serialized.code, message: serialized.message }, { status: serialized.status });
  }
}
