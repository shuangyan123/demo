import { toMcpError, withMcpClient } from "../../../server/mcp/client";

type CallRequest = { endpoint?: string; token?: string; tool?: string; arguments?: Record<string, unknown> };
const MAX_RESPONSE_CHARS = 32_000;

/** 调用单个 MCP 工具；响应体设定预算，原始结果只在当前请求内存在。 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as CallRequest;
    if (!body.endpoint || !body.tool) return Response.json({ error: "缺少 MCP endpoint 或工具名称" }, { status: 400 });
    const result = await withMcpClient({ endpoint: body.endpoint, token: body.token }, (client) => client.callTool({
      name: body.tool!,
      arguments: body.arguments ?? {},
    }));
    const serialized = JSON.stringify(result);
    if (serialized.length > MAX_RESPONSE_CHARS) return Response.json({ error: "MCP 工具结果超过 32KB 安全预算" }, { status: 413 });
    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: toMcpError(error) }, { status: 502 });
  }
}
