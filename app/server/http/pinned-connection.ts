import { Agent, buildConnector } from "undici";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { RouteSecurityError } from "./route-security.ts";
import type { ApprovedNetworkTarget } from "./outbound-network-policy.ts";

/** 将同一地址的 IPv6 展开式、压缩式和 IPv4-mapped 表示收敛，供 socket 对照使用。 */
export function addressIdentity(address: string): string {
  if (isIP(address) === 4) return address;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([\da-f]+):([\da-f]+)$/i);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

/** connector 只消费批准集合；既不做第二次 DNS，也不允许备用地址越出该集合。 */
export function pinnedLookup(target: ApprovedNetworkTarget): LookupFunction {
  return (hostname, options, callback) => {
    // net/Undici 依赖异步 lookup 语义，避免 connect 前缓存空的 peer 地址。
    queueMicrotask(() => {
      if (hostname.replace(/\.$/, "").toLowerCase() !== target.hostname) {
        callback(new Error("outbound lookup hostname mismatch"), "", 0);
        return;
      }
      const candidates = target.addresses.filter(item => !options.family || item.family === options.family);
      if (!candidates.length) { callback(new Error("no approved address for family"), "", 0); return; }
      if (options.all) callback(null, candidates);
      else callback(null, candidates[0].address, candidates[0].family);
    });
  };
}

export function createPinnedConnector(target: ApprovedNetworkTarget, connector = buildConnector): buildConnector.connector {
  const connect = connector({
    lookup: pinnedLookup(target),
    // 原 URL/Host 不改写；TLS 对原域名发送 SNI 并验证原域名证书，IP literal 使用 IP SAN。
    servername: isIP(target.hostname) ? undefined : target.hostname,
    rejectUnauthorized: true,
    timeout: 10_000,
    maxCachedSessions: 0,
  });
  return (options, callback) => {
    if (options.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase() !== target.hostname
      || Number(options.port || (options.protocol === "https:" ? 443 : 80)) !== target.port
      || options.protocol !== target.url.protocol || options.httpSocket || options.socketPath) {
      callback(new RouteSecurityError("outbound_binding_mismatch", "外联连接目标不匹配", 400), null);
      return;
    }
    // buildConnector 的调用级 servername 优先于构造选项，不能让 Host/调用方覆盖原目标身份。
    connect({ ...options, host: target.url.host, servername: isIP(target.hostname) ? "" : target.hostname }, (error, socket) => {
      if (error || !socket) { callback(error ?? new Error("missing outbound socket"), null); return; }
      if (!socket.remoteAddress || socket.remotePort !== target.port
        || !target.addresses.some(item => addressIdentity(item.address) === addressIdentity(socket.remoteAddress!))) {
        socket.destroy();
        callback(new RouteSecurityError("outbound_binding_mismatch", "外联连接未绑定批准地址", 400), null);
        return;
      }
      // 交回 HTTP 层前验证，Authorization/请求正文尚未写入 socket。
      callback(null, socket);
    });
  };
}

/** 请求独占连接池；不共享凭据、DNS 结果、LAN 许可或 TLS session。 */
export function createPinnedDispatcher(target: ApprovedNetworkTarget): Agent {
  return new Agent({ connect: createPinnedConnector(target), connections: 1, pipelining: 0 });
}
