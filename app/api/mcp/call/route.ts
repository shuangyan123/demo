import { toMcpError, withMcpClient } from "../../../server/mcp/client";
import { apiErrorResponse, apiJsonResponse, readRouteJson } from "../../../server/http/route-security.ts";

type CallRequest = { endpoint?: string; token?: string; allowPrivateNetwork?: boolean; tool?: string; arguments?: Record<string, unknown> };
const MAX_RESPONSE_CHARS = 32_000;

/** 调用单个 MCP 工具；响应体设定预算，原始结果只在当前请求内存在。 */
export async function POST(request: Request) {
  try {
    const body = await readRouteJson<CallRequest>(request);
    if (!body.endpoint || !body.tool) {
      return apiErrorResponse(undefined, { code: "invalid_mcp_call", message: "缺少 MCP endpoint 或工具名称", status: 400 });
    }
    const result = await withMcpClient({ endpoint: body.endpoint, token: body.token, allowPrivateNetwork: body.allowPrivateNetwork }, (client) => client.callTool({
      name: body.tool!,
      arguments: body.arguments ?? {},
    }));
    const serialized = JSON.stringify(result);
    if (serialized.length > MAX_RESPONSE_CHARS) {
      return apiErrorResponse(undefined, { code: "mcp_result_too_large", message: "MCP 工具结果超过 32KB 安全预算", status: 413 });
    }
    return apiJsonResponse({ result });
  } catch (error) {
    return apiErrorResponse(error, { code: "mcp_call_failed", message: toMcpError(error), status: 502, retryable: true });
  }
}
