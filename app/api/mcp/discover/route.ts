import { toMcpError, withMcpClient } from "../../../server/mcp/client";
import { apiErrorResponse, apiJsonResponse, readRouteJson } from "../../../server/http/route-security.ts";

type DiscoverRequest = { endpoint?: string; token?: string };

/** 真实发现 MCP tools/resources/prompts，只向客户端返回名称、描述和输入 schema。 */
export async function POST(request: Request) {
  try {
    const body = await readRouteJson<DiscoverRequest>(request);
    if (!body.endpoint) return apiErrorResponse(undefined, { code: "invalid_mcp_discovery", message: "缺少 MCP endpoint", status: 400 });
    const result = await withMcpClient({ endpoint: body.endpoint, token: body.token }, async (client) => {
      const [tools, resources, prompts] = await Promise.all([
        client.listTools(),
        client.listResources().catch(() => ({ resources: [] })),
        client.listPrompts().catch(() => ({ prompts: [] })),
      ]);
      return {
        tools: tools.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
        resources: resources.resources.map((resource) => ({ name: resource.name, uri: resource.uri })),
        prompts: prompts.prompts.map((prompt) => ({ name: prompt.name, description: prompt.description })),
      };
    });
    return apiJsonResponse(result);
  } catch (error) {
    return apiErrorResponse(error, { code: "mcp_discovery_failed", message: toMcpError(error), status: 502, retryable: true });
  }
}
