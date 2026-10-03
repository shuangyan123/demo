# ReviewWorkspace

ReviewWorkspace 是一个基于 Next.js、React、Dexie 和 Electron 的本地优先 AI 学习工作台。项目当前面向单机单用户场景，核心业务数据保存在本地浏览器数据库中，并可在用户授权后与 Obsidian Vault 协作。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/recall/wordmark/recall-wordmark-B-dark-transparent.png" />
  <img src="assets/brand/recall/wordmark/recall-wordmark-B-transparent.png" alt="Recall" width="215" height="85" />
</picture>

The formal Recall B wordmark above is supplied locked artwork. It is a visual
brand asset only; the existing `ReviewWorkspace`, `错题复盘`, package, and
desktop application identifiers remain unchanged.

当前版本处于 `0.2.x` 功能收敛阶段。后续版本规划见 [0.3 到 1.0 产品路线图](docs/product-roadmap-0.3-to-1.0.md)。

## 主要能力

- 错题录入、导入、筛选、复盘计划和掌握度跟踪
- 知识资料、知识训练、错题关联和知识演进提案
- 面试训练、AI 辅导、摄像头与屏幕上下文
- 多厂商 AI 连接、模型目录、推理参数和语音能力
- 本地已安排任务、运行收件箱和受控外部知识采集
- Obsidian Vault 同步、冲突检测、Wikilink 图谱和确认后写入
- MCP Streamable HTTP 连接和声明式扩展
- 本地备份、恢复、诊断和开发期 UI 审查数据
- Windows x64 Electron 安装版

## 技术栈

- Next.js 16 App Router，生产构建使用 `output: "standalone"`
- React 19、TypeScript 5、Tailwind CSS 4
- Dexie 4 / IndexedDB，本地业务库为 `review_workspace` v16
- Electron 43、electron-builder 26、NSIS；Electron Forge 7 / Squirrel.Windows 作为兼容路径
- Node.js 24.20.0 LTS
- Node test runner 契约测试和 Playwright E2E

依赖升级必须遵守 [依赖维护策略](docs/dependency-maintenance.md)，禁止使用 `npm audit fix --force` 绕过主版本或兼容性边界。

## 环境要求

- Node.js `>=24 <25`
- npm，使用仓库中的 `package-lock.json`
- Web 开发支持 Windows、macOS 或 Linux
- Electron 打包与正式验收当前仅支持 Windows x64

安装依赖：

```bash
npm ci
```

## Web 开发

```bash
npm run dev
```

默认访问 `http://localhost:3000`。Web 模式直接使用浏览器能力，不会模拟 Electron preload 或 IPC。

生产构建和本地 standalone 服务：

```bash
npm run build
npm run start:standalone
```

## Electron 开发与构建

同时启动 Next.js 开发服务和 Electron：

```bash
npm run desktop:dev
```

编译 Electron 主进程和 preload：

```bash
npm run desktop:compile
```

构建 Windows x64 安装包：

```bash
npm run desktop:builder:nsis
```

`desktop:builder:nsis` 会构建 Next standalone、准备固定 Node 运行时、校验 Electron 归档、组装 ASAR、应用 Electron Fuses 并生成 production-equivalent NSIS 安装器。产物位于 `out/`，不得提交到仓库。历史 Squirrel 兼容构建仍可通过 `desktop:make` 使用。

更完整的运行时和发布说明见 [部署文档](docs/deployment.md) 与 [发布 Smoke 清单](docs/release-smoke.md)。

## 测试与质量门

基础门禁：

```bash
npm run typecheck
npm run lint
npm run test:contracts
npm run build
```

按改动范围追加：

```bash
npm run test:e2e       # 浏览器交互、响应式或可访问性
npm run test:desktop   # Electron、preload、IPC、打包契约
npm run check:bundle   # 首屏或动态加载边界
npm run audit:prod     # 生产依赖安全门禁
```

真实 API Key、真实 Vault 和真实模型服务不进入 CI。需要人工凭据或文件系统授权的验收必须按 `docs/release-smoke.md` 执行并明确记录未验证项。

## 数据存储

| 数据 | 存储位置 | 说明 |
| --- | --- | --- |
| 学习、知识、对话、自动化 | `review_workspace` IndexedDB v16 | 核心本地业务数据 |
| 声明式扩展 | `review_extensions` IndexedDB v1 | 与核心 schema 隔离 |
| 主加密密钥 | `review_workspace_secure_keys` | 不可导出的 AES-GCM `CryptoKey` |
| 恢复事务 | `review_workspace_transfer` | 恢复完成或回滚后清理 |
| 小型设置 | 版本化 localStorage | MCP、插件偏好等受控配置 |
| Obsidian 正文 | 用户选择的 Vault | 只访问用户授权的托管目录 |
| 原始媒体与厂商原始事件 | 当前运行内存 | 不持久化 |

备份采用与真实 Dexie schema 对照的显式分类表；V2 manifest 记录应用/schema、included stores、excluded categories 与逐表数量。恢复在任何替换前拒绝未知存储、敏感字段、重复键、超限包和关键悬空关联，应用后再验证；凭据与 Vault 正文/句柄始终排除，恢复后需要重新输入并重新授权。完整支持矩阵见 [数据可靠性文档](docs/data-reliability.md)。

## Web 与 Electron 差异

两种宿主共享 React UI、Controller、Service、Repository、Dexie schema 和 Next Route Handlers。

| 能力 | Web | Electron |
| --- | --- | --- |
| Vault | File System Access API，需要浏览器支持和用户授权 | preload 最小桥接到受限 Vault IPC |
| 标题栏 | 普通网页 Chrome 布局 | Window Controls Overlay 与主题同步 |
| 屏幕/媒体 | 浏览器权限模型 | 同一 Web API，加 Electron session 权限边界 |
| 本地 Next 服务 | 外部开发或部署进程 | 随机 loopback standalone 子进程 |
| 运行时保护 | 浏览器沙箱与安全响应头 | 额外包含 runtime token、完整性校验、ASAR 与 Fuses |

业务代码不得直接读取 Electron preload global；宿主差异通过 `app/platform/` 的 Host Capability Layer 访问。

## 安全边界

- Electron 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`
- preload 只暴露受限、类型化能力，不暴露 Node.js 或绝对路径
- IPC 校验 sender，Vault 路径拒绝绝对路径、父级穿越和符号链接逃逸
- 安装版通过自定义协议代理随机 loopback，Next runtime 需要一次性 token
- 生产 CSP 禁止远程脚本和 `unsafe-eval`
- 凭据逐项 AES-GCM 加密，主密钥不可导出并使用记录级 AAD
- Provider、MCP、采集和导入 Route Handler 保持独立协议与 SSRF 边界
- 隐藏思维链、密钥、原始媒体、完整 prompt 和厂商原始响应不得持久化

## 目录结构

```text
app/
├── api/             Next Route Handlers
├── db/              Dexie schema 与迁移
├── features/        UI、Controller 和交互编排
├── platform/        Web/Electron Host Capability Layer
├── server/          服务端 Provider、MCP、采集与导入 adapter
├── services/        Repository、领域服务和客户端运行时
└── types/domains/   领域类型入口
desktop/             Electron main、preload、权限、runtime 与 Vault IPC
docs/                架构、API、部署、路线图和发布验收
e2e/                 Playwright 桌面与移动端验收
scripts/             审计、bundle、standalone 与桌面打包脚本
```

## 开发约定

1. 先阅读根目录 `AGENTS.md`、`docs/architecture.md` 和相关领域代码。
2. 使用 `feature/*`、`fix/*` 或 `refactor/*` 专用分支，不直接在 `main` 上开发。
3. 采用 Conventional Commits，并按 Issue → Branch → Commit → PR → Review → Merge 推进。
4. 优先小范围修改；不得无证据升级 Dexie schema、扩大 preload、放宽 CSP 或改变 local-first 定位。
5. View 不直接访问数据库或 Electron；复杂多步骤流程逐步迁移到 Application Layer。
6. 不提交 `.env`、API Key、Token、Cookie、密码、私钥、Vault 正文、安装包或运行缓存。
7. 每个阶段运行与风险相称的实际质量门，并在文档中区分自动验证、人工验证和残余风险。

架构决策见 [docs/architecture.md](docs/architecture.md)，API 契约见 [docs/api.md](docs/api.md)，长期经验记录见 [docs/agents.md](docs/agents.md)。

Recall 的证据与学习者状态边界及阶段进度见 [Recall Kernel Architecture RFC](docs/recall-kernel-architecture.md)：Phase B 已在 #132 合并；#133 的 Evidence Engine / Policy V1 shadow foundation 已实现，真实记录只读 shadow 评估仍待完成，尚无 authority cutover。
