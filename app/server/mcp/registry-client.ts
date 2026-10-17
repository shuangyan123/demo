import { outboundFetch } from "../http/outbound-fetch.ts";
import type { McpCatalogEntry, McpRegistryPage } from "../../types/domains/mcp.ts";

const REGISTRY_ORIGIN = "https://registry.modelcontextprotocol.io";
const REGISTRY_PATH = "/v0.1/servers";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; page: McpRegistryPage }>();

type RegistryRemote = { type?: string; url?: string };
type RegistryServer = {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  repository?: { url?: string };
  remotes?: RegistryRemote[];
};
type RegistryItem = {
  server?: RegistryServer;
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: {
      status?: string;
      isLatest?: boolean;
      updatedAt?: string;
    };
  };
};
type RegistryResponse = {
  servers?: RegistryItem[];
  metadata?: { nextCursor?: string };
};

function mapEntry(item: RegistryItem): McpCatalogEntry | undefined {
  const server = item.server;
  const official = item._meta?.["io.modelcontextprotocol.registry/official"];
  const remote = server?.remotes?.find((candidate) => candidate.type === "streamable-http" && candidate.url);
  if (!server?.name || !server.version || !remote?.url || official?.status !== "active" || official.isLatest !== true) return undefined;
  return {
    id: server.name,
    title: server.title || server.name,
    description: server.description || "没有说明",
    version: server.version,
    endpoint: remote.url,
    repositoryUrl: server.repository?.url,
    updatedAt: official.updatedAt,
    source: "registry",
    authMode: "none",
    compatibility: "streamable-http",
    riskLabel: "社区条目 · 添加前请核验来源与权限",
  };
}

/** 固定访问官方 Registry；调用方不能替换上游地址。 */
export async function queryOfficialMcpRegistry(input: { query?: string; cursor?: string }): Promise<McpRegistryPage> {
  const query = input.query?.trim().slice(0, 120) ?? "";
  const cursor = input.cursor?.trim().slice(0, 300) ?? "";
  const cacheKey = `${query}\n${cursor}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.page;

  const url = new URL(REGISTRY_PATH, REGISTRY_ORIGIN);
  url.searchParams.set("limit", "24");
  url.searchParams.set("version", "latest");
  if (query) url.searchParams.set("search", query);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await outboundFetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, { allowLoopback: false, allowPrivateNetwork: false });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`MCP Registry 暂时不可用（${response.status}）`); }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error("MCP Registry 响应超过安全上限");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("MCP Registry 响应超过安全上限");
  const parsed = JSON.parse(text) as RegistryResponse;
  const page = {
    entries: (parsed.servers ?? []).flatMap((item) => {
      const entry = mapEntry(item);
      return entry ? [entry] : [];
    }),
    nextCursor: parsed.metadata?.nextCursor,
  };
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, page });
  return page;
}
