<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This project may use Next.js APIs and conventions newer than your training data.

Before changing framework-specific behavior, inspect the installed Next.js documentation under:

`node_modules/next/dist/docs/`

Follow installed-version documentation and deprecation notices rather than assumptions from memory.

<!-- END:nextjs-agent-rules -->

# Review Workspace — Repository Instructions

本文件是 `Review Workspace / 错题复盘` 仓库的工程控制塔。

只记录长期有效的项目事实、架构边界、验证入口和工作流。

不要把：

* 临时修复记录
* Provider API 细节
* 每轮 UI 微调
* 历史迁移流水账
* Roadmap 具体实现过程

持续堆进本文件。

这些内容应进入 `docs/` 或 `CHANGELOG`。

---

# 1. 产品定位

Review Workspace 是一个：

**Local-first AI 学习 / 错题复盘 / 知识训练工作台。**

核心原则：

* 本地数据优先
* 用户学习数据可恢复
* AI 是能力层，不是数据事实源
* Web 与 Electron 尽量共享业务代码
* 桌面端不建立第二套业务状态
* 隐私与凭据边界优先于便利性

---

# 2. 当前主要技术栈

当前项目采用：

* Next.js
* React
* TypeScript
* Tailwind CSS
* Electron
* Electron Forge
* Dexie / IndexedDB
* Node.js 24.20.0 LTS
* Next standalone runtime

不要在普通功能开发中更换核心技术栈。

尤其不要未经明确任务要求迁移到：

* Tauri
* Rust Desktop Runtime
* 第二套前端框架
* 第二套数据库
* 云端账户系统

---

# 3. 当前架构方向

目标依赖方向：

```text
UI / View
    ↓
React Controller
    ↓
Application Use Case
    ↓
Service / Repository / Host Capability
    ↓
Persistence / Provider / Runtime
```

各层职责：

## View

负责：

* 展示
* 用户交互
* Accessibility
* Layout
* Visual state

不得承担后台事务编排。

## React Controller / Hook

负责：

* React state
* 表单状态
* busy / loading
* refresh
* toast / notice
* navigation
* view orchestration

复杂的跨 Repository / AI / 外部副作用业务流程应逐步下沉到 Application。

## Application

负责真实多步骤业务 Use Case：

* 调用顺序
* 状态转换
* 多步骤持久化
* 外部副作用边界
* partial commit
* 稳定业务结果 / error

Application 必须保持纯 TypeScript。

不得依赖：

* React
* React DOM
* JSX
* CSS
* Feature View
* Next Client UI
* `window`
* `document`
* Electron preload global

不要为了单次 Repository 调用创建 Application Use Case。

## Service / Repository

负责：

* 领域服务
* Provider 协议
* 数据访问
* 纯业务 helper
* 本地事务

不要把 React 状态传入 Repository。

## Platform / Host

负责 Web / Desktop 宿主能力差异。

业务层只能通过 Host Capability 使用桌面能力。

---

# 4. 当前 Roadmap 架构状态

当前已完成：

```text
0.3 Host Capability Layer
✓ complete

0.4 Application Layer

✓ Interview
✓ Automation
✓ Import

0.4.x Data Reliability
✓ complete

0.5 Learning Loop
✓ complete

0.5.x AI Capability Abstraction
✓ complete

Conversation migration
deferred
```

Conversation 当前仍属于 deferred 高频变化区。当前对话事实源是可见用户/助手消息、必要的可见工具结果与稳定的 `turnId/sequence`；diagnostic/internal steps 默认折叠，隐藏思维链、thought signature、厂商私有状态不进入上下文、学习状态或持久化。继续保持 `review_workspace` v17。

Automation 的 Provider retry hint 不能覆盖 Application 的副作用安全判断。遇到 rate limit、network、provider unavailable 或不确定终态时，不得自动重放可能已经产生外部副作用的 operation；manual-only 语义必须保持。

Import 确认继续由既有 repository transaction 保护本地 Draft/Mistake/Batch 事实；后续 ImportJob、文件系统或 Provider 副作用可能部分提交，必须返回可恢复的 partial result，不得隐式重复确认或整流程自动重试。

Learning Loop 中，AI 自己认为学生掌握不等于 mastery evidence。只有确定性提交事实（如 review result、micro-assessment submission、saved evaluation）才能推进学习状态；推荐动作继续从本地事实只读派生，不新增推荐持久化。

不要在没有明确任务要求时顺便迁移：

* send conversation
* context compression
* context budget
* plugin execution
* knowledge proposals

每轮任务只完成明确指定的 Roadmap 阶段。

完成后停止，不自动开始下一阶段。

---

# 5. 重要目录

```text
app/
├─ application/   多步骤业务 Use Cases
├─ features/      UI、Controller、Workspace
├─ platform/      Web / Desktop Host Capability
├─ services/      Repository、Domain Service、Client Service
├─ server/        Server-only 能力、Provider Adapter、HTTP 边界
├─ db/            Dexie schema 与 migrations
└─ types/
   └─ domains/    领域类型

desktop/
├─ main.ts
├─ preload.cts
├─ runtime.ts
├─ permissions.ts
└─ vault.ts

docs/
├─ architecture.md
├─ application-layer-migration.md
└─ product-roadmap-0.3-to-1.0.md
```

修改前优先从这些边界理解系统，不要只搜索组件名称后直接改。

---

# 6. 架构事实源

重要架构信息优先查看：

```text
README.md
docs/architecture.md
docs/application-layer-migration.md
docs/product-roadmap-0.3-to-1.0.md
CHANGELOG
```

如果这些文档与当前代码冲突：

1. 以可验证的实际代码行为为准
2. 判断文档是否过期
3. 本轮涉及该边界时同步修正文档

不要把全部细节重新复制进 `AGENTS.md`。

---

# 7. Host Capability 边界

Renderer 业务代码不得直接读取：

```text
reviewDesktopVault
reviewDesktopWindow
```

或其他 Electron preload global。

`features`、`services` 和 Application 不得直接依赖 Electron preload global；只能通过 `app/platform/` 的 Host Capability 使用桌面能力。

桌面能力必须经：

```text
app/platform/
```

暴露。

Platform 不得反向依赖：

* application
* features
* services
* db
* server
* React

Host Capability 不得作为扩大 preload 权限的借口。

Web 环境：

* 缺失的桌面能力应为 unavailable / undefined
* 不要伪造 Electron 行为
* 不要为了视觉模拟创建假的系统能力

---

# 8. Electron 安全边界

保持现有安全基线：

```text
contextIsolation = true
nodeIntegration = false
sandbox = true
webSecurity = true
```

不要未经明确安全设计扩大：

* preload bridge
* IPC surface
* filesystem access
* navigation permission
* external URL permission
* media permission

Electron Main：

* 管理窗口
* 生命周期
* 安全边界
* 本地 Next runtime

不得成为业务状态源。

业务状态继续由共享 React / Repository / Dexie 管理。

---

# 9. 数据边界

核心数据库：

```text
review_workspace
Dexie v17
```

扩展数据使用独立的 `review_extensions` v1；不得以扩展功能为由升级核心库。

保持 local-first、单机单用户；未经明确需求和迁移设计，不引入账号、多租户、云数据库或强制云同步。

除非任务明确要求并有真实数据 / 性能证据：

不要：

* 升级 schema
* 新增 index
* 创建第二套业务数据库
* 修改持久化 ID 语义
* 进行破坏性迁移

数据库 migration 逻辑集中在既有 migration 边界。

任何 schema change 必须考虑：

* existing user data
* rollback
* upgrade path
* backup / restore
* Web / Electron compatibility

Backup、Restore、Health Check 与 Repair 继续遵循现有 Data Reliability contract：凭据、Cookie、目录句柄和 Vault 正文不进入备份；用户事实、凭据缺失和 Vault 冲突保持 manual-only，不猜测删除或自动修复。

---

# 10. 多系统事务

本项目存在：

```text
IndexedDB
AI API
MCP
HTTP collection
Vault
Electron
```

这些系统之间不存在自动 ACID Transaction。

多步骤流程必须明确：

* 已提交步骤
* 未提交步骤
* 外部副作用是否已经发生
* 是否可以安全重试
* cleanup 是否可能失败

禁止为了“体验顺滑”对未知副作用进行隐式整流程重试。

---

# 11. AI / Provider 能力与隐私边界

0.5.x AI Capability Abstraction 已完成；详细事实源与验收矩阵见 `docs/ai-capability-architecture.md`。

能力事实必须遵循：

* `supported`、`unsupported`、`unknown` 是三种不同状态；`unknown` 不等于 `supported` 或 `unsupported`。
* model capability 与 protocol capability 分离，只有双方都明确 `supported` 才能放行；协议限制不得伪装成模型限制。
* 只信 exact static catalog 和明确标注的 trusted provider metadata；静态核验 catalog 优先于发现结果。禁止按 model name、provider name、前缀或兼容 endpoint 猜测 vision、reasoning、streaming、numeric limits 等能力。
* 使用 connection-scoped resolver；缓存事实按 connection ID、provider 和 normalized base URL 隔离，UI 不直接读取 provider model cache。
* custom-compatible 只保留文本协议最低能力；其余能力与数值限制保持 `unknown`，不得继承原生模型事实。
* 模型、结构化输出、流式能力和 runtime values 必须在 secret/provider mapping 之前验证；无效、unsupported 或 unknown 的显式值产生 typed failure，不得静默替换。

Provider-specific request、response、stream、SSE 和 error 只停留在 adapter/route boundary。业务 consumer 只消费 normalized generation result、stream event 和 typed provider failure，不解析 raw vendor response，也不从 HTTP 状态、raw message 或 capacity 文案重新猜测 Provider 语义。

generation 只有在存在可见终态内容时才算成功；reasoning/thinking、usage、completion metadata、thought signature 或空白输出不能生成成功的 assistant turn。Provider generation 禁止 automatic retry 和 automatic provider/model fallback；retry metadata 仅描述安全性，不授权重放。

不得持久化或传播：

* hidden chain of thought
* thought signature
* API Key
* Cookie
* Authorization header
* 完整 Provider 原始响应
* 不必要的 MCP 原始输出
* 原始媒体流

跨 Provider 对话上下文只使用产品明确需要的可见信息。hidden reasoning、thought signature 和 provider-private metadata 不得进入 business、UI state、learning state、persistence、logs、diagnostics 或 exports。

具体 Provider 协议、模型目录和兼容策略以当前 Service / Adapter 和架构文档为事实源，不再长期堆进本文件。

---

# 12. Credentials

所有凭据相关修改必须维持：

* 最小权限
* 最小暴露
* 日志脱敏
* UI mask
* 持久化加密
* Provider 凭据职责分离

不要在错误对象、Analytics、Run log 或调试日志中新增 Secret。

---

# 13. UI 基线

项目已有桌面工作台视觉语言。

不要无任务依据进行全局视觉重设计。

桌面 Workspace 的 Topbar / Sidebar / Main 共边保持单一责任：

* 不重复画边框
* 不叠加 Glow
* 不用高光掩盖接缝
* `<main>` 按现有实现负责共边
* 桌面左上圆角保持现有设计
* 移动端遵循现有 Drawer 行为

隐藏原生滚动条时必须保留：

```text
overflow-y: auto
```

并保证：

* wheel
* touch
* keyboard
* programmatic scrolling

仍然可用。

视觉修复优先解决结构问题，不使用 Glow、模糊或渐变遮盖布局错误。

---

# 14. UI 组件

继续遵守当前架构预算和 contract tests。

原则：

```text
超过约 300 行：
检查职责。

超过 500 行的 React Component：
除非存在明确理由，否则拆分。
```

不要为了满足行数机械拆成大量无价值 wrapper。

Workspace 应优先拆：

```text
bootstrap
controller
view router
domain controller
view
```

而不是继续扩大根组件。

---

# 15. Next.js

当前 Next.js 版本可能包含训练数据之后的行为。

涉及：

* Route Handler
* Server / Client boundary
* caching
* headers
* middleware / proxy
* standalone
* bundling
* dynamic import

等框架特性时：

优先读取当前安装包中的：

```text
node_modules/next/dist/docs/
```

不得仅根据旧 Next.js 经验修改。

---

# 16. 依赖

不要无任务依据：

* 升级 major version
* 替换 UI library
* 更换 Electron packaging
* 引入新的状态管理
* 引入 DI framework
* 引入 ORM

新增生产依赖前确认：

* 是否真的需要
* 当前依赖能否完成
* Bundle / desktop 影响
* License
* Maintenance

---

# 17. Application Layer 原则

现有 Interview Application 是当前模式样板：

```text
app/application/interview/
```

可参考：

* 显式依赖
* 真实 Use Case
* typed result
* typed application error
* partial result
* direct execution tests

但不要机械复制。

禁止因为 Application Layer 存在就建立：

```text
BaseUseCase
BaseRepository
ApplicationManager
CommandBus
EventBus
ServiceLocator
```

每个 Use Case 必须证明自身存在真实业务编排价值。

---

# 18. Architecture Guard

必须保持并扩展现有：

```text
app/features/performance/architecture-boundary.contract.test.ts
```

保护：

* Application purity
* Platform dependency direction
* Workspace budgets
* Repository / View 边界
* preload access
* component budgets

不要为了通过新代码而随意放宽 guard。

如果 guard 不合理：

先证明现有规则与目标架构冲突，再修改。

---

# 19. 必要质量门

对普通 TypeScript / React / Application / Service 修改，本地至少运行：

```bash
npm run typecheck
npm run lint
npm run test:contracts
npm run build
```

涉及真实用户流程：

运行相关 Playwright。

没有稳定针对性入口时，根据任务风险运行：

```bash
npm run test:e2e
```

涉及 bundle / lazy boundary：

```bash
npm run check:bundle
```

涉及 Electron / shared desktop boundary：

```bash
npm run test:desktop
```

只修改文档时不需要机械运行完整 Web 构建。

不得虚构测试结果。

---

# 20. GitHub Delivery

本仓库默认采用：

```text
main
+
短生命周期 feature / fix / refactor / chore branch
```

不要引入长期 `develop`，除非用户明确改变分支策略。

涉及实现、修复、重构、UI 修改、架构迁移、维护、规则/文档修改或发布交付时：

**必须使用项目 Skill：**

```text
review-workspace-engineering
```

位置：

```text
.agents/skills/review-workspace-engineering/SKILL.md
```

除非用户明确要求：

* 只分析
* 不 commit
* 不 push
* 不开 PR
* 不 merge

否则默认由 Agent 完成：

```text
Branch
→ Implementation
→ Validation
→ Commit
→ Push
→ PR
→ CI
→ Squash Merge
→ Sync main
→ Post-merge verification
```

## 20.1 Git branch / worktree hard invariants

以下规则是仓库级硬约束，适用于产品代码、测试、文档和 Codex 项目规则维护。

### New write task preflight

任何新的 write task 在第一次修改文件前必须完成：

```bash
git status --short
git status -sb
git branch --show-current
git rev-parse HEAD
git fetch origin
git rev-parse origin/main
git worktree list
git status --short
```

对于新的 write task，必须确认：

* 当前工作区 clean
* 当前 checkout 是 `main`
* `HEAD` 与 `origin/main` 一致
* 当前目录没有未提交或未知修改
* 不需要处理其他 worktree 才能开始本任务

预检通过后，必须从最新 `origin/main` 创建并切换到 task-specific fresh branch，之后才允许修改任何文件。规则维护本身也是 write task，不能因为只修改 `AGENTS.md` 或 Skill 就跳过该约束。

如果预检发现 dirty state、分支不正确、HEAD 不一致或 worktree ownership conflict，必须立即 STOP。不得自行执行：

* `stash`
* `reset`
* `restore`
* `clean`
* `checkout --`
* 提交 unrelated changes
* 删除、prune、merge 或 rebase 其他 worktree / WIP branch

### Fresh branch requirement

新的 implementation、refactor、fix、maintenance、rules 或 docs task 必须从最新 `origin/main` 开始，并在第一次写入前进入 task-specific branch。禁止直接在：

* `main`
* detached HEAD
* 无关 feature branch
* WIP branch

上实现新任务。Detached HEAD 在有效 task branch 建立前只允许读操作。

### Existing PR continuation

如果当前任务明确是继续已有 open PR、处理该 PR 的 review/CI/stabilization，必须继续该 PR 的 exact head branch，不得另建 feature branch 或第二个 PR。写入前必须核对：

* PR head branch
* local branch
* PR HEAD SHA

三者必须对应；否则 STOP 并报告实际状态。

### Worktree conflict

如果目标 branch 已被其他 worktree checkout，或 Git 报告 branch/worktree ownership conflict，必须 STOP 并报告 conflicting branch、worktree path、当前 HEAD 和当前 branch。不得切到 detached HEAD、随意改用另一个 branch、删除 worktree、prune worktree 或 force 操作来绕过冲突。

### Merge and cleanup invariants

不得在以下条件下 Merge：required CI pending/failed、存在冲突、Changes Requested、未解决的阻断 review、或验证后 PR HEAD 已变化。HEAD 变化后必须重新验证。

Merge 后只有在确认没有其他 open PR 依赖该 branch 时，才可删除已合并的 task branch；无关 worktree 和 WIP branch 必须保持不动。随后必须回到 `main`，执行 `git pull --ff-only origin main`，确认工作区 clean，再进行 post-merge verification。

---

# 21. Git 禁止事项

禁止：

* 大型修改直接发生在 main
* force push
* force-with-lease 作为普通工作流
* 直接 push main 替代 PR
* 绕过失败 CI
* admin bypass
* Merge conflict PR
* Merge 未验证 HEAD
* 因 CI 失败删除真实测试
* 把 unrelated changes 混进当前 PR

---

# 22. 文档维护

发生真实架构变化时更新：

```text
docs/architecture.md
docs/application-layer-migration.md
docs/product-roadmap-0.3-to-1.0.md
CHANGELOG
```

按实际影响选择，不是每次全部修改。

不要继续把每个 Provider 或 UI 微调的历史规则写回根 `AGENTS.md`。

---

# 23. Scope Discipline

每轮任务：

1. 明确当前目标
2. 完成当前目标
3. 验证
4. Delivery
5. 停止

例如完成：

```text
0.4 Phase 2 Automation
```

后，不要自动进入：

```text
0.4 Phase 3 Import
```

除非用户明确要求继续。

发现其他问题：

* 阻断本轮 correctness → 可以修
* 不阻断 → 记录，不扩大 scope

---

# 24. 完成定义

工程任务只有在以下适用步骤完成后才算完成：

```text
Implementation
✓

Tests
✓

Architecture boundaries
✓

Documentation
✓ if required

Commit
✓

Push
✓ unless explicitly disabled

PR
✓ unless explicitly disabled

Required CI
✓

Merge
✓ unless explicitly disabled

Post-merge smoke
✓
```

如果某一步被权限、环境或 GitHub policy 阻塞：

停在最后一个安全状态，明确说明真实原因。

不得声称已经完成未完成的步骤。
