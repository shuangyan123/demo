import { policyFetch } from "../http/policy-fetch.ts";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyIpAddress } from "../http/ip-address-classification.ts";
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

type LookupResult = Array<{ address: string }>;
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

/** 采集只允许公网；保留既有 192.0/16 限制，不因共享分类器而扩大允许范围。 */
export function isPrivateAddress(address: string): boolean {
  const { kind, ipv4 } = classifyIpAddress(address);
  return kind !== "public" || (ipv4?.[0] === 192 && ipv4[1] === 0);
}

async function assertSafeUrl(rawUrl: string, allowedOrigins: Set<string>, lookupImpl: (hostname: string) => Promise<LookupResult>): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("采集只允许 HTTP(S) 地址");
  if (!allowedOrigins.has(url.origin.toLowerCase())) throw new Error(`来源不在允许域名中：${url.origin}`);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("禁止访问本机地址");
  const directIp = isIP(hostname);
  const addresses = directIp ? [{ address: hostname }] : await lookupImpl(hostname);
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("禁止访问私网、环回或保留地址");
  return url;
}

async function readBodyWithinLimit(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("来源响应超过 1MB 安全上限");
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
  const lookupImpl = input.lookupImpl ?? ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  const fetchImpl = input.fetchImpl ?? ((url, init) => policyFetch(url, init, { allowLoopback: false, allowPrivateNetwork: false, acquisition: true }));
  if (!allowedOrigins.size) throw new Error("必须提供至少一个有效的允许域名");
  let currentUrl = input.url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const safeUrl = await assertSafeUrl(currentUrl, allowedOrigins, lookupImpl);
    const response = await fetchImpl(safeUrl, {
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
    if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) throw new Error(`不支持的来源内容类型：${contentType || "未知"}`);
    const body = await readBodyWithinLimit(response);
    const parsed = parseAcquisitionDocument({ body, contentType, url: safeUrl.toString() });
    if (!parsed.text) throw new Error("来源没有可提取的正文");
    return { ...parsed, url: safeUrl.toString(), fetchedAt: (input.now ?? new Date()).toISOString(), contentType };
  }
  throw new Error("来源重定向次数超过安全上限");
}
