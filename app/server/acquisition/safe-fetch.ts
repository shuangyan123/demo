import { isIP } from "node:net";
import { classifyIpAddress } from "../http/ip-address-classification.ts";
import { outboundFetch } from "../http/outbound-fetch.ts";
import { approveOutboundNetworkTarget } from "../http/outbound-network-policy.ts";
import { validateOutboundHttpUrl } from "../http/route-security.ts";
import { parseAcquisitionDocument, type ParsedAcquisitionDocument } from "./document-parser.ts";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "application/xml", "text/xml", "application/rss+xml", "application/atom+xml"];

export type SafeFetchResult = ParsedAcquisitionDocument & {
  url: string;
  fetchedAt: string;
  contentType: string;
};

type LookupResult = Array<{ address: string; family?: number }>;
type SafeFetchDependencies = {
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<LookupResult>;
};

/** 允许域名按 origin 比较，避免子串和后缀匹配绕过。 */
export function normalizeAllowedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

/** 私网选择条件不能扩大服务端公网采集策略。 */
export function isPrivateAddress(address: string): boolean {
  const classification = classifyIpAddress(address);
  return classification.kind !== "public" || (classification.ipv4?.[0] === 192 && classification.ipv4[1] === 0);
}

function assertAllowedOrigin(rawUrl: string, allowedOrigins: Set<string>): URL {
  const url = validateOutboundHttpUrl(rawUrl);
  if (!allowedOrigins.has(url.origin.toLowerCase())) throw new Error("来源不在允许域名中");
  return url;
}

async function readBodyWithinLimit(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error("来源响应超过 1MB 安全上限"); }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("来源响应超过 1MB 安全上限");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/** 每一次重定向都重新校验协议、允许域名与 DNS 解析结果。 */
export async function safeFetchAcquisition(input: { url: string; allowedOrigins: string[]; now?: Date } & SafeFetchDependencies): Promise<SafeFetchResult> {
  const allowedOrigins = new Set(input.allowedOrigins.map(normalizeAllowedOrigin).filter((value): value is string => Boolean(value)));
  const lookupAll = input.lookupImpl ? async (hostname: string) => (await input.lookupImpl!(hostname)).map(item => ({ ...item, family: item.family ?? isIP(item.address) })) : undefined;
  const policy = { purpose: "acquisition" as const, allowLoopback: false, allowPrivateNetwork: false, lookupAll, timeoutMs: REQUEST_TIMEOUT_MS };
  if (!allowedOrigins.size) throw new Error("必须提供至少一个有效的允许域名");
  let currentUrl = input.url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const safeUrl = assertAllowedOrigin(currentUrl, allowedOrigins);
    // 注入的 transport 也先执行完整策略检查；生产路径由 outboundFetch 同时绑定解析与连接。
    if (input.fetchImpl) {
      try { await approveOutboundNetworkTarget(safeUrl.href, policy, lookupAll); }
      catch { throw new Error("禁止访问私网、环回或保留地址"); }
    }
    const response = await (input.fetchImpl ?? ((url, init) => outboundFetch(url, init, policy)))(safeUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: "text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, application/xml;q=0.9" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("来源返回了缺少 Location 的重定向");
      if (redirectCount === MAX_REDIRECTS) throw new Error("来源重定向次数超过安全上限");
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`来源返回 HTTP ${response.status}`); }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) { await response.body?.cancel(); throw new Error("不支持的来源内容类型"); }
    const body = await readBodyWithinLimit(response);
    const parsed = parseAcquisitionDocument({ body, contentType, url: safeUrl.toString() });
    if (!parsed.text) throw new Error("来源没有可提取的正文");
    return { ...parsed, url: safeUrl.toString(), fetchedAt: (input.now ?? new Date()).toISOString(), contentType };
  }
  throw new Error("来源重定向次数超过安全上限");
}
