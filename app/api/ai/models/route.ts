import type { AiModelsRequest } from "../../../services/api-client.ts";
import { miniMaxFailureMessage } from "../../../services/minimax-connection.ts";
import { ProviderDirectoryHttpError, fetchProviderModelDirectory } from "../../../server/ai/model-directory.ts";
import { googleUpstreamFailureMessage } from "../../../server/ai/google-error.ts";
import { aiRouteError, aiUpstreamError, readAiRouteJson } from "../../../server/ai/http.ts";
import { apiJsonResponse } from "../../../server/http/route-security.ts";
import { networkPolicyFromProviderOptions, validateOutboundNetworkTarget } from "../../../server/http/outbound-network-policy.ts";

function isRequest(value: unknown): value is AiModelsRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AiModelsRequest>;
  return Boolean(input.provider && input.baseUrl && (input.apiKey || input.provider === "custom"));
}

/** 代理厂商官方模型目录，并在服务端完成分页与能力归一化。 */
export async function POST(request: Request) {
  try {
    const body = await readAiRouteJson(request);
    if (!isRequest(body)) return aiRouteError("缺少有效的模型目录连接参数", 400);
    await validateOutboundNetworkTarget(body.baseUrl, networkPolicyFromProviderOptions(body.providerOptions));
    return apiJsonResponse(await fetchProviderModelDirectory(body));
  } catch (error) {
    if (error instanceof ProviderDirectoryHttpError) {
      const response = error.response;
      const message = error.provider === "google"
        ? await googleUpstreamFailureMessage(response, "模型目录请求")
        : error.provider === "minimax"
          ? miniMaxFailureMessage(response.status, "directory", "cn", "pay_as_you_go")
          : "官方模型目录请求失败";
      return aiUpstreamError(message, response.status);
    }
    return aiRouteError("模型目录请求失败");
  }
}
