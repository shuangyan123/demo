<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Google 双协议与品牌选择约定

- Google 生成协议由具体模型目录项解析；`gemini-3.5-flash` 使用 Interactions，Gemini 2.5 等已核验模型使用 GenerateContent，未知手动模型不得按名称猜测。
- 只有连接测试可在明确 `only supports Interactions API` 时重试一次并缓存协议，正常对话禁止跨协议双发。
- Interactions 必须发送 `store:false`，不得持久化 interaction ID；GenerateContent 与 Interactions 字段必须保持互斥。
- 默认能力的连接和模型下拉必须显示 `ProviderIcon`，但持久化仍只保存 `{ connectionId, modelId }`。
- Obsidian 使用独立 integration branding 的固定版本本地资产，不得混入 AI provider registry。
- MiniMax 模型目录使用 `X-Api-Key`，消息生成使用 Bearer，禁止复用单一鉴权 helper。

## Google 双协议与品牌选择约定

- Google 生成协议由具体模型目录项解析；`gemini-3.5-flash` 使用 Interactions，Gemini 2.5 等已核验模型使用 GenerateContent，未知手动模型不得按名称猜测。
- 只有连接测试可在明确 `only supports Interactions API` 时重试一次并缓存协议，正常对话禁止跨协议双发。
- Interactions 必须发送 `store:false`，不得持久化 interaction ID；GenerateContent 与 Interactions 字段必须保持互斥。
- 默认能力的连接和模型下拉必须显示 `ProviderIcon`，但持久化仍只保存 `{ connectionId, modelId }`。
- Obsidian 使用独立 integration branding 的固定版本本地资产，不得混入 AI provider registry。
- MiniMax 模型目录使用 `X-Api-Key`，消息生成使用 Bearer，禁止复用单一鉴权 helper。

## 设置与额度验收约定

- Lobe Icons 只作为固定版本的本地社区品牌资产，登记版本、MIT 许可和 SHA-256；运行时不得访问 CDN，也不得宣称为厂商官方包。
- 粉笔 Cookie 直连永远标记实验功能，只允许 `tiku.fenbi.com` 固定路径；Cookie 本机 AES-GCM 加密，结果先入草稿，结构变化回退 PDF/Word，确认后撤销凭据只保留 30 秒内存。
- Gemini GenerateContent 优先档使用顶层 `serviceTier`，标准档不发送；`thinkingLevel` 与 `thinkingBudget` 不得同时出现。

- Lobe Icons 只作为固定版本的本地社区品牌资产，登记版本、MIT 许可和 SHA-256；运行时不得访问 CDN，也不得宣称为厂商官方包。
- 粉笔 Cookie 直连永远标记实验功能，只允许 `tiku.fenbi.com` 固定路径；Cookie 本机 AES-GCM 加密，结果先入草稿，结构变化回退 PDF/Word，确认后撤销凭据只保留 30 秒内存。
- Gemini GenerateContent 优先档使用顶层 `serviceTier`，标准档不发送；`thinkingLevel` 与 `thinkingBudget` 不得同时出现。

- 设置导航固定为“外观、AI 连接、个性化、额度、MCP、诊断”；旧 `roles` 在入口边界归一化为 `personalization`，持久化结构和 Dexie v16 不变。
- 模型 tooltip 的可视层只响应 450ms 鼠标停留或用户键盘导航；程序化聚焦与触屏不得显示浮层。菜单外壳不滚动，当前层仅在真实溢出后启用内部滚动。
- 额度凭据与普通推理 Key 分离并逐项加密。OpenAI、Anthropic、DeepSeek、xAI 只调用官方只读管理/费用/余额接口；Gemini、MiniMax、GLM 只显示控制台与手动记录。
- 厂商品牌登记必须包含来源、核验日期和许可说明；官方限制第三方 Logo 时使用文字缩写，禁止无授权复制。
- 额度行主操作固定为刷新；环形概览仅在存在可靠分母时显示比例，只有余额时使用状态环。精确金额通过悬浮、键盘或触屏说明层读取。
- MiniMax 中国大陆站使用 `https://api.minimaxi.com/anthropic` 与 Bearer 鉴权；区域和套餐显式保存。`MiniMax-M3` 精确声明文本、图片、视频、工具、1M 上下文与运行档位，M2.x 不得推断视觉能力。
- 额度行主操作固定为刷新；环形概览仅在存在可靠分母时显示比例，只有余额时使用状态环。精确金额通过悬浮、键盘或触屏说明层读取。
- MiniMax 中国大陆站使用 `https://api.minimaxi.com/anthropic` 与 Bearer 鉴权；区域和套餐显式保存。`MiniMax-M3` 精确声明文本、图片、视频、工具、1M 上下文与运行档位，M2.x 不得推断视觉能力。

## 2026-07-14 设置架构约定

- 设置导航固定为外观、AI 连接、个性化、额度、MCP、诊断；额度不得回到 AI 连接详情或内置集成页。
- 个性化记忆以可选字段保存在现有 personalization 单例；手动记忆 active，AI 建议只能 pending，最多 100 条且每次请求注入不超过 1500 字符。
- 额度启用必须立即落库并进入 `QuotaRuntimeStore` 生命周期；隐藏、离线暂停，恢复只刷新过期项，临时失败保留上次成功快照。
- React 事件值进入函数式状态更新前必须先复制到局部变量，禁止在更新器执行时再读取可能已清空的 `event.currentTarget`。
- 模型 tooltip 只在鼠标停留或用户键盘导航后可见；程序化焦点与触屏保持静默，但必须保留 `aria-describedby`。
- 额度只调用官方只读管理、费用或余额接口；真实 smoke 必须显式启用且绝不记录数值、密钥或原始响应。

## 架构边界约定

- 错题、知识和薄弱分析使用统一学习数据浏览器与单一筛选作用域；侧栏不得恢复重复板块筛选。
- 摄像头、屏幕共享和截图是新对话工具，原始媒体只留在内存；历史辅导记录可以保留次级入口，但不得恢复为并列主模块。
- 模块通过 `ConversationLaunchContext` 启动空白对话，只有首次发送才创建持久化会话和 `context` 摘要附件。

- `ReviewWorkspace` 只负责导航、连接注入和视图装配；对话快照、命令搜索与快捷键统一交给 `useReviewConversationController`。
- 新代码优先从 `app/types/domains/*` 引用领域类型，`app/types/review.ts` 仅作为兼容出口并逐步缩减。
- Dexie 迁移放在 `app/db/review-db-migrations.ts`，数据库继续使用 `review_workspace` v16，未经慢查询证据不得新增索引或升级 schema。
- `architecture-boundary.contract.test.ts` 必须持续检查 workspace 预算、低频静态依赖和循环依赖。

## AI 连接架构约定

- 模型目录采用官方在线发现优先、带核验日期的官方回退；对话选择器保持厂商图标到单厂商模型的两步状态。
- 音色设置由 `VoiceProviderDescriptor` 驱动；实时语音只持久化最终双方转写，PCM、临时凭据和厂商原始事件只留当前运行内存。
- OpenAI Realtime 使用 WebRTC；GLM 本地中继只支持单实例标准 Next 进程，禁止宣称支持多实例或 Serverless。

- 业务功能只接收 `ApiConnectionProfile`，不得读取或透传旧 `apiSetting`。
- 文本任务使用默认文本连接，图片/OCR/关键帧使用默认多模态连接，云端朗读使用默认语音连接；缺失时明确提示，不跨能力静默回退。
- `apiSettings` 旧表与 `ApiSetting` 类型只用于历史迁移和旧版本回退，清空默认文本连接时必须同步清理旧记录。
- 密钥解密和连接参数映射统一放在连接级 AI 客户端，业务 service 不得自行解密密钥或推断厂商协议。
- 流式输出只允许通过 `/api/ai/generate` 的 SSE 分支和 provider adapter 归一化事件实现；业务 UI 不得解析厂商原始流。
- AI 活动面板按 run/step 展示工具链阶段、短文本片段和 usage 摘要，不得持久化 prompt、截图、完整上下文、Vault 正文或厂商原始事件。
- AI 额度必须通过独立插件适配层查询，账单凭据与普通模型调用 Key 分开保存；无官方稳定账单 API 的厂商只能显示 unsupported/manual，不得抓取网页后台。
- 设置中不保留插件目录；粉笔导入放在“公考 → 导入资料”，Obsidian 放在知识库，AI 额度使用独立设置项。
- AI 额度插件采用 CodexBar 式 descriptor/fetch strategy 边界；provider 卡片、官网入口、状态页、刷新周期、来源模式和 unsupported 原因必须从插件注册表读取。
- AI 连接模型选择必须使用下拉列表加手动模型 ID 兜底；推荐、预览、弃用、官方和能力标签只作为说明，不再铺成一排推荐按钮。
- 回归验证至少运行 `npm run lint`、`npm run test:contracts` 和 `npm run build`，涉及交互时还要用应用内浏览器检查页面、控制台和关键流程。

## 工作台与插件约定

- 顶层工作台采用 Codex 式结构：新对话、搜索、已安排和项目；公考是默认折叠的唯一项目树节点，后续专项通过 `StudyDomainDefinition` 扩展。
- 公考首页必须展示导入/错题、知识沉淀、知识训练、AI 辅导、已安排复盘和 Obsidian 输出的学习链路状态；后续专项也应通过 domain registry 声明自己的首页链路。
- 新对话必须进入 Codex 式空白草稿；只有发送第一条消息后才创建持久化会话。项目、文件夹、会话、消息、附件摘要和工具步骤通过 IndexedDB v16 保存，但不得保存 prompt、截图正文、Vault 正文或厂商原始响应。
- 对话工具链必须内嵌在消息流里，默认折叠为“已运行 N 条命令”，不得恢复右侧常驻工具栏作为唯一展示方式。
- 公考项目在侧栏默认只显示一个项目入口，模块和六大板块放入公考内部折叠入口；板块只作为错题筛选，不再与项目并列。
- 内部适配器不得重新暴露为设置插件目录；MCP 必须独立在 `设置 → MCP`，真实 server/tools/resources/prompts 通过后续手动连接测试闭环验证。
- 粉笔导入属于应用内部 `ImportProviderPlugin`，不得重新作为主导航板块；解析结果必须先进入草稿和诊断，用户确认前不得写题库。
- “已安排”是原本本地自动化能力的产品入口，底层 `automation` 类型、表和 repository 继续兼容；不得为了命名调整升级 Dexie schema。

## 字体与语音约定

- 全局中文 UI 默认使用 `next/font` 自托管的 Noto Sans SC，并通过 `--font-noto-sans-sc` 接入主题字体栈；已知旧内置字体栈应自动迁移，用户手写的自定义字体不得覆盖。
- 浏览器语音识别仅用于面试和辅导的输入转写；朗读不得调用 `speechSynthesis`、系统音色或任何本机静默回退。
- 朗读只能使用默认语音连接。缺少连接、Voice ID 或请求失败时必须明确提示并保持静音。
- 本地部署语音统一走自定义连接的 OpenAI 兼容 `/audio/speech` 协议；自定义连接允许无 API Key，且无 Key 时不得发送空 `Authorization` 请求头。

## 主题与侧栏约定

- `ThemeConfig` 只使用 `diffuseGradient`；`translucentSidebar` 仅在导入和 IndexedDB 归一化时作为旧字段读取，导出不得再写旧字段。
- 八个内置主题（晴空、米白、薄荷、晨雾、深海、暮紫、石墨、夜樱）的对比度均默认为 `0`。迁移时只把仍等于历史预设值的内置主题归零，用户主动修改过的数值必须保留。
- 顶栏始终使用主题实色背景；侧栏也必须保持不透明，弥散效果只允许用低透明度径向渐变叠加，禁止恢复 `backdrop-filter` 或透明窗口底色。
- 历史 GitHub Light 统一迁移为可编辑的“晴空”，不得固定侧栏色或禁用弥散；弥散由多组低透明度、非对称的大面积柔和色场组成。
- 主题菜单保持 Codex 式纯文本结构，只显示主题名和选中勾；调色板使用应用内控件，颜色字段保持圆形色样加 `#RRGGBB` 输入。

## 人设与角色图约定

- `personaDisplayMode` 只使用 `"default" | "custom"`；旧 `basic` / `flashcard` 在 repository 归一化，不升级 IndexedDB 索引版本。
- 内置人设定义保持不可变；`public/personas/` 只保存统一摄影规范的真人教师头像，文字、上传图和专属音色统一写入 `personaCustomizations[personaId]`。
- 角色原图只接受 PNG、JPEG、WebP，最大 20MB；浏览器端居中裁切为 2:3、最长输出 2400×3600 WebP 后以 Data URL 持久化。删除自定义人设时必须同步清理定制、默认选择和模块引用。
- `resolvePersona()` 负责合并文字覆盖，`resolvePersonaVoice()` 只返回实际模块人设的独立音色。旧全局音色仅在首次迁移时复制到缺少音色的人设，之后删除不得复活；仍只允许使用默认语音连接。
- 定制页只渲染 `customPersonas`，不得为内置人设生成卡片；空状态只显示独立“+”，新卡在选图成功前必须保持为不持久化草稿。
- 角色卡固定 2:3；旧比例字段只用于迁移读取，活跃类型和导出不得保留比例选择。定制页可持久化切换闪卡与头像视图。
- 卡片正面使用 `public/personas/persona-card-frame-2x3.png` 原始像素纹样，只允许等比缩放。镶边保留四角金色卷草和原图底边蓝色，背面禁止出现镶边；姓名不得恢复黑色铭牌，也不得引入职阶、星级或原作标识。
- 闪卡桌面保持 7–8 列、移动端三列；空卡使用固定浅色珠光纸面，不得恢复黑色默认卡面。边框有效像素必须贴齐 2:3 卡边，禁止用非等比 CSS 拉伸修补透明余量。
- 定制角色背面只编辑角色名称、角色描述和独立音色；默认人设通过无金框编辑层显示头像和完整字段。两种编辑层不得共用会导致遮挡的滚动结构。
- 编辑层必须锁定焦点、支持 Escape 和遮罩关闭、恢复触发器焦点并锁定页面滚动；减少动态效果时取消闪箔和位移动画。

## 主题与人设验收约定

- 除 lint、contracts、build 外，至少检查 1536×1024 与 390×844；确认主题菜单键盘操作、调色板同步、晴空主题可编辑、弥散隔离、定制空状态、高清选图、固定 2:3 正面镶边、闪卡/头像切换、无框背面、默认头像编辑、独立音色错误反馈和刷新持久化。
- 视觉改动必须保存浏览器截图，并与已确认的 Image-2 规格图逐项比较；检查控制台、框架错误和横向溢出后才能交付。

## Obsidian 知识图谱约定

- Obsidian 只通过浏览器 File System Access API 访问用户选择的 Vault，不安装插件、不启动 REST 服务，也不上传 Vault 内容。
- 应用只读写可配置托管根目录（默认 `AI知识库`）及政治理论、常识判断、申论子目录；目录句柄只能保存在 repository/IndexedDB，React 状态不得持有。
- Markdown Properties 使用稳定 `review-id`，关系使用标准 Wikilink。同步采用基础/Vault/应用三方哈希；双边修改必须进入冲突，不得静默覆盖，文件删除只标记断开。
- Wikilink 图谱只能由同步后的 mapping 派生为可序列化 `ObsidianGraphSnapshot`；React 不得持有目录句柄，AI 只接收节点/边摘要。
- 错题、面试、辅导和知识资料可自动进入本地候选；AI 仅通过默认文本连接生成 `create | merge | link` 提案。用户确认前不得写知识库或 Vault，确认后也只能修改显式 AI 演进区块和托管链接。
- 知识演进提案生成必须显示解析数量、过滤数量、空结果原因和诊断说明；不得让生成结果只落为空状态。
- Vault 同步必须先完成目录遍历、重复 `review-id` 和三方哈希预检，再写文件并提交 IndexedDB 基线；托管根目录缺失不得标记全部映射断开。
- 冲突选择与提案确认前必须复读 Vault 并拒绝过期哈希；`link` 提案只更新 Wikilink 和来源引用，失败重试不得生成重复知识条目。

- 知识演进确认闭环必须区分 `create`、`merge`、`link`：`merge` 只能替换显式 AI 演进区并维护摘要、标签、托管链接和来源引用，`link` 只能维护 Wikilink/sourceRefs；两者确认前都要复读 Vault 并校验过期 hash，写入失败后 proposal 必须保持 pending 以便重试。
## 本地已安排约定

- 已安排任务只在应用打开时执行；启动、恢复可见和网络恢复时可合并补跑一次，不得暗示浏览器关闭后仍会后台运行。
- 调度支持不少于五分钟的固定间隔、每日、每周和五段式 Cron；使用任务保存的 IANA 时区，并由 Web Locks 与可续期 IndexedDB 租约双重去重。
- 已安排严格使用默认文本连接，不回退多模态或语音。缺连接、断网和模型失败必须进入运行收件箱，并推进到下一计划时间。
- 自定义任务只能读取用户勾选的数据范围；知识演进的来源和候选知识也必须分别受范围约束。除创建待确认提案外，不得自动修改知识库、训练计划、Obsidian 或文件。
- 预览读取范围只展示本地摘要，不调用 AI、不保存任务、不推进调度；试运行只在用户显式点击后调用默认文本连接，且不得创建 run、写 proposal、保存定义或更新 `nextRunAt`。
- 运行详情只持久化 scope、数量、样本标题、上下文字符数、失败分类和恢复动作；不得保存完整上下文 JSON、完整题干集合、完整知识正文或完整 prompt。
- 失败恢复 CTA 只能导航或提示，不得自动重试运行、测试连接、选择 Vault、创建任务或触发外部请求。
- 已安排 AI 成功态回归必须使用 E2E 本地 mock provider 覆盖真实 UI 配置默认文本连接、试运行成功、立即运行成功和详情展开；不得在 CI 中依赖真实 API Key、真实模型服务或外网。
- 知识演进已安排成功态回归必须使用 E2E 本地 mock JSON provider；CI 只验证待确认提案生成和展示，不得连接真实 Vault、确认写入 Vault 或请求外网模型。
- 空白闪卡正面只显示加号，不显示“添加角色图片”或“未命名角色”；已有图片的角色仍显示名称，上传入口保留无障碍标签。

## 性能与包体约定

- 对话模型选择采用“厂商 → 连接档案/具体模型”两级下拉；会话级覆盖保存 `selectedModelId` 与归一化 `selectedRuntimeValues`，不得为切换模型复制连接密钥。
- MCP 只支持安全的 Streamable HTTP，并与插件目录分离；原始结果只留当前运行内存，持久化 run/step 只能保存 Server、工具、参数键和脱敏状态。
- Obsidian 提案生成、解析与 pending 保存必须出现在对话时间线，`conversationId` / `runId` 只作关联且不得触发 Dexie schema 升级。
- 手动复盘进入和切题只重置为暂停的 `00:00`，不得自动启动；倒计时只作为次级 disclosure。

- `ReviewWorkspace` 首屏只保留总览、错题、复盘、知识库和统计等核心路径；粉笔导入、已安排、设置、面试、辅导等低频视图必须使用 `next/dynamic` 动态加载，不得重新静态引入主工作台。
- 导入页的 `useImportDrafts` 必须留在导入视图内部 wrapper 中；`pdfjs-dist`、`mammoth` 等文件解析依赖只能在实际解析函数里 `await import()`，避免进入首屏包体。
- AI 关联分析、Obsidian repository 等重型服务应在用户触发对应动作时按需加载；React 状态仍不得持有 Vault 目录句柄。
- KnowledgeWorkspace 的列表分页、批量选择、批量删除和导出范围计算应保留在 `useKnowledgeListController`；Obsidian repository 与知识演进 AI service 只能在刷新或用户动作中动态加载，不得通过知识库视图静态回到核心首屏链路。
- TutoringWorkspace 的实时媒体源、关键帧采样、语音转写/朗读、本地草稿和当前轮次提交应保留在 `useTutoringSessionController`；主工作台只接线 tab、计划、关联和设备视图，且不得破坏默认文本/多模态/语音连接边界。
- 大列表第一阶段采用渐进显示：错题和知识资料默认 80 条、导入草稿默认 60 条，批量全选只覆盖当前显示项，导出筛选结果仍保留完整筛选语义。
- IndexedDB 索引优化必须基于真实页面访问路径和慢查询证据；v16 只执行旧空草稿清理，不得为前端列表切片新增索引。
- 额度插件这类小型设置使用本地加密存储，不得为了配置面板升级 Dexie schema。
- 配置健康、诊断输入和恢复 CTA 导航属于工作台 glue code，必须保留在专用 hook 中；`ReviewWorkspace` 不得重新直接导入配置健康 hook、诊断 hook 或 `package.json` 版本信息。

## AI JSON 约定

## 连接模型解耦与对话树约定

- `ApiConnectionProfile.model` 只作历史迁移输入；新建、编辑、测试连接不得要求或写回模型。
- 对话保存连接、模型和可选运行值；后台默认能力保存各自的连接与模型，默认文本只在空白对话没有最近选择时作为初始值，不得覆盖已有会话选择。
- MiniMax 静态回退以 `MiniMax-M3` 为旗舰，M2.7 为次级，M2.5 为 Legacy；GLM 静态回退以 `glm-5.2` 为旗舰。
- 对话模型选择器必须是单栏钻取，已选厂商优先，其余按英文名排序；推理参数只能展示厂商真实支持项。
- 对话和文件夹进入任意嵌套层级后都必须能拖回根目录；拖拽期间固定显示根目录目标，仍拒绝跨项目、自身与子孙嵌套。

## 公考树、产品图标与六厂商适配经验

- 公考内部的模块和板块筛选必须使用独立原生 disclosure，默认折叠且不持久化；测试应直接断言各层 `open` 状态，不能依赖空数据库下不存在的板块按钮。
- 产品功能图标统一通过 `AppIcon` 使用 Lucide；AI 品牌只能通过 `ProviderIcon` 与集中注册表渲染，禁止恢复 Unicode 占位或重复内联 SVG。
- 对话拖拽统一使用 dnd-kit Pointer/Touch/Keyboard sensors，名称区域作为拖拽表面并保留 6px 激活距离；repository 继续校验跨项目、自身与非法子孙嵌套。
- 指针拖拽 E2E 必须先通过 locator hover 完成 actionability，pointerdown 后留出事件循环并发送多次移动；等待 `DragOverlay` 后再查找根目标，pointerup 后等待拖拽态完整卸载再继续。
- 只有 `modelListStrategy === official_api` 的连接允许后台刷新模型目录；自定义与手动目录不得在保存后额外请求模型服务。
- structured output 由统一请求契约进入 provider adapter；知识演进固定使用对象包络并兼容历史数组，空响应/解析失败/全部过滤最多修复重试一次。
- rejected 知识演进提案不再消费来源；pending 与 accepted 仍需排除，避免重复待确认或已确认提案。

- 模型返回 JSON 必须通过 `app/services/ai-json.ts` 统一处理 Markdown fence、对象/数组主体提取和稳定错误消息；业务 service 不得重新手写 fence 清理或裸 `JSON.parse`。
- JSON helper 只负责解析稳定性，不改变现有 prompt 契约、不引入额外 schema 依赖；字段缺失、空数组和业务归一化继续由各业务 service 自己处理。

## 发布验收与数据性能约定

## 对话拖拽与七厂商适配经验

- 对话和文件夹拖拽统一使用 dnd-kit 的 Pointer、Touch 与 Keyboard sensors；拖拽上下文留在 `ConversationFolderTree`，移动合法性继续由 repository 判断。
- 模型选择列表点击即生效，不得恢复“使用此模型”二次确认；来源、核验日期和协议说明只进入诊断或详情。
- AI 连接新建不再选择用途；连接档案只保存鉴权、endpoint 与厂商能力，默认用途单独保存连接和模型。
- OpenAI、Gemini、Claude、DeepSeek、GLM、MiniMax、Grok 通过显式 `ProviderAdapter` 注册；其他厂商只作为兼容边界，不得宣称原生已核验。
- MiniMax 文本使用官方推荐 Anthropic-compatible `/anthropic/v1/messages`，语音使用原生 T2A；两类请求不得共用通用 Chat Completions 请求体。
- 模型运行能力只能来自具体模型 `AiModelRuntimeDescriptor`；未知模型不推断，UI 只保存 `{ reasoning, speed }`，七家独立 mapper 负责最终厂商字段。
- `glm-5.2` 必须原样支持 `max/xhigh/high/medium/low/minimal/none` 且默认 `max`；GLM-4.5 至 5.1 只按显式核验清单显示开启/关闭，未来或带后缀模型不得按版本字符串推断。
- 模型目录缓存按连接 ID、厂商和规范化 Base URL 隔离 24 小时；设置测试、能力默认和对话选择器必须共用目录服务。
- 对话模型菜单只渲染当前钻取层；厂商、模型、普通运行和预算层按内容采用独立宽度，高度随内容变化，禁止用绝对覆盖、`:has()` 固定最小高度或不可聚焦的视觉隐藏替代卸载。
- 模型、推理和速度点击即乐观保存且菜单保持打开；持久化选择必须按 `conversationId` 隔离并串行写入，失败回滚当前会话，空白草稿不得与其他对话共用乐观值。
- 运行档位使用原生 radio 语义；共享能力 tooltip 必须支持 hover、键盘与触屏 focus、`role="tooltip"`、`aria-describedby` 和视口碰撞。手动模型 ID 允许 Enter 与紧凑行尾提交，不增加全局确认按钮。
- `kind: "budget"` 的推理 descriptor 必须声明 `customRange`；范围内自定义整数和模型明确允许的 `0/-1` 必须保留。Anthropic 最终 `max_tokens` 必须包含思考预算和调用方正文输出额度。

- 数据层性能第二阶段必须先记录真实页面访问路径和慢查询证据；没有页面级分页需求或明确慢查询时，不得升级 Dexie schema 或新增索引。
- 真实浏览器与 Vault 发布验收按 `docs/release-smoke.md` 执行，重点覆盖 connect、sync、conflict、proposal confirm；CI 不得连接真实 Vault、真实模型服务或外网 API Key。

## Node.js 与 Tailwind 运行时约定

- 项目本地开发、CI 和发布验证统一以 Node.js 22 为基线；`.nvmrc`、`.node-version` 和 `package.json` `engines.node` 必须保持一致。
- 契约测试使用 `node --test --experimental-strip-types`，GitHub Actions 继续使用 `actions/setup-node` 的 Node 22，不得回退到 Node 20。
- Node 26 下若出现 `[DEP0205] module.register()`，先检查 Tailwind 运行时依赖；`@tailwindcss/node` 需保持在已优先调用 `module.registerHooks()` 的 4.3.2 或同补丁线后续版本。
- 处理运行时 deprecation warning 不得通过隐藏 warning 交付，必须定位调用栈、更新依赖或锁定受支持运行时，并完成 lint、contracts、build 验证。

## 设置导航与确认稿 UI 约定

- `useReviewWorkspaceRecoveryNavigation` 是设置分区唯一状态源；`SettingsWorkspace` 必须保持受控，禁止新增内部活动分区、`initialSection` 镜像或定时同步。
- 普通保存、连接测试、额度轮询和父级 snapshot 更新不得改变当前设置分区；只有“返回应用”后再次进入设置才重置为外观。
- 设置内容按信息密度采用独立最大宽度，桌面行高 32–36px、粗指针至少 44px；额度与数据管理使用紧凑表格，记忆与危险操作使用可锁定焦点并恢复触发器的应用内弹层。

## 依赖维护约定

- 常规依赖维护只集中更新同主版本、同 Next/React 稳定线、Node 22 兼容的补丁和小版本；ESLint、TypeScript、Node 类型等 major 变更必须单独开预研 PR。
- Next、React、React DOM 和 `eslint-config-next` 使用精确版本，避免框架核心版本在 `package.json` 范围内漂移；其他工具依赖沿用既有范围策略，并由 lockfile 固定解析版本。
- `npm audit` 禁止使用 `--force` 自动跨 major 或降级修复；若修复建议要求退回不可接受的旧 Next 主版本，应记录为上游未提供稳定可接受修复并持续跟踪。
