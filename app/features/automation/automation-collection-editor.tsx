"use client";

import { useMemo } from "react";
import { mcpSettingsRepository } from "../../services/mcp-settings-repository";
import type { AcquisitionModelRef, AcquisitionSourceConfig, AutomationCollectionConfig } from "../../types/domains/acquisition.ts";
import { Button, Chip } from "../shared/ui-primitives";
import { UiReviewEmptyAction } from "../shared/ui-review-data-context.tsx";
import type { AutomationCenter } from "./use-automation-center.ts";

type Props = {
  config: AutomationCollectionConfig;
  center: AutomationCenter;
  onChange: (config: AutomationCollectionConfig) => void;
};

function splitLines(value: string): string[] {
  return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
}

function defaultSource(kind: AcquisitionSourceConfig["kind"]): AcquisitionSourceConfig {
  const base = { id: crypto.randomUUID(), label: kind === "url" ? "指定页面" : kind === "feed" ? "RSS / Atom" : "MCP 搜索", enabled: false, allowedOrigins: [], authority: "other" as const, contentPolicy: "summary_only" as const };
  if (kind === "url") return { ...base, kind, urls: [] };
  if (kind === "feed") return { ...base, kind, url: "" };
  return { ...base, kind, serverId: "", toolName: "", argumentTemplate: '{"query":"{{query}}"}' };
}

/** 采集模板的来源、白名单、内容策略与双模型配置。 */
export function AutomationCollectionEditor({ config, center, onChange }: Props) {
  const mcpSnapshot = useMemo(() => mcpSettingsRepository.load(), []);
  const scheduledTools = useMemo(() => mcpSnapshot.profiles.filter((profile) => profile.enabled).flatMap((profile) => {
    const discovery = mcpSnapshot.discovery[profile.id];
    return (discovery?.status === "ready" ? discovery.toolDescriptors ?? [] : [])
      .filter((tool) => tool.permission === "allow_scheduled")
      .map((tool) => ({ serverId: profile.id, serverLabel: profile.label, toolName: tool.name }));
  }), [mcpSnapshot]);

  function updateSource(id: string, updater: (source: AcquisitionSourceConfig) => AcquisitionSourceConfig): void {
    onChange({ ...config, sources: config.sources.map((source) => source.id === id ? updater(source) : source) });
  }

  function changeModel(kind: "curator" | "reviewer", patch: Partial<AcquisitionModelRef>): void {
    const current = config[kind] ?? { connectionId: "", modelId: "" };
    onChange({ ...config, [kind]: { ...current, ...patch } });
  }

  return (
    <fieldset className="grid gap-4 rounded-xl border border-line bg-surface-muted/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <legend className="font-medium">外部知识采集</legend>
          <p className="mt-1 text-xs text-muted">来源默认停用；预览不会联网或调用模型。</p>
        </div>
        <Chip tone="blue">{config.domain === "xingce" ? "行测" : config.domain === "shenlun" ? "申论" : "面试"}</Chip>
      </div>

      <label className="grid gap-1 text-sm">
        查询词
        <textarea className="min-h-20 rounded-lg border border-line bg-background p-3" value={config.queries.join("\n")} onChange={(event) => {
          const queries = splitLines(event.currentTarget.value);
          onChange({ ...config, queries });
        }} />
      </label>
      <label className="grid gap-1 text-sm">
        任务允许域名（每行一个完整 origin）
        <textarea className="min-h-20 rounded-lg border border-line bg-background p-3 font-mono text-xs" placeholder="https://www.gov.cn" value={config.allowedOrigins.join("\n")} onChange={(event) => {
          const allowedOrigins = splitLines(event.currentTarget.value);
          onChange({ ...config, allowedOrigins });
        }} />
      </label>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">来源</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onChange({ ...config, sources: [...config.sources, defaultSource("url")] })}>+ 页面</Button>
            <Button size="sm" variant="outline" onClick={() => onChange({ ...config, sources: [...config.sources, defaultSource("feed")] })}>+ RSS</Button>
            <Button size="sm" variant="outline" onClick={() => onChange({ ...config, sources: [...config.sources, defaultSource("mcp_search")] })}>+ MCP</Button>
          </div>
        </div>
        {config.sources.length ? config.sources.map((source) => (
          <div key={source.id} className="grid gap-3 rounded-xl border border-line bg-background p-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={source.enabled} onChange={(event) => {
                const enabled = event.currentTarget.checked;
                updateSource(source.id, (current) => ({ ...current, enabled }));
              }} />启用</label>
              <input aria-label="来源名称" className="min-h-9 min-w-40 flex-1 rounded-lg border border-line bg-background px-3 text-sm" value={source.label} onChange={(event) => {
                const label = event.currentTarget.value;
                updateSource(source.id, (current) => ({ ...current, label }));
              }} />
              <Button size="sm" variant="ghost" onClick={() => onChange({ ...config, sources: config.sources.filter((item) => item.id !== source.id) })}>移除</Button>
            </div>
            {source.kind === "url" ? <textarea aria-label="指定页面 URL" className="min-h-16 rounded-lg border border-line p-2 font-mono text-xs" placeholder="https://example.com/article" value={source.urls.join("\n")} onChange={(event) => {
              const urls = splitLines(event.currentTarget.value);
              updateSource(source.id, (current) => current.kind === "url" ? { ...current, urls } : current);
            }} /> : null}
            {source.kind === "feed" ? <input aria-label="RSS 地址" className="min-h-9 rounded-lg border border-line px-3 font-mono text-xs" placeholder="https://example.com/feed.xml" value={source.url} onChange={(event) => {
              const url = event.currentTarget.value;
              updateSource(source.id, (current) => current.kind === "feed" ? { ...current, url } : current);
            }} /> : null}
            {source.kind === "mcp_search" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <select aria-label="MCP 定时工具" className="min-h-9 rounded-lg border border-line bg-background px-2 text-sm" value={`${source.serverId}\u0000${source.toolName}`} onChange={(event) => {
                  const [serverId, toolName] = event.currentTarget.value.split("\u0000");
                  updateSource(source.id, (current) => current.kind === "mcp_search" ? { ...current, serverId, toolName } : current);
                }}>
                  <option value="\u0000">选择已获定时授权的工具</option>
                  {scheduledTools.map((tool) => <option key={`${tool.serverId}:${tool.toolName}`} value={`${tool.serverId}\u0000${tool.toolName}`}>{tool.serverLabel} · {tool.toolName}</option>)}
                </select>
                <input aria-label="MCP 参数模板" className="min-h-9 rounded-lg border border-line px-3 font-mono text-xs" value={source.argumentTemplate} onChange={(event) => {
                  const argumentTemplate = event.currentTarget.value;
                  updateSource(source.id, (current) => current.kind === "mcp_search" ? { ...current, argumentTemplate } : current);
                }} />
              </div>
            ) : null}
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-xs">来源允许域名<input className="min-h-9 rounded-lg border border-line px-2 font-mono" value={source.allowedOrigins.join(", ")} onChange={(event) => {
                const allowedOrigins = splitLines(event.currentTarget.value);
                updateSource(source.id, (current) => ({ ...current, allowedOrigins }));
              }} /></label>
              <label className="grid gap-1 text-xs">权威性<select className="min-h-9 rounded-lg border border-line bg-background px-2" value={source.authority} onChange={(event) => {
                const authority = event.currentTarget.value as AcquisitionSourceConfig["authority"];
                updateSource(source.id, (current) => ({ ...current, authority }));
              }}><option value="official">官方 / 一手</option><option value="recognized">权威媒体 / 机构</option><option value="other">其他</option></select></label>
              <label className="grid gap-1 text-xs">内容策略<select className="min-h-9 rounded-lg border border-line bg-background px-2" value={source.contentPolicy} onChange={(event) => {
                const contentPolicy = event.currentTarget.value as AcquisitionSourceConfig["contentPolicy"];
                updateSource(source.id, (current) => ({ ...current, contentPolicy }));
              }}><option value="summary_only">仅摘要（默认）</option><option value="licensed_full_text">自有 / 允许全文</option></select></label>
            </div>
          </div>
        )) : <div data-review-state="automation.collection.sources.empty"><p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">尚未添加来源；模板不会访问网络。</p><UiReviewEmptyAction packId="automation" /></div>}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ModelFields label="整理模型 A" optional={false} value={config.curator} center={center} onChange={(patch) => changeModel("curator", patch)} />
        <ModelFields label="复核模型 B" optional value={config.reviewer} center={center} onChange={(patch) => changeModel("reviewer", patch)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">新鲜度（天）<input type="number" min={1} max={365} className="min-h-9 rounded-lg border border-line px-3" value={config.freshnessDays} onChange={(event) => onChange({ ...config, freshnessDays: Number(event.currentTarget.value) })} /></label>
        <label className="grid gap-1 text-sm">每次最多文档<input type="number" min={1} max={10} className="min-h-9 rounded-lg border border-line px-3" value={config.maxDocuments} onChange={(event) => onChange({ ...config, maxDocuments: Number(event.currentTarget.value) })} /></label>
      </div>
    </fieldset>
  );
}

/** 连接和模型字段分开保存，绝不复制连接密钥。 */
function ModelFields({ label, optional, value, center, onChange }: { label: string; optional: boolean; value?: AcquisitionModelRef; center: AutomationCenter; onChange: (patch: Partial<AcquisitionModelRef>) => void }) {
  return (
    <div className="grid gap-2 rounded-lg border border-line bg-background p-3">
      <span className="text-sm font-medium">{label}{optional ? "（可选）" : ""}</span>
      <select aria-label={`${label}连接`} className="min-h-9 rounded-lg border border-line bg-background px-2 text-sm" value={value?.connectionId ?? ""} onChange={(event) => onChange({ connectionId: event.currentTarget.value })}>
        <option value="">选择文本连接</option>
        {center.aiSnapshot.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select>
      <input aria-label={`${label}模型 ID`} className="min-h-9 rounded-lg border border-line px-3 font-mono text-xs" placeholder="模型 ID" value={value?.modelId ?? ""} onChange={(event) => onChange({ modelId: event.currentTarget.value })} />
      {optional && !value?.connectionId ? <span className="text-xs text-amber-700">未配置时等级最高为 B，并标记“未交叉复核”。</span> : null}
    </div>
  );
}
