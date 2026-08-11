# MCP 权限与执行边界

Review Workspace 的 MCP 权限由 `app/services/mcp-settings-repository.ts` 在真实工具调用前统一执行。Settings、Conversation 和已安排采集任务只能提供调用意图，不能替代 execution boundary。

## Phase 1 状态

已完成 Permission Decision Core & MCP Execution Boundary。0.6 MCP / Automation / Plugin 权限模型仍处于 IN PROGRESS；Automation / Acquisition 无人值守权限扩展、声明式扩展权限和 Acceptance Closure 留给后续阶段。

本阶段不新增 Dexie 表或 schema，不执行插件代码，不改变 MCP Streamable HTTP、凭据解密或 SSRF 网络策略。

## 两种权限状态

- 持久化 policy 只保存可跨 reload 保留的用户决策：`ask`、`allow_scheduled`、`deny`。
- `allow_session` 只存在于内存 `mcpSessionPermissionGrants`，作用域是精确的 `serverId + toolName`。刷新页面、重启 Web 应用或重启 Electron renderer 后会消失。
- 旧快照若仍含 `permission: "allow_session"`，读取时安全规范化为 `ask`，不会恢复授权；下一次正常写入会写回 canonical policy。
- 改为 `ask`、`deny` 或 `allow_scheduled` 会立即清除同一工具的会话 grant。重新发现时只保留仍存在且仍在 allowlist 中的工具 grant；连接变化、删除 Server 或工具消失会使旧 grant 失效。

## 决策矩阵

| 持久化 policy / 会话状态 | interactive，无当前确认 | interactive，当前确认 | scheduled |
| --- | --- | --- | --- |
| `deny` | denied | denied | denied |
| `ask` | confirmation required | allowed | denied |
| `allow_session`（内存 grant） | allowed | allowed | denied |
| `allow_scheduled` | confirmation required | allowed | allowed |

`confirmed: true` 只由当前用户点击“确认并调用”的交互路径传入；挂载、effect、timer、AI 响应、导航和自动化触发都不能伪造本次确认。`allow_scheduled` 不会让交互调用静默执行。

## 执行顺序与 fail closed

任何 `callTool` 或 `callScheduledTool` 都必须经过同一个边界：

```text
读取当前 Server / discovery / tool
        ↓
Permission Decision Core
        ↓
解密当前 Server credential
        ↓
/api/mcp/call → MCP Streamable HTTP → remote Server
```

Server disabled、discovery 非 `ready`、工具已从最新 discovery 移除或权限 decision 非 `allowed` 时，不会解析 Token，也不会发起 `/api/mcp/call` 或远端请求。Discovery 只更新能力描述，新增工具默认 `ask`，不授予执行权限。

已安排采集的 MCP source 仍保留现有白名单、内容抓取和手动恢复边界，只通过 `callScheduledTool` 使用 `allow_scheduled`。本阶段不重构 Automation，也不新增 Acquisition 权限 UI。

## 隐私与最小审计

原始 tool result 只存在当前 Conversation 面板内存；运行摘要只记录 Server、tool、参数键和结果长度等脱敏信息。权限层不保存完整 arguments、raw result、Bearer token、Authorization header 或完整上下文。已有 MCP route 的请求预算、凭据边界、`allowPrivateNetwork` 和出站网络校验保持不变。
