# 项目经验沉淀

## 2026-07-12 对话拖拽与连接简化经验

- 嵌套对话树不要依赖原生 HTML5 `draggable`；拖拽上下文应限制在树组件内，多种 sensors 共用数据契约，repository 保留最终合法性判断。
- 模型列表的点击本身就是明确选择，不要再增加确认按钮；来源、核验日期和协议状态属于诊断信息。
- 连接档案和默认用途是不同状态域：前者保存鉴权与 endpoint，后者保存连接和模型。
- 七家重点厂商必须进入显式 `ProviderAdapter` 注册表，未核验厂商只能走兼容边界。
- MiniMax 文本优先使用官方推荐 Anthropic-compatible endpoint；语音仍使用原生 T2A。

## 2026-07-12 连接模型解耦经验

- AI 连接只承担鉴权、endpoint 和能力；业务调用必须显式解析 `AiRuntimeModelSelection`，不得重新读取历史 `connection.model`。
- 会话模型与后台能力默认模型是两个状态域；已有会话选择优先，空白对话先恢复最近会话选择，没有历史时再使用对应能力默认连接与模型。
- MiniMax 官方旗舰回退为 `MiniMax-M3`；在线 Models API 成功时展示账户可用的全部未弃用模型，静态目录只用于失败回退。
- 嵌套树的根目录 drop target 必须在拖拽期间固定可见，父子 drop handler 必须阻止错误冒泡并清理高亮。

## 2026-07 架构再加固

- AI 辅导的摄像头、屏幕共享和截图属于对话工具，不再作为侧栏主模块重复暴露；历史 session 数据通过次级入口继续访问。
- 错题、知识与薄弱分析共用 `LearningDataExplorer` 的筛选作用域；板块筛选不得同时出现在侧栏与内容区。
- 模块交给新对话时使用 `ConversationLaunchContext`，保持空白草稿不落库，并且只持久化脱敏摘要。

- 主工作台不得直接读取 conversation repository；对话快照、命令搜索和快捷键统一由 `useReviewConversationController` 管理。
- 新领域类型优先从 `app/types/domains/*` 引用；`app/types/review.ts` 仅作为渐进迁移兼容出口。
- Dexie 版本迁移应放入 `app/db/review-db-migrations.ts`，保持单事务、幂等和可独立测试。
- 架构约束必须进入契约测试，至少覆盖 workspace 预算、动态加载和循环依赖，不能只依赖评审约定。

## KnowledgeWorkspace 瘦身经验

- 知识资料列表的渐进渲染、批量选择、批量删除和导出范围计算应保留在 `useKnowledgeListController`，不要重新塞回 `knowledge-workspace.tsx`。
- Obsidian repository 与知识演进 AI service 属于知识库低频重服务，只能在刷新或用户动作中通过动态 `import()` 加载；React 状态仍只保存可序列化 snapshot、mapping 和 proposal。
- Obsidian Vault 和 AI 额度必须通过“设置 → 插件”集中呈现；AI 连接页只管理模型调用连接，不再承载额度配置。

## 专项学习与插件化经验

- 顶层工作台采用 Codex 式入口：新对话、搜索、已安排、插件和项目；“公考”是首个专项学习项目，后续专项通过 `StudyDomainDefinition` 注册，不再把功能平铺到主侧栏。
- 专项首页要优先展示学习链路和下一步，而不是只罗列模块；公考当前链路是导入/错题、知识沉淀、知识训练、AI 辅导、已安排复盘和 Obsidian 输出。
- “已安排”是原本本地自动化的产品入口；底层 automation 类型、表和仓储可继续复用，命名调整不得为了 UI 文案升级 Dexie schema。
- 粉笔导入属于设置插件，不再作为主导航板块；解析能力通过 `ImportProviderPlugin` 包装，UI 只能消费插件结果和诊断，不能重新直接绑定粉笔 parser。
- 插件页采用 Codex 目录式 UI，首屏只放搜索、已安装图标、分类列表、短描述、短状态徽标和主操作；健康摘要、隐私说明、诊断和业务面板必须点击插件后再进入页面内 inspector。
- 插件目录字段必须来自注册表，不能在 UI 中硬编码 provider 特例；运行态摘要只接收脱敏数量与连接可用性，不能读取 prompt、Vault 正文、截图或完整厂商响应。
- AI 额度 provider 采用 CodexBar 式 descriptor/fetch strategy 思路，provider 卡片、官网入口、状态页、刷新周期和 unsupported 原因都从注册表读取，通用 client 不写厂商账单分支。
- MCP 必须从插件目录移出，单独放在 `设置 → MCP`；本轮只保存 server 配置和 discovery 摘要，真实 tools/resources/prompts 调用后续通过 conversation run/step 展示。
- AI 对话面板按 Codex 风格展示会话、消息、composer 摘要和工具链；点击“新对话”只进入空白草稿，发送首条消息后才落库。工具链默认在消息流中折叠为“已运行 N 条命令”，会话和项目通过 IndexedDB v14 持久化，但只能保存可见消息、附件摘要、run/step 和 usage。
- 公考项目在侧栏默认只显示一个项目入口，模块和六大板块必须收进公考内部折叠入口；板块只作为错题筛选，不再与项目并列。

## TutoringWorkspace 瘦身经验

- 实时辅导的媒体源、关键帧采样、语音转写/朗读、本地草稿和当前轮次提交应保留在 `useTutoringSessionController`，`tutoring-workspace.tsx` 只做 tab、计划、关联和设备视图接线。
- 辅导仍必须遵守能力边界：纯文本轮次使用默认文本连接，携带关键帧时使用默认多模态连接，朗读只使用默认语音连接；缺连接时明确提示，不做本机或跨能力回退。

## AI JSON 解析经验

- 模型返回 JSON 必须通过 `app/services/ai-json.ts` 统一清理和解析；业务 service 不再手写 markdown fence 清理、对象/数组截取或裸 `JSON.parse`。
- 统一 helper 只负责解析稳定性，不改变 prompt 契约和字段 schema；字段缺失、空数组和业务归一化仍留在各自 service 的 normalize/validate 逻辑。

## 数据性能与发布验收经验

- 没有真实慢查询证据时，不为性能或列表切片升级 Dexie schema、不新增索引；通用 AI 会话持久化是业务建模升级，v14 只能新增会话/项目相关表。
- 真实 Vault 验收保留在人工 smoke：connect、sync、conflict、proposal confirm 四条路径必须逐项记录；CI 只验证契约和 mock provider，不接真实 Vault 或外网模型。

## AI 连接收尾经验

- 默认连接 ID 不能只在写入时校验；编辑连接能力后也必须在 repository 读取边界归一化，否则 React 会继续拿到能力不匹配的档案。
- 连接级客户端必须接收明确任务用途，并在解密密钥前校验能力。设置页测试也属于真实调用方，不能绕过该客户端。
- 流式输出只能在 provider adapter 层解析厂商事件，业务 UI 消费统一 `status/delta/usage/done/error`；结构化 JSON 任务仍等完整内容结束后走 `ai-json.ts`。
- AI 活动可视化按 run/step 展示工具链阶段、短文本片段和 usage 摘要，不得持久化 prompt、截图、完整上下文、Vault 正文或厂商原始事件。
- AI 连接模型选择使用下拉列表加手动模型 ID 兜底；模型能力和推荐状态作为说明展示，不再把推荐模型铺成按钮列表。
- 额度查询必须做成独立插件适配层，账单凭据与普通模型 Key 分开保存；没有官方账单 API 时只显示 unsupported/manual，不抓取网页后台。
- 额度 UI 采用紧凑厂商卡展示用量条、周期、刷新时间、来源标签和 unsupported/error 徽标；OpenAI 官方接口没有余额字段时必须明说，不得伪装余额。
- 额度插件配置使用本地加密存储即可，不为这类小型设置升级 Dexie schema；无慢查询证据时继续遵守不新增索引约定。
- 兼容旧表不仅要处理首次迁移；默认文本连接的模型、地址或密钥变更也要同步，清空或移除文本能力时则必须删除旧记录。
- 缺少默认连接时可以保留不发起 AI 请求的本地保存能力，但提示必须明确说明降级结果，不能伪装成 AI 摘要成功。
- 共享壳层接收状态文案时必须实际渲染并声明 `role="status"`；只把提示保存在上层状态会造成业务逻辑正确但用户完全不可见。
- `next/font/google` 会在生产构建阶段联网；要求离线可构建时，应提交官方字体和许可证并使用 `next/font/local`。

## 本次决策

- 外部知识库接入要把目录句柄封装在 adapter/repository；React 只接收序列化快照，避免权限对象进入组件树。
- Obsidian 双向同步必须保存基础、Vault、应用三方哈希；双边变化不得按时间戳猜测覆盖顺序。
- AI 自进化使用“自动收集、手动生成、确认写入”，只维护标记区块和 Wikilink，不覆盖用户手写 Markdown。
- 参考边框自带透明余量时应裁有效像素并保持目标比例，不能依赖 `object-fit` 掩盖蓝带悬空。
- 定制人设的业务模式与展示密度分开建模：`personaDisplayMode` 继续表示默认/定制，`customPersonaViewMode` 只表示闪卡/头像，并由 repository 归一化。
- 用户提供了明确边框参考时，采用确定性近白背景透明化，避免生成式重画改变卷草细节。
- 屏幕共享只扩展生命周期和错误反馈；媒体流留在浏览器内存，AI 继续只接收低频关键帧。
- 像素级复刻优先使用多参考图透视校正和像素共识提取，避免手绘 SVG 的轮廓漂移。
- 原图底边蓝色属于卡框结构，提取时以独立蓝色掩码限制在下缘，不把人物背景色带入透明资产。
- 默认人设与定制卡背字段和滚动需求不同，拆分组件比继续增加模式分支更易维护。
- 角色音色属于人设实体；旧全局值只做一次性迁移，防止用户删除后被回退逻辑重新注入。
- 主题差异应由数据预设表达，禁止使用主题名称触发隐藏样式分支。

## 后续实践

- 镶边参考图变化时先更新透明阈值，再在 160×240 至 190×285 CSS 尺寸做叠加比较。
- 任何图片容量调整必须同时覆盖原图限制、输出限制、IndexedDB 写入和移动端内存峰值。
- 主题视觉回归至少覆盖一个浅色和一个深色预设，并检查弥散关闭状态。

## Obsidian 桥接收尾经验

- File System Access 的目录句柄可以持久化，但权限恢复必须保留真实点击的用户激活；React 只消费恢复状态，句柄继续封装在 repository。
- 托管根目录不存在不能按空 Vault 处理，否则会把全部映射误标为断开；同步必须在完整遍历和重复 `review-id` 预检后才提交新基线。
- 本地新建且尚未映射的知识资料也属于 Obsidian 可用性边界；同步应在预检后为它生成确定性托管路径和 `synced` 映射，避免用户以为“立即同步”只导入不导出。
- 冲突按钮展示的内容可能在用户确认前再次变化，覆盖前必须复读文件并同时校验 Vault 与应用哈希。
- 文件系统和 IndexedDB 无法组成同一事务；先写带稳定 `review-id` 的确定性文件，再事务提交本地状态，可让提案失败后安全重试。
- `create`、`merge`、`link` 必须保持不同写入语义，尤其 `link` 只能维护托管链接和来源引用，不能借机改写正文。
- 知识演进不得把目标知识自身作为唯一来源或生成指向自身标题的 Wikilink；service 先过滤，repository 写入前再次防御。
- `KnowledgeEntry.nextReviewAt` 必须保持 `YYYY-MM-DD`；Vault 导入或迁移不能把完整 ISO 时间戳送入 `formatShortDate()`。
- Obsidian 图谱由同步后的 mapping 和 Wikilink 派生；React 只持有可序列化 `ObsidianGraphSnapshot`，AI 提案只接收节点/边摘要，不读取未授权 Vault 全文。
- CI 只验证静态质量、契约和生产构建；真实 Vault 与 AI 密钥必须留在本地浏览器验收，不得写入 Actions secrets 或测试夹具。
- 契约测试使用 `--experimental-strip-types`，GitHub Actions 与本地交付基线应使用 Node.js 22，避免 Node 20 无法识别该运行参数导致质量门误失败。

- 知识演进确认闭环必须区分 `create`、`merge`、`link`：`merge` 只能替换显式 AI 演进区并维护摘要、标签、托管链接和来源引用，`link` 只能维护 Wikilink/sourceRefs；两者确认前都要复读 Vault 并校验过期 hash，写入失败后 proposal 必须保持 pending 以便重试。
- 知识演进生成必须返回可见诊断：解析数量、过滤数量、空结果原因和过滤说明都要在 UI 可见，不能只显示空状态。
## 已安排实现经验

- 浏览器本地已安排任务必须把“准时后台执行”和“打开后补跑”区分清楚；没有常驻进程时不得承诺关闭页面仍运行。
- 调度去重需要双层保护：Web Locks 处理同源标签页，IndexedDB 到期租约处理不支持 Locks 的浏览器和崩溃恢复；长请求必须续租，提交结果前还要复核租约所有者。
- 漏跑不能逐次轰炸 AI 服务；保留最新计划时间、记录跳过数量并只生成一条运行记录更可控。
- 已安排上下文必须按数据范围现场组装，不能把完整应用快照或目录句柄交给自定义提示词；知识演进候选库也不能绕过范围授权。
- 计划任务执行前应比较定义版本和启用状态，避免另一标签页编辑或停用后仍使用旧快照请求模型。
- 失败运行也要推进下次计划并进入收件箱，否则缺连接或断网会形成每分钟重试循环。
- React 表单事件不要在函数式 state updater 或异步调用链里读取 `event.currentTarget`；必须先把 `value`、`checked`、`files` 等拷贝到局部 primitive，再传入状态更新或 service 调用。
- 自动化中心表单交互必须保留 Chromium E2E 覆盖；新增模板、周期或数据范围控件时，同步扩展 `e2e/automation-center.spec.ts`，并确保控制台和 `pageerror` 无运行时错误。
- AI 连接、Obsidian 桥接、导入/手动录入和个性化人设属于关键交互；修改这些入口、表单或错误提示时必须同步维护对应 E2E，并继续避免真实 API、Vault 或文件上传依赖进入 CI。
- 移动视口至少保留一条 Chromium E2E 烟测，覆盖侧栏折叠展开、关键入口可达和页面级横向溢出检查；新增全局导航或关键表单时同步扩展 `e2e/mobile-critical-flows.mobile.spec.ts`。
- 用户动作成功提示必须在数据刷新完成后发布，或刷新函数不得覆盖动作级反馈；新增保存、确认入库、删除、收藏等流程时要用 E2E 锁定最终可见提示。
- `ReviewWorkspace` 只保留业务编排和跨模块 wiring；导航、页头、侧栏入口和顶部状态展示放在 `ReviewWorkspaceShell`，同步/失败通知放在 `useReviewNotice`，后续瘦身不得把 shell 职责重新塞回主工作台。
- 配置健康、诊断输入和恢复 CTA 导航属于工作台 glue code，必须保留在专用 hook 中；`ReviewWorkspace` 不得重新直接导入配置健康 hook、诊断 hook 或 `package.json` 版本信息。
- 配置健康检查只能只读聚合已有快照：AI 连接、自动化、学习数据来自工作台状态，Obsidian 只读取 repository 暴露的可序列化 snapshot；不得把 Vault 目录句柄放入 React 状态。
- 配置健康 CTA 只负责导航到补齐入口，不得自动保存连接、创建自动化、连接真实 Vault、测试模型或发起外部请求；新增健康项时必须同步扩展契约测试和 E2E。
- 本地诊断面板只能展示当前快照和脱敏复制报告；不得持久化错误日志，不得写入 IndexedDB schema，不得请求 AI、连接 Vault、测试模型或申请浏览器权限。
- 诊断报告只能包含 label/provider/model/testStatus、Vault 状态、自动化失败摘要、浏览器能力和应用版本；禁止输出 API Key、`encryptedKey`、`iv`、目录句柄或完整 Vault 内容。
- 自动化预览只能本地读取授权范围并展示摘要，不得调用 AI、保存任务、推进调度或写入运行收件箱。
- 自动化试运行可在用户显式点击后调用默认文本连接，但必须保持临时态：不创建 run、不写 proposal、不保存定义、不更新 `nextRunAt`。
- 自动化运行详情只允许持久化 scope、数量、样本标题、上下文字符数、失败分类和恢复动作；不得保存完整上下文 JSON、完整题干集合、完整知识正文或完整 prompt。
- 自动化失败恢复 CTA 只能导航或提示，不能自动重试运行、测试连接、选择 Vault、创建任务或触发外部请求。
- 自动化 AI 成功态回归必须使用 E2E 本地 mock provider 覆盖真实 UI 配置默认文本连接、试运行成功、立即运行成功和详情展开；不得在 CI 中依赖真实 API Key、真实模型服务或外网。
- 知识演进自动化成功态回归必须使用 E2E 本地 mock JSON provider；CI 只验证待确认提案生成和展示，不得连接真实 Vault、确认写入 Vault 或请求外网模型。

## 性能与包体经验

- `ReviewWorkspace` 首屏只保留总览、错题、复盘、知识库和统计等核心路径；导入、自动化、设置、面试、辅导等低频视图必须用 `next/dynamic` 动态加载，不得重新静态引入主工作台。
- 导入页的 `useImportDrafts` 必须留在导入视图内部 wrapper 中；`pdfjs-dist`、`mammoth` 等文件解析依赖只能在实际解析函数里 `await import()`，避免进入首屏包体。
- AI 关联分析、Obsidian repository 等重型服务应在用户触发对应动作时按需加载；React 状态仍不得持有 Vault 目录句柄。
- 大列表第一阶段采用渐进显示：错题和知识资料默认 80 条、导入草稿默认 60 条，批量全选只覆盖当前显示项，导出筛选结果仍保留完整筛选语义。
- IndexedDB 索引优化必须基于真实页面访问路径和慢查询证据；没有 repository 级分页或明确性能瓶颈时，不为前端列表切片单独升级 Dexie schema。

## Node.js 与 Tailwind 运行时经验

- 项目本地开发、CI 和发布验证统一使用 Node.js 22；契约测试依赖 `node --test --experimental-strip-types`，不得回退到 Node 20。
- 如果 Node 26 运行 `next build` 出现 `[DEP0205] module.register()`，优先检查 `@tailwindcss/node` 版本；4.3.2 已改为优先使用 `module.registerHooks()`，不要用忽略 deprecation warning 的方式掩盖问题。
- Tailwind 运行时问题只接受同一补丁线内的最小升级，升级后必须跑 `npm run lint`、`npm run test:contracts` 和 `npm run build`，并用 `node --trace-deprecation ./node_modules/next/dist/bin/next build` 验证 warning 已消失。

## 依赖维护经验

- 常规依赖维护优先集中处理同主版本、同 Next/React 稳定线、Node 22 兼容的补丁和小版本更新；破坏性 major 变更必须单独预研，不混入安全补丁 PR。
- Next、React、React DOM 和 `eslint-config-next` 保持精确版本，避免框架核心在 lockfile 之外漂移；工具库可沿用现有 caret 范围，但必须通过 `package-lock.json` 锁定实际解析结果。
- `npm audit` 不得使用 `--force` 自动降级或跨 major 修复；如果修复建议要求退回不可接受的旧 Next 主版本，只能记录为上游未提供可接受稳定修复并继续跟踪。
# 2026-07 对话工作台沉淀

- 对话持久化只保存会话文本、工具摘要与附件元数据；任何图片、音频、文件原文和生成请求拼接内容必须停留在当前内存请求。
- 容量与限流错误在 route 边界归一化，界面保留草稿而不写入失败助手消息。
- 文件夹交互由独立树组件维护，主工作台只负责刷新快照和导航；录音必须使用 Gemini 录完转写，禁止浏览器语音识别回退。
- 文件夹操作层必须通过 Portal 脱离侧栏堆叠上下文；仅提高 z-index 不能解决变换父级与主内容之间的点击拦截。
- 移动端工作台侧栏需要给项目树保留可见高度并独立滚动；快捷入口应压缩为一行，不能沿用只容纳三个纵向按钮的固定高度。
- 模型目录缓存只保存归一化公开元数据；Key、鉴权头和厂商原始响应不得写入 localStorage。
- 会话级覆盖保存 `selectedModelId` 与归一化 `selectedRuntimeValues`，连接档案继续作为鉴权与 endpoint 的唯一来源；两级模型选择器不得要求每个模型一份密钥档案。
- MCP 配置和插件目录是两条边界：插件负责状态与跳转，MCP 负责真实 Streamable HTTP server/tool 调用；原始结果只在当前组件内存中，持久化步骤必须脱敏。
- 对话内 Obsidian 提案要关联 conversation/run 并以内嵌时间线呈现；确认动作必须发生在用户点击手势下，以便恢复 File System Access 权限。
- 复盘计时不得由页面进入或切题自动启动；默认正计时暂停，未启动提交合法记录 0 秒。
# 2026-07-12 模型与语音经验

- `AiConnectionPurpose` 新增 realtime 后，默认连接映射、设置标签、目录归一化必须同步更新，但不需要升级 Dexie v16。
- 语音表单必须由 `VoiceProviderDescriptor` 控制，禁止把同一组 style/speed/volume/pitch 字段无差别发送给所有厂商。
- 实时语音持久化边界是最终转写；音频、临时凭据、增量事件和 WebRTC/WebSocket 对象不得进入 React 全局状态或 IndexedDB。

# 2026-07-13 对话树与连接测试经验

- 去掉独立拖拽手柄后，应把传感器监听绑定到名称按钮，保留 6px 激活距离，避免普通点击被误判为拖动。
- 文件夹同时是拖拽源和放置目标时，draggable ID 与 droppable ID 必须使用不同命名空间；真实回归应分别覆盖文件夹和对话的指针拖动。
- dnd-kit 指针 E2E 必须明确越过激活距离并等待 `DragOverlay`，再定位仅在 active drag 中渲染的根目录目标；贴着阈值移动会在慢速 CI 上形成假阴性。
- 右键重命名统一落到行内输入框；Enter 应通过失焦单点提交，Escape 必须显式取消，避免键盘事件与 blur 重复写 repository。
- 模型发现与真实测试属于连接级客户端职责；设置界面只编排草稿、模型选择和反馈，连接档案不得重新持有模型字段。
- 模型速度必须由官方协议能力驱动：请求级优先服务与高速模型 ID 是两种不同机制，不得用一个布尔值向所有厂商透传。
- 测试成功只证明“当前鉴权 + endpoint + 所选模型”可用；是否设为默认文本模型仍是独立、显式的用户决策。

# 2026-07-13 模型运行选项经验

- 推理与速度能力必须由具体模型 `AiModelRuntimeDescriptor` 声明；未知、在线新增或手动模型返回无运行选项，禁止恢复模型名正则猜测。
- UI 只持久化 `{ reasoning, speed }`，服务端 provider mapper 再写厂商字段；连接档案、组件和业务 service 不得自行拼装 `reasoning_effort`、`thinkingConfig` 或 Fast header。
- GLM-5.2+ 七档必须原样保留并默认 `max`；旧 GLM 的开关是另一种 descriptor，不得把两者压成同一档位集合。
- 模型目录缓存键必须同时包含连接 ID、厂商和规范化 Base URL，TTL 为 24 小时；设置测试、能力默认和对话选择器必须消费同一目录服务。
- 运行档位 E2E 使用本地 mock Responses provider，至少验证弹层保持打开、立即持久化、刷新恢复、请求体映射与所选/实际档位摘要。
