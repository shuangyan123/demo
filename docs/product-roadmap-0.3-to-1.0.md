# 0.3 到 1.0 产品路线图

## 文档定位

本文描述 ReviewWorkspace 从 `0.2.x` 功能快速迭代阶段进入产品化阶段的版本边界。它不是功能愿望清单：每个阶段都包含目标、非目标、风险、验收标准和回滚边界。

Recall Phase E 已在其限定来源闭环内 COMPLETE；Phase F Slice 1 交付范围为
[Managed Data Root Foundation](recall-managed-storage.md)。它只建立 Host metadata/configuration/registry，
不表示 Phase F 整体完成。后续 [Slice 2 Diagnostic Durable Capture Repository](recall-diagnostic-history.md)
已建立独立 durable repository；[Slice 3 Production Durable Diagnostic Submission & Owner Recovery](recall-durable-diagnostic-submission.md)
已接通 production submit/owner reload→Evidence；[Slice 4 Complete Diagnostic History → Learner State → WHAT](recall-diagnostic-state-reconstruction.md)
已接通当前 profile/epoch/source 内完整 target history 的只读重建与 WHAT。
[F5 Diagnostic-first Resume Slice 1](recall-diagnostic-resume.md) 提供已有有效 profile 的总览入口、只读恢复展示与显式重复作答。
新 profile onboarding、位置迁移和全局 backup/reset integration 仍未交付；不表示 Phase F 整体完成。

通用约束：

- 保持 Electron、Next.js、React、Dexie 和 local-first 技术路线。
- 保持单机单用户，不引入账号、多租户、云数据库或强制云同步。
- 保持 `review_workspace` v16，除非有真实查询证据和完整迁移/回滚设计。
- 不以重做 UI 或更换状态管理框架作为版本目标。
- 每个阶段必须保护已有学习、对话、自动化、连接、凭据与 Vault 数据。

## 0.3 Host abstraction

### 目标

- 建立轻量 `app/platform/` Host Capability Layer。
- 让业务代码依赖类型化的 Vault、原生窗口等能力，而不是 Electron preload global。
- 保留现有 preload 和 IPC 权限范围。
- 建立 Web/Electron 宿主边界契约和维护者文档。

### 非目标

- 不重写 Electron main、runtime 或 Vault IPC。
- 不把所有浏览器 API 包装成通用平台框架。
- 不模拟 Electron IPC，也不改变正式用户设置。
- 不升级 Dexie schema。

### 风险

- 浏览器目录句柄与桌面 Vault 状态并非完全同构。
- 模块初始化时访问 `window` 会破坏 Next.js 预渲染。
- 过宽的 capability 接口可能扩大未来 preload 权限。

### 验收标准

- `features/` 和 `services/` 不直接引用 `reviewDesktopVault` 或 `reviewDesktopWindow`。
- Web File System Access 与 Electron Vault 的既有选择、权限、同步、冲突和监听语义保持一致。
- Electron preload、IPC channel、sender 校验和安全配置不变。
- typecheck、lint、contracts、desktop tests、build、bundle 和相关 E2E 通过。

### 回滚边界

- 可按 Host adapter、业务迁移、契约三组提交分别回滚。
- 回滚不得修改或清理 IndexedDB、Vault、凭据和 Electron userData。

## 0.4 Application Layer

### Phase 3 状态（2026-08-09）

- Interview 已完成 `start-interview-session` 与 `submit-interview-turn` 两个真实 Use Case；Controller 保留 React 状态、输入校验、刷新、通知、示例模式和最终评分触发。
- 用例通过显式窄依赖直接编排现有 repository、AI service 与 timer helper，并以直接 Node 测试覆盖调用顺序和部分提交；没有新增 DI 框架或跨 IndexedDB/AI 伪事务。
- Automation 已完成 `execute-automation-run`：Application 编排租约、`AutomationRun`、续租、外部执行、终态和 cleanup，Controller 保留 Web Locks、调度触发、busy、通知与刷新。
- Automation 的直接 Node 测试覆盖租约竞争、成功/失败顺序、终态写入失败、部分提交、人工重试边界与 cleanup 失败；不对外部 AI、HTTP 采集或提案副作用进行隐式重放。
- Import 已完成 `confirm-import-drafts`：Repository 保留 Mistake/Draft/Batch 的原子 transaction，Application 使用实际 confirmed set 生成结果和撤销凭据，并把后续 ImportJob 失败表达为可恢复的 partial success。
- Import 直接测试覆盖有效/无效/不存在草稿混合确认、真实 savedCount、精确撤销、确认前失败、审计记录失败与无隐式重复确认。
- Interview、Automation 与 Import 的当前计划范围均已完成，0.4 验收条件已满足。Conversation 继续明确 deferred，不在本阶段启动或宣告已迁移。

### 目标

- 从真实的多步骤 React 编排中提取 Application Use Case。
- 优先处理面试回合、自动化执行、导入确认、知识提案和对话发送。
- Application 层只依赖领域类型、Service/Repository port 和 Host Capability。
- Controller 继续负责 React 状态、表单事件、导航和用户反馈。

### 非目标

- 不一次性重写所有 controller。
- 不为单个 repository 调用增加无行为价值的包装层。
- 不引入依赖注入框架、Redux、Zustand 或事件总线。

### 风险

- 事务边界在迁移中被拆散。
- UI 乐观状态、错误恢复和幂等语义发生变化。
- 形成只有接口没有用例价值的过度抽象。

### 验收标准

- 至少两个跨 repository/AI 的真实 use case 迁移完成并有直接测试。
- Application 不 import React、组件、CSS 或浏览器事件类型。
- View 不新增 repository、Dexie、Provider 实现或 Electron 依赖。
- 迁移前后的错误、事务、刷新、通知和数据兼容行为有契约证明。

### 回滚边界

- 每个 use case 单独提交，controller 可逐项恢复原编排。
- Repository 接口和持久化记录在此阶段保持兼容。

## 0.4.x 数据可靠性

### Phase 1 状态（2026-08-09）

- 已建立覆盖 `review_workspace` 36 个表、扩展库、安全密钥库、恢复事务、版本化 localStorage、Vault 与运行时数据的所有权/分类/恢复等级矩阵；核心表与备份策略必须完全匹配，新增未知表会使 contract 失败。
- 保留 `LocalDataExportV2` 与早期无 manifest reader；新导出增加应用/schema、included stores、excluded categories 和逐表计数。恢复在 destructive mutation 前二次 preflight，并拒绝未知存储、敏感字段、重复键、超限记录、伪造清单和关键悬空引用。
- 恢复继续以 core/extension 两个独立 Dexie transaction 加 transfer job 实现，不伪造跨库 ACID；apply 后验证失败会回滚旧快照，回滚未完成时保留 job 并在根 Bootstrap 阻止业务 controller 启动。
- 已增加只读 Health Check foundation，检查 schema/classification、关键引用、未完成恢复和主密钥可用性；Vault 权限继续复用现有只读诊断。Phase 1 不提供自动 Repair，也未升级 Dexie v16。

### Phase 2 状态（2026-08-09）

- Health issue 已增加 `targeted-safe` / `manual-only` / `not-repairable` 分类。用户事实 dangling、凭据缺密钥和 Vault 权限/mapping/conflict 均保持 manual-only，不以“全绿”为目标猜测或删除数据。
- 唯一 targeted-safe repair 是无父对话的 `aiConversationRunSteps`：必须先生成 typed preview、请求下载 fresh recovery-safe V2 snapshot，并由用户分别确认快照已保存及目标记录不可由其恢复，再在单个 Dexie transaction 中精确删除和验证；不会级联删除其他记录。该快照恢复其余满足 V2 integrity contract 的受支持数据，但刻意排除 Restore preflight 本就会拒绝的 targeted orphan records。
- 根 Bootstrap 独占 interrupted recovery：`prepared` 仅清理未 apply 暂存，`applying` 回滚并验证 previous snapshot 后清理；成功显示可见结果，失败保留 job 并阻止业务 controller。诊断 page load 不再重复恢复。
- Vault Health 按需复用只读 snapshot 并检查 permission、mapping 状态与三方 hash；不请求新权限、不写 Markdown、不删 mapping、不自动解决 conflict。仍保持 `review_workspace` v16、`review_extensions` v1 与 `LocalDataExportV2`。

### 目标

- 建立数据分类、所有权、可重建性和恢复级别清单。
- 补齐 Backup、Restore、Export、Health Check、Repair 的边界。
- 复用现有 LocalDataExportV2、恢复事务库、诊断和 Vault 三方哈希。
- 为损坏、被阻塞、缺密钥、句柄失效和关联悬空提供可解释恢复路径。

### 非目标

- 不增加云同步或账号。
- 不把密钥、Cookie、目录句柄或 Vault 正文纳入备份。
- 不承诺无法由浏览器/文件系统保证的跨数据库与 Vault 原子事务。

### 风险

- 用户误把“备份”理解为包含凭据和外部 Vault。
- Repair 自动修改不可恢复数据。
- 未来新增表未进入导出允许列表。

### 验收标准

- 数据分类与支持矩阵有版本化文档。
- 恢复包继续拒绝未知表、重复主键、悬空关键关联和超限文件。
- Repair 默认只读预检；任何修改必须预览、确认且可回滚或可重新导入备份。
- 数据破坏和中断恢复有契约与浏览器 E2E。

### 回滚边界

- 数据格式升级保留旧格式读取器，并支持恢复到升级前快照。
- 任何 schema 升级必须独立于 UI/功能提交。

## 0.5 学习闭环

状态：**COMPLETE**。Phase 1 Evidence Normalization & Read-only Learning Action Queue、Phase 1 Stabilization、Phase 2 Action Completion Semantics & Cross-module Progress Loop 与 Phase 3 Acceptance Closure & UX Hardening 均已完成。

Phase 1 已交付：持久化 mastery 统一按 1..5 解释，错题、知识、辅导微测/计划与面试计划通过固定优先级派生只读行动队列；首页只展示有本地证据的最多四项行动。Automation 运行、待确认知识提案、未评分面试和未提交微测不作为学习完成证据。详见 `docs/learning-loop.md`。

Phase 2 已交付：错题与知识 grouped action 按真实 repository commit 逐项缩小；Tutoring P1/P2/P4 只随最新确定性微测和 plan facts 转换；Interview 只有 `saveEvaluation()` 推进计划，中止或未评分场次不计数；重复错因只保留至少两道当前未解决证据。切回 Dashboard 与 reload 均从 v16 既有事实重新派生，不持久化 recommendation、不增加 schema，也不把 click、AI reply 或 Automation success 当作学习完成。

Phase 3 已完成 Acceptance Closure & UX Hardening：同一 derived recommendation model 已通过 desktop、390×844 mobile、360×800 narrow mobile、纯键盘 disclosure/CTA、空档案、无到期任务、证据不足与 refresh/reload 验收；用户可读文案不暴露数据库 ID 或内部优先级代号。Review/Knowledge 保持具体 target 导航，Tutoring/Interview 精确 plan deep-link 继续 deferred。本阶段未新增 schema、recommendation persistence、业务规则或路由架构。

### 目标

- 将错题、知识、训练、面试、辅导、已安排复盘连接为可观察闭环。
- 用本地证据 ID 解释推荐动作、掌握变化和计划推进。
- 明确空数据、数据不足、冲突和待确认状态。

### 非目标

- 不用单一 AI 分数替代可验证学习证据。
- 不自动确认知识演进或写入 Vault。
- 不增加与学习闭环无关的新一级模块。

### 风险

- 指标定义漂移或过度承诺学习效果。
- 自动化建议覆盖用户选择。
- 不同专项形成重复状态模型。

### 验收标准

- 每条推荐动作可追溯到本地证据和固定优先级。
- 零回答、数据不足、失败运行和提案冲突不会错误推进状态。
- 核心桌面/移动路径、无障碍和刷新持久化通过 E2E。

### 回滚边界

- 推荐模型是只读派生层，可回滚而不修改业务记录。
- 新闭环字段优先采用兼容可选字段，避免无证据 schema 升级。

## 0.5.x AI capability abstraction

**状态：COMPLETE**

### Phase 1 — Model Capability Facts & Runtime Contract

**COMPLETE（2026-08-10）**

- 静态 model catalog 是已核验模型能力与数值事实源；runtime descriptor 只保留推理/速度值域，不再重复模型能力或上下文。
- 模型能力与当前 adapter/protocol 能力使用 `supported / unsupported / unknown` 分离表达；effective resolution 仅在双方明确支持时放行并保留失败原因。
- 具体模型、结构化输出、流式与显式 runtime 值在解密连接密钥和进入 provider mapper 前校验；未知/custom-compatible 不按名称继承原厂能力。
- 未新增 Provider、Dexie schema、凭据边界或隐藏思维数据。

### Phase 1 Stabilization — Capability Fact Propagation

**COMPLETE（2026-08-10）**

- connection + selected model 统一通过 connection-scoped resolver 合并静态核验事实与可信 provider metadata；Conversation 流式预路由、context budget 与 generation contract 不再各自选择不同 fact input。
- UI 不直接读取 provider model cache；无缓存时保留静态/unknown 回退，缓存继续按 connection ID、provider 与 base URL 隔离。
- 静态 catalog 优先级、custom-compatible 保守语义、Dexie v16、Provider adapter 与凭据边界均保持不变。

### Phase 2 — Provider Request / Response / Stream / Error Normalization

**COMPLETE（2026-08-11）**

- 以 `AiGenerateRequest`、`AiGenerateResult` 和 `AiGenerateStreamEvent` 固定应用层输入、输出与增量流语义；Provider 私有 request/response/event 字段停留在 adapter boundary。
- 七家原生 Provider 与 custom-compatible 路径均有 request、response、stream 和 failure fixtures；usage 的 `0`、显式 total、未知值、增量 delta、完成事件和异常中断均有直接契约测试。
- 统一 `AiProviderFailure` taxonomy，保留安全的 provider code/request ID/retry-after metadata；capability failure、malformed provider response 和业务 JSON validation 保持不同错误边界。
- 隐藏 reasoning、API key、Authorization、完整 prompt、原始响应和原始媒体不进入 normalized result、SSE error、diagnostics 或 conversation persistence；本阶段不新增 schema、不自动 retry、不自动 fallback。
- 详见 `docs/ai-capability-architecture.md`；最终 acceptance closure 见下方记录。

### Phase 2 Stabilization - Terminal Result & Consumer Failure Semantics

**COMPLETE (2026-08-11)**

- Typed provider failures reach Conversation presentation by `AiProviderFailure.code`; consumer code no longer guesses provider semantics from status text, raw messages, or capacity wording.
- A recognized provider response or completed stream without supported visible output fails as `malformed_response`; `stream_interrupted` remains reserved for missing completion evidence.
- Conversation does not persist a fabricated empty assistant answer, successful usage, or completed-turn memory after a failed generation. User input and an error run step may remain as durable facts.
- No automatic retry, provider fallback, hidden reasoning exposure, schema migration, new provider, capability change, or request-mapping rewrite was introduced.

### Acceptance Closure — Final Architecture / Consumer / Security Verification

**COMPLETE (2026-08-11)**

- A–K architecture audit confirmed the capability source, connection-scoped resolution, runtime validation, request/response/stream normalization, typed failure taxonomy, consumer boundary, visible terminal semantics, and privacy/security boundary.
- Direct fixtures cover native and custom protocols, visible and hidden-only terminal results, stream interruption versus completed-empty output, business JSON validation separation, typed client reconstruction, and bounded failure sanitization.
- Conversation, Tutoring, Interview, Automation, and AI-backed Import paths remain behind the shared generation facade; no consumer parses vendor request/response/SSE fields or re-guesses typed provider failures from status text.
- Acceptance Matrix and Deferred / Residual Boundaries are recorded in `docs/ai-capability-architecture.md`. No schema migration, new provider, automatic retry, provider fallback, or benchmark work is part of this closure.

### 目标

- 继续以具体模型目录项驱动文本、多模态、语音、推理和运行档位。
- 将业务 use case 与厂商协议、鉴权和原始流事件分离。
- 统一模型能力缺失、协议不支持、额度不足和连接失效的恢复结果。

### 非目标

- 不把未经验证的兼容厂商宣称为原生支持。
- 不推断未知模型的视觉、推理、速度或上下文能力。
- 不在业务 UI 解析厂商原始响应。

### 风险

- 厂商协议快速变化。
- 兼容接口字段相似但语义不同。
- 运行参数错误映射导致成本或结果偏差。

### 验收标准

- Provider adapter、目录服务和默认能力共享模型事实源。
- 每家原生厂商有请求、响应、流和错误 fixture。
- 跨厂商上下文不包含隐藏思维链、密钥或厂商私有状态。

### 回滚边界

- 厂商 adapter 可独立回滚；持久化继续只保存连接、模型和归一化运行值。

## 0.6 MCP / Automation / Plugin 权限模型

### Phase 1 — Permission Decision Core & MCP Execution Boundary

**COMPLETE（2026-08-11）**

- `ask`、`allow_session`、`allow_scheduled`、`deny` 通过纯 TypeScript decision core 统一解释；`allow_session` 只保存在当前进程内的精确 `serverId + toolName` session grant 中。
- `mcpSettingsRepository.callTool()` 与 `callScheduledTool()` 共享 execution boundary；Server 启用状态、最新 discovery、工具存在性和权限在凭据解密与 `/api/mcp/call` 之前复核，拒绝路径不触网。
- 旧的持久化 `allow_session` 读取时降级为 `ask`；重新发现只按精确 tool 名保留持久化策略和仍存在的会话 grant。UI 只收集交互确认，不能绕过 repository boundary。
- 保持 `review_workspace` v16、现有 MCP route、凭据加密、`allowPrivateNetwork`、SSRF 检查和 raw tool result 非持久化；增加直接权限矩阵、会话作用域、reload、无网络拒绝和 UI 架构 contract。
- 详见 `docs/mcp-permissions.md`。

### Phase 1 Stabilization — Permission Source-of-Truth & Session Grant Authority

**COMPLETE（2026-08-11）**

- 持久化 permission normalization 收敛到 `mcp-permission.ts`；session grant 的可变集合收拢在私有 store 内部。
- execution boundary 只读取 session grant，Settings Repository 负责 grant lifecycle mutation；Feature UI 不再拥有直接 mutation authority。
- 保持 `ask`、`allow_session`、`allow_scheduled`、`deny` 的既有语义、内存有效期、重发现清理、无网络拒绝和 `review_workspace` v16。
- 通过直接 permission/session contract、architecture boundary contract、完整质量门和相关 E2E 验证。

### Phase 2 — Automation / Acquisition Unattended Authorization & Minimal Audit

**COMPLETE（2026-08-11）**

- Automation 的 URL、Feed 和 MCP 外部能力从现有 `collectionConfig` / source / origin allowlist 派生为确定性的任务级声明；普通本地范围 + AI 任务不新增权限值，knowledge evolution 仍只是可撤销的 pending proposal。
- 新增纯 TypeScript authorization resolver，区分 `ready`、`blocked`、`invalid`，并在租约后、凭据和外部网络前解析当前 definition、MCP Server/discovery/tool、持久化 `allow_scheduled` 与 origin 交集；`allow_session` 不参与 scheduled。
- 预览不联网、不调用 AI、不自动授权；保存/启用缺少授权时保留配置并保持停用。真实执行只访问显式启用来源，MCP 保持 `callScheduledTool` 与既有 route/SSRF boundary，来源失败仍遵循部分结果语义。
- `AutomationRun` 复用可选最小 `unattendedAudit`，保存授权状态、稳定原因码、需求和资源摘要、origin、调用计数、proposal count 与终态；不保存秘密、完整参数、原始结果、完整 URL 路径、文档正文或完整模型上下文。阻断运行进入显式 blocked terminal，不自动 grant 或自动重试。
- 增加 Phase 1 preflight architecture guards、任务/工具权限分离、撤销/资源变化、无网络拒绝、审计隐私和来源部分失败契约；保持 `review_workspace` v16。
- 详见 `docs/automation-external-authorization.md` 与 `docs/mcp-permissions.md`。

### Phase 2 Stabilization — Failure-path External Effect Audit Accuracy

**COMPLETE (2026-08-11)**

- Acquisition, AI/proposal, and persistence failure paths preserve known sanitized external-effect summaries after a real HTTP or MCP call has started.
- Failed audits retain factual call counts and resource identities without persisting raw arguments, results, full URLs, document content, provider payloads, credentials, or error causes.
- Authorization-blocked runs remain zero-call `blocked` runs; uncertain external effects remain `manual-only`, with no automatic retry, replay, rollback, schema migration, or per-call journal.
- Direct contracts cover blocked zero-call behavior, MCP/HTTP failure progress, later-stage failure retention, deterministic merge/no double count, privacy, and unchanged success/partial-success semantics.
- Persisted `AutomationRun.error` messages are derived from stable category, provider, or authorization product text; raw failure causes remain process-local and the existing `unattendedAudit` boundary is unchanged.

`0.6 Phase 2` is complete. The final cross-boundary Acceptance Closure is recorded below.

### Phase 3 — Declarative Extension permission & disable semantics

- **COMPLETE（2026-08-12）**
- 现有 `ExtensionManifestV1` 的权限字段继续作为 declaration；由纯 TypeScript resolver 与当前 `enabled`、能力快照和底层设置交集决定 `ready`、`blocked` 或 `invalid`，不自动授予权限。
- 主题/人设的真实应用入口、显式启用和设置层内置 Obsidian/Fenbi 边界均在执行前复核当前状态；停用、撤销、旧 UI callback、无效旧记录和能力缺失均 fail closed。
- 升级改变声明时不继承旧 enabled；学习路径、已安排模板和评分标准包保持数据声明，不创建 plugin runtime、MCP registry 或任意代码执行。
- 保持既有 MCP/Host/AI/Vault authority、隐私边界、`review_extensions` v1 与 `review_workspace` v16；无新迁移、外部审计表或自动 fallback。
- 详见 `docs/declarative-extension-permissions.md`。

### Acceptance Closure — Final cross-boundary verification

**COMPLETE（2026-08-12）**

- MCP、Automation HTTP/MCP、Declarative Extension、Obsidian 与 Fenbi 的权限声明、当前授权、停用/撤销和隐私边界已按同一 acceptance matrix 收口。
- 真实执行路径 contract 覆盖 MCP stale/revocation、Automation blocked zero-call 与 origin revocation、扩展旧 callback、声明变更升级和内置插件数据保留。
- Chromium Playwright 覆盖内置插件停用与官方主题扩展的安装、启用、停用、主题回滚和 reload。
- 证据矩阵与兼容/回滚边界见 `docs/permission-model-acceptance.md`。

`0.6 overall`：**COMPLETE**。`0.7 overall`：**COMPLETE within the 0.7-owned closure contract**；Phase 1、Phase 2、产品迁移入口、核心 Windows installed-app credential path 与 2026-08-14 real cleanup acceptance 已有 scoped evidence。Recovery/lifecycle residual、no-safe-seam、0.8 deferred scope 与 portability non-claims 按下方矩阵保留，不被改写为 PASS。

### 目标

- 统一声明交互期、会话期和无人值守权限。
- MCP 工具、已安排任务、采集来源和声明式扩展使用明确权限描述。
- 持久化最小审计摘要，不保存原始工具结果或完整上下文。

### 非目标

- 不执行任意插件脚本、HTML 或 JSX。
- 不把 MCP 与内部插件目录合并。
- 不让失败恢复 CTA 自动触发外部操作。

### 风险

- 权限继承不清导致无人值守越权。
- 第三方工具返回敏感内容。
- 插件停用误删历史数据。

### 验收标准

- 默认拒绝，权限作用域和有效期可解释。
- `ask`、`allow_session`、`allow_scheduled` 在执行边界有契约。
- 停用只阻止新执行，保留既有数据和配置。

### 回滚边界

- 权限模型先以兼容字段和执行边界实施；可禁用新授权路径而不删除任务或插件记录。

## 0.7 Desktop credential hardening

状态：**IN PROGRESS**。

### Phase 1 — Desktop Credential Threat Model & Host Secure Storage Boundary

**COMPLETE（2026-08-12）**

- 完成 AI provider、旧 AI 设置、额度凭据、MCP Bearer、粉笔 Cookie、legacy JWK 与 Web secure key 的实际 inventory；保持现有 WebCrypto AES-GCM、record-specific AAD、不可导出 key 与缺 key 重新输入语义。
- 新增浏览器 / Electron Windows threat model，核对安装的 `electron@43.2.0` async `safeStorage` API 与 Windows DPAPI 边界；不把 safeStorage 描述成 TPM、硬件密钥或 zero-trust vault。
- 建立窄化 `desktop-v1` credential protection Host capability、trusted-sender IPC、版本/context/payload 校验和 fail-closed availability；不暴露 generic native crypto 或文件 API。
- 建立纯 TypeScript migration planner 与 failure/recovery matrix；支持后续 dual-read / single-write 设计，但本阶段 `none_phase_1`，不写入生产 Desktop credential。
- 增加 Web/Desktop/backend separation、preload/Main/desktop contracts、context substitution protection、masked-only rejection 与 planner direct tests；未修改 `review_workspace` v16 或 `review_extensions` v1。

Phase 1 明确不包含：production credential cutover、自动迁移、旧 JWK/v2 ciphertext/source 删除、durable migration journal、Windows DPAPI 真实 acceptance、0.8 installer/signing/distribution。详见 `docs/desktop-credential-threat-model.md`。

### 目标

- 评估 Electron 宿主安全存储是否能在不破坏 Web 兼容的前提下提升凭据保护。
- 明确浏览器不可导出 CryptoKey 与 Windows 宿主保护的威胁模型差异。
- 设计可中断、可重试、全成功后提交的凭据迁移。

### 非目标

- 不扩大 preload 为通用文件或系统 API。
- 不在迁移成功前删除旧密钥。
- 不让 Web 模式依赖 Electron。

### 风险

- 平台安全存储与 Electron profile/userData 生命周期不一致。
- 重装、换机和覆盖升级导致密钥不可恢复。
- 混合新旧记录造成部分解密失败。

### 验收标准

- 威胁模型、恢复策略和失败矩阵经过独立安全审查。
- 明文回填、masked-only、跨记录 AAD、主密钥不可导出和失败迁移契约继续通过。
- 建立覆盖升级与缺密钥恢复的 acceptance contract 和 recovery matrix；真实 installed-app Windows lifecycle evidence 由后续 acceptance/distribution phase 承担。

### 回滚边界

- 新存储必须支持双读、单写和明确回退期限；删除旧材料需要单独确认阶段。

### Phase 2 — Desktop Credential Migration & Controlled Cutover

**COMPLETE (2026-08-12)**

- Implemented structured Main → preload → platform credential errors, real inventory across AI, legacy AI, quota, MCP, Fenbi, Web v2, legacy v1, and Desktop v1 sources, and explicit format detection without decrypt-and-guess.
- Implemented sequential preflight, stage, verify, ready-to-commit, commit, and post-commit verification with an excluded safe journal. Partial staging and partial commit are resumable and remain recovery-required until verified.
- Desktop becomes preferred only after all expected records verify. Web sources remain retained for rollback evidence; post-cutover writes are Desktop-only and host failure never downgrades to Web.
- Added repository integration and regression contracts for AI connections, quota credentials, MCP bearer tokens, and Fenbi Cookie, including denied/disabled zero-unprotect paths.
- Core `review_workspace` remains v16; Web mode remains WebCrypto-only. At Phase 2 closure, Windows installed-app acceptance and cleanup were intentionally outside this phase; the historical partial acceptance record is maintained in Phase 3 below alongside the later closure record.

### Phase 3 — Product Migration Entry & Windows Installed-App Acceptance

**COMPLETE within the 0.7-owned credential-security closure contract（产品入口、核心 Windows credential path 和 2026-08-14 cleanup acceptance 已归档；residuals 按 closure contract 分类）**

- Settings → AI 连接增加最小显式 `Desktop 凭据保护` 入口；只有真实 Desktop Host 才渲染，Web 不显示伪造迁移能力。
- 打开 Settings 只读取安全 Host 状态与 migration journal；不会在启动、打开 Settings 或渲染面板时自动迁移。用户明确点击后才调用既有 `migrateDesktopCredentials()`，并继续使用 single-flight、可恢复 journal、Desktop-first authority 和 Desktop-only 写入。
- UI 只展示 ready、in progress、complete、requires re-entry、blocked、recovery required、Desktop protection unavailable 等固定安全状态，不展示凭据、密文、IV、payload、路径、堆栈或 raw IPC error。
- 增加 Web 隐藏、显式启动、无启动写入、single-flight、状态映射、状态 reload 和隐私边界 contracts，并增加 deterministic fake-Desktop Browser E2E harness。该 harness 不等同于 Windows DPAPI 或安装版证据。
- 真实 Windows installed-app 记录已确认同一机器、同一用户、同一 application profile 下的 Desktop-authoritative credential persistence、Web→Desktop cutover 与重复重启可用性；证据范围不扩展为 general DPAPI portability。
- controlled failure/recovery 的 installed-app evidence 仍为 **PENDING / DOCUMENTED RESIDUAL**；`corrupted envelope` 与 `interrupted pre-commit` 当前没有安全的 installed-app injection seam，因此是 **NO SAFE INSTALLED SEAM / NOT CLAIMED**。
- adjacent-version upgrade 与 uninstall/reinstall 仍为 **PENDING / DEFERRED TO 0.8**，由 Windows desktop distribution/lifecycle phase 负责；不同 machine/account、copied `userData` 与 general DPAPI portability 仍为 **MANUAL-ONLY / NON-CLAIM**，不写成 supported 或 portable。
- Real Credential Cleanup 已由 2026-08-14 operator-attested installed-app record 记录为 **PASS**：`3` retained Web sources → `0`，shared Web key present → absent，Desktop records 和 migration authority 保持，完整重启后 cleanup 仍 complete，DeepSeek/MiniMax credential-backed operation 通过且未观察到 Web material regeneration。
- 本阶段实现的 Desktop-only review → irreversible acknowledgement → confirmation 入口和显式 partial/recovery resume 仍保持原有安全边界；随后独立的 installed-app acceptance 完成了真实 destructive cleanup。operator evidence 限定为同机、专用 Windows 测试用户/profile、同 application profile，不扩展为 portability 或分发生命周期保证。

`0.7 WINDOWS ACCEPTANCE`：**PASS / COMPLETE within the 0.7-owned closure contract**。

`0.7 overall`：**COMPLETE**。Phase 1、Phase 2、产品入口、核心 real Windows installed-app credential path 和 real Credential Cleanup blocker 均已关闭或有充分 scoped evidence。Recovery 的 installed-app evidence 继续作为 documented residual，corrupted/interrupted cases 继续是 no-safe-seam，distribution lifecycle 继续委托 0.8，portability 继续明确不声明；这些分类不被改写为 PASS。

### 0.7 Closure Contract Clarification（2026-08-13）

本合同区分 evidence status、security closure 和 phase ownership；`PENDING` 不再自动等同于同一种 blocker：

- **PASS / EVIDENCED**：当前真实 installed-app evidence 覆盖 explicit Web→Desktop migration、Desktop authority、same-machine/same-Windows-user/same-profile persistence、repeated restart、credential-backed operation、privacy observation 和 same-version replacement 等实际观察路径。
- **AUTOMATED PASS**：fail-closed、Host unavailable、requires-reentry、context mismatch、partial recovery、context-substitution rejection、no-fallback-under-failure 等确定性安全语义由 contracts、fake host 或 deterministic E2E 覆盖；这些结果不升级为 installed-app、DPAPI 或真实 cleanup evidence。
- **DOCUMENTED RESIDUAL**：核心 fail-closed contract 已有自动证据，但对应 installed-app observation 尚未完成；仍保留 matrix 中的 `PENDING`，不把它写成 PASS。
- **NO SAFE INSTALLED SEAM**：当前没有安全方式注入 corrupted envelope 或 interrupted pre-commit；不得通过随机杀进程、编辑 userData/ciphertext/journal、破坏 DPAPI、真实凭据损坏或 ASAR patching 伪造 PASS。
- **DEFERRED TO 0.8**：adjacent-version overwrite upgrade、clean-machine install、uninstall/reinstall、signing、release asset 和 distribution-owned userData lifecycle。
- **MANUAL-ONLY / NON-CLAIM**：different machine/account、copied `userData` 和 general DPAPI portability；当前只声明 same-machine/same-user/same-profile evidence。
- **CLOSED 2026-08-14**：real Credential Cleanup。Operator-attested installed-app evidence records the explicit cleanup, final reconciliation, restart, and post-cleanup credential-backed operation within the stated scope; Cleanup Foundation and guarded Execution Entry remain the deterministic evidence for inventory, eligibility, journal, reconciliation, ordering, and automated/fake execution boundaries.
- **CONDITIONAL CLEANUP BLOCKER**：`legacy-v1` 不是当前已确认存在的事实；但未来 physical preflight 发现它时，必须以 `legacy_source_present` 阻断 cleanup。只有 physical inventory 确认 zero `legacy-v1` 后，才允许考虑删除 legacy JWK。

0.7 继续拥有 credential-security semantics：Desktop authority、no fallback、fail closed、context binding、source retention 和 cleanup ordering。0.8 只拥有 Windows distribution/lifecycle evidence，不接管这些安全语义。

### Phase 4 — Credential Cleanup Foundation and Execution Entry

**FOUNDATION AND EXECUTION ENTRY IMPLEMENTED；REAL CLEANUP ACCEPTED WITHIN SCOPED WINDOWS EVIDENCE（2026-08-14）；0.7 CLOSED**

- 增加独立 physical cleanup inventory，不调用 migration/normalization、不解密、不生成 key、不写 source/journal；报告 retained Web、legacy、Desktop、shared Web key 与 legacy JWK 的安全 presence/format facts。
- 增加独立 cleanup journal、fail-closed eligibility、crash/reappearance reconciliation、幂等 AI/quota/MCP/Fenbi/legacy source primitives，以及只允许最后删除 shared Web key 的窄 API。Migration journal、authority、Desktop material、schema 与 backup/export boundary 不变。
- Settings → AI 连接增加 Desktop-only 的显式 review → acknowledgement → confirmation execution entry。UI 只通过窄 facade 调用既有 executor；destructive facade 只在确认动作动态加载；fresh inventory/Host/Desktop recoverability verification、legacy-v1 blocker、source-before-key、shared Web key last、partial/recovery resume 和 no-auto-resume 继续由 service boundary 保证。Desktop verification 通过既有 Host unprotect boundary 并立即丢弃返回 secret，不持久化或暴露 plaintext。
- Contracts 与 browser E2E 只证明 automated/fake boundary：inventory no-write/no-decrypt/no-key-generation、explicit confirmation、stale-state block、source-before-key、partial/recovery、journal preservation、Web hiding、pre-migration block、reload without auto-resume 与 explicit resume。它们不证明真实 Windows cleanup、DPAPI deletion 或 installed-app deletion。

详见 `docs/credential-cleanup.md`。本 Phase 的 foundation/entry automated evidence 不能单独关闭 0.7；随后归档的 2026-08-14 installed-app acceptance 记录了真实 cleanup、final reconciliation、restart 和 credential-backed operation，并关闭了 0.7 credential-security gate。

完成的 closure sequence 为：**Cleanup Foundation and Execution Entry implemented → current-build Windows installer → isolated dedicated profile → explicit real cleanup acceptance → final reconciliation/restart credential check → `0.7 COMPLETE`**。本 Phase implementation 本身不执行 real cleanup；0.8 distribution/lifecycle work 仍未启动。

### 0.7 final closure boundary（2026-08-14）

Real cleanup、post-cleanup restart、no-regeneration observation 和 cleanup 后 credential-backed operation 均已记录为 scoped operator-attested installed-app evidence。Source-before-key、fresh revalidation、legacy-v1 blocking、fail-closed、context binding、partial/recovery 和 no-auto-resume 继续由 deterministic contracts 支持。最终 COMPLETE 只关闭 0.7-owned credential-security blockers；adjacent-version、uninstall/reinstall、signing、release assets、distribution-owned lifecycle、different machine/account、copied `userData` 和 general DPAPI portability 仍分别属于 0.8 或 MANUAL-ONLY / NON-CLAIM。

## 0.8 Windows desktop distribution

0.8 owns Windows distribution/lifecycle acceptance: clean-machine install, adjacent-version overwrite upgrade, uninstall/reinstall behavior, installer identity, release asset evidence, and `userData` lifecycle under those flows. Production-v1 is intentionally unsigned; signing/publisher identity is a future capability rather than a 0.8/M5 blocker. It does not own 0.7 credential-security semantics such as Desktop authority, no Web fallback, fail-closed behavior, context binding, or cleanup ordering.

### 目标

- 稳定 Windows x64 安装、覆盖升级、卸载和发布证据。
- 明确安装器、SHA-256、版本、提交和 CI 的可追溯关系。
- 按 [`windows-production-v1-release-policy.md`](windows-production-v1-release-policy.md) 固定 intentionally unsigned、accepted Unknown Publisher/SmartScreen residual 与 exact-artifact SHA-256 security boundary；M5-E 已完成 final staged-byte hash/manifest、实际 unsigned Authenticode 和 Actions artifact download verification。M5-F originally froze the `0.3.0` tuple；subsequent trusted Windows release E2E failure left the exact `v0.3.0` tag as an immutable unpublished failed candidate。M5-G 当前是 PR #125 的 `0.3.1` recovery source candidate 与 exact-SHA Draft Release asset readback/re-download/re-hash pipeline；其 PR-only Windows + Node `24.20.0` full E2E 是必要 recovery gate。PR #125 merge 后必须先完成新的 dedicated `0.3.1` production tuple re-freeze、review/merge freeze change 和 exact post-freeze main CI，之后才允许 owner authorization 进行真实 tag/Draft activation；M5-H/I/J 仍未完成；代码签名和 publisher identity 延后到独立未来里程碑。

### 非目标

- 不在本阶段承诺 macOS/Linux。
- 不发布脱离 resources 无法运行的裸 EXE。
- 不启用未经设计的自动更新。

### Phase 1 — Windows distribution lifecycle contract and acceptance foundation

状态：**COMPLETE（2026-08-14）**；`0.8 overall` 仍为 **IN PROGRESS**。

- 2026-08-14 historical audit snapshot recorded Electron `43.2.0`、Forge `7.11.2`、`MakerSquirrel` `7.11.2`、`electron-winstaller` `5.4.4` and Squirrel vendor runtime `2.0.1+eef37460ae`; it confirmed `review_workspace` package identity, Windows x64 output, Setup/full nupkg/`RELEASES` shape and the then-documented Windows release workflow. Current main uses Electron `43.4.1`; this historical evidence is intentionally preserved.
- 已建立 binary install root 与 Electron `userData` 的独立 ownership contract：预期分别为 `%LOCALAPPDATA%\\review_workspace\\` 与 `%APPDATA%\\错题复盘\\`；覆盖升级不自动清理 userData，卸载清理未实现且必须由未来产品语义和用户授权决定。
- 已建立 lifecycle contract：四类 Squirrel install/update/uninstall invocation 在 single-instance lock 和 BrowserWindow 前 early quit，`--squirrel-firstrun` 保持正常应用启动；新增直接行为 contract 与 package/release identity contract。
- 已吸收 clean first-install PASS 和 repeated same-version Setup file-lock diagnostic；后者不扩展为同版本 reinstall 安全保证，也不触发 GPU、sandbox、Update.exe 或 shortcut workaround。
- 已新增 [`docs/windows-desktop-distribution.md`](windows-desktop-distribution.md) 与 `docs/release-smoke.md` 的 A–W lifecycle matrix、threat model、隔离 acceptance procedure、signing/release boundary 和 non-claims。

Phase 1 不声称 adjacent-version real PASS、uninstall/reinstall real PASS、production signing、publisher identity、release promotion 或 interrupted-install recovery。详细状态以 distribution matrix 为准。

### Phase 2A — adjacent-version overwrite upgrade acceptance closure

状态：**COMPLETE within scoped adjacent-version binary/userData/restart acceptance（2026-08-15）**；0.8 overall **IN PROGRESS**。

- 已核实 baseline package version 为 `0.2.2`，下一合法 patch candidate 为 `0.2.3`；同步 `package.json`、lock root/package root version、Forge Setup fallback 与版本 identity contract。
- 已补齐真实 `0.2.2 → 0.2.3` acceptance 的文档与 closure matrix，明确 baseline hash、专用 Windows profile、single-run Setup、Squirrel completion、binary/root stub、shortcut、old-version cleanup、实际 `userData`、非敏感 sentinel 和 full restart 的证据边界。
- 已记录 operator-attested 的真实 Windows acceptance：指定 `0.2.2` baseline hash 匹配，clean install/restart 与 sentinel 通过；应用完全关闭后单次 `0.2.3` Setup 完成，Squirrel 输出 `Finished`、`Update.exe`/Setup 正常退出、`app-0.2.3` 与 root execution stub 可启动、`app-0.2.2` 清理、实际 `userData`/sentinel 保留，且升级后完整重启仍解析到 `0.2.3`。
- 未观察到产品 shortcut `.lnk`；该结果记录为 **NO PRODUCT SHORTCUT OBSERVED / N/A FOR THIS PHASE 2A RECORD**，不是 shortcut PASS/FAIL，root stub launch 独立通过；属于后续 0.8 distribution UX residual。
- 13:02 的同版本 `0.2.2` Setup 是一次 incidental successful same-version observation，不扩展为 general reinstall safety 或本阶段的 same-version PASS；runtime/security/schema/credential authority 保持不变。
- 未修改 Electron runtime、Squirrel package identity、userData 路径、credential authority、schema、preload/IPC/security settings；不创建 tag、不发布 GitHub Release、不添加 auto-update 或 signing。

Phase 2A 已在同一台 Windows 机器、同一专用 Windows profile 中，使用重新校验的已知 `0.2.2` installer 完成真实 baseline 与一次关闭应用后的 `0.2.3` overwrite upgrade，并观察到 scoped binary/data/restart 结果，因此标为 **COMPLETE**。Credential availability row 本轮为 **PENDING / NOT EXECUTED**，不构成本阶段已声明 binary/userData/restart closure 的阻断项；0.7 credential-security closure 不变。未执行行继续是 **PENDING**，不同机器/账户、复制 `userData` 与 DPAPI portability 仍是 **NON-CLAIM**。

### Phase 2A 验收标准

- `0.2.3` candidate package、lock identity、Forge installer name、Squirrel outputs、source SHA 和 SHA-256 manifest 可由 exact-head build record 对应；installer binary 不进入 Git。
- 已知 `0.2.2` baseline 单次安装、正常重启和 production UI sentinel 持久化通过；应用完全关闭后，`0.2.3` Setup 单次运行正常完成且 `Update.exe` 退出。
- 新版本部署、root execution stub、old-version cleanup classification、实际 `userData` 路径、产品 sentinel 与 full upgraded restart 均有真实观察记录；未观察到产品 shortcut `.lnk`，因此 shortcut 记录为 **NO PRODUCT SHORTCUT OBSERVED / N/A**，不标记 PASS/FAIL。
- Credential row 只在有真实 disposable/revocable credential 的情况下观察 Desktop authority 与既有操作；不重新输入、不导出/复制 DPAPI、不改 ciphertext/journal、不允许 Web fallback，不把 same-profile evidence 扩展为 portability claim。

### Phase 2A 非目标

- 不做同版本 reinstall、uninstall/reinstall、running-app upgrade、生产签名、SmartScreen、GitHub production release、`v0.2.3` tag、auto-update、delta update、不同机器/账户或 destructive interruption injection。

### Phase 2B — real uninstall/reinstall lifecycle acceptance

状态：**COMPLETE within the scoped closed-app uninstall → same-version `0.2.3` reinstall → same-userData/product-data persistence → full-restart acceptance（2026-08-15）**；`0.8 overall` 仍为 **IN PROGRESS**。

- 本阶段 scope 是专用 Windows profile 中的 `0.2.3` clean install → production UI ordinary sentinel → fully closed normal Windows uninstall → completed same-version `0.2.3` reinstall → original sentinel visibility → full ordinary restart。以下真实 lifecycle facts 是用户提供的 **operator-attested evidence**，不是 Codex 在本轮独立重放的 destructive sequence。
- Fresh preflight、既有 installer identity、clean install、baseline root-stub restart、production UI sentinel、closed-app uninstall、registry removal、root-stub removal、`packages` removal、userData preservation、same-version reinstall、`.dead` recovery、`app-0.2.3` redeployment、stub recreation、same userData reuse、original sentinel restoration 和 full ordinary restart 均按 scoped matrix 分类为 PASS/OBSERVED；完整 matrix 见 [`docs/windows-desktop-distribution.md`](windows-desktop-distribution.md) 与 [`docs/release-smoke.md`](release-smoke.md)。
- Uninstall registration 中 `DisplayName=review-workspace`、`DisplayVersion=0.2.3` 和 standard/quiet `Update.exe --uninstall` commands 存在，但 `DisplayIcon` 为空；该 uninstall-icon/network warning 记录为 **OBSERVED / UX RESIDUAL**，不是安装失败。
- 标准 closed-app uninstall 没有物理删除整个 install root：`.dead`、`Update.exe` 和一个很小的 `app-0.2.3` binary residual 保留。因此 **complete physical install-root deletion: NOT OBSERVED**、**physical binary cleanup: PARTIAL RESIDUAL OBSERVED**；本阶段不写 clean uninstall PASS。
- 当前 vendor 为 `electron-winstaller@5.4.4` 的 Squirrel `2.0.1+eef37460ae` / FileVersion `2.0.1.1`。上游 2.0.1 的 `FullUninstall` / `DeleteDirectoryOrJustGiveUp` / registry-removal 顺序与 `.dead` marker/residual-tolerant behavior 的 source-backed interpretation 已记录在 distribution contract；不把未直接观察的内部 call stack 或完美 binary deletion 写成事实。
- Candidate identity 未变：`ReviewWorkspace-0.2.3-Windows-x64-Setup.exe`、source SHA `da46193de710fa11b638793eb34401b305a713ae`、SHA-256 `FBC9D0553926BCFBB8634E31E2108FE3BA555FF999389CBB8403BB1A6B084B22`；本轮只做 evidence/status closure，不修改 runtime/package/Forge identity，不生成新 installer。
- Credential availability after reinstall 保持 **PENDING / NOT EXECUTED**，0.7 credential closure 保持 COMPLETE/unchanged；running-app uninstall 保持 **PENDING — SEPARATE MANUAL CASE**；shortcut 保持 **NO PRODUCT SHORTCUT OBSERVED / N/A**。不同机器/账户、复制 userData、general same-version safety、DPAPI portability、signing、publisher、SmartScreen、auto-update、release promotion 和 interrupted-install recovery 继续为 PENDING/NON-CLAIM。

#### Phase 2B scoped completion criteria

- verified `0.2.3` installer identity、fresh dedicated profile、clean install and baseline sentinel restart all pass;
- one closed-app standard Windows uninstall completed with registry/root-stub/packages/userData and physical residual classified without manual storage surgery;
- same-version post-uninstall reinstall consumed the residual state, removed `.dead`, redeployed `app-0.2.3`, reused the same userData and restored the original sentinel;
- a full ordinary root-stub restart launched without lifecycle arguments and retained the original sentinel;
- credential, running-app uninstall, shortcut, portability and signing rows retain their explicit `PENDING`/`N/A`/`NON-CLAIM` classification.

Static contracts and build/package success cannot replace the operator-attested Windows evidence. Phase 2B is therefore **COMPLETE only within the scoped lifecycle above**; complete physical install-root deletion, clean uninstall, credential persistence and the remaining 0.8 distribution claims are not closed.

### 风险

- runner 缓存和上游归档漂移。
- unsigned installer 的 Unknown Publisher / SmartScreen friction，以及 checksum/provenance 或发布权限失败。
- 覆盖升级破坏 Electron userData 或 Vault 配置。

### 验收标准

- Phase 1：当前 packaging stack、binary/userData ownership、lifecycle process model、installer identity、threat model 和 A–W acceptance matrix 有代码/依赖/文档证据与 automated contracts。
- Full 0.8：clean-machine 安装、覆盖升级、Phase 2B scoped 卸载/重装边界、intentionally unsigned release asset provenance 和其余 userData lifecycle 仍需按各自 scope 的真实 Windows evidence；M5-G 的 `0.3.1` source candidate、PR-only Windows Node `24.20.0` full E2E gate 与 round-trip pipeline 已实现，但 M5-G real activation 只有在新的 `0.3.1` production tuple re-freeze、freeze change review/merge 和 exact post-freeze main CI 完成后才可进行；M5-H/I/J 尚未完成，未执行项目不得写成 PASS。Production signing/publisher identity 不是 production-v1 acceptance gate；`v0.3.0` exact tag/failed candidate 保持 immutable。
- 安装器、ASAR、runtime manifest、Fuses、大小和 checksum 可验证；这些 artifact checks 不替代真实 installed-app lifecycle evidence。

### 回滚边界

- 保留前一稳定安装器和迁移兼容；发布失败不修改用户数据。

## 0.9 Stabilization

### 目标

- 冻结破坏性功能开发，集中处理缺陷、性能、可访问性和恢复体验。
- 建立升级、备份恢复、长时间运行和大数据量基线。
- 清理过期兼容桥，但只在真实迁移覆盖率充分后执行。

### 非目标

- 不增加大模块、Provider 或视觉重做。
- 不以删除测试或放宽预算解决失败。

### 风险

- 长期本地数据组合无法由短 E2E 覆盖。
- 兼容代码清理过早。
- 发布候选阶段仍有依赖或运行时高危漏洞。

### 验收标准

- 全部门禁稳定通过，生产 high/critical 为零。
- 关键业务具备桌面、移动、Electron 和恢复路径证据。
- 已知限制、人工验收项和支持边界完整记录。

### 回滚边界

- 每个稳定化修复保持单一问题、独立测试和明确回滚提交。

## 1.0 Release criteria

### 目标

发布首个具备明确数据、安全、宿主、测试和维护承诺的稳定版本。

### 非目标

- 1.0 不代表云服务、多用户、全平台或所有 AI 厂商支持。
- 1.0 不承诺浏览器关闭后继续执行本地已安排任务。

### 验收标准

- README、架构、API、部署、数据恢复、安全边界和变更记录与代码一致。
- `review_workspace` 历史数据、凭据、对话、自动化、学习数据和 Vault 映射完成升级验证。
- typecheck、lint、contracts、desktop tests、build、bundle、production audit 和桌面/移动 E2E 全部通过。
- Windows 安装、覆盖升级、卸载、checksum、签名状态和 Release 资产完成验证。
- 真实 Vault、至少一条真实模型连接和无凭据恢复流程完成脱敏人工 smoke。
- 无未说明的高危安全问题、数据丢失缺陷或阻断级可访问性问题。

### 回滚边界

- 保留最后一个稳定 `0.9.x` 安装包、数据库兼容路径和发布说明。
- 1.0 发布不得包含不可逆且无备份恢复路径的数据迁移。
