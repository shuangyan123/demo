"use client";

import { useMemo, useState, type FormEvent } from "react";
import { mcpSettingsRepository, type McpSettingsSnapshot } from "../../services/mcp-settings-repository.ts";
import type { McpServerProfile, McpToolPermission } from "../../types/domains/mcp.ts";
import { AppIcon } from "../shared/app-icon";
import { Button, Chip, EmptyState, cx } from "../shared/ui-primitives";

type McpForm = {
  id?: string;
  label: string;
  endpoint: string;
  enabled: boolean;
  authMode: "none" | "bearer";
  token: string;
};

const emptyForm: McpForm = {
  label: "本地 MCP Server",
  endpoint: "http://127.0.0.1:8765/mcp",
  enabled: true,
  authMode: "none",
  token: "",
};

/** MCP 设置采用服务器列表与详情检查器，发现结果只保存脱敏描述。 */
export function McpSettingsView({ onNotice }: { onNotice: (message: string) => void }) {
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

  return (
    <section className="mcp-settings-view">
      <header className="settings-page-heading">
        <p className="settings-eyebrow">工具与外部上下文</p>
        <h1>MCP</h1>
        <p>仅支持 Streamable HTTP。远程地址必须使用 HTTPS，本机 HTTP 仅允许 loopback；Token 会在本地加密。</p>
      </header>

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
          }) : <EmptyState>还没有 MCP Server。</EmptyState>}
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
                ) : <EmptyState>{discovery?.message ?? "点击“发现能力”读取真实 tools、resources 与 prompts。"}</EmptyState>}
              </section>
            </>
          ) : <EmptyState>添加一个 MCP Server 后，在这里检查连接与工具权限。</EmptyState>}
        </main>

        <form className="mcp-server-form" onSubmit={save}>
          <div className="flex items-center justify-between"><h2>{form.id ? "编辑 Server" : "添加 Server"}</h2>{form.id ? <button type="button" onClick={() => setForm(emptyForm)}>新建</button> : null}</div>
          <label className="ui-field">名称<input className="ui-input" required value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} /></label>
          <label className="ui-field">Endpoint<input className="ui-input" required placeholder="https://example.com/mcp" value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.currentTarget.value })} /></label>
          <label className="ui-field">认证<select className="ui-select" value={form.authMode} onChange={(event) => setForm({ ...form, authMode: event.currentTarget.value as McpForm["authMode"] })}><option value="none">无认证</option><option value="bearer">Bearer Token</option></select></label>
          {form.authMode === "bearer" ? <label className="ui-field">Token<input className="ui-input" type="password" autoComplete="off" placeholder={form.id ? "留空则保留现有 Token" : "输入 Token"} value={form.token} onChange={(event) => setForm({ ...form, token: event.currentTarget.value })} /></label> : null}
          <label className="inline-flex items-center gap-2 text-sm"><input checked={form.enabled} className="ui-checkbox" type="checkbox" onChange={(event) => setForm({ ...form, enabled: event.currentTarget.checked })} />启用</label>
          <Button type="submit" variant="primary">保存 Server</Button>
        </form>
      </div>
    </section>
  );
}
