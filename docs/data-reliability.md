# 数据可靠性支持矩阵

本文是 `0.4.x Data Reliability Phase 1` 的版本化事实源，适用于 `review_workspace` v16、`review_extensions` v1 与 `LocalDataExportV2`。它不授权 Dexie schema 升级、云同步或自动修复用户数据。

## 数据分类与恢复等级

| 分类 | 定义 | 默认恢复策略 |
| --- | --- | --- |
| `authoritative` | 用户创建或产品确认的业务事实 | 必须进入可校验备份 |
| `configuration` | 用户选择、安装和工作流配置 | 按敏感性选择备份或重新配置 |
| `derived` | 可从事实源或外部服务重新生成 | 允许失效后重建 |
| `credential-security` | 凭据、密文、主密钥与授权材料 | 不导出；恢复后重新输入 |
| `external-user-owned` | 应用外部由用户拥有的数据 | 不复制；重新授权后对账 |
| `ephemeral` | 当前运行或恢复过程的临时状态 | 完成后清理，可安全丢失 |

| 等级 | 含义 |
| --- | --- |
| R0 | 不备份，可安全丢失 |
| R1 | 可从事实源重新生成 |
| R2 | 可由用户重新配置或重新输入 |
| R3 | 用户业务数据，必须可备份和恢复 |
| R4 | 外部用户资产，只能重新授权/选择，不能声称已由应用备份 |

## 数据资产与所有权矩阵

| 数据资产 | Owner / source of truth | Storage | Class | Backup / restore | Exportable / rebuildable | Sensitive / external | Level | 丢失后果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 错题、复盘、知识、导入、面试、辅导、自动化、对话 | 用户；应用业务记录 | `review_workspace` v16 | authoritative | 包含 / 包含 | 可导出 / 不可无损重建 | 否 / 否 | R3 | 学习历史或工作流丢失 |
| AI 连接档案 | 用户；连接仓储 | `review_workspace.apiConnectionProfiles` | configuration | 仅脱敏 metadata / 包含 | metadata 可导出；凭据不可重建 | 部分敏感 / 否 | R3 + R2 | 连接名称保留，但必须重新输入凭据 |
| 旧 AI 设置 | 应用兼容桥 | `review_workspace.apiSettings` | credential-security | 排除 / 排除 | 不可导出；由新连接重新配置 | 是 / 否 | R2 | 旧凭据需要重新配置 |
| Vault 授权配置 | 用户与宿主授权 | `review_workspace.obsidianVaultConfigs` | external-user-owned | 排除 / 排除 | 不可导出；重新选择/授权 | 含句柄 / 是 | R4 | Vault 断开，不影响 Vault 正文 |
| Vault 映射与三方哈希 | 应用；本地映射记录 | `review_workspace.obsidianNoteMappings` | authoritative | 包含 / 包含 | 可导出；授权后对账 | 不含正文 / 关联外部 | R3 | 同步基线和冲突判断丢失 |
| 声明式扩展安装记录与受控资产 | 用户；扩展仓储 | `review_extensions.extensions` v1 | configuration | 包含 / 包含 | 可导出；包可重新安装 | 否 / 否 | R3 | 主题、人设、模板等本地扩展配置丢失 |
| 不可导出主密钥 | 本机安全边界 | `review_workspace_secure_keys.keys` v1 | credential-security | 排除 / 排除 | 不可导出；重新输入凭据后重建 | 是 / 否 | R2 | 现有密文不可解密 |
| 恢复任务与旧快照 | 恢复流程 | `review_workspace_transfer.jobs` v1 | ephemeral | 排除 / 不作为业务恢复输入 | 仅用于 commit/rollback | 可能含业务快照 / 否 | R0 | 未完成事务必须继续回滚，不能静默清理 |
| 版本化浏览器设置 | 各设置仓储 | `localStorage` | configuration / derived / credential-security | 当前 V2 全部排除 / 排除 | 按下表重建或重新配置 | 视键而定 / 否 | R1–R2 | UI 偏好、缓存或连接配置需要重建 |
| Obsidian Markdown 正文 | 用户 | 用户选择的 Vault | external-user-owned | 排除 / 排除 | 由用户拥有；重新授权后对账 | 是 / 是 | R4 | 应用不得覆盖或伪装恢复 |
| 原始媒体、完整运行 prompt、厂商/MCP 原始事件 | 当前运行 | 内存 / 对象 URL | ephemeral | 排除 / 排除 | 不重建 | 敏感 / 可能外部 | R0 | 当前运行上下文结束；业务摘要仍按既有规则保留 |

## `review_workspace` v16 表级分类

实现事实源是 `CORE_DATA_STORE_POLICIES`；契约测试将它与 Dexie 运行时表集合做完全相等比较。

| Backup | Tables | 说明 |
| --- | --- | --- |
| included | `mistakes`, `attempts`, `importJobs`, `apiConnectionProfiles`, `apiConnectionDefaults`, `appearanceSettings`, `personalizationSettings` | 用户事实与脱敏配置 |
| included | `knowledgeEntries`, `knowledgeAttempts`, `knowledgeMistakeLinks`, `knowledgeInternalizationDrafts` | 知识事实与训练历史 |
| included | `importBatches`, `importDrafts` | 导入批次与未确认草稿 |
| included | `interviewQuestions`, `interviewQuestionSets`, `interviewPracticePlans`, `interviewSessions`, `interviewTurns`, `interviewEvaluations`, `interviewLinks` | 面试资产与历史 |
| included | `tutoringSessions`, `tutoringTurns`, `tutoringPlans`, `tutoringLinks` | 辅导资产与历史 |
| included | `obsidianNoteMappings`, `knowledgeEvolutionProposals` | 应用侧 Vault 映射/哈希与待确认提案，不含正文 |
| included | `automationDefinitions`, `automationRuns` | 已安排定义与脱敏运行收件箱 |
| included | `aiProjects`, `aiConversationFolders`, `aiConversations`, `aiConversationAttachments`, `aiConversationMessages`, `aiConversationRunSteps` | 可见对话、附件摘要和脱敏工具步骤 |
| intentionally excluded | `apiSettings` | 旧凭据兼容表；原因必须保留，不能自动加入导出 |
| intentionally excluded | `obsidianVaultConfigs` | 宿主目录授权/句柄；恢复后重新选择或授权 |

未来新增 Dexie 表若没有显式 `included` 或 `excluded + reason`，contract 必须失败。安全材料不能因为“覆盖全部表”而自动进入备份。

## 版本化 localStorage 支持矩阵

当前 V2 不导出 localStorage，也不使用 `Object.entries(localStorage)`。完整重置仍只清理本应用 `review*` 命名空间。

| Key / pattern | Class | Backup | Recovery |
| --- | --- | --- | --- |
| `review-workspace:ai-quota-plugin-configs` | credential-security | excluded | 重新配置额度凭据 |
| `review-workspace:mcp-settings:v1|v2` | credential-security | excluded | 重新配置 MCP 与 Bearer |
| `review-workspace:fenbi-import-credential` | credential-security | excluded | 重新输入 Cookie |
| `review_workspace_crypto_key_v1` | credential-security | excluded | 仅供旧密钥迁移，不恢复 |
| `review-workspace:ai-quota-snapshots` | derived | excluded | 重新读取 |
| `review_provider_models_v4:*` | derived | excluded | 重新发现模型目录 |
| `review_connection_test_model_v1:*` | configuration | excluded | 重新选择测试模型 |
| `review-workspace:sidebar:v1` | configuration | excluded | 使用默认展开状态或重新设置 |
| `review_settings_plugins_v1` | configuration | excluded | 使用默认启用状态或重新设置 |
| `review-workspace:ui-review-*` | ephemeral | excluded | 开发审查状态不恢复 |

## Backup / Export contract

`LocalDataExportV2` 继续是唯一受支持格式，不升级为 V3：

- `schemaVersion: 2`、`exportedAt` 与 `credentialsExcluded: true` 保持兼容。
- 新导出包含 `manifest`：应用名/版本、核心与扩展 schema 版本、included stores、excluded categories、逐表记录数与总记录数。
- 2026-07 发布的早期 V2 没有 `manifest`；reader 继续接受并根据实际内容规范化清单。若包提供 manifest，则任何表或计数不一致都会拒绝。
- 100MB 文件上限、每 store 250,000 条与总计 1,000,000 条记录上限在任何 destructive mutation 前检查。
- 导出递归移除密文、IV、Key、Token、Cookie、目录句柄、掩码凭据与厂商原始响应。用户自己保存的面试题干或自动化任务指令是业务数据，不等同于未持久化的完整运行 prompt。

## Restore guarantees

恢复 preflight 顺序为：

```text
size / JSON / V2 metadata
→ known databases and stores
→ required stores and record limits
→ record objects and unique primary keys
→ security-sensitive field rejection
→ critical reference integrity
→ manifest and actual count agreement
→ preview
→ destructive apply
```

- `restore(preview)` 不信任旧 preview 对象；开始事务前会序列化并再次执行完整 preflight。
- 未知数据库/表、重复主键、缺失必需引用、关键悬空关联、敏感字段、伪造清单与超限包均拒绝。
- 任一 preflight 失败时，`review_workspace` 与 `review_extensions` 不发生修改。
- 旧 V2 reader 保留；本阶段没有 Dexie schema 升级。

当前 critical references 来自真实 repository 写入语义：错题/知识 attempt、知识错题 link、导入 draft、面试/辅导 turn、面试 evaluation、自动化 run，以及项目/目录/对话/消息/附件/运行步骤的父子关系。可选历史 `sourceId` 不作为拒绝整个备份的理由。

## Recovery transaction 与中断语义

真实流程：

```text
preflight
→ export current allowlisted snapshot
→ review_workspace_transfer.prepared
→ mark applying
→ atomic core DB replace
→ atomic extension DB replace
→ verify counts and critical references
→ delete transfer job (commit cleanup)
```

- 单个 Dexie transaction 内的 core replace 或 extension replace 各自原子；两个数据库之间不存在 ACID，也不覆盖 localStorage、主密钥或 Vault。
- apply/verify 失败时用 `previous` 回滚 core 与 extension；只有回滚验证成功后才清理 job。回滚也失败时保留 `applying` job 并阻止应用进入业务 controller。
- 页面关闭、刷新或浏览器崩溃后，根 Bootstrap 在任何业务 controller 挂载前读取 transfer DB：`prepared` 尚未修改业务库，可清理；`applying` 必须恢复并验证旧快照后再清理。
- `QuotaExceededError`、IndexedDB write failure 与 verify failure 都走同一可识别回滚边界。应用不声称拥有跨数据库/Vault 的事务。

## Read-only Health Check contract

`inspectHealth()` 输出稳定结构：

```text
healthy
checkedAt
warnings[]
errors[]
repairable[]
manualActions[]
```

Phase 1 检查：

- Dexie 表集合是否与显式分类完全一致；
- 当前记录的对象/主键与 critical references；
- `review_workspace_transfer` 是否存在未完成事务；
- 存在加密凭据时不可导出主密钥是否可读取（不解密、不输出密文）；
- Vault 未连接、权限丢失、冲突与待确认状态继续由现有 Obsidian 只读诊断报告检查。

Health Check 不调用 Provider 在线 API，也不修改记录。UI 只在用户点击“检查数据健康”后执行存储扫描；Vault 诊断只提供重新选择/授权入口，不覆盖正文。

## Repair safety policy

Phase 1 不提供通用 Repair UI、Rule Engine 或自动修复：

- 默认路径是读取报告、导出当前备份、恢复已验证备份、重新输入凭据或重新授权 Vault。
- `repairable` 当前固定为空；发现问题不会在应用启动时自动改业务记录。
- 未来最小 repair 必须满足 `scan → preview → explicit confirmation → backup/recovery boundary → mutate → verify`。
- 无法回滚的 Vault 写入必须逐项报告，不能归入本地数据库“修复成功”。

## 验证责任

- Contract 覆盖表分类、清单/计数、secret exclusion、未知表、重复键、限制、关键引用、preflight 不变性、verify rollback、中断识别与 Health Check。
- Browser E2E 覆盖真实下载备份、删除本地可见记录、导入恢复、刷新可见，以及畸形备份拒绝后原记录保持。
- 真实 Vault 权限、外部文件冲突、磁盘配额和浏览器进程强制终止仍需按 `docs/release-smoke.md` 做人工验收。
