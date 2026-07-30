"use client";

import { useMemo, useState, type FormEvent } from "react";
import { mcpSettingsRepository, type McpSettingsSnapshot } from "../../services/mcp-settings-repository.ts";
import type { McpCatalogEntry, McpServerProfile, McpToolPermission } from "../../types/domains/mcp.ts";
import { AppIcon } from "../shared/app-icon";
import { DevelopmentExampleSwitcher, useDevelopmentExample, type DevelopmentExampleOption } from "../shared/development-example-switcher";
import { Button, Chip, EmptyState, cx } from "../shared/ui-primitives";
import { McpCatalog } from "./mcp-catalog.tsx";

type McpForm = {
  id?: string;
  label: string;
  endpoint: string;
  enabled: boolean;
  authMode: "none" | "bearer";
  token: string;
  allowPrivateNetwork: boolean;
};

const emptyForm: McpForm = {
  label: "本地 MCP Server",
  endpoint: "http://127.0.0.1:8765/mcp",
  enabled: false,
  authMode: "none",
  token: "",
  allowPrivateNetwork: false,
};
const mcpExampleOptions: DevelopmentExampleOption[] = [
  { id: "mcp-connected", label: "已连接与工具权限" },
  { id: "server-error", label: "连接错误" },
];

/** MCP 入口在开发环境可切换纯内存示例，示例态不会读取服务器仓储。 */
export function McpSettingsView({ developmentExample, onNotice }: { developmentExample?: string; onNotice: (message: string) => void }) {
  const example = useDevelopmentExample(developmentExample, mcpExampleOptions);
  if (example.value) {
    return (
      <>
        <DevelopmentExampleSwitcher options={mcpExampleOptions} value={example.value} onChange={example.select} />
        <McpDevelopmentExample scenario={example.value} />
      </>
    );
  }
  return (
    <>
      {example.enabled ? <DevelopmentExampleSwitcher options={mcpExampleOptions} value={example.value} onChange={example.select} /> : null}
      <McpSettingsLiveView onNotice={onNotice} />
    </>
  );
}

/** MCP 设置采用服务器列表与详情检查器，发现结果只保存脱敏描述。 */
function McpSettingsLiveView({ onNotice }: { onNotice: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<McpSettingsSnapshot>(() => mcpSettingsRepository.load());
  const [form, setForm] = useState<McpForm>(emptyForm);
  const [selectedId, setSelectedId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const selected = useMemo(
    () => snapshot.profiles.find((profile) => profile.id === selectedId) ?? snapshot.profiles[0],
    [selectedId, snapshot.profiles],
  );
  const discovery = selected ? snapshot.discovery[selected.id] : undefined;

  function refresh(preferredId?: string) {
    const next = mcpSettingsRepository.load();
    setSnapshot(next);
    if (preferredId) setSelectedId(preferredId);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const profile = await mcpSettingsRepository.saveProfile(form);
      setForm(emptyForm);
      refresh(profile.id);
      onNotice("MCP Server 已保存；需要点击“发现能力”后才会连接。 ");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "无法保存 MCP Server");
    }
  }

  function edit(profile: McpServerProfile) {
    setSelectedId(profile.id);
    setForm({
      id: profile.id,
      label: profile.label,
      endpoint: profile.endpoint,
      enabled: profile.enabled,
      authMode: profile.authMode,
      token: "",
      allowPrivateNetwork: profile.allowPrivateNetwork === true,
    });
  }

  async function discover(profile: McpServerProfile) {
    setBusyId(profile.id);
    try {
      const result = await mcpSettingsRepository.discover(profile);
      refresh(profile.id);
      onNotice(result.message);
    } catch (error) {
      refresh(profile.id);
      onNotice(error instanceof Error ? error.message : "MCP 能力发现失败");
    } finally {
      setBusyId(undefined);
    }
  }

  function remove(profile: McpServerProfile) {
    mcpSettingsRepository.removeProfile(profile.id);
    if (form.id === profile.id) setForm(emptyForm);
    refresh();
    onNotice("MCP Server 已删除");
  }

  function changePermission(toolName: string, permission: McpToolPermission) {
    if (!selected) return;
    mcpSettingsRepository.setToolPermission(selected.id, toolName, permission);
    refresh(selected.id);
  }

  async function addCatalogEntry(entry: McpCatalogEntry) {
    if (!entry.endpoint) {
      onNotice("该条目没有可用的 Streamable HTTP 地址，不能添加。");
      return;
    }
    const profile = await mcpSettingsRepository.saveProfile({
      label: entry.title,
      endpoint: entry.endpoint,
      enabled: false,
      authMode: entry.authMode,
      allowPrivateNetwork: false,
      toolAllowlist: entry.toolAllowlist,
      catalogSource: entry.source,
    });
    refresh(profile.id);
    setForm({
      id: profile.id,
      label: profile.label,
      endpoint: profile.endpoint,
      enabled: false,
      authMode: profile.authMode,
      token: "",
      allowPrivateNetwork: false,
    });
    onNotice(entry.compatibility === "local-process-required"
      ? "已添加停用模板；请自行启动官方 HTTP Server，本应用不会安装或执行社区代码。"
      : "已添加停用 Server；填写鉴权并成功发现能力后才能启用。");
  }

  return (
    <section className="mcp-settings-view">
      <header className="settings-page-heading">
        <p className="settings-eyebrow">工具与外部上下文</p>
        <h1>MCP</h1>
        <p>仅支持 Streamable HTTP。远程地址必须使用 HTTPS，本机 HTTP 仅允许 loopback；Token 会在本地加密。</p>
      </header>

      <McpCatalog onAdd={addCatalogEntry} />

      <div className="mcp-settings-layout">
        <aside className="mcp-server-list" aria-label="MCP Server 列表">
          <div className="mcp-server-list-heading"><strong>Servers</strong><span>{snapshot.profiles.length}</span></div>
          {snapshot.profiles.length ? snapshot.profiles.map((profile) => {
            const itemDiscovery = snapshot.discovery[profile.id];
            return (
              <button
                className={cx("mcp-server-row", selected?.id === profile.id && "is-selected")}
                key={profile.id}
                type="button"
                onClick={() => setSelectedId(profile.id)}
              >
                <span className="mcp-server-icon"><AppIcon name="system" size={18} /></span>
                <span className="min-w-0"><strong>{profile.label}</strong><small>{profile.endpoint}</small></span>
                <span className={cx("mcp-status-dot", itemDiscovery?.status === "ready" && "is-ready", itemDiscovery?.status === "error" && "is-error")} />
              </button>
            );
          }) : <EmptyState stateId="settings.mcp.servers.empty">还没有 MCP Server。</EmptyState>}
          <button className="mcp-add-server" type="button" onClick={() => setForm(emptyForm)}><AppIcon name="newChat" size={16} />添加 Server</button>
        </aside>

        <main className="mcp-server-inspector">
          {selected ? (
            <>
              <header className="mcp-inspector-heading">
                <div><span>MCP SERVER</span><h2>{selected.label}</h2><p>{selected.endpoint}</p></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busyId === selected.id} onClick={() => void discover(selected)}>{busyId === selected.id ? "发现中…" : "发现能力"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => edit(selected)}>编辑</Button>
                  <Button size="sm" variant="danger" onClick={() => remove(selected)}>删除</Button>
                </div>
              </header>
              <div className="mcp-inspector-meta">
                <span>认证 <strong>{selected.authMode === "bearer" ? "Bearer Token" : "无"}</strong></span>
                <span>状态 <Chip tone={discovery?.status === "ready" ? "green" : discovery?.status === "error" ? "red" : "neutral"}>{discovery?.status ?? "未发现"}</Chip></span>
                {discovery ? <span>能力 <strong>{discovery.tools.length} tools · {discovery.resources.length} resources · {discovery.prompts.length} prompts</strong></span> : null}
              </div>
              <section className="mcp-tools-section">
                <div><h3>Tools</h3><p>“允许已安排任务”是无人值守调用的唯一有效授权；每次运行仍会复核 Server、工具和任务级白名单。</p></div>
                {discovery?.toolDescriptors?.length ? (
                  <div className="mcp-tool-table">
                    {discovery.toolDescriptors.map((tool) => (
                      <div className="mcp-tool-row" key={tool.name}>
                        <span><strong>{tool.name}</strong><small>{tool.description || "没有说明"}</small></span>
                        <select aria-label={`${tool.name} 权限`} value={tool.permission} onChange={(event) => changePermission(tool.name, event.currentTarget.value as McpToolPermission)}>
                          <option value="ask">每次询问</option>
                          <option value="allow_session">本次会话允许</option>
                          <option value="allow_scheduled">允许已安排任务</option>
                          <option value="deny">禁止</option>
                        </select>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState stateId="settings.mcp.discovery.empty">{discovery?.message ?? "点击“发现能力”读取真实 tools、resources 与 prompts。"}</EmptyState>}
              </section>
            </>
          ) : <EmptyState stateId="settings.mcp.selection.empty">添加一个 MCP Server 后，在这里检查连接与工具权限。</EmptyState>}
        </main>

        <form className="mcp-server-form" onSubmit={save}>
          <div className="flex items-center justify-between"><h2>{form.id ? "编辑 Server" : "添加 Server"}</h2>{form.id ? <button type="button" onClick={() => setForm(emptyForm)}>新建</button> : null}</div>
          <label className="ui-field">名称<input className="ui-input" required value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} /></label>
          <label className="ui-field">Endpoint<input className="ui-input" required placeholder="https://example.com/mcp" value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.currentTarget.value })} /></label>
          <label className="ui-field">认证<select className="ui-select" value={form.authMode} onChange={(event) => setForm({ ...form, authMode: event.currentTarget.value as McpForm["authMode"] })}><option value="none">无认证</option><option value="bearer">Bearer Token</option></select></label>
          {form.authMode === "bearer" ? <label className="ui-field">Token<input className="ui-input" type="password" autoComplete="off" placeholder={form.id ? "留空则保留现有 Token" : "输入 Token"} value={form.token} onChange={(event) => setForm({ ...form, token: event.currentTarget.value })} /></label> : null}
          <label className="inline-flex items-start gap-2 text-sm text-muted"><input checked={form.allowPrivateNetwork} className="ui-checkbox mt-0.5" type="checkbox" onChange={(event) => setForm({ ...form, allowPrivateNetwork: event.currentTarget.checked })} /><span>允许访问局域网地址<small className="block">本机 loopback 无需开启；云元数据和链路本地地址始终禁止。</small></span></label>
          <label className="inline-flex items-center gap-2 text-sm"><input checked={form.enabled} className="ui-checkbox" type="checkbox" onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} />启用</label>
          <Button type="submit" variant="primary">保存 Server</Button>
        </form>
      </div>
    </section>
  );
}

/** 展示发现完成和连接失败后的 MCP 检查器，不创建真实 Server。 */
function McpDevelopmentExample({ scenario }: { scenario: string }) {
  const failed = scenario === "server-error";
  return (
    <section className="mcp-settings-view" aria-label="MCP 开发示例">
      <header className="settings-page-heading">
        <p className="settings-eyebrow">开发示例</p>
        <h1>MCP</h1>
        <p>示例用于批注 Server、工具权限、资源和错误恢复状态。</p>
      </header>
      <div className="mcp-settings-layout">
        <aside className="mcp-server-list">
          <div className="mcp-server-list-heading"><strong>Servers</strong><span>1</span></div>
          <button className="mcp-server-row is-selected" type="button">
            <span className="mcp-server-icon"><AppIcon name="system" size={18} /></span>
            <span className="min-w-0"><strong>本地学习工具</strong><small>http://127.0.0.1:8765/mcp</small></span>
            <span className={cx("mcp-status-dot", failed ? "is-error" : "is-ready")} />
          </button>
        </aside>
        <main className="mcp-inspector">
          <header className="mcp-inspector-heading"><div><h2>本地学习工具</h2><p>{failed ? "连接被拒绝，请检查 Server 是否运行" : "已发现真实能力描述的示例形态"}</p></div><Chip tone={failed ? "red" : "green"}>{failed ? "错误" : "ready"}</Chip></header>
          <div className="mcp-inspector-meta"><span>认证 <strong>Bearer Token</strong></span><span>能力 <strong>{failed ? "0 tools" : "2 tools · 1 resource"}</strong></span></div>
          <section className="mcp-tools-section">
            <div><h3>Tools</h3><p>权限示例不会保存，也不会执行工具。</p></div>
            {failed ? <EmptyState stateId="settings.mcp.failed">重新启动 Server 后点击“发现能力”。</EmptyState> : (
              <div className="mcp-tool-table">
                {["search_knowledge", "read_resource"].map((name, index) => (
                  <div className="mcp-tool-row" key={name}><span><strong>{name}</strong><small>{index ? "读取选定资源" : "搜索本地知识摘要"}</small></span><select aria-label={`${name} 示例权限`} defaultValue={index ? "ask" : "allow_session"}><option value="ask">每次询问</option><option value="allow_session">本次会话允许</option><option value="deny">禁止</option></select></div>
                ))}
              </div>
            )}
          </section>
        </main>
        <aside className="mcp-server-form"><h2>资源</h2><p className="text-sm text-muted">{failed ? "连接恢复后显示资源。" : "review://knowledge/index"}</p></aside>
      </div>
    </section>
  );
}
