import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyIpAddress, type IpAddressClassification } from "./ip-address-classification.ts";
import { RouteSecurityError, validateOutboundHttpUrl } from "./route-security.ts";

export type OutboundNetworkPolicy = {
  allowPrivateNetwork?: boolean;
  allowLoopback?: boolean;
  purpose?: "acquisition";
};

export type LookupAddress = { address: string; family: number };
export type LookupAll = (hostname: string) => Promise<LookupAddress[]>;
export type ApprovedNetworkTarget = { url: URL; hostname: string; port: number; addresses: LookupAddress[] };

async function resolveWithinDeadline(hostname: string, lookupAll: LookupAll): Promise<LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([lookupAll(hostname), new Promise<LookupAddress[]>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("outbound DNS timeout")), 10_000);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function assertAllowedClassification(
  classification: IpAddressClassification["kind"],
  policy: OutboundNetworkPolicy,
): void {
  if (classification === "blocked") throw new RouteSecurityError("blocked_outbound_target", "禁止访问链路本地、元数据或特殊网络地址", 400);
  if (classification === "loopback" && policy.allowLoopback === false) throw new RouteSecurityError("loopback_not_allowed", "当前功能不允许访问本机地址", 400);
  if (classification === "private" && !policy.allowPrivateNetwork) throw new RouteSecurityError("private_network_confirmation_required", "访问局域网地址前必须显式开启“允许本地网络”", 400);
}

/** 全部 DNS 答案一起授权；实际调用者必须把返回集合交给 pinned connector。 */
export async function approveOutboundNetworkTarget(
  value: string,
  policy: OutboundNetworkPolicy = {},
  lookupAll: LookupAll = async (hostname) => defaultLookup(hostname, { all: true, verbatim: true }),
): Promise<ApprovedNetworkTarget> {
  const url = validateOutboundHttpUrl(value);
  const hostname = normalizeHostname(url.hostname);
  if (METADATA_HOSTS.has(hostname) || hostname.endsWith(".metadata.google.internal")) {
    throw new RouteSecurityError("blocked_metadata_target", "禁止访问云元数据服务", 400);
  }
  let addresses: LookupAddress[];
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolveWithinDeadline(hostname, lookupAll);
  } catch {
    throw new RouteSecurityError("outbound_dns_failed", "外联地址 DNS 解析失败", 400);
  }
  if (!addresses.length) throw new RouteSecurityError("outbound_dns_failed", "外联地址没有可用 DNS 记录", 400);
  for (const result of addresses) {
    if (isIP(result.address) !== result.family) throw new RouteSecurityError("outbound_dns_failed", "DNS 地址族无效", 400);
    const classification = classifyIpAddress(result.address);
    const kind = classification.kind;
    if (policy.purpose === "acquisition" && classification.ipv4?.[0] === 192 && classification.ipv4[1] === 0) {
      throw new RouteSecurityError("blocked_outbound_target", "禁止访问采集保留地址", 400);
    }
    if ((hostname === "localhost" || hostname.endsWith(".localhost")) && kind !== "loopback") {
      throw new RouteSecurityError("blocked_outbound_target", "localhost 只能解析到本机地址", 400);
    }
    assertAllowedClassification(kind, policy);
  }
  return { url, hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), addresses };
}

/** 仅供语法/策略早期检查；网络请求本身仍必须使用 outboundFetch。 */
export async function validateOutboundNetworkTarget(value: string, policy: OutboundNetworkPolicy = {}, lookupAll?: LookupAll): Promise<URL> {
  return (await approveOutboundNetworkTarget(value, policy, lookupAll)).url;
}

/** 将持久化字符串选项收敛为服务端网络策略，浏览器不发送厂商私有字段。 */
export function networkPolicyFromProviderOptions(options?: Record<string, string>): OutboundNetworkPolicy {
  return {
    allowLoopback: true,
    allowPrivateNetwork: options?.allowPrivateNetwork === "true",
  };
}
