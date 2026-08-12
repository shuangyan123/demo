# MCP 权限与执行边界

Review Workspace 的 MCP 权限由 `app/services/mcp-settings-repository.ts` 在真实工具调用前统一执行。Settings、Conversation 和已安排采集任务只能提供调用意图，不能替代 execution boundary。

## Phase 1 状态

已完成 Permission Decision Core & MCP Execution Boundary 与 Phase 2 Automation / Acquisition Unattended Authorization & Minimal Audit。0.6 MCP / Automation / Plugin 权限模型的 Acceptance Closure 已完成；跨边界矩阵与证据见 `docs/permission-model-acceptance.md`。

本阶段不新增 Dexie 表或 schema，不执行插件代码，不改变 MCP Streamable HTTP、凭据解密或 SSRF 网络策略。

## 两种权限状态

- 持久化 policy 只保存可跨 reload 保留的用户决策：`ask`、`allow_scheduled`、`deny`。
- `allow_session` 只存在于内存 session grant store，作用域是精确的 `serverId + toolName`。刷新页面、重启 Web 应用或重启 Electron renderer 后会消失。
- 旧快照若仍含 `permission: "allow_session"`，读取时安全规范化为 `ask`，不会恢复授权；下一次正常写入会写回 canonical policy。
- 改为 `ask`、`deny` 或 `allow_scheduled` 会立即清除同一工具的会话 grant。重新发现时只保留仍存在且仍在 allowlist 中的工具 grant；连接变化、删除 Server 或工具消失会使旧 grant 失效。

## Stabilization — Session Grant Authority

- 持久化 permission normalization 只有 `app/services/mcp-permission.ts` 一个 source-of-truth；Settings Repository 直接复用，不保留复制实现。
- session grant store 的可变 `Set` 只在 store 内部可见；对外只提供精确的读取、授予、撤销、清理和重发现保留 API。
- execution boundary 只有当前 session grant 的读取权限；它不能直接创建、撤销或清理 grant。
- Settings Repository 拥有 session grant lifecycle 的 mutation authority；Feature UI 只能通过 repository 表达权限意图，不能直接修改 session grant。

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

## Phase 2：Automation / Acquisition 无人值守授权

已安排采集复用 `AutomationDefinition.collectionConfig` 作为任务级声明。URL、Feed、MCP source 必须在 definition 中显式启用；MCP source 还必须声明精确 `serverId` 与 `toolName`。MCP tool 的 `allow_scheduled` 只是 tool-level 条件，不能单独授权任意 Automation；`allow_session` 永远不能成为 scheduled backdoor。

预览只执行本地、确定性的声明解析，展示来源数量、origin、MCP Server/tool、缺少 permission、停用或未 ready 资源，不调用网络、AI 或自动 grant。保存/启用缺少授权时保留配置并保持停用，失败恢复 CTA 只导航或提示。

真实任务在 lease 后、凭据和 `/api/mcp/call` 或 `/api/acquisition/fetch` 前重新解析当前 definition、MCP discovery、Server enabled、tool 存在性、`allow_scheduled` 和 origin 交集。Session grant 不参与 scheduled 解析。权限撤销、Server 停用、tool 移除或 discovery 失效只阻止新运行，保留配置和历史。

运行复用 `AutomationRun.unattendedAudit` 保存最小审计：task/run ID、触发模式、授权状态、稳定原因码、需求数量、source kind、MCP Server/tool ID、HTTP origin、调用成功/失败数、proposal count 和终态。不保存 token、完整参数、raw result、完整 URL 路径、文档正文、prompt 或模型响应。授权阻断是显式 blocked terminal，不是成功空结果；已发生外部副作用继续保持人工恢复和不自动重试。

详细声明、解析、撤销与隐私边界见 `docs/automation-external-authorization.md`。

## 隐私与最小审计

原始 tool result 只存在当前 Conversation 面板内存；运行摘要只记录 Server、tool、参数键和结果长度等脱敏信息。权限层不保存完整 arguments、raw result、Bearer token、Authorization header 或完整上下文。已有 MCP route 的请求预算、凭据边界、`allowPrivateNetwork` 和出站网络校验保持不变。
