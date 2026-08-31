# Fenbi Desktop Session Foundation

## Scope

Recall 目前同时保留两条 Fenbi 路径：

- 既有手动 Cookie 导入仍由 `app/server/import/fenbi-account-import-adapter.ts` 和现有加密凭据 repository 负责；
- Electron Main 新增一个只属于 Fenbi 的 persistent session foundation，供后续嵌入式登录和同步接入。

本阶段不创建 `WebContentsView`、Fenbi UI、DOM scraping、页面脚本注入、账户验证或自动同步，也不修改 Dexie、导入 parser、凭据存储或 release/installer 边界。

## Session authority

Fenbi 使用 `persist:review-fenbi`，与 Recall renderer 的 `persist:review-workspace` 完全分离。`desktop/fenbi-session.ts` 是唯一 Electron session authority：它只调用一次 `session.fromPartition`，安装 Fenbi remote-content policy，并提供 `getFenbiSession()`、`initializeFenbiSession()` 和 `clearFenbiSession()`。

清理只作用于这个 dedicated session 的 storage、HTTP cache 和 auth cache。它不会触碰 Recall workspace session、Recall/AI 凭据、Obsidian/Vault、Dexie、错题或对话历史。

## Origin and remote-content policy

Web 导航和 authenticated request 使用两组独立的 exact-host policy：`FENBI_WEB_ALLOWED_HOSTS` 包含 `www.fenbi.com` 和已有 adapter 使用的 `tiku.fenbi.com`，用于未来嵌入式网站/login navigation；`FENBI_REQUEST_ALLOWED_HOSTS` 只包含 `tiku.fenbi.com`，用于 Main-only authenticated request target。两者都要求 HTTPS、无用户名/密码、无非默认端口，并拒绝 `javascript:`, `file:`, `data:`, 自定义 scheme 和其他域名，包括 misleading hostname。不得用宽泛的 `*.fenbi.com` wildcard 代替显式登记。

当前 web policy 已覆盖产品目标中的 Fenbi website/login 路径；后续若发现 redirect 仍需其他 host，必须补充明确的官方流程/代码证据后再逐项加入，不能用任意 HTTPS 或未经校验的 substring/宽泛 proxy 代替。

Fenbi session 的权限 handler deny all，display capture 也拒绝，下载默认取消。未来 `WebContentsView` 必须使用 `createFenbiWebPreferences()` 的 `partition: persist:review-fenbi`、`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true` 和 `allowRunningInsecureContent: false`，并安装 `installFenbiWebContentsPolicy()` 以使用 web-navigation policy 拒绝 popup、非 allowlist navigation 和 redirect。当前 Recall 的 `desktop/permissions.ts` 不变，Fenbi 不被当作 Recall trusted origin。

## Renderer boundary and authentication semantics

`window.reviewFenbiSession` 只提供：

- `getStatus()`：返回 `available`、`persistent`、`hasSessionData` 和 `authentication`；
- `clear()`：返回一个 `{ cleared: true }` receipt。

status 中没有 Cookie、Token、`Set-Cookie`、session object、raw error 或 cookie count。存在 Fenbi session data 只能得到 `authentication: "unknown"`；没有 session data 才是 `"not-established"`。本阶段不把任意 Cookie 等同于账户已登录，也不执行 live account validation。

`readFenbiRequestCookieHeader()` 是 Main-process-only 的未来 transport seam。它仅在通过 `FENBI_REQUEST_ALLOWED_HOSTS` request-target policy 的 URL 上读取 dedicated session 的 Cookie，并且结果不经过 preload、不序列化、不持久化、不记录；后续集成仍需接入账户级权威验证和现有 adapter，不能在 `desktop/` 复制 parser 或直接 import `app/server/` implementation。

Fenbi 页面本身不加载 Recall preload。Recall renderer 仅能通过 sender/origin 校验后的窄 IPC 调用 session status/clear。

## Evidence boundary

本 foundation 的 contract tests 不需要真实 Fenbi 账号、Cookie 或外部网络。它们覆盖 partition isolation、URL policy、deny-all permissions、popup/navigation/download defaults、sanitized bridge、clear target 和现有手动 adapter 保留。真实登录、account validation、WebContentsView lifecycle 和 incremental sync 属于后续任务。
