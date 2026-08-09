# 0.3 到 1.0 产品路线图

## 文档定位

本文描述 ReviewWorkspace 从 `0.2.x` 功能快速迭代阶段进入产品化阶段的版本边界。它不是功能愿望清单：每个阶段都包含目标、非目标、风险、验收标准和回滚边界。

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

状态：Phase 1 Evidence Normalization & Read-only Learning Action Queue 已完成；后续阶段待启动。

Phase 1 已交付：持久化 mastery 统一按 1..5 解释，错题、知识、辅导微测/计划与面试计划通过固定优先级派生只读行动队列；首页只展示有本地证据的最多四项行动。Automation 运行、待确认知识提案、未评分面试和未提交微测不作为学习完成证据。详见 `docs/learning-loop.md`。

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
- 覆盖升级和缺密钥恢复完成真实 Windows 验收。

### 回滚边界

- 新存储必须支持双读、单写和明确回退期限；删除旧材料需要单独确认阶段。

## 0.8 Windows desktop distribution

### 目标

- 稳定 Windows x64 安装、覆盖升级、卸载、签名和发布证据。
- 明确安装器、SHA-256、版本、提交和 CI 的可追溯关系。
- 评估代码签名和 SmartScreen 信誉建设。

### 非目标

- 不在本阶段承诺 macOS/Linux。
- 不发布脱离 resources 无法运行的裸 EXE。
- 不启用未经设计的自动更新。

### 风险

- runner 缓存和上游归档漂移。
- 签名证书、时间戳服务和发布权限失败。
- 覆盖升级破坏 Electron userData 或 Vault 配置。

### 验收标准

- clean-machine 安装、覆盖升级、卸载保留/清理边界有人工记录。
- 安装器、ASAR、runtime manifest、Fuses、大小和 checksum 可验证。
- GitHub Release 资产状态、大小和 SHA-256 与本地一致。

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
