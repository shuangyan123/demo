# Windows Desktop Distribution / Lifecycle Contract

状态：**0.8 Phase 1 COMPLETE；0.8 overall IN PROGRESS**（2026-08-14）。

本文件建立 Windows x64 分发、生命周期和 `userData` 的 ownership contract。它不重新设计或削弱 0.7 的 Desktop authority、no Web fallback、fail-closed、context binding、source retention 或 credential cleanup ordering。0.7 的安全语义仍由既有实现、contract 和已归档的 scoped installed-app evidence 所拥有。

## Phase 1 boundary

Phase 1 交付：

- 当前 Forge/Squirrel packaging 链、输出形状和生命周期调用链审计；
- binary root 与 Electron `userData` 的独立 ownership contract；
- Squirrel 参数分类、package identity、artifact shape 和 security baseline 的 automated contract；
- 0.8 lifecycle acceptance matrix、隔离 Windows 手工流程、签名和 release asset 的前置边界；
- clean first-install evidence 和 repeated same-version Setup diagnostic 的准确分类。

本阶段不实施：installer framework migration、auto-update、destructive uninstall cleanup、schema migration、credential migration/重构、production signing 或正式 release promotion。

## Current packaging stack

以下版本和路径来自当前 `package.json`、`package-lock.json`、Forge 配置、安装依赖和本地生成 artifact 的审计；installer binary 不进入 Git。

| 项目 | 当前事实 | 证据 / 分类 |
| --- | --- | --- |
| Application package | `review-workspace` / product name `错题复盘` / version `0.2.2` | `package.json`、`.desktop-app/package.json` |
| Electron | `43.2.0` | locked dependency；当前 Windows artifact 的 file version 为 `0.2.2` |
| Electron Forge | `7.11.2` | locked `@electron-forge/cli` 与 maker |
| Maker | `@electron-forge/maker-squirrel` `7.11.2` | `forge.config.ts` 使用 `MakerSquirrel` |
| Windows generator | `electron-winstaller` `5.4.4` | maker optional dependency，lockfile 已解析 |
| Squirrel runtime | `Squirrel.exe` ProductVersion `2.0.1+eef37460ae`，FileVersion `2.0.1.1` | 当前 `electron-winstaller/vendor/Squirrel.exe` 资源版本；不把它误写成应用版本 |
| Setup bootstrapper | `Setup.exe` ProductVersion `1.9.1.0` | 当前 `electron-winstaller/vendor/Setup.exe` 资源版本 |
| Target | Windows x64 | Forge `--arch=x64` 与 `squirrel.windows/x64` |
| Squirrel package id | `review_workspace` | Forge maker 将 `review-workspace` 的连字符替换为下划线 |
| Installer name | `ReviewWorkspace-0.2.2-Windows-x64-Setup.exe` | `forge.config.ts` 的 `setupExe` |
| Forge output | `out/make/squirrel.windows/x64/` | Forge `outDir: "../out"` |
| Package outputs | `RELEASES`、`review_workspace-0.2.2-full.nupkg`、Setup.exe | 当前本地 make artifact shape |
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

当前 `desktop-release.yml` 只在 Windows x64 runner 上执行 make、preload artifact regression 和 SHA-256 manifest；手动运行上传短期 workflow artifact，`v*` tag 运行还会发布 installer 与 `SHA256SUMS.txt`。当前没有自动更新入口，也没有把裸 `review-workspace.exe` 作为 release asset 发布。

## Install root and userData ownership

### Binary ownership

`MakerSquirrel({ name: "review_workspace" })` 是 Squirrel identity。当前安装 root 的预期位置是：

```text
%LOCALAPPDATA%\review_workspace\
├─ Update.exe
├─ RELEASES
├─ review-workspace.exe       # Squirrel root execution stub
└─ app-0.2.2\                 # versioned deployed application
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

当前产品 contract 是“binary lifecycle 与 userData lifecycle 分离”。覆盖升级不得隐式清空 `userData`；卸载是否只删除 install root、是否留下 `userData`，必须用真实 Squirrel uninstall acceptance 确认后再更新为 PASS。本阶段不添加卸载清理，也不把“重装后能启动”写成“凭据可恢复”。

## Squirrel lifecycle process model

`desktop/main.ts` 在注册稳定 protocol scheme 后立即分类 lifecycle args；四类 lifecycle invocation 在 request single-instance lock、`app.whenReady()` 和 `BrowserWindow` 创建前调用 `app.quit()`。因此 lifecycle helper 不会创建 renderer，也不会启动 packaged Next runtime。

| invocation | 当前处理 | renderer / runtime | Phase 1 classification |
| --- | --- | --- | --- |
| `--squirrel-install` | early quit | 不启动 | AUTOMATED PASS |
| `--squirrel-updated` | early quit | 不启动 | AUTOMATED PASS |
| `--squirrel-uninstall` | early quit；无 userData cleanup | 不启动 | AUTOMATED PASS；真实 uninstall PENDING |
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
3. For adjacent-version acceptance, install `0.2.2`, fully close the app, then install a separately built `0.2.3`/`0.3.x` candidate. Check new `app-<version>`, root stub, shortcuts, old-version cleanup, launch, data and credential authority. Do not fabricate this row before a real adjacent build exists.
4. For uninstall/reinstall, record whether only install root or also `userData` is removed. If `userData` remains, verify schema/data handling and keep credential recovery semantics scoped to the same Windows user/machine/profile.
5. For interruption/corruption, use only a future safe test seam or controlled fixture. Random process kill, manual `userData`/journal/ciphertext edits, DPAPI destruction, ASAR patching and destructive profile surgery are not acceptance methods.
6. If a candidate fails, preserve the evidence and use the last known installer with the same userData boundary. Rollback must not delete or rewrite userData; no automatic rollback is implied by this document.

## Current non-claims

- adjacent-version overwrite upgrade is not yet a real PASS;
- uninstall while closed/running and uninstall + reinstall are not yet real PASS;
- stale shortcut, execution-stub retargeting and old `app-<version>` cleanup are not yet real PASS;
- production code signing, publisher identity and signed SmartScreen behavior are not PASS;
- formal release asset identity beyond current filename/checksum workflow is not PASS;
- copied `userData`, changed Windows account/machine and general DPAPI portability are NON-CLAIM;
- corrupted/partial/interrupted installed-app recovery is NOT SAFE TO INJECT / NON-CLAIM until a safe seam exists;
- no installer behavior is evidence that 0.7 credential security has changed.
