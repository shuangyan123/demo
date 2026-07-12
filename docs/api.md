# API 约定

## AI 运行时模型选择

- `/api/ai/*` URL 不变。客户端提交连接参数与本次 `modelId`；连接档案本身不再要求模型。
- 对话请求可携带会话级 `selectedReasoningEffort`，由 provider adapter 映射为 `reasoning_effort`、`thinking_level`、adaptive thinking `effort` 或厂商思考参数。
- 无对话上下文的任务从能力默认项解析“连接 + 模型”；不得读取 `ApiConnectionProfile.model` 作为正常运行时来源。
- `/api/ai/models` 只返回归一化公开元数据，不缓存 API Key、请求上下文或厂商原始响应。

## 路由公共边界

- `/api/ai/*` 保持现有 URL 与请求契约；`app/server/ai/http.ts` 统一 JSON 读取、纯文本错误和上游状态码映射。
- 路由不得向客户端透传异常对象、请求体、鉴权头或厂商原始错误正文。
- 业务字段继续由具体 route/provider adapter 校验，公共 HTTP 层不推断厂商协议。

## 生成

文本和多模态任务统一调用 `/api/ai/generate`。业务 service 调用 `generateWithConnection(connection, purpose, input)` 时必须显式传入 `text` 或 `vision`；连接不具备对应能力时，请求会在密钥解密和网络调用前失败。

`/api/ai/generate` 在 `stream: true` 时返回 `text/event-stream`，事件固定为 `status`、`delta`、`usage`、`done`、`error`。业务层通过 `generateWithConnectionStream()` 消费归一化事件；结构化 JSON 任务仍必须等完整内容结束后交给 `app/services/ai-json.ts` 解析。

旧 `/api/ai` OpenAI-compatible 路由已移除。厂商 endpoint、鉴权头、请求字段和响应解析只允许存在于服务端 provider adapter。

## 通用对话

`ConversationLaunchContext` 是模块到新对话的内存交接协议，包含 `moduleId/moduleLabel/kind/sourceType/sourceId/title/summary/suggestedPrompt`。它不是服务端 API，也不直接持久化；首次发送时才把 `kind/sourceType/sourceId` 写入会话，并把脱敏摘要保存为 `context` 附件。

`AiConversationSourceType` 新增 `mistake`，用于从错题行启动对话；现有 `manual/tutoring/interview/import/knowledge` 保持兼容。

通用 AI 会话不新增服务端 API。`ConversationRepository` 通过 IndexedDB v16 保存项目、文件夹、会话、消息、附件摘要和工具步骤。点击“新对话”只打开空白草稿，发送第一条消息后才调用 `createConversation()` 落库；`deleteConversation()` 在单一事务中级联删除关联摘要。

会话消息只保存用户可见文本、附件摘要、连接标签、模型和 usage；不得保存截图原文、Vault 正文、完整 prompt 或厂商原始响应。缺少默认文本连接时仍可保存用户消息，但助手回复必须明确提示需要配置连接，不得伪装 AI 已执行。

`AiConversationRunStep` 只保存步骤事实；UI 按 `runId` 派生“正在运行... / 已运行 N 条命令 / 运行失败”的折叠摘要，不新增持久字段。

`CommandSearchResult` 只表示本地跳转和命令面板结果，覆盖会话、项目、公考模块、错题、知识、已安排、插件与设置；搜索不调用 AI，也不向服务端上传查询内容。

## AI 连接模型目录

### 六厂商归一化补充

- `AiGenerateRequest.structuredOutput` 包含 `name`、`schema` 与 `strict`，服务端 adapter 将其映射为厂商原生结构化输出字段。
- `POST /api/ai/models` 的模型项包含 `id`、`label`、`purposes`、`capabilities`、`status`、`source`、上下文与输出上限、流式/结构化支持和 `updatedAt`；不返回密钥或原始模型对象。
- 客户端模型目录缓存有效期为一小时。过期数据可立即展示并后台刷新；手动刷新强制请求官方目录，失败时保留静态目录和手动模型 ID。
- 生成错误归一化为鉴权、模型不存在、能力不匹配、限流、容量、上下文、内容过滤和网络类错误，并返回可操作提示。

`AiProviderCatalogEntry` 描述厂商连接协议、默认 base URL、能力、官方文档链接、模型列表刷新策略和手动模型兜底。`AiModelCatalogEntry` 描述模型 ID、文本/视觉/语音/流式/结构化能力、推荐/预览/弃用状态、来源和最后验证时间。

设置页使用用途、厂商、模型三级下拉。`POST /api/ai/models` 代理连接对应的官方 models API，返回 `id`、`label`、`capabilities`、`source` 与 `fetchedAt`；客户端只缓存归一化公开目录 24 小时，不缓存 Key、请求头或厂商原始响应。失败时回退静态核验目录，并始终保留手动模型 ID。连接测试必须走本地 `/api/ai/generate` 与 provider adapter，不只做表单 mock。

## 额度插件

额度查询使用 `/api/ai/quota`，只接受额度插件凭据，不接受普通模型调用连接。OpenAI 插件调用官方 Admin Costs/Usage API 并返回标准 `AiQuotaSnapshot`；官方未返回余额字段时，`officialRemainingAvailable` 必须为 `false`。

`AiQuotaSnapshot` 可包含 `periodLabel`、`resetAt`、`sourceLabel` 和 `usageRatio`，用于设置插件中的紧凑厂商卡展示；这些字段只能来自官方接口、用户手动预算或明确的 unsupported 状态，不能由网页抓取伪造。

`AiQuotaProviderPlugin` 使用 CodexBar 式 descriptor/fetch strategy 描述 provider 标签、官网账单入口、状态页、刷新周期、来源模式和 unsupported 原因。DeepSeek、Gemini、Anthropic、Qwen、火山、硅基流动和自定义服务在没有稳定官方账单 API 前只返回 unsupported/manual 状态。禁止通过网页抓取、非官方接口或复用普通 API Key 伪造实时余额。

## 设置插件目录

`SettingsPluginDefinition` 面向 Codex 目录式 UI 暴露 `icon`、`category`、`shortDescription`、`providerLabel`、`statusBadge`、`primaryAction`、`menuActions` 和 `detailPanelLoader`。目录页只消费这些轻量字段，业务插件面板必须通过 `detailPanelLoader` 在点击后按需加载。

`SettingsPluginCategory` 当前包含 `featured`、`knowledge-sync`、`import-source`、`quota` 和 `study-extension`。`featured` 只用于目录聚合展示，不代表第三方动态安装能力；MCP 不进入插件目录。

## MCP 设置

`McpServerProfile` 保存本地 MCP server 的名称、endpoint、启用状态和更新时间。`McpDiscoveryResult` 保存一次脱敏探测摘要，包括 tools/resources/prompts 名称列表、状态、错误和检查时间。

MCP 设置使用 localStorage repository，不复用插件 registry，也不升级 Dexie schema。本轮只做配置、启用/禁用、删除和 mock discovery；真实 MCP 握手与工具调用接入后，必须通过通用 conversation run/step 展示。

## 导入插件

粉笔导入通过内部 `ImportProviderPlugin` 接口注册在“公考 → 导入资料”。适配器可处理文本、本地文件、截图 OCR、PDF 和 docx，统一返回 `ImportProviderParseResult`，包含草稿、来源、模式和诊断摘要。

`ImportProviderPlugin` 必须声明诊断能力、AI 能力、重试策略和草稿落点。粉笔插件当前使用 `safe-reparse`，失败后只能重新解析并回到草稿确认，不得绕过草稿直接写题库。

粉笔文本本地解析不调用 AI；AI 文本解析只使用默认文本连接；图片和无文本层 PDF OCR 只使用默认多模态连接。解析出的错题和知识资料仍进入草稿区，用户确认前不得写入题库或知识库。

## 专项学习

`StudyDomainDefinition` 负责声明专项首页文案、学习链路、默认下一步和模块健康信号。公考首页固定展示导入/错题、知识沉淀、训练、AI 辅导、已安排和 Obsidian 输出的闭环状态；后续专项复用同一字段，不新增独立首页协议。

## 语音

人设朗读使用 `/api/ai/speech`。客户端只提交默认语音连接和当前角色的 `VoiceProfile`；没有语音能力、角色音色、Voice ID 或默认语音连接时不发起请求，并保持静音。

## 图片

角色图片完全在浏览器处理，不新增服务端 API。输入仅允许 PNG、JPEG、WebP 且不超过 20MB；新上传图片输出为居中裁切的 2:3 WebP，最大 2400×3600，按质量和尺寸逐级压缩后写入 IndexedDB。既有 3:4 Data URL 不重写，仅在 2:3 展示框内居中裁切。

## 屏幕关键帧

屏幕共享不新增流媒体 API。浏览器只在手动截取或低频观察时生成宽度不超过 960px 的 JPEG，并通过默认多模态连接随当前辅导轮次提交；缺少多模态连接时明确提示，不回退到文本或其他能力连接。

## 兼容边界

旧 `apiSettings`、全局音色与卡片比例只允许 repository 读取并迁移，活跃设置结构和导出结果不得再包含这些字段。默认文本连接更新时同步刷新旧表；清空默认值或移除文本能力时同步删除旧记录。

## Obsidian 本地桥接

Obsidian 不新增服务端 API，也不安装第三方插件。浏览器通过 File System Access API 读写用户明确选择的 Vault，并只访问配置的托管目录。Markdown 使用 YAML Properties 保存 `review-id`、分类、标签和来源引用，正文使用标准 `[[Wikilink]]`；Firefox、Safari 等不支持写目录的环境只提供一次性 `.md` 文件夹导入。

知识演进仍调用 `/api/ai/generate` 的默认文本连接。模型只能返回待确认 JSON 提案，不能获取目录句柄、直接写文件或绕过冲突检查。生成结果对外归一为 `KnowledgeEvolutionGenerationResult`，包含可保存提案、解析数量、过滤数量、诊断信息和空结果原因。

Vault Adapter 对外提供目录选择、权限查询/恢复、Markdown 遍历、单文件复读和受限写删能力。所有路径必须是托管根目录内不含 `.`、`..` 的相对路径；目录缺失、句柄失效、权限拒绝、文件占用和用户取消均转换为可操作的中文错误。同步和提案写入不新增服务端接口。

提案确认语义固定为：`create` 创建稳定 `review-id` 的新笔记，`merge` 更新摘要、标签、AI 演进区块与托管链接，`link` 只更新 Wikilink/来源引用。目标映射不是最新 `synced` 基线时必须先同步或处理冲突。

同步后的 Wikilink 会派生为本地图谱快照，并作为知识演进 AI 上下文的一部分；图谱快照不新增服务端接口，不包含目录句柄或 Vault 原文。

## 已安排调用约定

“已安排”不新增服务端 Route，底层仍复用本地 automation 仓储。每日简报、每周总结和自定义任务通过 `generateWithConnection(connection, "text", input)` 调用默认文本连接；缺少连接时只写入失败运行记录。已安排上下文按用户选择的范围在本地临时组装，不包含密钥、目录句柄或未授权模块数据。

知识演进已安排任务复用既有提案 JSON 契约，只把提案保存为 `pending`。来源表按勾选范围读取；未勾选知识库时不得读取或发送候选知识条目，此时模型只能生成新增提案。用户确认前不得更新知识条目、映射或 Vault 文件。
# 对话转写接口

`POST /api/ai/transcribe` 只接受 Google Gemini 连接的 `model`、`baseUrl`、临时 `audioBase64` 与 `mimeType`，返回归一化 `{ text, requestId? }`。音频不会被服务端或 IndexedDB 持久化；429/503 统一为可切换模型的容量提示。

## MCP Streamable HTTP

- `POST /api/mcp/discover` 接受 `{ endpoint, token? }`，返回归一化的 `tools/resources/prompts` 名称、说明和工具输入 schema。不得返回 Token、鉴权头或厂商原始事件。
- `POST /api/mcp/call` 接受 `{ endpoint, token?, tool, arguments }`，使用官方 MCP TypeScript SDK 调用工具；响应体超出 32 KiB 时拒绝交给浏览器。
- 两个路由都拒绝 URL 内凭据、非 HTTP(S)、远程明文 HTTP 与跨 origin 重定向；请求超时为 15 秒。HTTP 仅允许 `localhost`、`127.0.0.0/8` 和 `::1`。
- 浏览器 repository 负责本地加密 Bearer Token；IndexedDB 和工具步骤不得保存 Token 或 MCP 原始结果。
# 实时语音 API

- `POST /api/ai/realtime/session`：用长期连接密钥交换 OpenAI/Gemini 临时凭据，或创建 GLM 内存中继会话。响应永不返回长期密钥。
- `GET|POST|DELETE /api/ai/realtime/glm`：轮询归一化事件、发送单个 PCM 音频块和结束 GLM 中继。单块有容量限制，会话空闲两分钟回收。
- 现有 `/api/ai/speech` 保持兼容；OpenAI 使用 `tts-1-hd`/`tts-1`，Gemini 返回 PCM 后包装 WAV，MiniMax 和 GLM 只接收 descriptor 声明的参数。
