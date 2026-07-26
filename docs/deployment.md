# 部署与验证

## GitHub Actions 质量门

Pull Request 和 `main` 推送统一使用 Node.js 22 执行 `npm ci`、ESLint、契约测试和生产构建；全部通过后方可合并。契约测试依赖 Node.js 22 的 TypeScript 运行参数，真实 Vault 与外部 AI 连接只在本地 Chrome/Edge 验收，不向 CI 上传目录内容或 API Key。

## 构建要求

```bash
npm ci
npm run lint
npm run test:contracts
npm run build
```

部署产物必须包含 `public/personas/persona-card-frame-2x3.png`。若重新提取镶边，使用 `scripts/extract-persona-frame.mjs` 处理 1024×1536 原始参考图并保留来源记录，不得改用生成式补画。

## 浏览器验收

至少在 1536×1024 与 390×844 检查：2:3 卡片正面纹样与底部蓝色、闪卡/头像切换持久化、无框背面、默认编辑器滚动、高清上传、独立音色、屏幕共享停止同步、键盘焦点、控制台错误和横向溢出。

Obsidian 双向桥接要求 HTTPS 或 localhost，并以 Chrome 111+ / Edge 111+ 做目录权限和真实 Vault 写入验收。部署不得申请托管目录之外的权限；不支持 File System Access API 时必须保留只读 Markdown 文件夹导入。

## 自动化运行边界

本地自动化依赖页面存活，不需要 cron 服务器、Service Worker 或云端队列。浏览器关闭后不会执行；重新打开、恢复可见或网络恢复时合并补跑一次。浏览器通知只在页面打开且用户主动授权时显示，核心结果始终保存在 IndexedDB 收件箱。

部署环境必须允许动态加载 `cron-parser`，并保持系统 IANA 时区数据可用。时区、夏令时、五段式 Cron、最短五分钟间隔、租约续期和旧定义拒绝执行属于发布前契约测试范围。

## 采集服务部署边界

- 生产服务器必须允许对用户白名单中的公开 HTTP(S) 来源发起出站请求，同时禁止把代理层配置成可访问云元数据或内网的通用转发器。
- 运行时基线为 Node.js 22；`cheerio@1.1.2` 用于服务端 HTML/RSS/XML 解析，其引擎要求与项目基线一致。
- 浏览器关闭后不会采集；页面恢复可见或网络恢复时仍只合并补跑一次。
- CI 必须拦截 `/api/acquisition/fetch` 并使用固定响应，不连接真实网站、真实 MCP、真实模型或真实 Vault。
- 部署日志不得记录完整网页、MCP 原始结果、模型原始响应、提示词、连接密钥或 Vault 正文。

## P1 学习工作区发布检查

- 生产构建后在 1536×1024 验证错题主从列表、复盘 70/30 布局和知识编辑区，在 390×844 验证批量管理入口、移动详情返回和复盘底部操作。
- 浅色与深色都必须检查页面级横向溢出、顶栏遮挡、键盘焦点、框架错误层和控制台错误。
- CI 使用本地 IndexedDB 表单数据，不连接真实模型、外网来源或真实 Vault。
# P3 UI/UX 部署说明（2026-07-23）

- 本轮没有新增环境变量、服务端依赖、Route、数据库迁移或外网服务。
- 生产验收继续使用 Node.js 22、`next build` 与单实例 `next start`；CI 的导入、搜索、插件和学习数据流程全部使用本地状态或明确 mock。
- 发布前必须完成 1536×1024 与 390×844 的浅色/深色截图、控制台检查、键盘路径、减少动态效果和横向溢出检查。
# 0.2.0 升级门禁

- CI 的生产构建后必须执行 `npm run check:bundle`，并上传 `.next/diagnostics/bundle-budget.json`。需要更新基线时必须提交新的 Turbopack analyzer 证据和理由，不能通过单纯放宽 5% 阈值绕过回归。
- 桌面与移动 Playwright 项目分别运行 axe 严重级门禁；失败时上传 trace 与附件报告。真实模型凭据和真实 Vault 仍只允许本机人工 smoke。
- 架构发布门禁还要确认业务源码没有 `types/review.ts` import，Provider/Obsidian facade 与内部实现模块均不超过 500 行；本轮没有 Dexie 升级或新增部署变量。

# API 密钥与对话体验发布检查（2026-07-26）

- 升级后首次读取凭据会迁移 v1 密文。迁移失败时保留旧密文和旧 JWK；不得通过清空站点数据“修复”，密钥库确实丢失时由用户重新输入凭据。
- 发布不新增环境变量，不允许把 `.env`、API Key、Token、浏览器配置或视觉验收临时目录提交到 Git。
- 门禁固定执行 `typecheck`、`lint`、`test:contracts`、`build`、`check:bundle`、`audit:prod` 与桌面/移动 E2E。
- 在 1536×1024 和 390×844、浅色与深色验证：Markdown 段落节奏、原始 HTML 静默跳过、模型旁推理滑杆、键盘与粗指针目标、操作菜单锚点、行内重命名、控制台、横向溢出和焦点恢复。

# 单色 UI 与外联安全发布检查（2026-07-26）

- 部署层不得放宽 CSP：`script-src-attr 'none'`、`frame-src 'none'`、`manifest-src 'self'` 和同源 `Cross-Origin-Resource-Policy` 必须保留；静态渲染、PDF 与 WASM 只保留当前构建实际需要的来源。
- 公网 Provider 使用 HTTPS；loopback 可使用 HTTP(S)。局域网服务必须由连接或 MCP 逐项开启“允许本地网络”，反向代理和容器网络仍需额外阻止云元数据与内部管理网段。
- 应用对 Provider/MCP 跳转采用失败关闭，不自动跟随重定向。DNS 全结果校验属于应用层防线；生产环境仍应以防火墙或 egress policy 限制元数据和管理网络，降低运行时解析与请求之间的基础设施风险。
- 完整重置前关闭同源其他标签页；若密钥库或业务库被占用，界面会保留数据并提示关闭占用页面后重试。localhost、127.0.0.1 和不同端口继续是不同浏览器来源，凭据不会跨来源恢复。
- 发布视觉证据保存在 `docs/design/security-ui-unification/`；不得将 `.playwright-results`、浏览器 profile、密钥、Token、Cookie 或 `.env*` 纳入提交。

## AI 连接保存与 UI 发布检查（2026-07-26）

- 发布门禁已覆盖 `typecheck`、`lint`、239 项契约、生产构建、包体、生产依赖审计和 54 项 E2E；生产依赖漏洞为 0。
- 视觉证据保存在 `docs/design/ai-connection-save-ui-closure/`。应用内浏览器仅出现严格 CSP 阻止 React 开发调试 `eval` 的提示，生产构建不依赖该能力。
- 真实厂商调用仍需在本机显式提供测试凭据；自动化只使用隔离的 mock provider，不提交或记录真实 Key。
