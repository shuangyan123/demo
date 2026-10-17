import { fetch as nativeFetch, type Dispatcher } from "undici";
import { approveOutboundNetworkTarget, type LookupAll, type OutboundNetworkPolicy } from "./outbound-network-policy.ts";
import { createPinnedDispatcher } from "./pinned-connection.ts";
import { RouteSecurityError } from "./route-security.ts";

export type OutboundFetchOptions = OutboundNetworkPolicy & { timeoutMs?: number; lookupAll?: LookupAll };
// 使用公开的 Node transport，避免 Next/SDK 重建 Request 时丢失 dispatcher。测试只替换此 I/O seam。
export const outboundTransport = { fetch: nativeFetch as unknown as typeof fetch };

/** 不把代理的 hostname 重解析误认为已绑定目标；未实现的代理模式明确失败关闭。 */
export function assertDirectConnection(url: URL, env: Record<string, string | undefined> = process.env): void {
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy;
  if (!proxy) return;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const exempt = (env.NO_PROXY || env.no_proxy || "").split(",").some(raw => {
    const value = raw.trim().toLowerCase();
    if (value === "*") return true;
    // 只支持明确 host / suffix / host:port，复杂 CIDR 规则不猜测放行。
    if (value === hostname || value === url.hostname.toLowerCase() || value === `${url.hostname.toLowerCase()}:${port}`) return true;
    return value.startsWith(".") && (hostname === value.slice(1) || hostname.endsWith(value));
  });
  if (!exempt) throw new RouteSecurityError("outbound_proxy_unsupported", "当前代理无法保证出站地址绑定；请为目标配置直连例外", 400);
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** 最终 URL、全部 DNS 答案和实际 socket 共用授权；每次调用重新解析，绝不自动重试。 */
export async function outboundFetch(input: string | URL | Request, init: RequestInit = {}, policy: OutboundFetchOptions = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assertDirectConnection(url);
  const signal = AbortSignal.any([AbortSignal.timeout(policy.timeoutMs ?? 60_000), ...(init.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])]);
  signal.throwIfAborted();
  const target = await abortable(approveOutboundNetworkTarget(url.href, policy, policy.lookupAll), signal);
  signal.throwIfAborted();
  const dispatcher = createPinnedDispatcher(target);
  const destroy = () => { void dispatcher.destroy().catch(() => undefined); };
  signal.addEventListener("abort", destroy, { once: true });
  const finish = () => { signal.removeEventListener("abort", destroy); destroy(); };
  try {
    // SDK 可能传入 Node 内置 Request；显式保留可见 HTTP 字段，避免不同 Undici 版本的对象品牌不兼容。
    const requestFields: RequestInit = input instanceof Request ? {
      method: input.method, headers: input.headers, body: input.body, credentials: input.credentials,
      cache: input.cache, mode: input.mode, referrer: input.referrer, referrerPolicy: input.referrerPolicy,
    } : {};
    const options: RequestInit & { dispatcher: Dispatcher; duplex?: "half" } = { ...requestFields, ...init, signal, dispatcher, redirect: init.redirect === "manual" ? "manual" : "error" };
    if (options.body instanceof ReadableStream) options.duplex = "half";
    const response = await outboundTransport.fetch(url, options);
    if (!response.body) { finish(); return response; }
    const reader = response.body.getReader();
    // 保留逐块背压；读完、取消、异常或 deadline 都销毁独占池。
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { finish(); controller.close(); }
          else controller.enqueue(chunk.value);
        } catch (error) { finish(); controller.error(error); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
    }, { highWaterMark: 0 });
    const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperty(result, "url", { value: response.url });
    return result;
  } catch (error) { finish(); throw error; }
}

/** SDK 的每次 POST/GET/DELETE 都限制在显式 endpoint，不继承重定向或其他 origin 的凭据许可。 */
export function endpointFetch(endpoint: URL, policy: OutboundFetchOptions): typeof fetch {
  return async (input, init) => {
    const actual = new URL(input instanceof Request ? input.url : input.toString());
    if (actual.origin !== endpoint.origin || actual.pathname !== endpoint.pathname || actual.search !== endpoint.search) {
      throw new RouteSecurityError("outbound_endpoint_mismatch", "SDK 请求超出已授权端点", 400);
    }
    return outboundFetch(input, { ...init, redirect: "error" }, policy);
  };
}
