"use client";

import { useMemo, useState } from "react";
import { mcpSettingsRepository } from "../../services/mcp-settings-repository";
import { Button, EmptyState, IconButton } from "../shared/ui-primitives";

type ConversationMcpToolPanelProps = {
  onClose: () => void;
  onExecuted: (label: string, summary: string) => Promise<void>;
  onNotice: (message: string) => void;
};

/** 对话内 MCP 调用面板；原始结果只保留在组件内存，运行记录仅接收脱敏摘要。 */
export function ConversationMcpToolPanel({ onClose, onExecuted, onNotice }: ConversationMcpToolPanelProps) {
  const snapshot = useMemo(() => mcpSettingsRepository.load(), []);
  const servers = snapshot.profiles.filter((profile) => profile.enabled && snapshot.discovery[profile.id]?.status === "ready");
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const tools = snapshot.discovery[serverId]?.toolDescriptors ?? [];
  const [toolName, setToolName] = useState(tools[0]?.name ?? "");
  const [argumentText, setArgumentText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [resultPreview, setResultPreview] = useState("");
  const server = servers.find((item) => item.id === serverId);
  const tool = tools.find((item) => item.name === toolName);

  async function execute() {
    if (!server || !tool) return;
    if (tool.permission === "deny") return onNotice("该 MCP 工具已被禁止");
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argumentText) as Record<string, unknown>;
    } catch {
      return onNotice("参数必须是 JSON 对象");
    }
    setBusy(true);
    try {
      const result = await mcpSettingsRepository.callTool(server, tool.name, args);
      const raw = JSON.stringify(result);
      setResultPreview(raw.slice(0, 2400));
      await onExecuted(`${server.label} / ${tool.name}`, `参数键：${Object.keys(args).join("、") || "无"} · 已返回 ${raw.length} 字符`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "MCP 工具调用失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="conversation-inline-inspector" aria-label="MCP 工具调用">
      <header><div><span>MCP TOOL</span><h2>调用外部工具</h2></div><IconButton icon="close" label="关闭 MCP 工具面板" onClick={onClose} /></header>
      {servers.length ? <>
        <div className="conversation-inline-fields">
          <label>Server<select value={serverId} onChange={(event) => { const id = event.currentTarget.value; setServerId(id); setToolName(snapshot.discovery[id]?.toolDescriptors?.[0]?.name ?? ""); }}><option value="">选择 Server</option>{servers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Tool<select value={toolName} onChange={(event) => setToolName(event.currentTarget.value)}><option value="">选择 Tool</option>{tools.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
          <label className="col-span-full">参数 JSON<textarea rows={4} value={argumentText} onChange={(event) => setArgumentText(event.currentTarget.value)} /></label>
        </div>
        <p className="conversation-tool-confirmation">将调用 <strong>{server?.label ?? "-"}</strong> 的 <strong>{tool?.name ?? "-"}</strong>；参数键与脱敏状态会写入运行摘要，原始结果不会持久化。</p>
        <Button variant="primary" disabled={busy || !tool || tool.permission === "deny"} onClick={() => void execute()}>{busy ? "调用中…" : "确认并调用"}</Button>
        {resultPreview ? <details className="conversation-mcp-result"><summary>查看本次内存结果</summary><pre>{resultPreview}</pre></details> : null}
      </> : <EmptyState stateId="conversation.mcp-tools.empty">没有已启用且发现成功的 MCP Server。请先到“设置 → MCP”连接并发现能力。</EmptyState>}
    </section>
  );
}
