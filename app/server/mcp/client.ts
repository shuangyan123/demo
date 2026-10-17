import { endpointFetch } from "../http/outbound-fetch.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { validateOutboundNetworkTarget } from "../http/outbound-network-policy.ts";

const MCP_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS = new Set(["localhost", "[::1]", "::1"]);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function isExplicitLanHost(hostname: string): boolean {
  return /^10(?:\.\d{1,3}){3}$/.test(hostname)
    || /^192\.168(?:\.\d{1,3}){2}$/.test(hostname)
    || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(hostname)
    || hostname.endsWith(".local");
}

/** 校验 MCP 地址，远程服务只允许 HTTPS，本机桥接只允许显式 loopback。 */
export function validateMcpEndpoint(value: string, allowPrivateNetwork = false): URL {
  const endpoint = new URL(value.trim());
  if (endpoint.username || endpoint.password) throw new Error("MCP 地址不得包含用户名或密码");
  if (endpoint.protocol === "http:" && !isLoopbackHost(endpoint.hostname) && !(allowPrivateNetwork && isExplicitLanHost(endpoint.hostname))) {
    throw new Error("远程 MCP 必须使用 HTTPS，HTTP 仅允许 localhost 或 127.0.0.1");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") throw new Error("MCP 仅支持 Streamable HTTP(S)");
  endpoint.hash = "";
  return endpoint;
}

type McpConnectionInput = {
  endpoint: string;
  token?: string;
  allowPrivateNetwork?: boolean;
};

/** 为单次请求建立 MCP 会话；不在服务端缓存 Token 或原始工具结果。 */
export async function withMcpClient<T>(input: McpConnectionInput, task: (client: Client) => Promise<T>): Promise<T> {
  const endpoint = validateMcpEndpoint(input.endpoint, input.allowPrivateNetwork === true);
  await validateOutboundNetworkTarget(endpoint.href, {
    allowLoopback: true,
    allowPrivateNetwork: input.allowPrivateNetwork === true,
  });
  const deadline = AbortSignal.timeout(MCP_TIMEOUT_MS);
  const safeFetch = endpointFetch(endpoint, { allowLoopback: true, allowPrivateNetwork: input.allowPrivateNetwork === true, timeoutMs: MCP_TIMEOUT_MS });
  const headers = input.token ? { Authorization: `Bearer ${input.token}` } : undefined;
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: (url, init) => safeFetch(url, { ...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) }),
    requestInit: { headers, redirect: "error", signal: deadline },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  const client = new Client({ name: "review-workspace", version: "0.1.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    return await task(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** MCP 错误只返回稳定短文本，避免上游响应或 Token 进入日志与 UI。 */
export function toMcpError(error: unknown): string {
  const message = error instanceof Error ? error.message : "MCP 请求失败";
  if (/abort|timeout/i.test(message)) return "MCP 请求超时，请检查服务状态";
  if (/401|unauthor/i.test(message)) return "MCP 认证失败，请检查 Bearer Token";
  if (/403|forbidden/i.test(message)) return "MCP 服务拒绝访问";
  // SDK 异常可能带有 endpoint query 或上游正文，不把它们回传给 UI。
  return "MCP 请求失败，请检查端点、网络或服务配置";
}
