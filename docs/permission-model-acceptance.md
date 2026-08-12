# 0.6 权限模型 Acceptance Closure

本文档记录 0.6 MCP、Automation、声明式扩展和内置插件的跨边界验收证据。它是验收矩阵，不是运行时权限模型；不新增数据库表、授权缓存或审计事件。

## 核心结论

- declaration 只描述需求，不产生 grant。
- UI、缓存和旧 callback 只表达意图；真实执行前重新读取当前 authority。
- `allow_session` 只属于当前 interactive session，不能授权 scheduled Automation。
- scheduled MCP 必须同时满足任务声明、当前 Server/discovery/tool 和持久化 `allow_scheduled`。
- deny、disabled、资源撤销和 stale discovery 在敏感边界前 fail closed。
- 失败记录只保留稳定分类、恢复动作和聚合审计事实，不保留凭据、原始参数/结果、正文或 raw error cause。

## Acceptance Matrix

| Domain | Interactive | Scheduled | Disable / Deny | Revocation | Check before side effect | Privacy |
| --- | --- | --- | --- | --- | --- | --- |
| MCP | 当前确认或精确 session grant | 精确 `serverId + toolName` 且为 `allow_scheduled` | deny、Server disabled、tool missing、discovery stale 均阻断 | execution boundary 每次重读当前快照 | permission → credential → `/api/mcp/call` | 不持久化 Token、完整参数或 raw result |
| Automation HTTP | 只在显式用户流程中采集 | task source 与当前 origin allowlist 交集 | origin 不再允许时写入 blocked terminal | executor 使用当前 definition，不复用旧 ready 快照 | authorization → credential/network/acquisition | `unattendedAudit` 只记录 origin、计数和稳定原因码 |
| Automation MCP | 不继承 scheduled grant 的交互语义 | task declaration、当前资源和 `allow_scheduled` 缺一不可 | permission、Server、tool 或 discovery 变化时零外部调用 | repository 和 executor 均在下一次执行复核 | authorization → `callScheduledTool` → network | 不持久化 MCP args/results 或 provider payload |
| Declarative Extension | 显式安装后由用户启用 | 当前没有 extension scheduled runtime | disabled、invalid 或 capability missing 阻断 | 旧 callback 在执行时重新读取安装记录 | authorization → theme/persona application action | 仅签名 `data.json`；禁止脚本、HTML、WASM 和远程 runtime |
| Obsidian | 用户显式连接、同步或确认 | 不提供 unattended Vault runtime | disabled 时阻断 permission、watch、sync 和 Vault write | listener/watch 与 repository 使用当前插件状态 | plugin check → Vault permission → file/DB effects | Vault 正文、目录句柄不进入诊断或审计 |
| Fenbi | 用户显式导入、解析或同步 | 不提供 unattended credential runtime | disabled 时阻断 credential reveal、parse、provider/network | hook、repository 和 provider entry 复核当前状态 | plugin check → decrypt/provider/network | encrypted credential 和 drafts 保留；不展示明文 Cookie |

## 证据位置

- MCP：`app/services/mcp-permission.contract.test.ts`、`app/services/mcp-settings-repository.contract.test.ts`、`app/features/performance/architecture-boundary.contract.test.ts`。
- Automation：`app/services/automation-external-authorization.contract.test.ts`、`app/application/automation/automation-application.contract.test.ts`。
- Declarative Extension：`app/services/declarative-extension.contract.test.ts`，覆盖安装、启用、声明变化升级、声明不变升级、无效 legacy record 和旧 callback。
- Built-in Plugin：`app/services/settings-plugin-permissions.contract.test.ts`、`e2e/plugin-disable-boundary.spec.ts`。
- 用户可见路径：`e2e/plugin-disable-boundary.spec.ts` 的内置插件停用和官方主题扩展安装/启用/停用/reload 验收。

## 兼容性与回滚边界

- `review_workspace` 保持 v16，`review_extensions` 保持 v1；本次不包含 schema migration 或新的权限持久化。
- 既有 Automation partial effect 与不确定外部终态继续使用 manual-only recovery，不自动 replay、rollback 或 retry。
- 已经开始且不可取消的外部请求不能被回溯取消；这不改变下一次执行必须重新授权的要求。

只有本矩阵、targeted E2E、本地质量门、远端 CI 和合并后验证全部通过，Roadmap 才将 0.6 overall 标记为 `COMPLETE`；0.7 仍保持 `NOT STARTED`。
