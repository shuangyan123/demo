# API 约定

## 主题字体与壳层视觉修复（2026-07-18）

- 本次只调整本地字体资产、主题 CSS 变量和工作台装饰层，不新增或修改服务端 API、请求字段、响应字段及 SSE 事件。
- IndexedDB 继续使用 `review_workspace` v16；外观设置结构不变，已有自定义 `codeFont` 字符串继续兼容。

## ProviderTransport 与本地扩展契约（2026-07-16）

- `POST /api/ai/generate` 的客户端请求、响应和 SSE 事件保持不变。服务端新增 `ProviderTransport.generate()`、`stream()` 和 `listModels()`；adapter 继续负责厂商字段映射与输出归一化。
- 只有 `provider=google`、`generationProtocol=google_interactions` 且 Base URL 为 `generativelanguage.googleapis.com` 时使用 `@google/genai`。调用固定 `apiVersion=v1beta`、`store:false`、`maxRetries:0`，并由路由请求信号和统一 60 秒超时负责取消。
- Google 自定义代理不进入 SDK，完整保留用户 Base URL 与路径；GenerateContent 仍是模型级明确兼容路径。普通对话不跨协议双发，只有连接测试可在明确 Interactions-only 错误时安全重试一次。
- 声明式扩展不新增服务端 API。`ExtensionManifestV1` 必须包含 `schemaVersion`、`id`、`version`、`minAppVersion`、`kind`、作者、说明、`data.json` 入口、权限、资产清单、内容 SHA-256 与 ECDSA P-256 签名。
- 扩展 JSON 顶层只允许 `manifest`、`data`、`assets`。未知字段、`..`/绝对路径、脚本/HTML/CSS/WASM/字体、远程运行时 URL、单资产超过 2MB、整包超过 5MB、摘要或签名错误、应用版本不兼容都会被拒绝。
- `LearnerStateSnapshot` 与 `TutoringMicroAssessment` 是本地领域契约，不是外部 API。辅导请求只注入经过字符预算裁剪的证据化摘要；媒体 Data URL 只能存在于当前 `/api/ai/generate` 请求内，不得进入 repository。

## Google Interactions、活动展示与记忆边界（2026-07-15）

- `/api/ai/generate` URL 不变。Google Interactions 使用 `/v1beta/interactions`；流式请求使用 `/v1beta/interactions?alt=sse`，并解析 `step.delta`、`interaction.completed` 以及 `total_input_tokens/total_output_tokens/total_tokens`。
- 连接测试允许在 Google 明确返回“only supports Interactions API”时重试一次；普通对话不得双发。成功协议写入连接和 Base URL 隔离的模型目录缓存。
- `AiActivityEventDetail.presentation` 为 `conversation | compact-test | background`。该字段只控制客户端展示，不进入服务端请求契约或持久化模型。
- `PersonalizationSettings.memoryVersion` 为 2，可选保存 `memoryEntries` 与最多 100 条 `memoryRevisions`。每次请求最多检索 8 条、1500 字符；禁止保存 API Key、密码、Token、证件号、附件正文、完整对话和厂商原始响应。
- `POST /api/ai/models` URL 不变；Qwen 响应从 `output.models` 归一化，Anthropic、Google、MiniMax 与 Qwen 均完成官方分页聚合。

## 完整模型目录与兼容厂商（2026-07-15）

- `/api/ai/models` URL 不变，响应增加可选 `complete`；客户端目录结果同时记录 `source`、`fetchedAt`、`stale` 和 `complete`，但这些加载元数据不进入连接档案。
- Google 聚合 `pageToken`，MiniMax 聚合 `after_id`，Qwen 聚合部署模型页码；最多读取 20 页并阻止重复游标。MiniMax 目录使用 `X-Api-Key`，生成仍使用 Bearer。
- OpenRouter、Groq、Mistral、SiliconFlow 与 Kimi 使用各自官方 Bearer 模型列表；Kimi 只采信 `supports_image_in`、`supports_video_in` 等官方元数据，未知模型默认仅文本。
- 豆包、百度千帆和腾讯混元保持手动模型 ID，不声明在线目录。所有目录响应只返回归一化条目，不透传密钥或厂商原始响应。

## Google 模型级双协议（2026-07-15）

- `/api/ai/models` URL 不变，目录项可选返回 `generationProtocol`。`gemini-3.5-flash` 使用 `google_interactions`，已核验的 Gemini 2.5/3.1 模型继续使用 `google_generate_content`。
- `/api/ai/generate` URL 不变。GenerateContent 使用 `systemInstruction`、`contents`、`generationConfig`、`serviceTier`；Interactions 使用 `system_instruction`、`input`、`generation_config`、`service_tier` 和 `store: false`，两组字段不得混用。
- 只有连接测试可在 Google 明确返回 “only supports Interactions API” 时从 GenerateContent 安全重试一次，并把协议写入连接目录缓存。正常生成请求不得自动重试另一协议。
- Interactions 流式事件归一化 `step.delta` 与 `interaction.completed`；应用不保存 interaction ID。
- MiniMax 模型目录 `/anthropic/v1/models` 使用 `X-Api-Key`，消息 `/anthropic/v1/messages` 使用 Bearer，两类鉴权不得共用。

## 连接测试、模型能力与个性化记忆（2026-07-14）

- `/api/ai/models` 与 `/api/ai/generate` URL 不变。Google Models API 只接收 `supportedGenerationMethods` 包含 `generateContent` 的模型；返回项增加 `capabilitySource` 和可选 `supportedGenerationMethods`。精确静态 descriptor 标记为 `verified`，未知模型不得按名称猜测视觉能力。
- 编辑连接的测试和模型发现使用当前草稿厂商、Base URL、Key 与模型；旧连接只在草稿 Key 为空时提供解密后的本次内存凭据。测试事件带 `presentation: "compact-test"`，服务端请求格式不变。无目录连接的待选 connectionId 不写库，提交手动模型 ID 后才通过 repository 原子保存完整默认选择。
- `PersonalizationSettings` 增加可选 `memoryVersion`、`memorySettings`、`memoryEntries`，仍写入现有 personalization 单例。手动记忆直接 active，AI 建议只能 pending；只有用户确认后的记忆能进入最多 1500 字符的系统片段。
- 数据管理不新增服务端 API。导入、错题复盘和对话历史通过独立 IndexedDB 事务清理；完整重置删除 `review_workspace` 与本应用 localStorage。

## 粉笔实验直连（2026-07-15）

- `POST /api/import/fenbi/validate`：请求体 `{ cookie }`，只验证 `tiku.fenbi.com` 当前会话，返回 `{ valid }` 或脱敏的稳定错误码。Cookie 不写日志、数据库或响应。
- `POST /api/import/fenbi/sync`：请求体 `{ cookie, scope }`，以 SSE 依次返回 `stage/progress/drafts/done/error`。服务端固定读取错题板块树、分页错题和分批解析；每批最多 100 个 ID、并发最多 2、分页间隔至少 300ms。
- 错误码固定为 `invalid_cookie`、`rate_limited`、`upstream_unavailable`、`malformed_response`。私有响应结构变化时客户端提示使用 PDF/Word 导出兜底，不允许任意 URL 转发。

## 额度验证与刷新（2026-07-14）

`POST /api/ai/quota` 接收 `{ action, provider, credentials, period?, monthlyBudget? }`。`action` 为 `validate | refresh`；旧 OpenAI `{ apiKey }` 请求继续按刷新兼容。响应只包含归一化验证结果或 `AiQuotaMetric[]`，不返回凭据和厂商原始响应。

客户端 `QuotaRuntimeStore` 在启用时立即持久化；凭据齐全则先验证再刷新。仅页面可见且在线时按 descriptor cadence 刷新，手动刷新绕过缓存，最多四路并发，临时失败保留并标记上次快照为 stale。

- OpenAI 使用 Admin Key 查询 Costs/Usage；剩余额度仅可由本地预算估算。
- Anthropic 使用 Admin Key 查询组织、usage report 与 cost report。
- DeepSeek 使用普通 API Key 查询 `/user/balance`，不生成历史消耗。
- xAI 使用 Management Key 验证并查询 Team 余额与用量；无法推导 Team ID 时返回明确错误。
- Gemini、MiniMax、GLM 仅提供官方控制台与手动记录，不抓取网页后台。

## 七厂商适配器注册表（2026-07-12）

- `/api/ai/generate` 通过 `ProviderAdapter` 统一调用生成、解析与流式解析方法；路由不读取厂商私有响应字段。
- OpenAI 与 Grok 使用 Responses；Claude 使用 Messages；MiniMax 文本使用官方推荐的 Anthropic-compatible `/anthropic/v1/messages`，语音继续使用原生 `/v1/t2a_v2`。
- DeepSeek 与 GLM 保留各自参数映射；Gemini 的稳定 `generateContent` 作为受控迁移路径，待 Interactions 达到功能等价后再切换。
- `/api/ai/models` 为 MiniMax 使用区域规范化后的 `/anthropic/v1/models` 与单一 `Authorization: Bearer`；返回值仍只包含归一化公开元数据。中国大陆站根地址为 `https://api.minimaxi.com/anthropic`，国际站为 `https://api.minimax.io/anthropic`。
- 未注册的旧厂商和自定义连接进入兼容适配器，不得标记为七家原生已核验支持。

## AI 运行时模型选择

- `/api/ai/*` URL 不变。客户端提交连接参数与本次 `modelId`；连接档案本身不再要求模型。
- UI 只提交归一化 `runtime: { reasoning?: string | number; speed?: string }`。连接客户端和服务端都会用具体模型的 `AiModelRuntimeDescriptor` 校验；未知或手动模型不接收推断出的运行参数。
- `reasoning` 是判别联合；`kind: "budget"` 必须提供 `customRange`。预设的动态/关闭哨兵值 `-1/0` 与范围内自定义整数均可归一化，其他值回退 descriptor 默认值。
- 无对话上下文的任务从能力默认项解析“连接 + 模型”；不得读取 `ApiConnectionProfile.model` 作为正常运行时来源。
- `/api/ai/models` 只返回归一化公开元数据，不缓存 API Key、请求上下文或厂商原始响应。

七家 mapper 只负责把已校验运行值写入厂商请求，endpoint、鉴权和响应归一化仍由 provider adapter 负责：

- OpenAI：`reasoning.effort`、`service_tier=priority`。
- Gemini 3.x：`generationConfig.thinkingConfig.thinkingLevel`；Gemini 2.5：`thinkingBudget`；Priority 位于请求顶层。2.5 Pro 自定义范围为 `128–32768`，Flash 为 `0–24576`，Flash Lite 为 `512–24576`，各模型仍按 descriptor 单独允许官方 `0/-1` 哨兵值。
- Claude：adaptive thinking + `output_config.effort`，旧模型使用最低 1024 的 `budget_tokens`；内部有效输出上限等于思考预算与调用方正文输出额度之和，避免 `budget_tokens >= max_tokens` 的无效请求。合资格模型 Fast 发送 `speed=fast` 与 beta header。
- DeepSeek V4：关闭/high/max；明确核验的 `glm-5.2`：七档原样 `reasoning_effort`，核验清单内的旧 GLM 只发送 `thinking.type`。
- MiniMax M3：关闭/自适应与标准/优先，并支持 Anthropic-compatible 图片、独立视频内容块；静态能力为文本、视觉、视频、工具和 1M 上下文。M2.x 高速通过配对模型 ID，且不得误报图片或视频能力。
- Grok 4.5：`reasoning.effort` 与 Priority；多代理 effort 不进入普通菜单。

## 路由公共边界

- `/api/ai/*` 保持现有 URL 与请求契约；`app/server/ai/http.ts` 统一 JSON 读取、纯文本错误和上游状态码映射。
- 路由不得向客户端透传异常对象、请求体、鉴权头或厂商原始错误正文。
- 业务字段继续由具体 route/provider adapter 校验，公共 HTTP 层不推断厂商协议。

## 生成

文本和多模态任务统一调用 `/api/ai/generate`。业务 service 调用 `generateWithConnection(connection, purpose, input)` 时必须显式传入 `text` 或 `vision`；连接不具备对应能力时，请求会在密钥解密和网络调用前失败。

`/api/ai/generate` 在 `stream: true` 时返回 `text/event-stream`，事件固定为 `status`、`delta`、`usage`、`done`、`error`。业务层通过 `generateWithConnectionStream()` 消费归一化事件；结构化 JSON 任务仍必须等完整内容结束后交给 `app/services/ai-json.ts` 解析。

当厂商返回实际 service tier/Fast 状态时，JSON 结果及 `usage/done` 事件可包含 `actualSpeed`。时间线只保存用户选择档位与这一归一化实际档位，不保存原始响应。

GLM 运行能力只按显式模型清单登记。七档清单当前仅含 `glm-5.2`；开关清单为 `glm-5.1`、`glm-5`、`glm-5-turbo`、`glm-5v-turbo`、`glm-4.7`、`glm-4.6`、`glm-4.6v`、`glm-4.5`、`glm-4.5v`。`glm-999`、`glm-5.2-custom` 等未来或手动 ID 不产生运行参数，直到目录与 descriptor 同步登记文档和核验日期。

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
- 客户端模型目录缓存有效期为 24 小时，并按连接 ID、厂商和规范化 Base URL 隔离；手动刷新绕过缓存，失败时保留已核验静态目录和手动模型 ID。
- 生成错误归一化为鉴权、模型不存在、能力不匹配、限流、容量、上下文、内容过滤和网络类错误，并返回可操作提示。

`AiProviderCatalogEntry` 描述厂商连接协议、默认 base URL、能力、官方文档链接、模型列表刷新策略和手动模型兜底。`AiModelCatalogEntry` 描述模型 ID、文本/视觉/语音/流式/结构化能力、推荐/预览/弃用状态、来源和最后验证时间。

设置页把连接档案与默认用途分开：厂商连接先通过“获取模型 → 选择模型 → 极小真实请求”测试，默认文本/多模态等再分别选择连接与模型。`POST /api/ai/models` 返回 `id`、`label`、`capabilities`、`source` 与 `fetchedAt`；设置测试、默认能力和对话选择器共用同一目录服务。连接测试必须走本地 `/api/ai/generate` 与 provider adapter，不只做表单 mock。

## 额度插件

额度查询使用 `/api/ai/quota`，只接受额度插件凭据，不接受普通模型调用连接。OpenAI 插件调用官方 Admin Costs/Usage API 并返回标准 `AiQuotaSnapshot`；官方未返回余额字段时，`officialRemainingAvailable` 必须为 `false`。

`AiQuotaSnapshot` 可包含 `periodLabel`、`resetAt`、`sourceLabel`、`usageRatio` 和运行时 `stale` 标记，用于独立额度设置中的紧凑厂商行；这些字段只能来自官方接口、用户手动预算或明确的 unsupported 状态，不能由网页抓取伪造。

`AiQuotaProviderPlugin` 使用 CodexBar 式 descriptor/fetch strategy 描述 provider 标签、官网账单入口、状态页、刷新周期、来源模式和 unsupported 原因。DeepSeek 使用官方 `/user/balance`，且只有用户显式操作时才可引用已保存的同厂商推理 Key；Gemini、MiniMax、GLM 保持控制台/手动记录。禁止网页抓取或用一次推理请求冒充额度验证。

## 内置集成目录

`SettingsPluginDefinition` 面向内置集成页暴露 `icon`、`category`、`shortDescription`、`providerLabel`、`statusBadge`、`primaryAction`、`menuActions` 和 `detailPanelLoader`。目录页只消费这些轻量字段，业务面板必须通过 `detailPanelLoader` 在点击后按需加载；不声明静态 `installed`，也不展示没有真实生命周期的安装、禁用按钮。

`SettingsPluginCategory` 当前包含 `featured`、`knowledge-sync`、`import-source` 和 `study-extension`。`featured` 只用于目录聚合展示，不代表第三方动态安装能力；额度与 MCP 均不进入该目录。

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

# 模型发现、测试与速度参数（2026-07-13）

- `POST /api/ai/models` 按连接厂商调用官方模型目录；OpenAI、Gemini、Anthropic、xAI、DeepSeek 与 MiniMax 支持在线发现，GLM 使用带核验日期的官方静态目录，自定义连接保留手动模型 ID。
- 未保存连接由连接级客户端将表单草稿临时映射到 `/api/ai/models` 与 `/api/ai/generate`，业务组件不得直接拼装厂商请求，也不得把模型写回 `ApiConnectionProfile`。
- 完整连接测试必须先选择具体模型，再发送一次极小真实生成请求；该请求可能产生少量用量，成功只更新连接测试状态，不自动改写默认文本、多模态、语音或实时能力。
- 会话请求的 `providerOptions.serviceTier = "priority"` 仅在目录声明支持时映射：OpenAI 使用 `service_tier`，Gemini GenerateContent 使用顶层 `serviceTier`；标准档不发送字段。MiniMax 按具体模型 descriptor 发送官方运行字段。

# P0 工作台与公考首页（2026-07-17）

本次 UI/UX 调整不新增或修改服务端 Route、请求体、响应体、AI 协议及 IndexedDB schema。推荐下一步、七阶段短状态和配置健康摘要均由浏览器内已有快照纯计算得到。

通用 `WorkspaceShell` 外层边界、零留白交接、顶栏横线移除、对话圆角贴合与七阶段 SVG 几何修复均只属于客户端展示调整，不新增网络接口、持久化字段或迁移。

2026-07-18 的顶栏、侧栏与工作区无缝交接修复同样仅调整共享壳层 CSS；服务端 Route、请求体、响应体、AI 协议和 IndexedDB v16 均无变化。

后续主区顶部/左侧共边、无阴影圆角与滚动条隐藏仍属于纯展示层修改，不新增任何公共接口或持久化字段。

工作区弥散背景改由带 18px 圆角的 frame 单层承载，layout 保持实色且 `<main>` 保持透明；该圆角伪影修复只调整 CSS 绘制职责，不改变主题配置结构或持久化协议。
