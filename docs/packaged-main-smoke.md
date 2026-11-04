# 实验性 Windows Capability Probe 与工具安全边界

本实验最初在 PR #149 的 `4a04f938ed928694591daa2b8cda2d979c2af959` 工作树中开发，现独立迁移至 `main` 基线 `c3fa2e963ac8c7cfbde9750c1fc717b5f0bbb75e`，不包含 PR #149 的功能代码。这里只开发和模拟验证工具，没有运行 Recall，没有改变正式 Main、ASAR、路由、preload、认证或生产 fuse。

**这还不是真实 packaged Main 验收实现。** 当前交付安全工具自测与独立的只读实验性 workflow；远程结果必须绑定本独立分支的精确提交和 CI run。没有真实启动驱动；没有隐藏的 `--run`、环境开关或自动降级路径。工具和 probe 都不能产生 `actualPackagedAcceptance=true`。旧 CI 结果不能证明本补丁，新的能力探测成功也不代表真实窗口验收成功。

## 已交付的安全边界

- `scripts/packaged-main-smoke-safety.mjs` 创建独占临时目录，绑定父目录、文件系统身份和随机 owner marker。清理遇到链接、junction、身份或 marker 变化便停止并保留现场，不跟随到无关目录。该保护以测试目录的单 owner 为前提，不宣称对恶意并发管理员无竞态。
- 子进程环境是精确白名单，不展开父环境。不传 CI 凭据、Provider Key、runtime token、DEBUG 或 NODE_OPTIONS。工具刻意不重定向 APPDATA/LOCALAPPDATA，也不把 USERPROFILE 环境值当作 Known Folder 隔离证明。
- 所有必需前置证据都必须明确执行且通过；unknown/missing 直接阻止目标启动。总超时会发送取消信号；停止或异步操作收敛无法确认时，结果失败并保留资料目录，避免清理与仍存活操作竞态。
- 结果只投影固定代码与断言状态，不输出原始异常、原始驱动输出、环境、命令行或秘密。模拟结果只叫 `SIMULATION_PASSED`；未执行断言为 `INCOMPLETE`。没有独立 HTTP 状态观测时，HTTP 409 始终标 `unobserved`；传入的外部证据描述最多为 `reported_unvalidated`，不会因此变成已验证状态，UI 文案也不能代替状态码。
- `packaged-main-job.ps1` / `.cs` **只供 Node 模拟 fixture 使用**。它们校验 fixture mode、node.exe、mock 脚本名、参数和环境白名单；不是通用 Recall 启动器。进程先 suspended 创建，加入禁止 breakaway 的 Windows Job，再恢复；guardian 退出时由 `KILL_ON_JOB_CLOSE` 清理整个 Job。已退出父进程的 detached 后代也仍受 Job 管理。强制 containment 与正常退出分别报告。

Windows PowerShell 5.1 入口保持 ASCII 注释，避免无 BOM UTF-8 的注释编码影响失败路径；详细中文边界放在本文和 Node 模块注释中。拒绝路径直接输出固定 JSON 并退出非零，不输出异常正文。

## 本地工具自测

固定 Node 24.20.0，在 Windows 上执行：

```powershell
node --test scripts/packaged-main-smoke-safety.contract.test.mjs
```

覆盖缺失前置不启动、未执行断言不得通过、原始异常不外泄、总超时取消、迟到操作不与清理竞态、停止未确认保留现场、无关 sibling 文件保护、junction 保护、精确环境白名单，以及实际 Node 父/子进程的 Job 超时终止、父进程先退出后的后代清理和正常退出区别。

这些是工具测试。fixture 进程是 Node 脚本，不是 Electron、浏览器或 Recall。自测通过不建立 Windows 测试账户、Known Folder、外部网络隔离或实际 UI 操作的验收证据。

## CI 补丁的实际行为

使用独立的 `.github/workflows/packaged-main-capability.yml`，名称为 **Experimental Windows Capability Probe**。它仅对该 workflow、工具脚本及本文的 PR 改动触发，独立 checkout 精确 PR HEAD，使用 Node 24.20.0 和 `contents: read`，不持久化 checkout 凭据。

1. 执行工具自测，step 上限 3 分钟。只使用 Node/Windows 内建 API，无需 npm install。
2. 执行只读 capability probe，step 上限 2 分钟，整个实验 job 上限 6 分钟。

原 `.github/workflows/ci.yml` 和 Windows NSIS Production job 与基线保持完全一致，现有构建、审计、artifact contracts、finalize 和 upload 都没有增加桌面依赖。独立实验不下载、不重新构建、不消费打包制品，输出明确 `artifactObservation=not_performed`。未来真实验收仍应在有制品的作业中另外证明全部安全前置；实验 VM 的结果不能替另一个 job 的 VM 作保证。

Probe 检查精确 checkout SHA、GitHub-hosted Windows 标识、非 Session 0 的 active/input desktop、UI Automation root 可读性、CIM 进程和 TCP listener 查询。它用 `SHGetKnownFolderPath` 查询当前账户的真实 Roaming/Local/Profile 路径，仅输出与环境值是否匹配的布尔值，不输出路径或账户名。

已观测到环境能力不足时退出 **2 / ENVIRONMENT_UNSUPPORTED**；源码绑定或探测调用异常退出 **1 / PROBE_ERROR**。两者都保留独立 job 的失败状态，不使用 `continue-on-error`；不能自动归因于产品回归。基本检查满足时只报告 **DESKTOP_CANDIDATE_ONLY**，明确保留以下 false：freshUserIsolationVerified、uiInteractionVerified、egressEnforcementVerified、fileWriteBoundaryVerified、realProcessCleanupVerified、packagedMainStarted、actualPackagedAcceptance。没有输出或上传用户 profile、截图、原始环境或 Token。本补丁不修改 GitHub required-check 或保护设置，不豁免仓库既有合并规则。

`runs-on: windows-latest` 本身不能证明 UI 交互可用。实际能力必须由本 workflow 在精确提交上的运行结果确认，不能提前断言 GitHub-hosted Windows 支持或不支持完整验收。若报 ENVIRONMENT_UNSUPPORTED，应停止该环境的真实窗口验收方向，不通过切换空断言、跳过 UI、禁用 UAC/UIPI 或把静态合同改称运行验收来“通过”。

## 首次 CI 后仍必须完成的条件

在实现任何真实启动步骤前，仍需独立验证并审查以下 OS 驱动能力；本补丁不伪装为已完成：

| 条件 | 最低证据 |
| --- | --- |
| 新测试用户与路径 | 一次性非管理员账户；加载其真实 Windows profile/hive；在该 token 下查询 Known Folders；独立 profile/managed roots 及 ACL 均不指向 runner 资料或工作树。不能只改 APPDATA/LOCALAPPDATA。 |
| 合法空资料 | 用既有初始化核心在上述实际路径创建全新 identity/bootstrap，独立读回 resolver=ready；不复制真实资料，不 mock Main。 |
| 真实 UI 可操作 | 同一测试账户/desktop 上的无害窗口先证明 accessibility 调用能执行且返回真实状态，再用实际 Recall 窗口操作。UIA root 可读不等于 Invoke 可用。 |
| 外部网络隔离 | 在应用运行前，证明对实际 packaged exe、bundled node.exe 及后代有效的 OS egress 限制；IPv4/IPv6 非 loopback 均阻断，loopback 正常；使用受控 canary，而非“没有观察到连接”推断已阻断。不得影响 runner 控制通道。 |
| 写入边界 | 验证该用户的 writable roots、artifact 只读权限和文件访问观测，记录测试资料的实际位置；目录快照不能证明未向其他位置写入。 |
| 进程收敛 | 在真实 runner 的既有父 Job 下验证 nested Job、禁止 breakaway 和失败清理；PID/开始时间/镜像/hash 绑定，不能按名字批量杀进程。 |

条件不能证明时，真实启动必须 FAIL。当前安全内核会把这些未知 gate 拒绝；没有为“方便首次运行”提供 bypass。

## 真实 Smoke 的后续断言设计

安全前置成立后才能新增实际 OS driver，并绑定新的精确 CI SHA、harness hash、production-evidence 与 exe/ASAR/runtime manifest：

1. 从当前 job 的 `win-unpacked/review-workspace.exe` 启动，无替代 Main 参数，不改 ASAR、fuse，不启用 inspector/remote debugging。记录实际镜像/hash/账户身份与 packaged 资源路径。
2. 以最小环境设置 loopback sentinel 的 `ELECTRON_RENDERER_URL` 及 `RECALL_UPDATE_MOCK_SCENARIO=available`。sentinel 零请求是必要条件，还须实际窗口 document URL 为 `review-app://workspace/`；窗口标题本身不够。
3. OS 侧绑定 Main 的 bundled `resources/.desktop-runtime/node/node.exe` 子进程、server.js 命令行及仅 loopback listener。不得读取或保存子进程的 runtime token。
4. 用真实窗口的 accessibility 控件进入设置 → 诊断 → 检查模拟更新，采集真实 disabled 状态。没有独立 HTTP 观测则明确 `HTTP 409 unobserved`，不拦截或伪造响应。
5. 正常关闭窗口，确认 Main/Node/renderer、关联 listener 和临时资料均收敛；强杀只算失败 containment，不能算正常退出。

当前没有执行上述五步，所以不能解除 PR #149 的 packaged-Main 合并阻断。

## 若 hosted runner 不支持交互

具体替代环境是**一次性、具有已登录且未锁定桌面会话的 Windows VM**。使用全新标准用户，不映射主机 Home/AppData/工作树，不共享剪贴板或凭据；只读传入哈希绑定的 unpacked 文件，保留来宾内 loopback，阻断外部网络。必须满足上表全部条件，并采集实际窗口、进程/端口和正常退出证据后才能验收。这里不授权购买、创建基础设施或在开发者本机建立账户/改防火墙。

## 参考

- [OpenInputDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-openinputdesktop)：active session 与 input desktop 必须查询，不能从 runner label 推断。
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)：子进程关联及 breakaway 边界。
- [Chromium accessibility](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility/overview.md)：可通过系统 accessibility 操作 UI；需要针对当前 Chromium/Windows 实测。
