import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyIpAddress, type IpAddressClassification } from "./ip-address-classification.ts";
import { RouteSecurityError, validateOutboundHttpUrl } from "./route-security.ts";

export type OutboundNetworkPolicy = {
  allowPrivateNetwork?: boolean;
  allowLoopback?: boolean;
  /** 采集的历史 192.0/16 额外限制必须同样约束实际连接。 */
  acquisition?: boolean;
};

type LookupAddress = { address: string; family: number };
type LookupAll = (hostname: string) => Promise<LookupAddress[]>;

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

function assertAllowedAddress(address: string, policy: OutboundNetworkPolicy): void {
  const classified = classifyIpAddress(address);
  const acquisitionReserved = policy.acquisition && classified.ipv4?.[0] === 192 && classified.ipv4[1] === 0;
  assertAllowedClassification(acquisitionReserved ? "blocked" : classified.kind, policy);
}

/** DNS 预检的全部结果均须符合策略；未绑定实际 socket，不能据此宣称防止 DNS rebinding。 */
export async function validateOutboundNetworkTarget(
  value: string,
  policy: OutboundNetworkPolicy = {},
  lookupAll: LookupAll = async (hostname) => defaultLookup(hostname, { all: true, verbatim: true }),
): Promise<URL> {
  const url = validateOutboundHttpUrl(value);
  const hostname = normalizeHostname(url.hostname);
  if (METADATA_HOSTS.has(hostname) || hostname.endsWith(".metadata.google.internal")) {
    throw new RouteSecurityError("blocked_metadata_target", "禁止访问云元数据服务", 400);
  }
  if (isIP(hostname)) {
    assertAllowedAddress(hostname, policy);
    return url;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookupAll(hostname);
  } catch {
    throw new RouteSecurityError("outbound_dns_failed", "外联地址 DNS 解析失败", 400);
  }
  if (!addresses.length) throw new RouteSecurityError("outbound_dns_failed", "外联地址没有可用 DNS 记录", 400);
  for (const result of addresses) assertAllowedAddress(result.address, policy);
  return url;
}

/** 将持久化字符串选项收敛为服务端网络策略，浏览器不发送厂商私有字段。 */
export function networkPolicyFromProviderOptions(options?: Record<string, string>): OutboundNetworkPolicy {
  return {
    allowLoopback: true,
    allowPrivateNetwork: options?.allowPrivateNetwork === "true",
  };
}
