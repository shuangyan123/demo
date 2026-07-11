# 应用架构

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

- `ConversationWorkspace` 由两级模型选择、媒体工具、MCP 调用和 Obsidian 提案等独立组件协作；会话可以保存 `selectedModelId` 覆盖，但继续复用同一连接档案的密钥和 endpoint。
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
AI Request -> Connection Client -> /api/ai/* -> Provider Adapter -> Provider
Vault Event -> Obsidian Controller -> Repository -> File System Access API
```

- 页面草稿、筛选、展开和媒体状态留在 feature/controller。
- 业务实体、会话摘要、运行结果和迁移基线存入 `review_workspace`。
- Dexie 当前版本保持 v16；`review-db-migrations.ts` 承载幂等迁移函数，不为前端切片新增索引。
- AI route 使用共享 HTTP 错误边界，只返回归一化数据或脱敏错误，不透传厂商原始响应。

## 扩展点

- 新学习专项注册 `StudyDomainDefinition`，不得在 shell 中新增专项分支。
- 新导入来源实现 `ImportProviderPlugin`。
- 新 AI 厂商扩展 provider registry 与 provider adapter。
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
