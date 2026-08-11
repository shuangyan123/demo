# Automation / Acquisition 无人值守授权

## 状态

Phase 2 已完成。0.6 MCP / Automation / Plugin 权限模型仍为 `IN PROGRESS`；Declarative Extension Phase 3 和 Acceptance Closure 尚未开始。

本阶段复用现有 `AutomationDefinition.collectionConfig`，不新增第二套任务权限字段：URL、Feed 和 MCP source 就是任务级外部能力声明。普通 `daily_review`、`weekly_progress` 与 `knowledge_evolution` 仍可使用既有默认文本连接；知识演进只保存 pending proposal，不等于知识库或 Vault 已确认写入。

## 执行模型

```text
AutomationDefinition.collectionConfig
  → ExternalCapabilityRequirement[]（纯函数派生）
  → 当前 MCP / 来源快照授权解析
  → ready / blocked / invalid
  → lease 后、凭据与网络前的 preflight
  → acquisition / AI 外部边界
  → AutomationRun.unattendedAudit
```

解析器位于 `app/services/automation-external-authorization.ts`，不读取 React、Dexie、凭据或网络。调用方提供当前 MCP Server、discovery、tool 和持久化 permission 快照。`allow_session` 即使在当前内存快照中可见，也会规范化为 `ask`，不能满足 scheduled。

授权结果包含：

- `ready`：所有已启用外部 source 的声明和当前资源状态满足要求。
- `blocked`：Server 停用、discovery 未 ready、tool 被移除或 permission 不是 `allow_scheduled`。
- `invalid`：来源、origin、URL 或 JSON argument template 无法形成安全的任务声明。

`missingPermissions`、`disabledResources`、`staleResources` 和 `invalidScopes` 是机器可读结果；稳定原因码包括 `mcp_permission_missing`、`mcp_server_disabled`、`mcp_discovery_not_ready`、`mcp_tool_missing`、`origin_not_allowed` 和 `source_invalid`。

## 来源声明与执行

- URL source 必须有任务 origin 白名单，并且至少有一个 URL 落在当前任务与来源白名单的交集内；混合列表中的越界候选继续按现有语义被过滤，整条 source 没有可执行候选时 preflight 阻断。
- Feed source 的 feed URL 必须在当前 origin 交集内。文档抓取继续通过 `/api/acquisition/fetch`，保留逐跳 origin、DNS、SSRF、内容类型、超时和大小检查。
- MCP source 必须声明精确的 `serverId`、`toolName`、有效 JSON object `argumentTemplate` 和 `{{query}}`。执行必须使用 `mcpSettingsRepository.callScheduledTool()`；Server enabled、discovery ready、tool 存在和持久化 `allow_scheduled` 由当前 execution boundary 再次检查。
- `allow_scheduled` 是 MCP tool-level 条件，不是 Automation 授权。最终允许值是任务声明、当前资源状态、tool permission 与来源 allowlist 的交集；另一个 tool 的授权不能替代任务声明。
- 运行时只访问 definition 中启用的 sources；AI 或 MCP 返回结果不能扩大来源集合。

预览只做本地归一化和授权解析，展示 URL/Feed/MCP 数量、origin、缺少 permission、停用或未 ready 资源；不联网、不调用 AI、不自动 grant。保存或启用遇到未满足授权时保留配置并保持停用；用户修正后再显式启用。试运行若模拟 scheduled collection，同样要求 `allow_scheduled`，不创建 run、调度状态或 proposal。

每次真实执行都在租约取得后重新读取当前 definition 和 MCP 快照。权限从 `allow_scheduled` 改为 `ask`、Server 被停用、tool 被移除或连接变化导致 discovery 失效时，下一次运行阻断并保留任务、配置和历史；不会自动选择替代 tool、自动 grant 或自动重试。

## 最小审计与恢复

真实运行复用 `AutomationRun`，可选的 `unattendedAudit` 只保存 task/run ID、时间、触发模式、授权状态、稳定原因码、需求数量、source kind、MCP Server/tool ID、HTTP origin、外部调用成功/失败计数、proposal 数量和终态。不会保存 token、Authorization header、Cookie、完整 MCP args、raw result、完整 URL 路径、文档正文、完整 prompt/response 或上下文。

授权阻断写入显式 `failed + audit.terminalState: blocked` 收件箱记录，外部调用数为零，并推进当前计划时间以避免每分钟重复占用租约。网络超时、HTTP/feed 解析、远端 MCP 和模型失败仍是 runtime failure；已发生外部副作用后继续保持既有 `manual-only` 恢复语义，不新增重试框架。

proposal persistence 仍只是本地 pending 写入；确认知识或 Vault 的既有复读、hash 校验、用户确认和部分提交边界不由本阶段自动化授权绕过。Declarative Extension package/template 安装不授予网络或 scheduled MCP 权限，本阶段不实现插件运行时或 Phase 3 disable semantics。`review_workspace` 继续保持 v16。

## Failure-path audit accuracy

Phase 2 Stabilization is complete. When acquisition has already contacted an HTTP or MCP source and a later AI, proposal, or orchestration step fails, the known external-effect summary is transported through a typed in-memory error and retained in the failed `AutomationRun.unattendedAudit`.

- The audit remains aggregate and sanitized: counts, source kinds, MCP server/tool identities, and normalized HTTP origins only.
- Raw MCP arguments/results, full URLs, document content, prompts, provider payloads, credentials, and error causes stay outside persistence.
- Authorization blocks remain zero-call `blocked` runs; known external effects do not authorize automatic retry, replay, or cross-system rollback.
