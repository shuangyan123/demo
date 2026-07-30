"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { McpCatalogEntry, McpRegistryPage } from "../../types/domains/mcp.ts";
import { fetchLocalApi } from "../../services/local-runtime-diagnostics.ts";
import { AppIcon } from "../shared/app-icon.tsx";
import { Button, Chip, EmptyState } from "../shared/ui-primitives.tsx";
import { useUiReviewData } from "../shared/ui-review-data-context.tsx";

const RECOMMENDED: McpCatalogEntry[] = [
  {
    id: "recommended:tavily-search",
    title: "Tavily Remote Search",
    description: "远程搜索入口；仅开放 tavily-search，网页正文继续由应用安全抓取。",
    version: "remote",
    endpoint: "https://mcp.tavily.com/mcp/",
    source: "recommended",
    authMode: "bearer",
    toolAllowlist: ["tavily-search"],
    compatibility: "streamable-http",
    riskLabel: "推荐 · 需要 Tavily API Key",
  },
  {
    id: "recommended:brave-search",
    title: "Brave Search 自托管模板",
    description: "官方 HTTP 自托管模板；仅开放 web/news search，本应用不会下载或启动 npm、Docker 代码。",
    version: "2.x",
    endpoint: "http://127.0.0.1:8765/mcp",
    repositoryUrl: "https://github.com/brave/brave-search-mcp-server",
    source: "recommended",
    authMode: "none",
    toolAllowlist: ["brave_web_search", "brave_news_search"],
    compatibility: "local-process-required",
    riskLabel: "需要本地进程 · 本期不自动安装",
  },
];

export function McpCatalog({ onAdd }: { onAdd: (entry: McpCatalogEntry) => Promise<void> }) {
  const uiReview = useUiReviewData();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<McpRegistryPage>({ entries: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [addingId, setAddingId] = useState<string>();

  const load = useCallback(async (nextQuery: string, cursor = "") => {
    if (uiReview?.active) {
      setPage({ entries: [] });
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("query", nextQuery.trim());
      if (cursor) params.set("cursor", cursor);
      const response = await fetchLocalApi(`/api/mcp/registry?${params}`);
      const result = await response.json() as McpRegistryPage & { message?: string };
      if (!response.ok) throw new Error(result.message || "MCP Registry 暂时不可用");
      setPage((current) => ({
        entries: cursor ? [...current.entries, ...result.entries] : result.entries,
        nextCursor: result.nextCursor,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "MCP Registry 暂时不可用");
    } finally {
      setLoading(false);
    }
  }, [uiReview?.active]);

  useEffect(() => {
    if (!uiReview?.ready || uiReview.active) return;
    const timer = window.setTimeout(() => void load("", ""), 0);
    // 首次只加载固定官方 Registry；搜索由用户显式提交。
    return () => window.clearTimeout(timer);
  }, [load, uiReview?.active, uiReview?.ready]);

  async function add(entry: McpCatalogEntry) {
    setAddingId(entry.id);
    try {
      await onAdd(entry);
    } finally {
      setAddingId(undefined);
    }
  }

  return (
    <section className="grid gap-4" aria-label="MCP 目录">
      <div className="grid gap-3">
        <div><h2 className="font-semibold">推荐</h2><p className="text-sm text-muted">添加后保持停用；填写鉴权并成功发现能力后才能启用。</p></div>
        <div className="grid gap-3 md:grid-cols-2">
          {RECOMMENDED.map((entry) => <CatalogCard adding={addingId === entry.id} entry={entry} key={entry.id} onAdd={add} />)}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-semibold">社区 Registry</h2><p className="text-sm text-muted">仅显示官方 Registry 中最新、active、提供 Streamable HTTP 的远程条目。</p></div>
          <form className="flex gap-2" onSubmit={(event: FormEvent) => { event.preventDefault(); void load(query, ""); }}>
            <label className="sr-only" htmlFor="mcp-registry-search">搜索 MCP Registry</label>
            <input id="mcp-registry-search" className="ui-input" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索名称或说明" />
            <Button disabled={loading} size="sm" type="submit" variant="outline"><AppIcon name="search" size={16} />搜索</Button>
          </form>
        </div>
        {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        {uiReview?.active ? <p className="text-sm text-muted">UI 审查数据已启用，官方 Registry 请求已暂停；推荐卡和本地审查 profile 仍可用于检查布局。</p> : null}
        {loading && !page.entries.length ? <EmptyState stateId="settings.mcp.registry.loading">正在读取官方 MCP Registry…</EmptyState> : null}
        {!loading && !page.entries.length && !error ? <EmptyState stateId="settings.mcp.registry.filtered-empty">没有匹配的 Streamable HTTP 社区条目。</EmptyState> : null}
        {page.entries.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {page.entries.map((entry) => <CatalogCard adding={addingId === entry.id} entry={entry} key={`${entry.id}:${entry.version}`} onAdd={add} />)}
          </div>
        ) : null}
        {page.nextCursor ? <Button disabled={loading} size="sm" type="button" variant="ghost" onClick={() => void load(query, page.nextCursor)}>加载更多</Button> : null}
      </div>
    </section>
  );
}

function CatalogCard({ adding, entry, onAdd }: { adding: boolean; entry: McpCatalogEntry; onAdd: (entry: McpCatalogEntry) => void }) {
  return (
    <article className="ui-card grid gap-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><strong className="block truncate">{entry.title}</strong><span className="text-xs text-muted">{entry.version}</span></div>
        <Chip tone={entry.source === "recommended" ? "green" : "yellow"}>{entry.source === "recommended" ? "推荐" : "社区"}</Chip>
      </div>
      <p className="text-sm text-muted">{entry.description}</p>
      <p className="truncate text-xs text-muted">{entry.endpoint ?? "无远程地址"}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{entry.riskLabel}</span>
        <Button disabled={adding} size="sm" type="button" variant="outline" onClick={() => onAdd(entry)}>{adding ? "添加中" : "添加"}</Button>
      </div>
    </article>
  );
}
