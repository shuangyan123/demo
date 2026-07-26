import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { RouteSecurityError, validateOutboundHttpUrl } from "./route-security.ts";

export type OutboundNetworkPolicy = {
  allowPrivateNetwork?: boolean;
  allowLoopback?: boolean;
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

function classifyIpv4(address: string): "public" | "loopback" | "private" | "blocked" {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return "blocked";
  const [a, b] = octets;
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if (a === 0 || (a === 169 && b === 254) || a >= 224) return "blocked";
  return "public";
}

function classifyIpv6(address: string): "public" | "loopback" | "private" | "blocked" {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::1") return "loopback";
  if (normalized === "::" || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff")) return "blocked";
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return "private";
  if (normalized.startsWith("::ffff:")) return classifyIpv4(normalized.slice(7));
  return "public";
}

function classifyAddress(address: string): "public" | "loopback" | "private" | "blocked" {
  const family = isIP(address);
  if (family === 4) return classifyIpv4(address);
  if (family === 6) return classifyIpv6(address);
  return "blocked";
}

function assertAllowedClassification(
  classification: ReturnType<typeof classifyAddress>,
  policy: OutboundNetworkPolicy,
): void {
  if (classification === "blocked") throw new RouteSecurityError("blocked_outbound_target", "禁止访问链路本地、元数据或特殊网络地址", 400);
  if (classification === "loopback" && policy.allowLoopback === false) throw new RouteSecurityError("loopback_not_allowed", "当前功能不允许访问本机地址", 400);
  if (classification === "private" && !policy.allowPrivateNetwork) throw new RouteSecurityError("private_network_confirmation_required", "访问局域网地址前必须显式开启“允许本地网络”", 400);
}

/** 解析并校验外联目标；所有解析结果都必须满足同一网络策略，避免 DNS rebinding 绕过。 */
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
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    assertAllowedClassification("loopback", policy);
    return url;
  }
  if (isIP(hostname)) {
    assertAllowedClassification(classifyAddress(hostname), policy);
    return url;
  }
  // RFC 2606 测试域不产生真实外联，仅用于本地契约中的 mock transport。
  if (hostname.endsWith(".example") || hostname.endsWith(".test") || hostname === "example.com") return url;
  let addresses: LookupAddress[];
  try {
    addresses = await lookupAll(hostname);
  } catch {
    throw new RouteSecurityError("outbound_dns_failed", "外联地址 DNS 解析失败", 400);
  }
  if (!addresses.length) throw new RouteSecurityError("outbound_dns_failed", "外联地址没有可用 DNS 记录", 400);
  for (const result of addresses) assertAllowedClassification(classifyAddress(result.address), policy);
  return url;
}

/** 将持久化字符串选项收敛为服务端网络策略，浏览器不发送厂商私有字段。 */
export function networkPolicyFromProviderOptions(options?: Record<string, string>): OutboundNetworkPolicy {
  return {
    allowLoopback: true,
    allowPrivateNetwork: options?.allowPrivateNetwork === "true",
  };
}
