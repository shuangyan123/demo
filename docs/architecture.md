# 应用架构

## AI 连接、额度运行时与个性化记忆（2026-07-14）

- 连接编辑器只持有当前草稿；目录发现与测试通过 `ai-connection-client` 在草稿 Key 留空时安全复用旧密钥，但厂商、Base URL 和模型永远取当前草稿。连接测试活动使用 `compact-test`，由独立 352px 结果卡渲染，不进入全局 AI 对话结构。
- 默认能力通过 `DefaultCapabilitySelector` 原子保存 `{ connectionId, modelId }`。无目录连接只在组件内保留待选连接，输入手动模型后才整体落库；共享目录与手动模型 ID 始终并存。官方连接能力在 repository 边界按当前 contract 归一化，自定义连接继续尊重用户声明。
- `QuotaRuntimeStore` 是额度启用、缓存、四路并发、超时、页面可见性和在线恢复的唯一调度边界。临时失败保留上次成功快照并标记过期；普通模型 Key 与账单凭据仍完全分离。
- 额度表格通过纯函数 presentation 层把官方指标转换成 32px 环形概览；有分母才计算比例，只有余额时使用状态环。精确数值只进入 450ms 悬浮、键盘聚焦或触屏点击后的说明层，刷新仍是行级主操作。
- MiniMax 连接在 repository 与 provider adapter 边界显式保存 `region`、`credentialPlan` 并规范化 Anthropic-compatible 根地址。M3 的文本、图片、视频、thinking 与 service tier 都由精确 descriptor 声明，M2.x 不继承视觉能力。
- 设置导航为外观、AI 连接、个性化、额度、MCP、诊断。个性化内部拆分角色和记忆；记忆以可选版本字段保存在现有 personalization 单例，最多 100 条，只有 active 条目可按范围裁剪到 1500 字符后注入请求，不升级 IndexedDB v16。
- 数据删除只由“诊断 → 数据管理”提供，按导入、错题复盘、对话历史和完整重置分域执行；AI 连接页不再承载业务数据清理。

## 设置、模型菜单与额度边界（2026-07-14）

- 设置导航固定为外观、AI 连接、个性化、额度、MCP、诊断；个性化与额度使用模块顶层 `next/dynamic`，旧 `roles` 入口只在导航边界归一化为 `personalization`。
- 模型菜单外壳不滚动，当前层由独立 viewport 承担真实溢出；换层同步清零滚动位置并通过 `ResizeObserver` 决定是否启用滚动。tooltip 使用单例 intent，程序化聚焦和触屏不创建可视浮层。
- 额度领域类型位于 `types/domains/ai-quota.ts`。浏览器 repository 逐项加密管理凭据，服务端 `quota-adapters.ts` 负责 OpenAI、Anthropic、DeepSeek、xAI 的官方只读 API 和统一错误分类。
- AI 连接只保存推理凭据；额度管理凭据、Team ID、本地预算和指标单独保存。Dexie 保持 `review_workspace` v16，旧单密钥与旧快照只在读取边界兼容转换。

## 对话拖拽与厂商适配器边界（2026-07-12）

- `ConversationFolderTree` 在自身 Client Component 边界内持有 `DndContext`、Pointer/Touch/Keyboard sensors 与拖拽覆盖层；`ReviewWorkspace` 不接触拖拽状态。
- 文件夹和对话移动仍由 `conversationRepository` 校验项目、根目录、自身及子孙关系，UI 只提交目标并显示结果。
- AI 连接档案只负责厂商、鉴权、Base URL 与声明能力；默认用途通过 `AiConnectionDefaults` 独立保存连接与模型。
- 七家已核验厂商通过 `providerAdapterRegistry` 进入明确协议；其他厂商只进入兼容边界。
- 模型选择器采用厂商到模型的紧凑钻取，点击模型立即保存会话选择，不再维护额外确认状态。

## 连接与运行时模型边界（2026-07-12）

- `ApiConnectionProfile` 只持有厂商、地址、密钥与能力；历史 `model` 只用于一次性初始化默认能力模型，新建和编辑不再写入。
- 后台任务通过 `AiConnectionDefaults` 的“连接 + 模型”组合运行；对话通过 `selectedConnectionId`、`selectedModelId` 与 `selectedRuntimeValues` 运行，两者互不覆盖。旧推理/速度字段只在 repository 读取时折叠，不升级 Dexie v16。
- 模型选择器采用单栏钻取：当前会话厂商优先，其余按英文名排序；进入厂商后只显示连接、模型、能力 tooltip 和独立推理/速度子列表，所有选择点击即保存。
- 官方 Models API 成功时展示账户可用的全部未弃用模型；失败时才使用带 `verifiedAt` 的回退目录。MiniMax 当前旗舰为 `MiniMax-M3`，GLM 当前旗舰为 `glm-5.2`。
- 对话树名称区域承担 dnd-kit 拖拽，拖拽期间始终提供根目录目标；repository 继续拒绝跨项目、自身和子孙嵌套。

## 对话模型菜单分层（2026-07-13）

- `ConversationWorkspace` 只编排会话运行、消息和工具状态；输入器由 `ConversationComposer` 承载，模型触发器与弹层由 `ConversationModelSelector` 装配，目录加载、菜单导航和选择持久化分别进入专用 hook。
- 模型菜单状态使用 `providers → models → reasoning/speed` 单层判别联合。`ConversationModelPicker` 每次只渲染当前层，不以绝对定位把新面板覆盖在仍可聚焦的旧面板上。
- 空白对话选择保存在 `draftSelection`；持久化对话使用按 `conversationId` 隔离的乐观选择。写入按用户操作顺序串行化，刷新确认后清理，失败时只回滚当前对话并显示错误，禁止把 A 对话的临时选择带到 B 对话。
- 选项宽高由内容和当前层决定：桌面厂商、模型、普通运行、预算层分别为 208/240/160/200px；移动端在 390×844 基准下限制为 320/352/288/320px 且不超过视口安全宽度。仅内容超过可用高度时内部滚动。
- 运行值继续只以 `selectedRuntimeValues` 持久化，不改变 IndexedDB v16 或 `/api/ai/models`、`/api/ai/generate`。UI 提交归一化值，provider runtime mapper 负责厂商字段。

```text
选择模型/档位
  → descriptor 归一化
  → 当前对话乐观状态
  → conversationRepository 串行写入
  → 刷新 snapshot
  → /api/ai/generate
  → provider runtime mapper
```

```text
features/conversation/
├── conversation-workspace.tsx             会话运行编排
├── conversation-composer.tsx              输入、附件与工具装配
├── conversation-model-selector.tsx        触发器与弹层生命周期
├── conversation-model-picker.tsx          当前钻取层
├── conversation-model-runtime-controls.tsx 运行 radio 与预算输入
├── use-conversation-model-navigation.ts   判别联合与跨层焦点
├── use-conversation-model-selection.ts    草稿/对话选择与串行写入
└── use-connection-model-catalog.ts         共享目录读取
features/shared/ui-tooltip.tsx              可访问共享 tooltip
```

## 分层与依赖方向

```text
App Shell / ReviewWorkspace
  -> Domain Feature / Application Controller
  -> Domain Service / Repository Port
  -> Browser Adapter / Dexie / AI HTTP Route
  -> External Provider or Local File System
```

- 依赖只能沿箭头向下；UI 不直接读取其他领域的 repository。
- `ReviewWorkspace` 只负责导航、连接注入、视图装配和跨模块通知。
- 长生命周期交互状态由专用 controller 管理；可持久化状态只通过 repository 写入。
- `MediaStream`、`FileSystemDirectoryHandle`、密钥明文、完整 prompt、截图和 Vault 正文不得进入全局 React 状态或持久化日志。

## 目录与模块

```text
app/
├── api/ai/                 AI 浏览器代理路由
├── api/mcp/                MCP Streamable HTTP 发现与调用边界
├── db/                     Dexie 实例、schema 与版本迁移
├── features/               按业务领域组织的 UI 与 controller
├── server/ai/              provider adapter 与 HTTP 公共边界
│   └── runtime-option-mappers/ 七家厂商运行参数映射
├── server/mcp/             MCP SDK 客户端与 URL 安全校验
├── services/               迁移中的 repository、adapter 与纯业务服务
└── types/domains/          领域稳定类型入口
```

- Review：错题、复盘、统计与主工作台装配。
- Knowledge：知识资料、训练、内化、演进与 Obsidian 桥接。
- Conversation：项目、文件夹、空白草稿、消息与工具步骤。
- Automation：仅在应用打开时调度的“已安排”任务。
- Interview / Tutoring / Import / Settings：低频功能，必须动态加载。
- AI Connection：连接档案、能力边界、模型目录、语音与额度插件。

## 对话、插件与 MCP

- `ConversationWorkspace` 由 `ConversationComposer`、两级模型选择、媒体工具、MCP 调用和 Obsidian 提案等独立组件协作；会话可以保存 `selectedModelId` 覆盖，但继续复用同一连接档案的密钥和 endpoint。
- 顶层“插件”只展示应用内扩展状态和领域跳转；MCP 独立位于设置，并通过对话工具实际调用，不伪装成插件目录条目。
- MCP 首期仅支持 Streamable HTTP：远程 HTTPS、本机 loopback HTTP、无认证或本地加密 Bearer。原始调用结果仅在当前工具面板内存中存在，run/step 只保存 Server、工具、参数键和结果长度等脱敏摘要。
- Obsidian 提案以当前对话和用户勾选的知识摘要为来源；生成、解析和 pending 保存形成同一对话 run，确认时才恢复目录权限、复读 Vault 并执行哈希检查。
- 复盘计时是页面 controller 的临时状态：默认正计时且暂停在 `00:00`，切题只重置，用户点击开始后才累计。

## 模块与新对话

- 错题、知识和薄弱分析统一进入“学习数据”浏览器，共享板块、掌握度与搜索作用域；侧栏不再重复提供板块筛选。
- 业务模块通过内存态 `ConversationLaunchContext` 把来源、摘要和建议问题交给空白对话；点击入口不会创建记录，首次发送后才持久化会话与脱敏上下文摘要。
- 摄像头、屏幕共享和截图属于对话工具。原始 `MediaStream` 与帧只驻留内存，截图只有在用户发送后才进入多模态请求。
- 历史辅导 session/turn 表继续兼容，通过对话工具菜单的“历史辅导记录”进入，不升级 Dexie schema。

`app/types/review.ts` 是迁移期兼容出口；新代码应从 `app/types/domains/*` 引用。领域类型完成迁移后再缩减兼容出口，避免一次性改动全部调用方。

## 数据流与状态归属

```text
User Event -> Feature Controller -> Domain Service -> Repository -> IndexedDB
AI Request -> Connection Client -> Runtime Descriptor -> /api/ai/* -> Provider Mapper -> Provider Adapter -> Provider
Vault Event -> Obsidian Controller -> Repository -> File System Access API
```

- 页面草稿、筛选、展开和媒体状态留在 feature/controller。
- 业务实体、会话摘要、运行结果和迁移基线存入 `review_workspace`。
- Dexie 当前版本保持 v16；`review-db-migrations.ts` 承载幂等迁移函数，不为前端切片新增索引。
- AI route 使用共享 HTTP 错误边界，只返回归一化数据或脱敏错误，不透传厂商原始响应。

## 扩展点

- 新学习专项注册 `StudyDomainDefinition`，不得在 shell 中新增专项分支。
- 新导入来源实现 `ImportProviderPlugin`。
- 新 AI 厂商扩展 provider registry、provider adapter 与具体模型 runtime descriptor/mapper；未知模型不得按名称猜测运行参数。
- 新额度来源扩展 descriptor/fetch strategy；无稳定官方 API 时只能使用 manual/unsupported。
- MCP 保持独立设置边界，真实调用最终进入 conversation run/step 状态机。

## 性能与架构守卫

- 低频 Client Component 使用模块顶层 `next/dynamic`；重型库在用户动作中使用 `await import()`。
- `architecture-boundary.contract.test.ts` 检查 workspace 预算、低频静态依赖和相对 import 循环。
- `bundle-boundary.contract.test.ts` 检查首屏重型依赖、controller 边界和 Dexie 迁移约束。
- 新增跨域依赖前应先提供 facade/controller；禁止把 repository 重新接回主工作台。

## 架构决策

1. 保留 hooks + repository，不引入 Redux、Zustand 或 DI 框架。
2. 保留单个 Dexie 数据库与 v16 schema，迁移代码按版本模块化。
3. 采用渐进式领域拆分，兼容出口在调用方迁移完成前保留。
4. 外部 `/api/ai/*` URL 和持久化数据契约保持向后兼容。

## 设置导航与紧凑界面边界（2026-07-14）

- `useReviewWorkspaceRecoveryNavigation` 是设置分区的唯一状态源；`SettingsWorkspace` 只接收受控的 `activeSection` 与 `onSectionChange`，不得再通过本地 state、定时器或 `initialSection` 镜像父级状态。
- 侧栏、健康检查 CTA 与诊断入口统一写入同一 `settingsSection`；旧 `roles` 只在入口边界归一化为 `personalization`。普通保存、轮询、连接测试和父级重渲染不得修改当前分区。
- 设置内容按信息密度使用独立宽度：连接表单 720px、默认能力 560px、额度与数据管理 760px、记忆 840px；移动端统一限制在视口安全宽度内。
- 默认能力首屏只保留文本与多模态，语音类能力进入原生 disclosure；额度和数据管理采用紧凑表格，记忆与危险操作通过具备焦点锁定、Escape、遮罩关闭和焦点恢复的应用内弹层编辑。
# 模型目录与实时语音边界（2026-07-12）

- 模型目录采用官方在线发现优先、带核验日期的官方回退清单；按连接 ID、厂商和规范化 Base URL 隔离缓存 24 小时，密钥和厂商原始响应不得缓存。设置测试、默认能力和对话菜单共用 `model-directory-service`。
- 对话模型选择保持“厂商图标 → 单厂商连接/模型”两级状态，空白对话仍只在首条文本或最终用户语音转写后创建。
- 语音试听由 `VoiceProviderDescriptor` 驱动，只向 OpenAI、Gemini、MiniMax、GLM 发送各自支持的字段。
- 实时语音运行对象、PCM、增量转写和临时凭据只留内存。OpenAI 使用 WebRTC；GLM 使用本地单实例 WebSocket 中继与同源 HTTP 入口，空闲两分钟回收，不支持多实例或 Serverless。

# 对话树与连接测试闭环（2026-07-13）

- 对话树的名称区域直接作为 dnd-kit 拖拽表面，不再占用六点手柄或鼠标提示；拖动时用浮层和固定根目录目标反馈，移动合法性仍由 repository 校验。
- 文件夹和对话统一使用“展开位/空位、图标名称、操作位”网格；根图标严格对齐，只有 `.conversation-tree-children` 按层级增加缩进。两者通过右键菜单进入行内重命名；Enter 提交、Escape 取消。
- 连接档案只保存厂商、鉴权、 endpoint 与能力。模型发现和真实测试通过连接级 AI 客户端完成，测试模型只保存在本地界面偏好中，必须由用户显式设为默认能力模型。
- `AiModelRuntimeDescriptor` 位于 `types/domains/ai-model.ts`，由具体模型 ID 声明推理、速度、默认值、文档和核验日期。OpenAI/Gemini/xAI Priority、Claude Fast、MiniMax 配对高速模型分别映射，其他模型不得伪造统一速度档。
- 明确核验的 `glm-5.2` 保留 `max/xhigh/high/medium/low/minimal/none` 七档，默认 `max`，请求同时发送 `thinking.type=enabled` 与原样 `reasoning_effort`；核验清单内的 GLM-4.5 至 5.1 只发送开关。未来或带自定义后缀的模型在 descriptor 登记前保持未知，不按版本字符串推断。
