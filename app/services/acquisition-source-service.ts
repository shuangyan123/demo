import type {
  AcquisitionDocument,
  AcquisitionSourceConfig,
  AutomationCollectionConfig,
  KnowledgeEvolutionProposal,
} from "../types/review.ts";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";

type FetchResponse = {
  url: string;
  title: string;
  publisher?: string;
  publishedAt?: string;
  fetchedAt: string;
  contentHash: string;
  text: string;
  excerpt: string;
  discoveredUrls: string[];
  error?: string;
};

export type AcquisitionDiscoveryResult = {
  documents: AcquisitionDocument[];
  discoveredCount: number;
  fetchedCount: number;
  duplicateCount: number;
  diagnostics: string[];
};

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** 旧任务和手工编辑数据进入执行链前统一收紧边界。 */
export function normalizeCollectionConfig(input: AutomationCollectionConfig): AutomationCollectionConfig {
  return {
    ...input,
    queries: input.queries.map((item) => item.trim()).filter(Boolean).slice(0, 12),
    allowedOrigins: [...new Set(input.allowedOrigins.map(normalizeOrigin).filter((item): item is string => Boolean(item)))].slice(0, 24),
    freshnessDays: Math.max(1, Math.min(365, Math.round(input.freshnessDays || 30))),
    maxDocuments: Math.max(1, Math.min(10, Math.round(input.maxDocuments || 10))),
    sources: input.sources.map((source) => ({
      ...source,
      label: source.label.trim() || "未命名来源",
      allowedOrigins: [...new Set(source.allowedOrigins.map(normalizeOrigin).filter((item): item is string => Boolean(item)))].slice(0, 12),
      contentPolicy: source.contentPolicy === "licensed_full_text" ? "licensed_full_text" : "summary_only",
    })),
  };
}

function effectiveOrigins(config: AutomationCollectionConfig, source: AcquisitionSourceConfig): string[] {
  const global = new Set(config.allowedOrigins);
  const sourceOrigins = source.allowedOrigins.length ? source.allowedOrigins : config.allowedOrigins;
  return sourceOrigins.filter((origin) => global.has(origin));
}

function isAllowedUrl(rawUrl: string, allowedOrigins: string[]): boolean {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && allowedOrigins.includes(url.origin.toLowerCase());
  } catch {
    return false;
  }
}

function replaceQueryTemplate(value: unknown, query: string): unknown {
  if (typeof value === "string") return value.replaceAll("{{query}}", query);
  if (Array.isArray(value)) return value.map((item) => replaceQueryTemplate(item, query));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceQueryTemplate(item, query)]));
  return value;
}

function parseMcpArguments(template: string, query: string): Record<string, unknown> {
  const parsed = JSON.parse(template.trim() || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP 参数模板必须是 JSON 对象");
  return replaceQueryTemplate(parsed, query) as Record<string, unknown>;
}

/** MCP 原始结果只在当前调用栈中递归扫描 URL，不写入任何持久化状态。 */
export function extractCandidateUrls(value: unknown): string[] {
  const urls: string[] = [];
  const visit = (item: unknown, depth: number) => {
    if (depth > 8 || urls.length >= 100) return;
    if (typeof item === "string") {
      const matches = item.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
      urls.push(...matches);
      return;
    }
    if (Array.isArray(item)) item.forEach((child) => visit(child, depth + 1));
    else if (item && typeof item === "object") Object.values(item).forEach((child) => visit(child, depth + 1));
  };
  visit(value, 0);
  return [...new Set(urls.map((url) => url.replace(/[.,;:!?]+$/, "")))];
}

async function fetchDocument(url: string, allowedOrigins: string[]): Promise<FetchResponse> {
  const response = await fetch("/api/acquisition/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, allowedOrigins }),
  });
  const result = await response.json() as FetchResponse;
  if (!response.ok) throw new Error(result.error || "来源抓取失败");
  return result;
}

async function discoverSourceUrls(config: AutomationCollectionConfig, source: AcquisitionSourceConfig): Promise<{ urls: string[]; diagnostics: string[] }> {
  const origins = effectiveOrigins(config, source);
  if (!origins.length) return { urls: [], diagnostics: [`${source.label} 没有与任务白名单相交的允许域名`] };
  if (source.kind === "url") return { urls: source.urls.filter((url) => isAllowedUrl(url, origins)), diagnostics: [] };
  if (source.kind === "feed") {
    if (!isAllowedUrl(source.url, origins)) return { urls: [], diagnostics: [`${source.label} 的订阅地址不在允许域名中`] };
    const feed = await fetchDocument(source.url, origins);
    return { urls: feed.discoveredUrls.filter((url) => isAllowedUrl(url, origins)), diagnostics: [] };
  }
  const urls: string[] = [];
  for (const query of config.queries) {
    const result = await mcpSettingsRepository.callScheduledTool(source.serverId, source.toolName, parseMcpArguments(source.argumentTemplate, query));
    urls.push(...extractCandidateUrls(result).filter((url) => isAllowedUrl(url, origins)));
  }
  return { urls: [...new Set(urls)], diagnostics: [] };
}

/** 按白名单发现、抓取并用 URL 与内容哈希双重去重。 */
export async function acquireCollectionDocuments(input: AutomationCollectionConfig): Promise<AcquisitionDiscoveryResult> {
  const config = normalizeCollectionConfig(input);
  const enabledSources = config.sources.filter((source) => source.enabled);
  const discovered: Array<{ url: string; source: AcquisitionSourceConfig; origins: string[] }> = [];
  const diagnostics: string[] = [];
  for (const source of enabledSources) {
    try {
      const result = await discoverSourceUrls(config, source);
      diagnostics.push(...result.diagnostics);
      const origins = effectiveOrigins(config, source);
      result.urls.forEach((url) => discovered.push({ url, source, origins }));
    } catch (error) {
      diagnostics.push(`${source.label}：${error instanceof Error ? error.message : "来源发现失败"}`);
    }
  }

  const uniqueUrls = [...new Map(discovered.map((item) => [item.url, item])).values()];
  const documents: AcquisitionDocument[] = [];
  const hashes = new Set<string>();
  let duplicateCount = discovered.length - uniqueUrls.length;
  for (const candidate of uniqueUrls) {
    if (documents.length >= config.maxDocuments) break;
    try {
      const fetched = await fetchDocument(candidate.url, candidate.origins);
      if (hashes.has(fetched.contentHash)) {
        duplicateCount += 1;
        continue;
      }
      hashes.add(fetched.contentHash);
      documents.push({
        id: crypto.randomUUID(),
        url: fetched.url,
        title: fetched.title,
        publisher: fetched.publisher,
        publishedAt: fetched.publishedAt,
        fetchedAt: fetched.fetchedAt,
        contentHash: fetched.contentHash,
        text: fetched.text,
        excerpt: fetched.excerpt,
        sourceKind: candidate.source.kind,
        authority: candidate.source.authority,
        contentPolicy: candidate.source.contentPolicy,
        licenseNote: candidate.source.licenseNote,
      });
    } catch (error) {
      diagnostics.push(`${candidate.url}：${error instanceof Error ? error.message : "抓取失败"}`);
    }
  }
  return { documents, discoveredCount: uniqueUrls.length, fetchedCount: documents.length, duplicateCount, diagnostics };
}

/** 配置预览是纯函数，不联网、不调用模型。 */
export function previewCollectionConfig(input: AutomationCollectionConfig) {
  const config = normalizeCollectionConfig(input);
  const enabled = config.sources.filter((source) => source.enabled);
  return {
    sourceLabels: enabled.map((source) => source.label),
    allowedOrigins: config.allowedOrigins,
    estimatedDocuments: Math.min(config.maxDocuments, Math.max(enabled.length, config.queries.length)),
  };
}

/** 确认前重新读取来源并比较内容哈希，防止过期证据写入 Vault。 */
export async function verifyAcquisitionProposalSources(proposal: KnowledgeEvolutionProposal): Promise<void> {
  if (!proposal.provenance) return;
  for (const document of proposal.provenance.documents) {
    try {
      const origin = new URL(document.url).origin;
      const current = await fetchDocument(document.url, [origin]);
      if (current.contentHash !== document.contentHash) throw new Error(`来源内容哈希已变化：${document.title}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("哈希已变化")) throw error;
      throw new Error(`来源 URL 无法验证：${document.title}`);
    }
  }
}
