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

## Embedded practice workspace (FENBI-EMBED-01)

“粉笔练习”是桌面端的 remote practice surface，不是导入页的别名。Electron Main 通过唯一的 `FenbiWebContentsController` lazy 创建 `WebContentsView`，将它挂到 Recall `BrowserWindow.contentView`，并始终复用 `createFenbiWebPreferences()` 与 `installFenbiWebContentsPolicy()`。初始导航固定为 `https://www.fenbi.com/`；renderer 只能请求首页、刷新、后退、前进和 bounds 更新，不能提供任意 URL。

该 view 使用 `persist:review-fenbi`，Recall 主 renderer 仍使用 `persist:review-workspace`。Fenbi remote content 不加载 Recall preload，因此不会收到任何 Recall contextBridge、Node 能力或 `reviewFenbiSession`；Recall renderer 只通过 origin-checked `reviewFenbiView` 接收脱敏状态（可用性、可见性、加载状态、allowlist host、导航能力和安全错误枚举）。bounds 由 renderer slot 提供，但 Main 会校验有限数值、拒绝负尺寸并将几何 clamp 到 BrowserWindow content area；不做未经 Electron 证据支持的 device-pixel-ratio 换算。

`FenbiContextPanel` 注册在现有 `WorkspaceContextPanelRegistration`，只展示真实 session/view 状态和实际可用操作：回到首页、后退、前进、刷新、打开现有粉笔导入、确认后清除粉笔专用会话。`hasSessionData` 仍不等于已登录；`authentication: "unknown"` 显示为“检测到粉笔会话数据 / 登录状态尚未验证”。清除操作只委托 Fenbi dedicated session，完成后刷新状态并回到 Fenbi 首页，不删除 Recall 数据。自动错题同步尚未实现。

Web/Next.js mode 不伪造 native embedded surface，而显示“粉笔嵌入仅桌面版可用”，并可提供安全的 `https://www.fenbi.com/` 浏览器链接。现有 `粉笔导入` workflow 保持独立，是当前的 import/sync fallback；未来同步任务仍需另行定义 session-authorized incremental wrong-question synchronization，不能在本任务中复制 parser、抓取页面 DOM 或拦截请求。

`WebContentsView` 是 native child surface，普通 renderer `z-index` 不能把 SummaryPopover 或 mobile drawer 可靠地画在它上面。共享 `ui-overlay-events.ts` 提供 source-set occlusion store：SummaryPopover、mobile ContextPanel 和 mobile sidebar 分别持有稳定 source，任一 source 打开即隐藏 Fenbi view，所有 source 关闭后才恢复。桌面 ContextPanel 继续使用 push layout，slot 通过 ResizeObserver、布局 transition、窗口/viewport 事件和 requestAnimationFrame 跟随实际几何；离开 Fenbi view 时隐藏，返回时使用最新 bounds。该机制是通用 shell 能力，ContextPanel 与 SummaryPopover 不包含 Fenbi 特判。

真实 Fenbi 页面交互、登录 redirect host、session persistence 和 native z-order 仍需在 Electron GUI 中验收；浏览器 Playwright 只证明导航、fallback、ContextPanel/summary 和 occlusion renderer contract，不替代 live native QA。
