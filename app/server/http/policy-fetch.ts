import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, buildConnector } from "undici";
import { classifyIpAddress } from "./ip-address-classification.ts";
import { validateOutboundNetworkTarget, type OutboundNetworkPolicy } from "./outbound-network-policy.ts";
import { RouteSecurityError, validateOutboundHttpUrl } from "./route-security.ts";

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;

function addressKey(address: string): string {
  const classified = classifyIpAddress(address);
  if (isIP(address) === 4) return address;
  if (classified.ipv4 && new URL(`http://[${address}]/`).hostname.startsWith("[::ffff:")) return classified.ipv4.join(".");
  return new URL(`http://[${address}]/`).hostname;
}

/** 每次建连只解析一次；全部答案校验后，lookup 只能返回该集合。 */
export async function resolvePinnedTarget(
  url: URL,
  policy: OutboundNetworkPolicy,
  resolver: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true }),
): Promise<Address[]> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: Address[];
  try {
    addresses = family ? [{ address: hostname, family }] : await Promise.race([
      resolver(hostname),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 10_000); }),
    ]);
  } finally { clearTimeout(timer); }
  await validateOutboundNetworkTarget(url.href, policy, async () => addresses);
  if (!addresses.length || addresses.some((entry) => isIP(entry.address) !== entry.family)) {
    throw new RouteSecurityError("outbound_dns_failed", "外联 DNS 记录无效", 400);
  }
  return addresses;
}

/** 请求级 Agent 不使用环境代理或全局 dispatcher，也不跨授权上下文复用连接。 */
export function createPolicyDispatcher(origin: string, policy: OutboundNetworkPolicy = {}): Agent {
  const dispatcher = new Agent({
    connections: 1,
    pipelining: 0,
    connect(options, callback) {
      const hostname = options.hostname.includes(":") ? `[${options.hostname}]` : options.hostname;
      const target = new URL(`${options.protocol}//${hostname}:${options.port || (options.protocol === "https:" ? 443 : 80)}`);
      if (target.origin !== origin || options.httpSocket || options.socketPath) {
        callback(new RouteSecurityError("blocked_outbound_target", "外联连接目标与授权不一致", 400), null);
        return;
      }
      void resolvePinnedTarget(target, policy).then((addresses) => {
        if (dispatcher.destroyed) { callback(new Error("Outbound request cancelled"), null); return; }
        const pinnedLookup: LookupFunction = (_hostname, lookupOptions, done) => {
          const candidates = addresses.filter((entry) => !lookupOptions.family || entry.family === lookupOptions.family);
          // 与系统 lookup 一样异步完成；Windows 提前设置 socket 选项时不能缓存空 peer。
          queueMicrotask(() => {
            if (!candidates.length) { done(new Error("No approved address for requested family"), "", 0); return; }
            if (lookupOptions.all) done(null, candidates);
            else done(null, candidates[0].address, candidates[0].family);
          });
        };
        // 保留原 hostname，确保 Host、SNI 和证书身份不被 IP 替换；不关闭 CA/hostname 验证。
        const connect = buildConnector({ lookup: pinnedLookup, timeout: 10_000, maxCachedSessions: 0 });
        connect(options, (error, socket) => {
          if (error) { callback(error, null); return; }
          const approved = new Set(addresses.map((entry) => addressKey(entry.address)));
          if (!socket.remoteAddress || !approved.has(addressKey(socket.remoteAddress)) || socket.remotePort !== Number(target.port || (target.protocol === "https:" ? 443 : 80))) {
            socket.destroy();
            callback(new RouteSecurityError("blocked_outbound_target", "实际连接地址与授权不一致", 400), null);
            return;
          }
          callback(null, socket);
        });
      }).catch((error: unknown) => callback(error instanceof RouteSecurityError ? error : new RouteSecurityError("outbound_dns_failed", "外联地址解析或连接失败", 400), null));
    },
  });
  return dispatcher;
}

/** 调用方只选择既有功能授权；最终 URL、每次 SDK 请求、取消和重定向均在此收敛。 */
export async function policyFetch(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  policy: OutboundNetworkPolicy = {},
): Promise<Response> {
  const url = validateOutboundHttpUrl(input instanceof Request ? input.url : input.toString());
  // 尚未验收代理端的 DNS 绑定；显式启用 Node 环境代理时失败关闭，不能静默改成直连。
  if (process.env.NODE_USE_ENV_PROXY === "1" || process.execArgv.includes("--use-env-proxy") || /(?:^|\s)--use-env-proxy(?:\s|$)/.test(process.env.NODE_OPTIONS ?? "")) {
    throw new RouteSecurityError("outbound_proxy_unsupported", "当前安全传输尚不支持环境代理，请使用明确配置的服务端点", 400);
  }
  const dispatcher = createPolicyDispatcher(url.origin, policy);
  const timeout = AbortSignal.timeout(60_000);
  const callerSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const destroy = () => { void dispatcher.destroy().catch(() => undefined); };
  signal.addEventListener("abort", destroy, { once: true });
  try {
    const options: RequestInit & { dispatcher: Agent } = { ...init, dispatcher, signal, redirect: init.redirect === "manual" ? "manual" : "error" };
    const response = await globalThis.fetch(input, options);
    // close 等待当前正文完成/取消；不截断 SSE，不允许后续请求借用此 Agent。
    void dispatcher.close().catch(destroy).finally(() => signal.removeEventListener("abort", destroy));
    return response;
  } catch (error) {
    signal.removeEventListener("abort", destroy);
    await dispatcher.destroy().catch(() => undefined);
    throw error instanceof Error && error.cause instanceof RouteSecurityError ? error.cause : error;
  }
}
