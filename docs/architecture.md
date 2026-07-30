# 应用架构

## Electron 桌面架构（2026-07-28）

```text
desktop/
├─ main.ts          单实例、窗口、安全导航与生命周期
├─ runtime.ts       资源校验、随机端口与 Next standalone 子进程
├─ protocol.ts      review-app 自定义协议与令牌代理
└─ permissions.ts   媒体、文件与屏幕来源权限
```

- React controller、Dexie repository 与 Route Handlers 保持 Web/Electron 共用；桌面目录不进入 React 业务依赖图。
- Electron 主进程只管理应用生命周期、安全边界和本地 Next 子进程，不持有学习状态，不解密业务凭据。
- `next.config.ts` 使用 `output: "standalone"`。浏览器开发仍由 `npm run dev` 提供，Electron 开发加载同一 `http://127.0.0.1:3000`。
- 安装版数据流为 `review-app://workspace → protocol.handle → 127.0.0.1:随机端口 → Next standalone`。一次性令牌仅存在于主进程和子进程环境，代理转发到 Next 后由根 `proxy.ts` 校验并移除。
- 正式包启用 ASAR 完整性、仅从 ASAR 加载、Cookie 加密以及 Node/CLI 环境入口限制；Electron 43 包继续使用标准 V8 snapshot，因为官方 Windows 分发不包含 browser-process-specific snapshot 文件。
- IndexedDB 状态继续由现有 repository 管理。稳定自定义 origin 保证重启后存储位置不变，覆盖安装不删除 Electron `userData`。

当前方案是 Electron + Next standalone。它直接保留现有 AI SSE、语音、Realtime、MCP、采集和粉笔同步 Route Handlers。Tauri 静态导出或 Node sidecar 会引入 Rust、WebView2 与双运行时维护，当前阶段不采用。代价是安装体积较大；只有服务端能力迁出 Next 且体积成为实测问题时再评估 Tauri。

- 业务状态：React controller + Dexie v16 + repository；桌面壳不新增业务状态源。
- 恢复状态：独立 `review_workspace_transfer` v1 只保存待提交包与旧快照，成功或回滚后删除。
- API：保留原有同源 Route Handler 契约；桌面令牌是 loopback 内部传输头，不属于公开业务 API。
- 公考开发示例按学习数据、复盘、知识训练和面试模块分别注册；总览不提供示例。匹配场景时仍先于业务 controller 分流到纯内存 fixture。
- 表格使用显式 `cellStart` / `cellCenter` 语义类，不依赖列序号猜测内容。
- GitHub 使用共享 Web CI 与独立 Windows 桌面发布工作流：PR 验证同一份业务代码和桌面壳契约，手动触发只上传短期 artifact，`v*` 标签校验 `package.json` 版本后创建带 SHA-256 清单的 Draft Release。
- 桌面发布与 Web 部署只通过 Git commit SHA 关联；安装包、`.desktop-runtime`、Forge `out/` 和签名材料不进入仓库，私人仓库阶段不启用自动更新。


## 0.2.0 本机 API 安全边界（2026-07-23）

- `server/http/route-security.ts` 是同源校验、有界 JSON、外联 URL、请求 ID 和结构化错误的共享边界；Route Handler 只负责业务字段校验和调用领域 adapter。
- Provider registry、MCP client、采集 safe fetch 继续分别负责厂商协议、Streamable HTTP 和 SSRF 深层校验；共享 Route 边界不绕过这些既有规则。
- 客户端 `services/api-error.ts` 同时读取新 JSON 错误和历史纯文本错误，避免升级期间改变用户可见恢复提示。
- 安全响应头由 `next.config.ts` 单点维护；CSP 不允许远程脚本、frame 或 object，仅为本机 API、明确 HTTPS/WSS 外联、媒体 blob 和自托管资产保留能力。
- 该边界不新增服务端持久化，不记录请求正文，也不升级 `review_workspace` v16。

## 主题字体与工作台弥散边界（2026-07-18）

- `theme-fonts.ts` 是内置 UI 与代码字体栈的共享边界；Geist Mono 由根布局通过 `next/font` 注入，主题预设和持久化归一化不再各自维护字体顺序。
- 已发布的内置代码字体栈在 repository 边界迁移到 Geist Mono，用户手写字体继续原样保留；`--app-code-font` 仍是组件唯一消费入口。
- 顶栏保持不透明主题底色，并通过独立 `--chrome-topbar-diffuse` 承接低强度弥散色场；关闭弥散时变量为 `none`。
- `raised-surface` 不再绘制顶部、左侧或圆角阴影；层级只由 `<main>` 的 1px 共边和 18px 左上圆角表达。

## P0 工作台与公考首页展示边界（2026-07-17）

- `WorkspaceShell` 继续统一桌面持久化侧栏状态；移动端使用不持久化的临时抽屉状态，并负责焦点锁定、Escape、遮罩关闭、滚动锁定和触发器焦点恢复。
- `ConversationEmptyState` 与 `DashboardStudyFlow` 是独立展示组件；`ConversationWorkspace` 保持在 500 行预算内，既有 controller、repository 和首次发送后才持久化的流程不变。
- `DashboardView` 只接收结构化配置健康、日期状态和操作回调。`resolveDashboardNextAction()` 是唯一推荐动作排序边界，七阶段路径状态继续来自已有本地快照。
- 公考首页默认只展开推荐动作、学习路径与三项统计；板块、知识和辅导详情保留在三个原生 disclosure。未新增静态重型依赖、数据库迁移或网络请求。

## AI 活动、跨厂商上下文与记忆 v2（2026-07-15）

- `AiInteractionPanel` 现在是 `app/page.tsx` 下唯一的应用级活动宿主。`conversation` 事件只写入消息流内的工具摘要；`compact-test` 使用 352px 测试卡；`background` 只渲染一行可关闭状态。设置页和工作台不再各自订阅活动事件。
- `CanonicalConversationTurn` 以 IndexedDB 中的可见用户/助手消息为事实源，并按附件摘要与可见工具结果补充上下文。未超限时发送完整可见历史；超限时使用会话摘要和最近 12 轮。隐藏思维链、thought signature、厂商缓存与私有工具状态不进入该结构。
- Google 官方主机的 GenerateContent 固定为 `/v1beta/models/{model}:generateContent`，Interactions 固定为 `/v1beta/interactions`，流式使用 `?alt=sse`。自定义代理保留用户路径，避免错误改写代理版本。
- 模型目录缓存升级为 v4；Qwen 从 `output.models` 读取分页，Anthropic 使用 `has_more/last_id`。已保存连接测试按“最近成功模型 → 关联默认模型 → 推荐模型”选择。
- 自动记忆仍保存在 personalization 单例，不升级 Dexie v16。新用户默认开启；旧用户由 v1 开关迁移。明确“记住”本地提取，其他内容按三轮或 45 秒批处理；高置信稳定事实自动生效，学习状态、敏感项和冲突进入待处理，秘密直接丢弃。

## 模型目录完整性与按轮次对话链（2026-07-15）

- `ModelCatalogSelect` 是连接测试和默认能力的共享选择边界；当前值只决定选中态，不参与候选过滤，手动模型 ID 始终可用。对话模型菜单继续复用同一 `model-directory-service` 数据源。
- 目录读取返回 `live/cache/fallback`、`stale` 与 `complete`。静态 fallback 只用于首屏占位，只有 24 小时内且 `complete=true` 的 v3 在线缓存可以跳过请求。
- `server/ai/model-directory.ts` 集中处理 Google、MiniMax、Qwen 分页以及 OpenRouter、Groq、Mistral、SiliconFlow、Kimi 的官方目录；在线状态优先，精确 descriptor 只补充已核验能力和协议。
- OpenRouter、Groq、Mistral、SiliconFlow、Kimi、Qwen 标记为 `compatible`，复用 OpenAI-compatible 生成边界；未知模型不得推断多模态、推理或速度能力。
- 对话通过 `turnId/sequence` 将用户消息、可见工具和 AI 回答稳定组成轮次。准备上下文、选模型、调用和流式状态属于 `diagnostic`，默认折叠在轮次详情中；Dexie 仍为 v16。

## Google 双协议与品牌选择边界（2026-07-15）

- Google adapter registry 是请求构建、响应解析和流式分发的唯一执行入口，协议由具体模型目录项决定：`google_generate_content` 或 `google_interactions`。
- 协议解析按精确 descriptor、在线目录、连接级 24 小时缓存依次进行；未知手动模型仅在连接测试收到明确协议不匹配时重试一次，普通对话禁止双发。
- Interactions 固定发送 `store: false`，不保存 `previous_interaction_id`；应用继续发送完整历史，厂商原始步骤与响应不持久化。
- 默认能力的连接与模型选择复用紧凑品牌选择器，图标仅为展示数据，不写入默认能力或连接记录。
- Obsidian 属于 integration branding，不进入 AI provider registry；品牌资产以固定版本本地 SVG 和校验值登记。

## 品牌、Gemini 与粉笔账户导入（2026-07-15）

- 厂商品牌仍由 `ProviderBranding` 单一注册表驱动。Lobe Icons 固定为 `@lobehub/icons-static-svg@1.91.0` 并本地固化 SVG、版本、来源、MIT 许可与 SHA-256；运行时不访问 CDN，未匹配厂商使用文字缩写。
- Google adapter 独占 GenerateContent URL 归一化、`serviceTier`、thinking 字段互斥和脱敏错误分类。标准档不发送服务等级，优先档只发送顶层 `serviceTier: "priority"`，并保留 Gemini 默认采样。
- 粉笔快捷导入分为 `FenbiAccountImportAdapter`、同源 validate/sync route、`useFenbiQuickImport` 与现有草稿 repository。服务端只访问硬编码 `tiku.fenbi.com/api/xingce/*` 路径；Cookie 仅在本机 AES-GCM 密文与单次请求内存中存在。
- 账户同步结果与 PDF/Word 兜底统一落入 `ImportDraft`。异常草稿默认展开，正常草稿折叠；确认前不写错题库，确认后只保留 30 秒内存撤销凭据。Dexie 继续保持 `review_workspace` v16。

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

- `ConversationWorkspace` 只编排会话运行、消息和工具状态；输入器由 `ConversationComposer` 承载。语音、实时通话、模型和推理是一级入口，低频附件/媒体/知识工具进入加号菜单，斜杠指令的瞬时状态留在独立输入组件。
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

## 已安排外部知识采集（2026-07-21）

```text
本地调度 / 补跑 / Web Lock + IndexedDB 租约
  -> 白名单 URL、RSS/Atom 或已获 allow_scheduled 的 MCP 搜索
  -> /api/acquisition/fetch（协议、origin、DNS、重定向、类型、超时、1MB）
  -> HTML/XML 标准化与 URL/内容哈希去重
  -> 模型 A 整理 -> 模型 B 独立复核
  -> 固定 100 分可信度与阻断规则
  -> knowledgeEvolutionProposals.pending
  -> 来源哈希 + Vault 目标统一预检
  -> 逐项写入并即时标记 accepted
```

- `app/server/acquisition` 只负责服务端网络边界和 Cheerio 解析；`app/services/acquisition-*` 负责浏览器内来源发现、运行期文档、模型整理、复核和评分，UI 不直接访问外网。
- `AutomationDefinition.collectionConfig` 只保存领域、查询、来源、origin 白名单和 `{connectionId, modelId, selectedRuntimeValues}`；密钥继续只存在连接仓储。旧任务缺少该字段时沿用原执行链。
- 完整网页、MCP 原始结果、完整提示词和模型原始响应只存在当前运行内存。提案只保存生成稿、360 字以内的必要证据摘录、URL、内容哈希、模型/版本和评分审计。
- 可信度权重固定为 25/25/15/10/15/10。缺复核模型时最高 B；URL 不可验证、无证据段落、来源哈希变化、精确重复或模型事实冲突会阻止确认。
- 批量确认不承诺文件系统事务回滚：预检完成后顺序写入，成功项立即 accepted；失败和尚未处理项保持 pending。Dexie 继续使用 `review_workspace` v16，不新增索引。

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
2. 核心业务保留 `review_workspace` v16；声明式扩展使用独立 `review_extensions` v1，两个数据库都进入完整导出与重置。
3. 采用渐进式领域拆分，兼容出口在调用方迁移完成前保留。
4. 外部 `/api/ai/*` URL 和持久化数据契约保持向后兼容。

## 学习者模型、传输层与声明式扩展（2026-07-16）

```text
错题 / 知识 / 面试 / 辅导微测 / 计划
  -> LearnerStateSnapshot（只读、证据化）
  -> LearningContextAssembler（最多 6–8 条、字符预算）
  -> 辅导请求
  -> 学生操作与微测
  -> TutoringPlan 间隔复练

/api/ai/generate
  -> ProviderAdapter（字段映射与归一化）
  -> ProviderTransport（超时、取消、流与目录）
     -> Google 官方 Interactions：@google/genai，零自动重试
     -> 自定义代理/兼容厂商：HttpProviderTransport

声明式扩展 JSON
  -> 严格 schema / 资产摘要 / 内容摘要 / ECDSA 签名
  -> review_extensions v1
  -> 现有主题、人设、学习路径、模板和评分标准消费边界
```

- `PersonalMemoryEntry` 继续只处理稳定资料、偏好和目标；掌握度、错因、到期复习和下一步行动属于动态学习者模型，不写入通用记忆。
- `LearnerStateSnapshot` 不新增表和索引，每次按当前本地数据计算；所有进入提示词的结论必须至少包含一个 `LearnerEvidenceRef`，上下文只输出证据 ID，不复制完整题库、知识正文或历史对话。
- `VisionSourceAdapter` 是未来 Android XR 配套应用的输入端口。浏览器实现只管理内存中的 `MediaStream`、关键帧和不可逆灰度指纹；Dexie 只保存观察摘要、时间、置信度和用户确认结果。
- `review_extensions` 与 `review_workspace` 完全分离。扩展包只有 `data.json` 和受控资产，不能注入 JSX、脚本或 HTML；需要新工具的扩展仍通过独立 MCP 安全边界。
- 扩展市场是低频动态加载视图；安装、启用、停用、卸载、导出和单版本回滚由 `declarativeExtensionRepository` 管理，完整重置和导出同时覆盖两个数据库。

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

# 通用工作台外层边界（2026-07-17）

- `WorkspaceShell` 在语义 `<main>` 外统一提供 `chrome-content-frame`；默认 `raised-surface`，显式 `plain` 只供未来确需无边界的宿主使用。
- 主应用、学习模块、对话和独立设置工作台消费同一外层边界。壳层只管理收进、圆角、边线、阴影与贴边关系，内容 padding、滚动和业务布局仍由各视图负责。
- 桌面侧栏展开时工作区零留白贴合侧栏与顶栏；由语义 `<main>` 独占顶部和左侧 1px 共边，顶栏与侧栏不重复绘制对应边框。工作区仅保留 18px 左上圆角，不再叠加内外阴影、高光或边缘渐隐。对话工作区继承壳层 100% 可用高度，避免重复视口计算越过圆角；侧栏折叠及移动端继续铺平。

## 工作台无缝抬升面（2026-07-18）

- 桌面侧栏、顶栏和工作区共用同一几何接缝；工作区保持零留白和 18px 左上圆角，顶部、左侧 1px 边线只由 `<main>` 绘制。边界采用无阴影方案，禁止在共边或圆角添加内外阴影、高光、模糊或渐隐。
- 顶栏弥散在底部 12px 回到实色，侧栏弥散从顶部 12px 渐入，使两块不透明 surface 的接缝保持连续。移动抽屉仍可使用独立右边界，折叠侧栏与移动工作区继续铺满。
- `<main>` 继续负责纵向滚动，但隐藏原生滚动条；鼠标滚轮、触控、键盘与程序化滚动保持可用，设置侧栏和页面内部独立滚动容器不受影响。
- 弥散开启时，`chrome-content-frame` 是工作区唯一的弥散底图承载层，并与 `<main>` 共享 18px 左上圆角；`.chrome-layout` 保持实色，让圆角外侧属于顶栏/侧栏交界。`<main>` 仅绘制共边和圆角并保持透明。

## P1 学习列表展示边界（2026-07-23）

- 错题、知识列表继续消费现有 repository、筛选器、`useBulkSelection` 和渐进显示控制器；展示层不得复制查询、导出或删除状态。
- 桌面统一使用无阴影的主从布局；移动端详情状态只保存在当前组件内，顶栏下方全屏展示，不写入 IndexedDB。
- 知识库拆为 `knowledge-library-list`、`knowledge-entry-editor` 与 `knowledge-starter-controls`，Obsidian 和内化控制器仍由 `KnowledgeView` 编排并保持按需加载。
- `ReviewWorkspace` 的低频动态加载、首屏包体边界、Dexie v16 与 Vault 句柄 repository 边界保持不变。
# P1 辅导与面试当前轮次架构（2026-07-23）

- `conversation.kind === "tutoring"` 时，由 `ConversationWorkspace` 动态加载 `ConversationTutoringExperience`，运行时再按需加载 `conversation-tutoring-runtime`；普通对话与核心工作台不静态依赖辅导服务。
- 可见用户/老师消息继续写入对话表，结构化卡点、下一步、微测和复练状态写入带 `conversationId` 的辅导会话与带 `conversationMessageId` 的轮次。确定性 ID 保证模型失败重试、刷新恢复和计划生成不会重复写入。
- 独立辅导页只承担历史记录、计划和资料关联；实时媒体、当前轮次和模型选择留在对话内。模型请求显式使用当前对话的 `modelId` 与 `selectedRuntimeValues`，不读取连接历史模型。
- `LearningSessionLayout` 只共享桌面信息侧栏与移动底部抽屉的布局、焦点锁定、Escape、滚动锁定和焦点恢复；辅导、面试业务状态保持在各自 feature。
- 面试主导航收敛为模拟现场、题库、训练计划和复盘记录。阶段栏读取真实 session stage，评分只读取完成后的 evaluation；原始录音、摄像头、屏幕与关键帧仍只驻留当前运行内存。
- `TutoringSession.conversationId` 与 `TutoringTurn.conversationMessageId` 均为可选兼容字段，不新增索引，不升级 `review_workspace` v16，也不新增 HTTP API。
# P2 已安排与设置展示架构

- `features/automation/use-automation-view-controller.ts` 只维护搜索、状态、当前任务、收件箱筛选、编辑模式、移动页签与抽屉；`automation-view-model.ts` 负责可测试的摘要、最近运行和筛选派生。
- `AutomationView` 只装配任务列表、运行收件箱和两个可访问编辑层。调度、补跑、租约、采集与恢复动作仍由既有 service/controller 提供，展示层不触发隐式重试。
- 设置分区继续由 `useReviewWorkspaceRecoveryNavigation` 单一受控；`SettingsSectionHeader` 和 feature-local CSS Module 只共享展示结构，不引入第二份分区状态。
- AI 连接表格和详情只消费序列化连接快照，不渲染密钥；默认能力仍保存独立的连接、模型与运行值。HTTP API、Dexie v16 和低频动态加载边界不变。

# P3 全产品 UI/UX 最终收口架构（2026-07-23）

- 导入页继续由 `ImportWorkspace` 持有解析与草稿 controller，`review-import-view` 只新增 38/62 来源/草稿布局和移动三步状态；原始文件、粉笔凭据、确认与撤销语义未迁移到展示层。
- `LearningInsightSnapshot` 是纯派生展示模型，只从存在错题关联的 `Attempt.reviewedAt/result`、当前错题掌握度和到期日期计算。板块少于 5 次有效复盘时不生成趋势方向。
- 知识训练拆为独立动态 `knowledge-training-view`，训练画布、队列和会话摘要仍消费既有间隔训练状态，不复制算法或 repository。
- 插件管理只读取 `settingsPluginDefinitions` 三项真实登记，详情面板在选择后动态加载；MCP、密钥、Vault 句柄和第三方代码均未进入注册表快照。
- 命令搜索在桌面使用居中面板、移动使用全屏层，并统一焦点锁定、Escape、页面滚动锁定与触发器焦点恢复。
- P3 共享页面状态只负责呈现加载、空、错误或离线说明，不执行业务读取。HTTP API、公开路由、持久化对象和 `review_workspace` v16 均未变化。

## P3 补充：ReviewWorkspace 架构终止收口

- `ReviewWorkspace` 现在只调用 `useReviewWorkspaceController` 并渲染 `ReviewWorkspaceViewRouter`；根编排组件限制为 150 行以内，不再直接拥有学习、知识、会话或设置业务状态。
- `useReviewLearningController` 独占错题筛选、选择、复盘队列、计时、统计与相关动作；`useReviewKnowledgeController` 独占知识筛选、关联建议、导入草稿、训练队列与相关动作。两者通过显式类型交给路由，不引入覆盖工作台的 React Context。
- `useReviewWorkspaceController` 只组合工作区数据、导航、AI 连接、个性化、自动化、会话、设置恢复与健康状态，并以 `workspace`、`learning`、`knowledge`、`conversation` 四组稳定边界返回。
- `ReviewWorkspaceViewRouter` 只装配设置页、工作台壳层、命令搜索和核心/低频 route component。route 文件禁止导入 repository/service；低频视图继续在模块顶层用显式路径 `next/dynamic` 加载。
- 架构契约硬性限制根组件不超过 150 行，顶层 controller 与 view router 不超过 300 行，领域 controller 与任何 React component 不超过 500 行；同时检查动态加载、无循环依赖、旧 `stats` 映射和 `review_workspace` v16 不变。
- 本次重构不改变可见 UI、业务语义、HTTP API、IndexedDB schema、首次消息持久化、导入确认、复盘计时、Obsidian 句柄或恢复导航边界。

## 根级恢复与本机运行诊断（2026-07-23）

- `app/error.tsx` 与 `app/global-error.tsx` 复用 `WorkspaceViewState`，提供重试、返回工作台和复制脱敏诊断；诊断只包含稳定错误类别、时间和 Next digest，不输出堆栈、用户正文或厂商原始响应。
- 浏览器内同源 API 调用统一经过 `fetchLocalApi`。该边界仅在内存保存最近 50 条路由类别、阶段、耗时、状态码和错误类别，既不写 IndexedDB，也不记录请求体、响应体、Cookie、Token、音频或 Vault 正文。
- 异步初始化 Hook 使用零延时任务与 `active` 卸载保护，避免 Effect 同步写状态并防止组件卸载后的错误通知；业务源码不再需要 `react-hooks/set-state-in-effect` 豁免。

## 包体与无障碍门禁（2026-07-23）

- 以 Next 16.2.11 `experimental-analyze --output` 和生产构建清单建立 `docs/performance-budget.json`。CI 校验首屏客户端 JavaScript、CSS、最大 JavaScript chunk 均不得超过基线 5%，报告写入 `.next/diagnostics/bundle-budget.json`。
- 首屏基线为 JavaScript 1,183,694 bytes、CSS 131,222 bytes、最大异步 chunk 568,117 bytes。Turbopack import trace 显示 PDF 与字体映射仍位于低频异步块；结构契约继续阻止 PDF、DOCX、Obsidian、实时媒体、已安排和设置回到静态首屏链路。
- 已安排、设置、导入、面试、辅导与对话入口只在用户 hover/focus 时预取代码，不触发 repository 或外部请求。桌面 1536×1024 与移动 390×844 使用 axe WCAG A/AA 规则阻断 serious/critical 问题。

## 领域类型与核心服务收口（2026-07-23）

- 业务源码已从 `types/review.ts` 的 191 个引用降为 0。`types/review.ts` 缩为 5 行历史兼容出口，interview、tutoring、obsidian、personalization、appearance、association、import、workspace、MCP、voice 与 provider catalog 均有独立领域入口。
- `types/domains/legacy-review.ts` 冻结保存历史 schema 类型清单，领域入口作为新代码唯一公共边界；架构契约禁止业务重新导入兼容出口。该整理不改表结构、字段、索引或 `review_workspace` v16。
- Provider 公共 adapter 保持原导出并缩至 405 行，语音请求/音频解析进入 177 行内部 mapper。Obsidian repository facade 保持原对象 API 并缩至 490 行，纯转换与图谱派生进入 104 行 helper。
- 拆分保持 Google 双协议、MiniMax 鉴权、SSE、语音、MCP、自动记忆、Obsidian 冲突与 proposal 语义；对应 209 个契约测试继续作为回滚判据。

## API 密钥与对话体验收口（2026-07-26）

- `secure-key-store` 使用独立 IndexedDB `review_workspace_secure_keys` 保存不可导出的 AES-256-GCM `CryptoKey`；业务数据库继续保持 `review_workspace` v16。
- 密文升级为 `v2:`，AAD 由连接 ID、凭据类型和字段组成。AI 连接、旧 AI 设置、额度凭据、MCP Token 与粉笔 Cookie 通过同一幂等迁移门迁移；复核仍有旧密文时绝不删除旧 JWK。
- 密钥库与密文损坏会返回重新输入凭据的稳定错误，不新增密钥 HTTP API，也不读写 `.env.local`。该边界增强本机静态数据和导出防护，但不能抵御已执行的恶意脚本，因此继续依赖严格 CSP、输入边界和禁用原始 HTML 的 AI Markdown 渲染。
- `AssistantMarkdown` 是历史消息与流式草稿的唯一 AI 正文展示边界；`react-markdown` 与 `remark-gfm` 只处理受限语法，不使用 `dangerouslySetInnerHTML`。
- `ConversationReasoningControl` 位于模型选择旁，局部预览滑杆值，仅在指针释放、键盘操作结束或失焦时复用会话级串行乐观保存。速度设置仍留在模型菜单，持久化结构保持 `selectedRuntimeValues`。
- 对话树右键和省略号都锚定当前行操作按钮；桌面执行同一视口碰撞修正，移动端继续复用同一底部操作层和行内重命名输入。

## 全应用单色交互与安全收口（2026-07-26）

- 共享样式新增 `interactive-primary`、`interactive-selected`、`interactive-hover`、`interactive-pressed` 与 `focus-ring` 中性令牌。主操作使用前景/表面反色，选择依赖中性底色、字重和勾选，键盘焦点仅通过 `:focus-visible` 高对比外轮廓表达；品牌资产、学习链路和数值图表继续使用各自的数据色。
- 对话树操作状态仍归 `ConversationFolderTree` 所有。右键与省略号解析同一行操作按钮矩形；桌面一级菜单固定 208px 并优先位于锚点右侧 8px，移动二级菜单固定 224px 并独立碰撞翻转；移动端将相同状态投影为带返回按钮的两级底部层。
- 安全密钥库把“读取”与“创建”拆开。解密只调用 `readSecurePrimaryKey()`，缺失、损坏、旧 JWK 异常和密文/AAD 校验失败分别映射为稳定的 `CredentialSecurityError`，不会为不可解密记录生成新钥匙。
- 安全导出升级为 `LocalDataExportV2`，采用显式表允许清单和递归敏感字段清理。旧 AI 设置、Vault 目录配置、密文、IV、掩码 Key、Token、Cookie 与厂商原始响应不进入导出；连接只保留非敏感元数据并标为 `reconfigure_required`。新增表默认不导出。
- 出站策略默认允许公网 HTTPS 与 loopback，RFC1918/ULA 必须由自定义连接或 MCP 的 `allowPrivateNetwork` 明确授权；云元数据、链路本地、未指定、多播和 URL 内嵌凭据始终拒绝。服务端检查全部 DNS 结果，并以 `redirect: "error"` 拒绝未复核跳转。
- 完整重置关闭并删除 `review_workspace`、扩展数据库和独立安全密钥库，同时清理本应用 `review*` localStorage 键；数据库占用会返回可恢复提示。业务库继续保持 Dexie v16，低频动态加载边界不变。

## AI 连接保存恢复（2026-07-26）

- 严格迁移入口继续承担全量复核与旧 JWK 删除；设置快照和连接保存改用非阻断迁移结果 `complete | partial`，只暴露稳定脱敏错误码。
- 新 Key 直接由 v2 本机密钥加密，其他 AI、MCP、额度或粉笔旧凭据异常不会阻断当前连接。未提供新 Key 时只校验当前连接，失败后要求重输且不覆盖旧密文。
- 编辑连接切换厂商继续保留连接 ID 与用户名称，更新厂商默认端点、能力和选项，并强制输入新 Key；数据库仍为 Dexie v16，Provider 协议与公开 API 不变。

## 额度生命周期与组件内示例（2026-07-26）

- 额度启停由 `aiQuotaRepository.setEnabled` 执行单记录短事务，不解密凭据或启动共享迁移。`QuotaRuntimeStore` 立即发布启停状态，停用取消同厂商任务，启用后的验证和刷新进入后台队列且失败不回滚配置。
- 额度保存使用尽力迁移并直接以 v2 密钥加密当前新凭据；无关 AI、MCP、粉笔或其他额度旧记录损坏不会阻断目标写入。读取额度只解密当前记录。
- AI 连接、额度、粉笔和 MCP 的展示组件支持开发环境纯内存示例。示例分流发生在真实 repository/runtime 容器挂载前，不写 IndexedDB/localStorage、不调用外部服务；生产构建不渲染入口。
- 设置壳层新增桌面集成模式：展开侧栏时主区抬升到窗口顶边并独占共边；折叠侧栏和移动端保持既有结构。数据库继续为 `review_workspace` v16。

## Codex 风格统一工作台（2026-07-27）

- `ReviewWorkspaceViewRouter` 始终装配同一个 `ReviewWorkspaceShell`；总览、对话与设置只替换侧栏和内容插槽，不再按视图或设置分区重建外壳。
- `SettingsWorkspace` 是纯内容宿主，设置导航由 `SettingsWorkspaceSidebar` 提供；`settingsSection`、返回目标与侧栏状态继续由 `useReviewWorkspaceController` 单向受控。
- 桌面端统一使用 `--chrome-workspace-top-inset: 12px`。左侧 Chrome 的实色与弥散由 `.chrome-shell::before` 单层承载，顶部区和侧栏自身保持透明；工作区 frame 从 `y=12` 延伸至视口底部。
- `<main>` 继续独占顶部、左侧 1px 共边与 18px 左上圆角，不使用阴影、高光、模糊或边缘渐隐。移动端保留横跨顶栏、无抬升圆角的内容区和焦点锁定抽屉。
- 对话标题、消息流和输入框统一为 50rem 中心轴；消息区独立滚动，输入框保持底部。AI 连接表使用稳定五列和三槽动作列，中等宽度切换列表布局但不隐藏删除。
- 本次迁移不修改 HTTP API、Provider 协议、持久化结构或 `review_workspace` v16，并保留现有 `next/dynamic` 低频边界。
# v0.2.1 桌面、fixture 与面试状态边界

- `desktop/runtime.ts` 使用 `DesktopRuntimeError` 统一承载稳定错误码；诊断只显示相对路径、退出码和限长脱敏日志。完整性校验保持 SHA-256 全覆盖并使用有限并发。
- `DevelopmentExampleDefinition` 将示例 ID、业务视图和 fixture 变体集中注册。开发环境在 live controller 挂载前分流，确保示例不读取 IndexedDB、localStorage、Vault 或网络。
- `InterviewSession` 的计时字段是普通记录字段，不参与索引；`interview-timer.ts` 提供可测试的归一化与状态转换，Dexie 继续使用 `review_workspace` v16。
