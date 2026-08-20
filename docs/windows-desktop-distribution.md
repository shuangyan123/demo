# Windows Desktop Distribution / Lifecycle Contract

状态：**0.8 Phase 1 COMPLETE；Phase 2A COMPLETE within scoped adjacent-version acceptance；Phase 2B COMPLETE within scoped closed-app uninstall → same-version reinstall → userData/product-data persistence → full-restart acceptance；0.8 overall IN PROGRESS**（2026-08-15）。

本文件建立 Windows x64 分发、生命周期和 `userData` 的 ownership contract。它不重新设计或削弱 0.7 的 Desktop authority、no Web fallback、fail-closed、context binding、source retention 或 credential cleanup ordering。0.7 的安全语义仍由既有实现、contract 和已归档的 scoped installed-app evidence 所拥有。

## Phase 1 boundary

Phase 1 交付：

- 当前 Forge/Squirrel packaging 链、输出形状和生命周期调用链审计；
- binary root 与 Electron `userData` 的独立 ownership contract；
- Squirrel 参数分类、package identity、artifact shape 和 security baseline 的 automated contract；
- 0.8 lifecycle acceptance matrix、隔离 Windows 手工流程、签名和 release asset 的前置边界；
- clean first-install evidence 和 repeated same-version Setup diagnostic 的准确分类。

本阶段不实施：installer framework migration、auto-update、destructive uninstall cleanup、schema migration、credential migration/重构、production signing 或正式 release promotion。

## Phase 2A candidate and acceptance closure

状态：**COMPLETE within the scoped binary/userData/restart contract**（2026-08-15）。

本阶段只把当前 `0.2.2` package identity 提升为真实的下一 patch candidate `0.2.3`，并补齐版本一致性 contract、候选 artifact 记录和人工验收边界。它不修改 Electron runtime、Squirrel identity、`userData` 路径、credential authority、schema 或安全设置，不创建 `v0.2.3` tag，也不发布 GitHub Release。

`0.2.3` candidate 的 PR 在真实 Windows operator 完成以下流程前保持 OPEN：已知 `0.2.2` 安装版单次安装与正常重启 → 通过 production UI 创建非敏感 sentinel → 完全关闭 → 单次运行 `0.2.3` Setup → 观察 Squirrel `Update.exe` 完成、new-version deployment、root stub、shortcut、old-version directory、实际 `userData` 和 sentinel → 通过正常入口完整重启。该流程现已由专用 profile 完成；credential row 仍只允许观察既有 Desktop authority，不能重新生成、复制、编辑或降级 credential material。

任务指定的既有 `0.2.2` baseline installer 已重新计算并匹配 SHA-256 `80DAA2073B655D22265FFCED5B3D501EE0592E588F4E27D665BACDA3CB7E2932`。真实 adjacent upgrade 的结论只来自下方 operator-attested installed-app evidence，不来自 package、contract、UI 启动或 same-version replacement。

### Phase 2A real acceptance record（2026-08-15）

证据范围：同一台 Windows 机器、专用本地 Windows test user/profile、从 clean profile 安装、同一 application profile；没有复制 `userData`、换账户、换机器或 DPAPI/credential material 操作。记录只保留非敏感版本、生命周期、路径类别和状态事实。

- Known `0.2.2` baseline：clean install、`Program: Finished Squirrel Updater`、`app-0.2.2` launch、实际 `%APPDATA%\\错题复盘` userData 和 production UI sentinel `upgrade-acceptance-2026-08-15` 持久化通过。
- 同一 baseline sequence 中 13:02 发生了一次额外的 same-version `0.2.2` Setup；Squirrel 观察到 existing install、`app-0.2.2` redeployment 和 Finished。该事件记录为 **INCIDENTAL SUCCESSFUL SAME-VERSION REINSTALL OBSERVATION**，不属于 Phase 2A PASS，也不证明一般 same-version reinstall 安全。
- Adjacent upgrade：在 `review-workspace.exe` 与 `Update.exe` 完全退出后，candidate SHA 匹配，`0.2.3` Setup 只运行一次；未杀进程、删目录、改 shortcut、改 userData/journal/ciphertext。Squirrel 检测 existing install、部署 `app-0.2.3`、运行 `cleanDeadVersions`、记录 `Program: Finished Squirrel Updater`，Setup 与 Update 正常退出。
- Binary/lifecycle：root execution stub 仍存在并启动 `app-0.2.3`；旧 `app-0.2.2` 不再存在；`userData` 路径保持 `%APPDATA%\\错题复盘`；sentinel 在升级后和完整关闭/重启后均存在。
- Shortcut：搜索 current-user Start Menu、current-user Desktop、ProgramData Start Menu 和 Public Desktop，以及 Review/错题/review_workspace/review-workspace 名称与 target，未观察到产品 `.lnk`。因此分类为 **NO PRODUCT SHORTCUT OBSERVED / N/A FOR THIS PHASE 2A RECORD**，不是 shortcut PASS，也不是仅因不存在就判 FAIL；shortcut creation/UX 保留为独立 0.8 distribution residual。已验证的 supported launch path 是 Squirrel root execution stub。
- Credential：本轮没有重新输入、测试或修改 credential；Phase 2A credential availability row 保持 **PENDING / NOT EXECUTED**，不冒充 credential upgrade PASS。0.7 Desktop authority、no Web fallback、fail-closed 和 cleanup semantics 保持 COMPLETE/unchanged；该未执行 credential row 不阻塞本次 scoped binary/userData/restart closure。

## Phase 2B — real uninstall/reinstall lifecycle acceptance

状态：**COMPLETE within the scoped closed-app uninstall → same-version `0.2.3` reinstall → same-userData/product-data persistence → full-restart acceptance**（2026-08-15）；`0.8 overall` 仍为 **IN PROGRESS**。

以下真实 Windows lifecycle facts 是用户提供的 **operator-attested evidence**，不是 Codex 在本轮独立重放的 destructive uninstall/reinstall。证据范围限定为同一台 Windows 机器、一个全新的专用本地 profile、一次 clean `0.2.3` Setup、一次应用完全关闭后的正常 Windows uninstall、同一个已核验的 `0.2.3` Setup reinstall 和一次完整普通重启；没有复制 `userData`、手工编辑 IndexedDB、手工删除 install root/userData/registry、kill `Update.exe` 或执行 credential 操作。

### Candidate identity and scope

- Package version：`0.2.3`。
- Installer：`ReviewWorkspace-0.2.3-Windows-x64-Setup.exe`。
- Existing candidate artifact source SHA：`da46193de710fa11b638793eb34401b305a713ae`；这是 installer bytes 的 provenance，不是本轮文档分支的 current `main` SHA。
- Candidate installer SHA-256：`FBC9D0553926BCFBB8634E31E2108FE3BA555FF999389CBB8403BB1A6B084B22`；本地现有 `out/make` artifact 已重新计算并匹配该值，手工验收前仍须对实际携带的 installer 再计算一次。
- Current preparation baseline：`679babea003227b96db12cd9bda988093141f45c`；本轮不修改 package/runtime/Forge identity，因此不生成新的 installer bytes。
- Scope：专用 Windows profile 中，`0.2.3` clean install → production UI sentinel → closed-app normal uninstall → same-version `0.2.3` reinstall → sentinel visibility → full restart。
- Explicitly out of scope：credential-backed reinstall observation、running-app uninstall、newer-version reinstall、signing、SmartScreen、publisher identity、auto-update、GitHub Release 和 destructive interrupted-install injection。

### Phase 2B operator-attested acceptance record（2026-08-15）

- **Fresh profile and artifact identity：PASS。** Preflight observed no `%LOCALAPPDATA%\review_workspace\` install root, `%LOCALAPPDATA%\SquirrelTemp\`, `%APPDATA%\错题复盘\`, `review-workspace` process or `Update` process. The exact installer hash matched `FBC9D0553926BCFBB8634E31E2108FE3BA555FF999389CBB8403BB1A6B084B22`。
- **Clean baseline install：PASS。** One Setup run deployed `app-0.2.3`, created the root execution stub and actual `%APPDATA%\错题复盘\` userData. The first-run process used `--squirrel-firstrun`; the Electron child used `--user-data-dir="%APPDATA%\错题复盘"`; `Update.exe` exited normally. Squirrel recorded `Starting Squirrel Updater: --install .`, `Writing files to app directory ... app-0.2.3`, `Rigging execution stub`, `cleanDeadVersions` and `Program: Finished Squirrel Updater`。
- **Uninstall registration warning：OBSERVED residual。** Both installs logged `Couldn't write uninstall icon, don't care` followed by a `System.Net.WebException`/connection timeout, but both transactions finished normally. The registered entry contained `DisplayName=review-workspace`, `DisplayVersion=0.2.3`, standard `Update.exe --uninstall` and quiet `Update.exe --uninstall -s` commands; `DisplayIcon` was empty. This is an uninstall-icon/distribution-UX residual, not an install failure。
- **Production sentinel and baseline restart：PASS。** The non-sensitive production-UI sentinel `uninstall-reinstall-acceptance-2026-08-15` was created without direct database writes. After a complete close and root-stub relaunch, the original sentinel remained visible。
- **Closed-app standard uninstall：PASS / OBSERVED within scoped lifecycle acceptance。** With the app and `Update.exe` closed, the normal Windows Installed Apps/Squirrel uninstall was invoked once. The product entry and `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\review_workspace` registration disappeared; no review-workspace or Update process remained. The root execution stub was absent and `packages` was absent, while `%APPDATA%\错题复盘\` was preserved。
- **Physical residual：explicitly retained。** After the 30-second observation window, the install root remained with `app-0.2.3\`, `.dead` and `Update.exe`; `.dead` was a one-byte uninstall marker. A small `app-0.2.3` binary residual, including examples such as `v8_context_snapshot.bin` and `squirrel.exe`, remained. Therefore complete physical install-root deletion is **NOT OBSERVED**, and physical binary cleanup is **PARTIAL RESIDUAL OBSERVED**; this is not classified as “clean uninstall”。
- **Squirrel source-backed interpretation。** The installed `electron-winstaller@5.4.4` vendor `Squirrel.exe` reports ProductVersion `2.0.1+eef37460ae` and FileVersion `2.0.1.1`. The upstream [Squirrel 2.0.1 `FullUninstall`](https://github.com/Squirrel/Squirrel.Windows/blob/2.0.1/src/Squirrel/UpdateManager.ApplyReleases.cs#L106-L160) attempts hooks, calls [`DeleteDirectoryOrJustGiveUp`](https://github.com/Squirrel/Squirrel.Windows/blob/2.0.1/src/Squirrel/Utility.cs#L515-L522), recreates the root when absent and writes `.dead`; [`Update.exe` uninstall](https://github.com/Squirrel/Squirrel.Windows/blob/2.0.1/src/Update/Program.cs#L283-L292) removes the registry entry after `FullUninstall` returns. Operator observed registry removal, root-stub removal, `.dead` creation and partial binary residual after the standard closed-app uninstall. This matches the documented Squirrel 2.0.1 full-uninstall marker/residual-tolerant deletion semantics; it does not claim an unobserved internal call stack or perfect binary deletion。
- **Same-version reinstall：PASS。** Residual `.dead`, `app-0.2.3` files and `Update.exe` were not manually removed, and userData was not modified. The same verified Setup ran once, logged `Install path ... already exists, burning it to the ground`, then completed `First run, starting from scratch`, `Writing files to app directory ... app-0.2.3`, stub rigging, `cleanDeadVersions` and `Program: Finished Squirrel Updater`. Afterwards `.dead` was absent, `app-0.2.3`, root stub, `Update.exe` and the same userData were present, and the original sentinel was visible without recreation。
- **Post-reinstall ordinary restart：PASS。** After all processes exited, the root stub launched `app-0.2.3` without `--squirrel-firstrun` or lifecycle arguments; the child still used `%APPDATA%\错题复盘\`, and the original sentinel remained visible。
- **Recreated registration：PASS with UX residual。** `DisplayName`, `DisplayVersion=0.2.3`, standard and quiet uninstall commands were recreated. `DisplayIcon` remained empty and is retained as **MISSING / UX RESIDUAL**。

### Current uninstall implementation audit

| Audit item | Current code fact | Evidence boundary |
| --- | --- | --- |
| `--squirrel-uninstall` | `desktop/main.ts` classifies it through `squirrel-lifecycle.ts` and calls `app.quit()` | Automated source contract; actual Windows uninstall remains manual |
| Early quit order | Lifecycle branch is before `requestSingleInstanceLock()`, `app.whenReady()` and `BrowserWindow` creation | Automated PASS |
| Renderer / packaged runtime | Lifecycle branch does not create a window or call `startDesktopRuntime()`; `app.whenReady()` is only in the normal-launch branch | Automated PASS |
| Protocol registration | `registerDesktopScheme()` runs at module load before classification; it registers the privileged scheme only and does not start renderer/runtime or touch product data | Source audit; no lifecycle result inferred |
| Explicit uninstall hook | No app-side uninstall hook is present | Source audit |
| `electron-squirrel-startup` | Not imported or used | Source audit |
| `Update.exe --uninstall` | Main process does not invoke it; normal Squirrel/Windows uninstall owns that external transaction | Source audit; actual command/process behavior remains manual |
| Shortcut removal | No explicit `removeShortcut`/shortcut bridge is present | Source audit; actual shortcut state is manual/N/A if absent |
| `userData` redirect | No `app.setPath("userData", ...)` or `app.setName(...)`; Electron keeps the existing product identity path | Automated identity contract plus manual path confirmation |
| Uninstall-time data/credential cleanup | Main has no destructive `userData` cleanup or uninstall/reinstall migration path; 0.7 credential cleanup is not called from lifecycle handling | Automated Main-source contract; no claim about Windows filesystem behavior |
| Package/Squirrel identity | `review-workspace` / `错题复盘` / `0.2.3` / `review_workspace` remains stable | Automated package/Forge contract |

默认 ownership contract 仍是：卸载 binary 不等价于删除用户数据。Phase 2B 不增加任何删除 `%APPDATA%\错题复盘`、IndexedDB、Vault、credential record、migration journal、secure key 或 profile 的代码。

### Phase 2B closure matrix

| Row | Final status |
| --- | --- |
| Fresh dedicated profile | PASS |
| Verified `0.2.3` installer hash | PASS |
| `0.2.3` clean install | PASS |
| Production sentinel creation | PASS |
| Baseline full restart | PASS |
| Baseline sentinel persistence | PASS |
| Closed-app standard uninstall | PASS / OBSERVED |
| Uninstall registration removal | PASS / OBSERVED |
| Root execution stub removal | PASS |
| Packages removal | PASS |
| UserData preservation | PASS |
| Complete physical install-root deletion | NOT OBSERVED |
| Squirrel `.dead` marker | OBSERVED |
| Partial binary residual | OBSERVED |
| Same-version post-uninstall reinstall | PASS |
| `.dead` residual recovery | PASS |
| `app-0.2.3` redeployment | PASS |
| Root stub recreation | PASS |
| Same userData path reuse | PASS |
| Original sentinel restored | PASS |
| Full ordinary post-reinstall restart | PASS |
| Original sentinel after restart | PASS |
| Uninstall registration recreated | PASS |
| `DisplayIcon` | MISSING / UX RESIDUAL |
| Credential availability | PENDING / NOT EXECUTED |
| Running-app uninstall | PENDING — SEPARATE MANUAL CASE |
| Shortcut | NO PRODUCT SHORTCUT OBSERVED / N/A |
| Different account/machine | NON-CLAIM |
| Copied userData | NON-CLAIM |
| General DPAPI portability | NON-CLAIM |

### Precise Windows manual acceptance procedure

Use a new disposable local Windows profile such as `ReviewWorkspace-Uninstall`; do not reuse developer, prior upgrade, repeated-Setup or credential-cleanup profiles, and do not copy existing AppData/userData. Record only sanitized facts, status and timestamps.

1. **Preflight.** Record `whoami` and the profile category, then confirm the install root, `SquirrelTemp` and expected product userData are absent and no `review-workspace`/`Update` process is running. Do not publish the username, machine name or full absolute paths.
2. **Verify the artifact.** Run `Get-FileHash ReviewWorkspace-0.2.3-Windows-x64-Setup.exe -Algorithm SHA256` and require the exact candidate hash above. Run Setup once; do not double-click it, kill `Update.exe`, edit `SquirrelTemp`, delete directories or change shortcuts. Wait for first launch, Setup/Update exit and sanitized Squirrel `Finished` evidence.
3. **Create the baseline sentinel.** Through the production UI create the ordinary non-sensitive record `uninstall-reinstall-acceptance-2026-08-15`, with test-only content. Fully close the app, launch through the root stub, and confirm the original sentinel remains visible.
4. **Take the uninstall snapshot.** With the app fully closed and no active Update transaction, record non-sensitive facts: `app-0.2.3`, root stub, `Update.exe`, actual userData existence, sentinel visibility and observable shortcut state. Do not copy userData or read raw IndexedDB/credentials.
5. **Run a normal closed-app uninstall.** Use Windows Settings → Apps → Installed apps → `ReviewWorkspace`/`错题复盘` → Uninstall, or the registered standard Squirrel command. Invoke it once. Observe lifecycle args, Setup/Update processes, root/version directory removal, exit/completion and fatal errors. Do not manually remove the root, registry keys, Update.exe, shortcuts or AppData.
6. **Classify the uninstall result.** After the transaction completes, inspect install-root and userData existence with `Test-Path` and record the actual result. If the root remains, preserve it and classify the exact residual (`.dead`, `Update.exe` and any small version-directory residual) without calling it complete physical deletion. If userData is absent, stop and treat it as a significant product-data contract finding.
7. **Reinstall the same version.** Only after all app/Update processes exit, run the same verified `0.2.3` Setup once. This is post-uninstall same-version reinstall, not Setup over an existing installation. Record deployment, root stub, `Finished`, Setup/Update exit, first launch and fatal errors.
8. **Verify preserved data.** In the production UI find the existing sentinel; do not create a replacement. If missing, classify actual userData path, possible second profile, product identity and initialization/schema error before stopping. Never copy old data back.
9. **Verify full restart.** Fully quit, confirm processes exit, relaunch through the root stub, and confirm `app-0.2.3`, the same userData path, the original sentinel and no residual Update transaction.
10. **Close only observed rows.** Keep credential availability `PENDING / NOT EXECUTED` unless a separate disposable/revocable credential test was truly performed. Keep running-app uninstall as `PENDING — SEPARATE MANUAL CASE` unless safely tested in another fresh profile. Preserve all portability and signing non-claims.

If any critical step fails, preserve sanitized process/log/root/userData/timestamp/hash facts and stop. Do not retry Setup or uninstall, kill Update, delete roots or userData, rebuild the profile, edit registry, copy data or alter credentials. A runtime fix must be a separate PR from evidence closure.

### Automation boundary and stop point

The new desktop lifecycle contract proves only source-level properties: explicit lifecycle classification, early quit before normal app readiness, no renderer/runtime launch from the lifecycle branch, no Main-process destructive `userData` cleanup, and stable package/Forge identity. It cannot prove Windows removal of the install root, preservation of userData, Squirrel transaction completion or sentinel restoration after reinstall.

Static contracts and build/package success do not independently prove Windows lifecycle behavior. The supplied operator-attested sequence now closes only the scoped closed-app standard uninstall → same-version `0.2.3` reinstall → same-userData/product-data persistence → full-restart acceptance. It does not claim complete physical install-root deletion, clean uninstall, credential persistence, running-app uninstall, shortcut UX, signing or portability.

## Current packaging stack

以下版本和路径来自当前 `package.json`、`package-lock.json`、Forge 配置、安装依赖和本地生成 artifact 的审计；installer binary 不进入 Git。

| 项目 | 当前事实 | 证据 / 分类 |
| --- | --- | --- |
| Application package | `review-workspace` / product name `错题复盘` / candidate version `0.2.4` | `package.json`、generated `.desktop-app/package.json` |
| Electron | `43.2.0` | locked dependency；candidate Windows artifact 的 file version 应为 `0.2.4` |
| Electron Forge | `7.11.2` | locked `@electron-forge/cli` 与 maker |
| Maker | `@electron-forge/maker-squirrel` `7.11.2` | `forge.config.ts` 使用 `MakerSquirrel` |
| Windows generator | `electron-winstaller` `5.4.4` | maker optional dependency，lockfile 已解析 |
| Squirrel runtime | `Squirrel.exe` ProductVersion `2.0.1+eef37460ae`，FileVersion `2.0.1.1` | 当前 `electron-winstaller/vendor/Squirrel.exe` 资源版本；不把它误写成应用版本 |
| Setup bootstrapper | `Setup.exe` ProductVersion `1.9.1.0` | 当前 `electron-winstaller/vendor/Setup.exe` 资源版本 |
| Target | Windows x64 | Forge `--arch=x64` 与 `squirrel.windows/x64` |
| Squirrel package id | `review_workspace` | Forge maker 将 `review-workspace` 的连字符替换为下划线 |
| Installer name | `ReviewWorkspace-0.2.4-Windows-x64-Setup.exe` | `forge.config.ts` 的 `setupExe` |
| Forge output | `out/make/squirrel.windows/x64/` | Forge `outDir: "../out"` |
| Package outputs | `RELEASES`、`review_workspace-0.2.4-full.nupkg`、Setup.exe | candidate make artifact shape |
| Signing | **PENDING**；没有 production certificate、publisher identity 或 CI signing secret contract | 不声称 signed PASS |

### Packaging flow

```text
package.json + .desktop-app/package.json
        ↓
Next standalone + desktop:compile
        ↓
Forge packager: review-workspace.exe + resources/app.asar + .desktop-runtime
        ↓
MakerSquirrel / electron-winstaller
        ↓
RELEASES + full.nupkg + ReviewWorkspace-<version>-Windows-x64-Setup.exe
        ↓
Squirrel Setup.exe / Update.exe
        ↓
%LOCALAPPDATA%\review_workspace\app-<version>\
```

`out\review-workspace-win32-x64\` 是 Forge 的 unpacked application artifact，不是用户安装后的 Squirrel root。安装后的 root、versioned `app-<version>` directory、root execution stub、`Update.exe`、`SquirrelTemp` 和 shortcuts 必须在隔离的真实 Windows profile 中分别观察，不能从 unpacked artifact 推断。

当前 `desktop-release.yml` 只在 Windows x64 runner 上执行 make、preload artifact regression、Squirrel package metadata regression 和 SHA-256 manifest；手动运行上传短期 workflow artifact，`v*` tag 运行还会发布 installer 与 `SHA256SUMS.txt`。当前没有自动更新入口，也没有把裸 `review-workspace.exe` 作为 release asset 发布。

## 0.8 Squirrel no-remote-icon bridge（2026-08-20）

状态：**SOURCE FIX IMPLEMENTED；GENERATED PACKAGE AND REAL WINDOWS OFFLINE ACCEPTANCE REQUIRED；installer migration feasibility remains ACTIVE**。

### Root cause

`electron-winstaller@5.4.4` 在没有显式覆盖时会把 Electron GitHub 的远程 `iconUrl` 写入默认 nuspec template。历史 `0.2.3` nupkg 因此包含，现已因该 installer-time remote icon retrieval 问题失效：

```text
https://raw.githubusercontent.com/electron/electron/main/shell/browser/resources/win/electron.ico
```

Squirrel.Windows `2.0.1` 的 `CreateUninstallerRegistryEntry()` 先创建 uninstall registry key，然后在 `IconUrl != null` 时等待下载和转换图标，之后才写入 `DisplayName`、`DisplayVersion`、`InstallLocation`、`UninstallString` 和其他普通值。2026-08-20 的真实 Windows 记录观察到 `Update.exe --install` 在该路径长期存活、拥有外部 HTTPS 连接，且 `Program: Finished Squirrel Updater` 未出现；此前 Phase 2B 也观察到 `Couldn't write uninstall icon, don't care`、HTTP timeout 和空 `DisplayIcon`。

### Source fix

本 bridge 已由 PR #91 合并到当前 `main`（source baseline `4a08bf2…`）。它在 [scripts/squirrel.nuspec.template](../scripts/squirrel.nuspec.template) 中逐项保留当前已安装 `electron-winstaller@5.4.4` 模板的 metadata/files 行为，但完全省略 `<iconUrl>`；[forge.config.ts](../forge.config.ts) 通过受支持的 `nuspecTemplate` 选项引用该 checked-in template。PR #90 已关闭且未合并；本候选不复用其分支或结论。

这不是 `iconUrl: ""`、`iconUrl: null`、`file:` URL、另一个远程 URL 或 vendor fork。预期结果是 Squirrel 的 `IconUrl` 为空/缺失，从而跳过 installer-time icon download；卸载注册中的 `DisplayIcon` 不再作为产品保证，普通 uninstall registry values 不应再被该远程请求阻塞。

### Scope and non-claims

- 这是一个 **short-term Squirrel bridge**，不是 installer framework migration；NSIS/electron-builder 不在本任务中实现。
- 不修改 package/application identity、版本、runtime、userData、Dexie、credential authority/storage/cleanup、preload/IPC、protocol、single-instance、Electron fuses/security、signing、release/tag 或 auto-update。
- 静态 contract 和 generated nupkg metadata 可以证明 source/package 不含 `<iconUrl>`；它们不能证明真实 Windows offline install、running-app uninstall、credential availability、DPAPI portability 或 Phase 2C。
- 历史 `0.2.3` candidate 仅保留既有 lifecycle evidence，不再作为 no-remote-icon bridge 验收候选；它受 installer-time remote icon retrieval 影响而失效。
- `0.2.4` 是新的 bridge acceptance candidate，目标仅为真实 Windows fresh/offline/GitHub-unreachable clean-install baseline；source-level/generated-package evidence 不能替代真实 Windows acceptance。
- 真实 Windows acceptance 仍为 **PENDING**；本候选不声称 clean install、offline install、running-app uninstall、credential/DPAPI、signing 或 production readiness PASS。

### 0.2.4 bridge acceptance candidate and operator procedure

候选必须从 clean、已提交的 task-branch HEAD 生成，并记录该 exact source SHA。预期 artifact identity 为：

- Installer：`ReviewWorkspace-0.2.4-Windows-x64-Setup.exe`。
- Full package：`review_workspace-0.2.4-full.nupkg`。
- Package identity：`review_workspace`；Electron：`43.2.0`；Windows target：x64。
- `RELEASES`、full `.nupkg` 和 Setup.exe 的实际 byte size/SHA-256 必须从生成文件记录。

Source contracts 和 generated `.nupkg` metadata 只能证明 checked-in bridge 与生成包不含 `<iconUrl>` 及旧 Electron GitHub icon URL；它们不是 real-Windows acceptance。下一轮人工验收只执行以下窄范围：

1. 使用全新的 disposable Windows local user/profile；预检没有 `review_workspace` install root、`SquirrelTemp`、`Update.exe`、应用进程或既有产品数据。
2. 对实际携带的 `ReviewWorkspace-0.2.4-Windows-x64-Setup.exe` 重新计算 SHA-256，并与候选记录一致。
3. 在运行 Setup 前禁用网络，或明确验证 `raw.githubusercontent.com` 不可达；保留只含非敏感目标/状态的网络证据。
4. Setup **只运行一次**。等待 Setup、`Update.exe`、Squirrel transaction 和相关子进程全部退出；Squirrel log 必须达到 `Program: Finished Squirrel Updater`。
5. 验证 uninstall registration 已完成：`DisplayName`、`DisplayVersion=0.2.4`、`InstallLocation`、`UninstallString`、`QuietUninstallString`。
6. 通过网络/进程观察确认安装期间没有连接旧的 Electron GitHub icon URL；不得用 package metadata 把此项写成 real-Windows PASS。
7. 首次启动应用，确认 child runtime 使用预期 `%APPDATA%\错题复盘`。
8. 通过 production UI 创建一个 sanitized、非敏感 sentinel；完成一次普通完整关闭和重新启动，确认 sentinel 仍存在。

任一步失败都必须停止并保留脱敏的 installer hash、Squirrel log、进程退出和路径类别证据；不得重试 Setup、手工清理 install root/userData/registry、修改 shortcut 或执行 destructive uninstall。该首轮候选不包含 running-app uninstall；结论仍为 **REAL WINDOWS OFFLINE CLEAN-INSTALL ACCEPTANCE REQUIRED**。

## Install root and userData ownership

### Binary ownership

`MakerSquirrel({ name: "review_workspace" })` 是 Squirrel identity。当前安装 root 的预期位置是：

```text
%LOCALAPPDATA%\review_workspace\
├─ Update.exe
├─ RELEASES
├─ review-workspace.exe       # Squirrel root execution stub
└─ app-<version>\             # versioned deployed application
```

这是当前 package/config 和 Squirrel model 推导出的 install-root contract；clean first-install 记录证明安装完成，但没有把本机绝对路径作为公开 evidence。后续真实 acceptance 必须在专用 profile 中确认 root、stub target、`Update.exe`、`SquirrelTemp` 和 old-version cleanup。

### `userData` ownership

当前 `main.ts` 不调用 `app.setPath("userData", ...)` 或 `app.setName(...)`，也不把 `userData` 放入 install root。Electron 默认 userData 由 application name 派生；package/product identity 和既有同机实机观察对应的预期路径是：

```text
%APPDATA%\错题复盘\
```

该路径是当前 userData expectation，不是跨机器、跨账户或复制 profile 的 portability guarantee。每次真实安装版 acceptance 都必须读取实际 `app.getPath("userData")` 或通过不含秘密的诊断记录确认，不得只凭目录名称猜测。

| 资产 | owner | upgrade contract | uninstall/reinstall contract |
| --- | --- | --- | --- |
| `app-<version>` binaries、resources、execution stub | Squirrel distribution | 可被新版本替换；old version cleanup 需单独观察 | 属于 install lifecycle；不等价于用户数据 |
| IndexedDB、Electron session data、Vault/config 等产品数据 | Electron `userData` / shared repositories | binary replacement 不应自动删除或重建 | 默认保留，除非未来有明确产品语义和用户授权；Phase 1 不加 destructive cleanup |
| Desktop credential records / 0.7 authority | 0.7 credential boundary | 0.8 只能观察 upgrade 后可用性，不能改变 authority 或 fallback | 不从 installer convenience 推导可恢复性；DPAPI portability 不声明 |
| installer metadata、`RELEASES`、Squirrel logs | Squirrel / distribution tooling | 不作为产品事实源 | 不应被当作用户数据恢复源 |

当前产品 contract 是“binary lifecycle 与 userData lifecycle 分离”。覆盖升级不得隐式清空 `userData`；本轮 operator-attested Squirrel acceptance 已确认 closed-app standard uninstall 保留 `userData`，同时留下 `.dead`、`Update.exe` 和小型 version-directory residual，因此不写 complete install-root deletion PASS。本阶段不添加卸载清理，也不把“重装后能启动”写成“凭据可恢复”。

## Squirrel lifecycle process model

`desktop/main.ts` 在注册稳定 protocol scheme 后立即分类 lifecycle args；四类 lifecycle invocation 在 request single-instance lock、`app.whenReady()` 和 `BrowserWindow` 创建前调用 `app.quit()`。因此 lifecycle helper 不会创建 renderer，也不会启动 packaged Next runtime。

| invocation | 当前处理 | renderer / runtime | Phase 1 classification |
| --- | --- | --- | --- |
| `--squirrel-install` | early quit | 不启动 | AUTOMATED PASS |
| `--squirrel-updated` | early quit | 不启动 | AUTOMATED PASS |
| `--squirrel-uninstall` | early quit；无 userData cleanup | 不启动 | AUTOMATED PASS；closed-app standard uninstall operator-observed within scoped acceptance；running-app uninstall PENDING |
| `--squirrel-obsolete` | early quit | 不启动 | AUTOMATED PASS |
| `--squirrel-firstrun` | 不属于 lifecycle quit args，走正常启动 | 可以创建正常窗口/runtime | AUTOMATED PASS；真实 first run CURRENTLY PASS |
| ordinary launch | `requestSingleInstanceLock()`；second instance focus existing window | 正常启动 | existing behavior；real lifecycle matrix 保留 |

Squirrel's `--squirrel-install` / `--squirrel-updated` normally owns shortcut and first-run orchestration. 本项目当前 custom handling 没有调用 `electron-squirrel-startup`，也没有显式 `--createShortcut` / `--removeShortcut` bridge；因此 Start Menu/Desktop shortcut 是否存在、stale shortcut 是否指向 current stub，必须通过真实安装版观察，不能从代码推断 PASS。不要把快捷方式永久改成直指 `app-<version>` exe 作为 workaround。

## Distribution and lifecycle threat model

### Assets

- installer、full `.nupkg`、`RELEASES` 和 release checksum；
- Squirrel root/stub、versioned application directory、ASAR 和 bundled standalone runtime；
- Electron `userData` 中的学习事实、IndexedDB、Vault/config、session data 和 0.7 credential state；
- installer/package/source/version/architecture/publisher provenance；
- lifecycle invocation 与 Squirrel-generated shortcuts。

### Trust boundaries

1. Git commit / CI runner → Forge staging and Squirrel output；
2. `Setup.exe` / `Update.exe` → `%LOCALAPPDATA%\review_workspace`；
3. versioned binaries → Electron `userData`；
4. Squirrel lifecycle args → Electron Main；
5. unsigned or signed release asset → user-controlled Windows installation。

### Threats and required controls

| threat | required control |
| --- | --- |
| Wrong version, wrong asset or checksum mismatch | package version/tag check、installer filename、source SHA、SHA-256 manifest；不从聊天或文件名猜 provenance |
| Installer tampering / unknown publisher | production Authenticode identity、timestamp、publisher verification 和 post-sign hash；没有证书时保持 PENDING |
| Overlapping same-version Setup locks files | 不重复运行开发者 profile；使用 disposable profile；把 observed lock/transaction failure 限定为 diagnostic，不宣称 reinstall safe |
| Upgrade deletes or reinitializes data | binary root 与 `userData` 分离；upgrade 前后检查 schema/data/credential authority；不自动 schema migration |
| Uninstall deletes user facts or credentials | Phase 1 不实现 uninstall cleanup；先确定真实 Squirrel behavior，再由产品语义和用户授权决定 |
| Stale shortcut or old execution stub | observe root stub、shortcut target、`app-<version>` cleanup；不永久绕过 Squirrel stub |
| Lifecycle arg reaches renderer | direct argument contract；early quit before lock/window/runtime |
| Distribution work weakens Electron boundary | 保持 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`、`webSecurity=true`、ASAR integrity/fuses；不使用 `--no-sandbox` 或 insecure-content bypass |
| DPAPI / userData portability overclaim | same-machine/user/profile restart is scoped evidence only；copied userData、different account/machine、general portability remain NON-CLAIM |

## Installer identity and provenance contract

每一个 future candidate/release 都应能由非敏感 manifest 或 CI record 回答：

| field | Phase 1 contract |
| --- | --- |
| package version | `package.json.version`；tag 必须等于 `v<version>` |
| source commit | CI `github.sha` / local build `git rev-parse HEAD`；不把未验证的 local artifact 当 release |
| Electron / Forge / maker | locked package versions |
| installer filename | `ReviewWorkspace-<version>-Windows-x64-Setup.exe` |
| SHA-256 | `SHA256SUMS.txt` 与实际 installer bytes 一致 |
| architecture | Windows x64 |
| Squirrel identity/version | `review_workspace`；vendor runtime version recorded separately from app version |
| signing status | `unsigned / production signing not configured` until certificate and signature verification exist |
| publisher identity | current metadata `Private` is not a trusted production publisher; future certificate subject must be verified |
| CI provenance | workflow run, source SHA, runner and retention; no secret, path, profile or credential data |
| user/profile data | **never** included in artifact metadata |

Phase 1 adds deterministic contracts for the package identity, Forge maker/output, lifecycle classification and existing artifact checks. Formal signed manifest, certificate secret ownership, timestamping and release promotion remain Phase 2+ work.

## Acceptance and rollback procedure

All real installer procedures require a dedicated Windows x64 user/profile and a disposable/revocable test credential. Do not repeatedly launch Setup in the developer profile. Do not put credentials, full URLs, local paths, raw exceptions or user identity into evidence.

1. Build from a known source SHA with Node 22; record version, installer filename, architecture, maker, Squirrel version, SHA-256 and signing status.
2. For clean install, confirm no existing app root, `SquirrelTemp`, `Update.exe` or process; launch Setup once; observe normal Squirrel completion, first run and process exit.
3. For adjacent-version acceptance, install `0.2.2`, fully close the app, then install the separately built `0.2.3` candidate. Check new `app-<version>`, root stub, shortcuts, old-version cleanup, launch, data and credential authority. Do not fabricate this row before the real adjacent upgrade is observed.
4. For uninstall/reinstall, record whether only install root or also `userData` is removed. If `userData` remains, verify schema/data handling and keep credential recovery semantics scoped to the same Windows user/machine/profile.
5. For interruption/corruption, use only a future safe test seam or controlled fixture. Random process kill, manual `userData`/journal/ciphertext edits, DPAPI destruction, ASAR patching and destructive profile surgery are not acceptance methods.
6. If a candidate fails, preserve the evidence and use the last known installer with the same userData boundary. Rollback must not delete or rewrite userData; no automatic rollback is implied by this document.

## Current non-claims

- adjacent-version overwrite upgrade is **PASS within the same-machine, same-Windows-user, same-application-profile scope** recorded above; it is not portability evidence;
- the incidental same-version `0.2.2` Setup observation is not a general same-version reinstall safety claim;
- no product shortcut was observed; shortcut creation/UX remains a separate distribution residual, while the root execution stub path passed;
- running-app upgrade, uninstall while closed/running and uninstall + reinstall are not yet real PASS;
- production code signing, publisher identity and signed SmartScreen behavior are not PASS;
- formal release asset promotion/provenance beyond current filename/checksum workflow is not PASS;
- copied `userData`, changed Windows account/machine and general DPAPI portability are NON-CLAIM;
- corrupted/partial/interrupted installed-app recovery is NOT SAFE TO INJECT / NON-CLAIM until a safe seam exists;
- Phase 2A credential availability after upgrade was not executed and remains PENDING; no installer behavior is evidence that 0.7 credential security has changed.
