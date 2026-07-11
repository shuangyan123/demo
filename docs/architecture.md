# 应用架构

## AI 连接边界

```text
ReviewWorkspace → feature hook → AI service
→ ai-connection-client → /api/ai/generate|models|speech|transcribe → provider adapter
```

- `ReviewWorkspace` 只向业务模块注入已按用途解析的 `ApiConnectionProfile`。
- 文本、关键帧和朗读分别声明 `text`、`vision`、`speech` 能力；连接级客户端在解密前拒绝能力不匹配的请求。
- `ai-connections-repository` 统一维护默认连接、密钥密文、旧表同步和失效默认值清理。业务 service 不读取 `apiSettings`，也不推断厂商协议。
- `/api/ai/generate`、`/api/ai/models`、`/api/ai/speech` 与 `/api/ai/transcribe` 是浏览器代理入口，厂商 endpoint、鉴权和响应解析集中在 provider adapter。
- `/api/ai/generate` 支持普通 JSON 与 `stream: true` SSE 两种返回；客户端只消费归一化的 `status | delta | usage | done | error` 事件。
- `AiInteractionPanel` 订阅浏览器内临时事件，把一次 AI 请求整理为 Codex 式会话、消息流、工具步骤、流式片段和用量提示；不持久化 prompt、截图、Vault 正文或厂商原始响应。
- AI 连接设置通过 provider catalog 区分连接协议和模型目录；OpenAI、Azure OpenAI、Anthropic、Gemini、DeepSeek、Qwen、火山、SiliconFlow、OpenRouter、xAI、Groq、Mistral、Kimi、智谱、百度千帆、腾讯混元和自定义 OpenAI 兼容都必须从目录读取能力、模型标签、文档链接和手动模型兜底。

## Codex 式工作台与专项学习

```text
ReviewWorkspaceShell → study registry / conversation repository → existing feature views
ConversationWorkspace → conversationRepository → IndexedDB v16
```

- 顶层导航采用 `新对话 / 搜索 / 已安排 / 项目` 结构；“公考”是唯一项目树节点，默认折叠，模块和板块筛选只在其子树中显示。
- “新对话”只进入空白 conversation 草稿，发送第一条消息后才创建持久化会话；左侧 shell 保存项目和已有会话，中间显示消息流、composer 和折叠工具摘要。
- v15 新增对话文件夹与显式连接选择；v16 不增加索引，只在升级事务中级联清理标题为“新对话”且消息数为 0 的历史空记录。对话删除必须在同一事务清理消息、附件摘要和工具步骤。
- 搜索入口打开本地命令面板，聚合会话、项目、公考模块、错题、知识、已安排、插件和设置跳转；搜索不调用 AI，不上传内容。
- “公考”是首个 `StudyDomainDefinition`，聚合总览、错题库、复盘、知识库、知识训练、面试训练、AI 辅导和薄弱分析；后续专项只注册新的 domain/module。
- 左侧项目区默认只显示“公考”，模块与六大板块都作为公考内的折叠入口；板块筛选只设置错题库筛选，不再作为顶层导航。
- 专项首页通过 domain registry 声明学习链路和默认下一步，公考当前固定为“导入/错题 → 知识沉淀 → 训练 → AI 辅导 → 已安排复盘 → Obsidian 输出”。
- 粉笔导入位于“公考 → 导入资料”，Obsidian 位于知识库，额度位于 AI 连接详情；设置中不再保留插件目录。

## 内置集成位置

```text
公考导入 / 知识库 / AI 连接 → internal integration panel
```

- 设置页不再提供插件目录。粉笔导入、Obsidian 与 AI 额度继续复用内部适配层，但分别进入公考、知识库和 AI 连接的业务上下文。
- `SettingsWorkspace` 只保留外观、AI 连接、个性化、MCP 与诊断；MCP 仍是独立设置项。
- 粉笔导入通过 `ImportProviderPlugin` 包装现有本地解析、AI 文本解析和多模态 OCR，生成草稿后仍由用户确认入库。

## MCP 设置

```text
SettingsWorkspace → McpSettingsView → mcp-settings-repository → localStorage
```

- MCP 不在插件目录中展示，独立进入 `设置 → MCP`。
- MCP 本轮只保存 server 名称、endpoint 和启用状态，并提供本地探测摘要；真实 tools/resources/prompts 调用要等连接器接入后再进入 conversation run/step 状态机。
- MCP 配置不升级 Dexie schema，不保存工具调用内容、prompt、Vault 正文或完整响应；错误信息必须脱敏展示。

## AI 额度插件

```text
Settings → AI Connections → AiQuotaSettingsPanel → ai-quota-repository
→ /api/ai/quota → provider quota plugin
```

- 额度查询是应用内插件适配层，不复用模型调用 Key，不把账单逻辑写进通用 AI client。
- OpenAI 插件调用官方 Admin Costs/Usage API；若官方接口不返回剩余额度，只显示官方费用和用户配置预算下的估算剩余。
- 额度插件参考 CodexBar 的 descriptor/fetch strategy 边界：provider 描述、官网入口、状态页、刷新周期、来源模式和策略声明来自同一注册表。
- 额度 UI 默认折叠为紧凑厂商行；展开后才显示用量条、周期、凭据、来源与官网账单入口。
- DeepSeek、Gemini、Anthropic、Qwen、火山、硅基流动等插件先以预留状态展示，未确认稳定官方账单 API 前不抓取网页后台。
- 额度插件配置存放在本地浏览器 `localStorage`，密钥仍使用 Web Crypto 加密；不升级 Dexie schema，遵守无慢查询证据不新增索引的性能约定。

## 人设与主题架构

## 模块边界

- `persona-flash-card.tsx`：只负责 2:3 卡片正面、原始 PNG 镶边与悬停操作。
- `persona-avatar-card.tsx`：复用同一人设数据和编辑动作，提供更高密度的头像视图。
- `persona-card-back-dialog.tsx`：只负责定制角色的名称、描述和独立音色。
- `persona-default-editor.tsx`：只负责默认人设头像及完整字段，采用固定外壳和独立滚动区。
- `personalization-settings-repository.ts`：负责旧数据迁移、归一化、独立音色解析和 IndexedDB 持久化。
- `appearance-settings-repository.ts`：负责主题迁移、色彩变量和弥散色场生成。

## 数据流

```text
IndexedDB 读取 → repository 一次性迁移与归一化 → 页面本地草稿
→ 用户编辑/预览 → repository 保存 → 业务模块按实际人设解析独立音色
```

页面不引入全局状态库。朗读只接收默认语音连接与当前人设音色，不跨能力回退；无音色时明确提示并保持静音。

## 资产策略

`public/personas/persona-card-frame-2x3.png` 由 `scripts/extract-persona-frame.mjs` 对用户确认的 1024×1536 参考图执行确定性透明化。前端仅等比缩放，保留金色纹理、抗锯齿及底部蓝色，不使用 SVG 或生成式重画。

## 屏幕共享边界

`TutoringWorkspace → useTutoringMedia → useFrameSampler → tutoring AI service` 保持单向依赖。`MediaStream` 和最近关键帧只存在浏览器内存；浏览器停止共享时立即清理采样状态。多模态连接只接收手动或三秒低频采样的 JPEG，不接收连续视频或系统音频。

## Obsidian 知识图谱桥接

```text
KnowledgeView / Settings Plugin → useObsidianKnowledgeBridge → knowledge evolution service
→ obsidian-knowledge-repository → Vault adapter / IndexedDB v12
```

- React 只保存 `ObsidianVaultSnapshot`、映射和提案；`FileSystemDirectoryHandle` 仅由 repository 与 Vault adapter 读取。
- Vault 的 `AI知识库/政治理论|常识判断|申论` 是 Markdown 正文和 Wikilink 主源；IndexedDB 保存正文镜像、训练状态、三方哈希与冲突。
- 手动同步以最后同步哈希为基线：单边变化自动同步，双边变化保留两份内容并等待选择，文件消失只标记断开。
- AI 自动收集错题、面试复盘、辅导摘要和知识条目作为候选，但只生成 `create | merge | link` 提案；确认后才修改显式 AI 演进区块并写入 Vault。
- repository 从同步后的 mapping 和 Wikilink 派生 `ObsidianGraphSnapshot`；React 只展示节点、边和统计，不持有目录句柄。
- 知识演进提案会接收图谱摘要作为上下文，优先基于已有 Wikilink 生成 link/merge 提案。
- 提案生成返回 `KnowledgeEvolutionGenerationResult`，UI 必须显示可用条数、解析条数、过滤条数和空结果原因，避免生成后不可见。
- 同步采用“完整遍历与重复 ID 预检 → Vault 写入 → IndexedDB 事务提交”；预检或文件写入失败时不得更新同步基线。托管根目录缺失属于连接故障，不等同于空目录。
- 冲突选择和提案确认都会重新读取 Vault 并校验三方哈希，过期页面不得覆盖新版本；`link` 提案只更新 Wikilink 和来源引用。

## 扩展原则

## 2026-07 公考树与六厂商适配加固

- 公考、模块、板块筛选使用三层原生 disclosure，三层均默认折叠；展开状态只属于当前 React 会话，不写入 IndexedDB。
- `AppIcon` 集中封装 Lucide 的尺寸、线宽和光学对齐；AI 品牌仍由 `ProviderIcon` 与品牌注册表读取本地 SVG。
- 对话树的展开、菜单与拖拽状态继续由 `useConversationTreeController` 管理。独立拖拽手柄写入应用 MIME，文件夹和根目录负责 drop 协议，repository 仍是移动合法性的最终边界。
- AI 连接按协议适配、模型发现、能力映射、错误归一化分层。OpenAI 与 xAI 使用 Responses，Gemini 使用 generateContent，Anthropic 使用 Messages，DeepSeek 与 MiniMax 使用各自核验的兼容协议。
- 模型公开元数据采用一小时 stale-while-revalidate 缓存；密钥、请求头与厂商原始响应不进入缓存，也不会自动替换已保存的模型 ID。
- 知识演进使用统一 structured output 契约与 `{ proposals: [] }` 包络；空响应、解析失败或全量过滤只修复重试一次，rejected 提案不会永久消费来源。

新增人设字段时先扩展 `PersonaCustomization` 和 repository 归一化，再分别接入默认编辑器或定制卡背。新增主题只需增加预设，不得为单个主题新增名称判断或固定色分支。

## 已安排

```text
已安排入口 → AutomationView → TaskList / Editor / Inbox → useAutomationCenter
→ scheduler / executor → automation-repository
→ IndexedDB v13 / 默认文本连接
```

- “已安排”是原本本地自动化能力的产品入口；底层 `automation` 表、类型和 repository 继续兼容，不为命名调整升级 Dexie schema。
- 已安排定义和运行收件箱由 IndexedDB 管理；React 只保存可序列化快照，任务运行次数一次遍历派生，定时器、Web Locks 和租约留在 hook/repository。
- 应用启动、恢复可见和网络恢复时检查到期任务。关闭期间的多个周期合并为一次补跑，执行后直接推进到下一计划时间。
- 自定义任务只读取明确勾选的错题、知识、面试、辅导或 Obsidian 映射；知识演进来源和候选知识同样按范围读取。除保存待确认知识演进提案外，不修改业务数据。
- 多标签页先申请 Web Lock，再由 IndexedDB 五分钟可续期租约兜底；计划执行前校验定义版本，提交结果前复核所有者。任务失败同样写入收件箱并推进计划，避免无限重试。
# 2026-07 Codex 式对话工作台

- Dexie v15 为对话增加文件夹、显式连接选择与附件元数据表；文件夹即分类，可嵌套移动，附件正文、图片和录音字节不写入 IndexedDB。
- 对话输入拆为独立的文件夹树与工作区：模型选择按文本/多模态能力过滤，录音 Blob 仅在内存中转写，工具步骤只在消息流折叠展示。
- Obsidian 仍只在知识库通过 File System Access 与三方哈希同步；对话工具只能准备待确认提案，不能直接写 Vault 或调用外部 MCP tools。
