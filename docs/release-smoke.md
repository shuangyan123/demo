# 发布前手工冒烟清单

> **Current M5 policy:** Windows production-v1 is intentionally unsigned.
> Code signing, publisher identity, certificate timestamping/rotation, and
> SmartScreen reputation are not production-v1 blockers. Historical matrices
> below retain their original unsigned/non-claim evidence boundaries. The
> current release policy and remaining blockers are defined in
> [`windows-production-v1-release-policy.md`](windows-production-v1-release-policy.md).

当前 canonical release workflow 是
`.github/workflows/trusted-desktop-release.yml`：它由成功的 `CI` main
`workflow_run` 驱动，并创建待人工确认的 Draft Release。历史
`.github/workflows/desktop-release.yml` 已从当前 tree 删除，GitHub Actions
API 当前状态为 `deleted`，仅保留为 SEC-04 历史证据。当前 runtime 为
Electron `43.4.1`；生产/default installer 仍是 Forge/MakerSquirrel Squirrel，
NSIS 仍是 candidate/future cutover；production-v1 不引入 updater。现有
workflow 的 final-byte SHA-256/manifest 生成只完成部分边界，完整的
exact-SHA Draft round-trip 仍是 M5 blocker。

## Current 2026-08-20 · 0.8 Squirrel no-remote-icon bridge acceptance closure

状态：**0.2.4 REAL WINDOWS OFFLINE CLEAN-INSTALL BASELINE: PASS**（用户提供的 operator-attested evidence，限于本节 scope）。历史 `0.2.3` candidate 因 installer-time remote icon retrieval 失效，仅保留既有 operator-attested lifecycle evidence；PR #90 已关闭且未合并，PR #91 的 checked-in no-remote-icon bridge 已合并。该 PASS 不来自 source/package 自动证据，也不是 Codex 本轮重新执行的 independent replay。

- Installer：`ReviewWorkspace-0.2.4-Windows-x64-Setup.exe`；source SHA：`1c41e53488fe8b4427d1c78831e3b524a114a2da`；SHA-256：`2A28CB47E3485DC2D67CEE80ED2208E705607452372A0C34B1FC323E186626EE`。
- Full package：`review_workspace-0.2.4-full.nupkg`；Squirrel identity：`review_workspace`；Windows x64。
- 生成前记录 clean committed task-branch HEAD 的 exact source SHA；生成后记录 Setup.exe、full `.nupkg` 和 `RELEASES` 的 byte size/SHA-256。
- 必须确认 generated `.nupkg` 无 `<iconUrl>` 且无旧 Electron GitHub icon URL；不得以 `iconUrl` 空值、`file:` 或其他 URL 代替 bridge。
- Operator-attested record：fresh profile preflight、candidate hash、GitHub Raw/general network unreachable、single Setup、Squirrel `Program: Finished Squirrel Updater`、normal uninstall registration、first launch、bundled runtime、预期 `%APPDATA%\错题复盘` userData、production-UI sentinel、normal close、root-stub restart 和 sentinel persistence 均 **PASS**。
- `DisplayIcon` 为空，分类为 **EMPTY / EXPECTED BRIDGE UX RESIDUAL**；不把它写成安装失败。该记录没有重试 Setup、执行 uninstall 或测试 credential/DPAPI。
- Running-app uninstall、closed-app uninstall、reinstall、credential/DPAPI、signing、SmartScreen、production readiness、auto-update、不同账户/机器、copied userData 和 NSIS/electron-builder M0 继续保持 **PENDING / NON-CLAIM**；installer migration feasibility 仍 ACTIVE，Squirrel 仍是 temporary bridge。
- 任何后续验收失败都停止并保留脱敏证据；完整 procedure 与边界见 [`docs/windows-desktop-distribution.md`](windows-desktop-distribution.md)。

## Current 2026-08-15 · 0.8 Windows Distribution Phase 2B scoped closure

状态：**COMPLETE within the scoped closed-app uninstall → same-version `0.2.3` reinstall → same-userData/product-data persistence → full-restart acceptance**；`0.8 overall` 仍为 **IN PROGRESS**。以下真实 Windows lifecycle facts 是用户提供的 **operator-attested evidence**，不是 Codex 在本轮独立重放的 destructive uninstall/reinstall。详细 audit、Squirrel source interpretation 和边界见 [`docs/windows-desktop-distribution.md`](windows-desktop-distribution.md)。

### Candidate identity

- Package：`0.2.3`；Squirrel identity：`review_workspace`；Windows x64。
- Installer：`ReviewWorkspace-0.2.3-Windows-x64-Setup.exe`。
- Artifact source SHA：`da46193de710fa11b638793eb34401b305a713ae`；installer SHA-256：`FBC9D0553926BCFBB8634E31E2108FE3BA555FF999389CBB8403BB1A6B084B22`。
- Vendor runtime recheck：`electron-winstaller@5.4.4` 的 `Squirrel.exe` ProductVersion `2.0.1+eef37460ae`、FileVersion `2.0.1.1`；本轮未修改 runtime/package/Forge identity，不生成新 installer。

### Phase 2B final closure matrix

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

### Operator-attested evidence notes

- Fresh preflight found no `%LOCALAPPDATA%\review_workspace\`, `%LOCALAPPDATA%\SquirrelTemp\`, `%APPDATA%\错题复盘\` or product/Update process; the exact installer hash matched.
- One clean Setup completed with `Starting Squirrel Updater: --install .`, `Writing files to app directory ... app-0.2.3`, root-stub rigging, `cleanDeadVersions` and `Program: Finished Squirrel Updater`; the first-run process used `--squirrel-firstrun` and the child used `--user-data-dir="%APPDATA%\错题复盘"`.
- The production UI created `uninstall-reinstall-acceptance-2026-08-15`; the original sentinel survived the baseline root-stub restart, the closed-app uninstall, same-version reinstall and the later full ordinary restart without recreation.
- Two installs observed `Couldn't write uninstall icon, don't care` plus a connection-timeout exception; both finished. The uninstall entry was present with standard/quiet commands, but `DisplayIcon` was empty.
- The standard closed-app uninstall removed the product registration and root execution stub, and removed `packages`, while preserving userData. It left the physical root with `app-0.2.3`, `.dead` and `Update.exe`; small binary residual was observed. This is **NOT** a clean uninstall or complete root deletion claim.
- The same verified Setup then logged `Install path ... already exists, burning it to the ground`, removed `.dead`, redeployed `app-0.2.3`, recreated the root stub and reused the same userData. A full ordinary restart launched without lifecycle arguments and restored the original sentinel.

### Safe evidence boundary

The accepted sequence was one fresh-profile Setup, one closed-app normal Windows uninstall, one same-version Setup and one full restart. Do not manually delete residual files, registry, shortcuts, AppData or credentials, and do not rerun the destructive case as part of this docs closure. Credential availability remains `PENDING / NOT EXECUTED`; running-app uninstall remains `PENDING — SEPARATE MANUAL CASE`; different account/machine, copied userData and general DPAPI portability remain `NON-CLAIM`.

Any future failure must preserve sanitized process/log/root/userData/timestamp/hash facts and stop. A runtime fix for the observed Squirrel residual would require a separate PR.

## Current 2026-08-14 · 0.7 Windows Credential Cleanup Closure

状态：**0.7 COMPLETE within the 0.7-owned closure contract**。本节归档 2026-08-14 的 operator-attested、human-observed Windows installed-app evidence；证据范围是同一台 Windows 机器、专用本地 Windows 测试用户/profile、同一 application profile，以及由该 profile 执行的同一安装包。它关闭了 real Credential Cleanup 这一 0.7 blocking item，但不扩大为跨机器、跨账户、复制 `userData` 或一般 DPAPI portability 证明。

### Build identity and evidence boundary

- Source commit：`73755341834249b1453ccd57a20787b16c3f3621`
- Installer：`ReviewWorkspace-0.2.2-Windows-x64-Setup.exe`
- SHA-256：`80DAA2073B655D22265FFCED5B3D501EE0592E588F4E27D665BACDA3CB7E2932`
- Application：`0.2.2`
- Electron：`43.2.0`
- Environment：same Windows machine; dedicated local Windows test user/profile; dedicated application profile; no copied existing `userData`
- Credential：disposable/revocable test credential；未记录 plaintext、token、provider response body、密文或本地用户名/路径
- Evidence type：operator-attested installed-app observation；本轮没有把聊天内容伪装成 screenshot/log artifact，也没有在仓库提交 installer 或运行数据

### Real Credential Cleanup — operator-attested installed-app evidence

Pre-cleanup physical state and product gate:

- Desktop migration：complete；authority：`desktop_preferred`
- Desktop credential protection：available/complete；Desktop records：preserved and recoverable
- Retained Web material：`3` credentials across `3` retained sources；shared Web key：present
- Cleanup review：fresh review completed；state reached `awaiting_confirmation`
- Irreversible acknowledgement：unchecked state kept the destructive action unavailable until explicit user acknowledgement
- DeepSeek and MiniMax saved connections：verified before cleanup

Destructive action and result:

- User completed the irreversible-consequence acknowledgement and clicked the production UI `Confirm and clean` action.
- No storage, `userData`, journal, ciphertext, key, or test-only executor was manually edited or invoked.
- Cleanup status：`complete`
- Final physical reconciliation：`0` credentials across `0` retained sources; no legacy JWK; shared Web key absent
- Desktop records and migration authority remained unchanged
- Observed transition: retained Web sources `3 → 0`; shared Web key `present → absent`

### Post-cleanup restart and provider operation

- Same installed app, same Windows test user/profile, same application profile was fully quit and restarted.
- Cleanup remained `complete`; final reconciliation remained `0` retained sources with the shared Web key absent.
- DeepSeek connection test：PASS
- MiniMax connection test：PASS
- No Web credential source or shared Web key regeneration was observed after restart or either credential-backed operation.
- This is an observed no-regeneration result within the stated acceptance scope, not a universal runtime guarantee. The broader no-fallback semantics remain jointly supported by the deterministic fail-closed contracts below.

### Supplementary clean first-install evidence

A new local Windows test user/profile was used after the earlier profile had experienced repeated same-version Squirrel Setup attempts. Before installation, the profile had no existing application directory, `SquirrelTemp`, `Update.exe`, or ReviewWorkspace process. The same installer and SHA-256 above were launched once; Squirrel completed normally, the first-run Electron process and children started, and `Update.exe`/`Setup.exe` exited normally.

- Clean first install：PASS — supplementary operator-attested evidence
- Squirrel installer normal completion：PASS
- First-run Electron launch：PASS
- Ownership remains unchanged: clean-machine installation, adjacent-version upgrade, uninstall/reinstall, signing, release assets, and distribution-owned lifecycle remain **DEFERRED TO 0.8**.

Repeated or overlapping execution of the same-version Squirrel Setup in an already-installed profile previously produced file-lock/install-transaction failures. That bounded diagnostic observation was not reproduced in the clean single-run first installation and is not evidence of a clean first-install failure. It does not establish that same-version reinstall or all installer lifecycle flows are universally safe.

### 0.7-owned closure matrix

| 0.7 item | Evidence source | Closure classification |
| --- | --- | --- |
| Explicit Web → Desktop migration/cutover | Prior real installed-app record plus 2026-08-14 pre-cleanup state | PASS — real installed evidence |
| Desktop authority and migration persistence | Desktop-preferred state, preserved authority, preserved Desktop records, restart observation | PASS — real installed evidence within scope |
| Credential-backed operation before/after cleanup | DeepSeek and MiniMax connection tests | PASS — operator-attested real installed evidence |
| No Web fallback / fail-closed semantics | Existing deterministic contracts; no material regeneration observed after cleanup | PASS — automated evidence plus scoped real observation; not a global runtime claim |
| Context binding and substitution rejection | Existing deterministic contracts | PASS — automated/deterministic evidence |
| Source retention before cleanup | Physical inventory observed 3 retained sources before confirmation | PASS — operator-attested real installed evidence |
| Fresh inventory, confirmation binding, and Desktop revalidation | Fresh review, acknowledgement gate, completed production UI flow | PASS — operator-attested real installed evidence plus contracts |
| Legacy-v1 conditional blocker | Cleanup eligibility contracts; completed physical cleanup had zero retained sources and no legacy JWK | PASS — deterministic blocker semantics plus scoped aggregate observation |
| Source-before-key ordering and shared Web key last | Existing executor/order contracts; final physical reconciliation | PASS — automated/deterministic ordering evidence plus scoped real result |
| Final physical reconciliation | 3 sources → 0; no legacy JWK; shared Web key absent | PASS — operator-attested real installed evidence |
| Migration authority and Desktop records preserved | Post-cleanup reconciliation and restart state | PASS — operator-attested real installed evidence |
| Post-cleanup restart | Full quit/restart with cleanup still complete | PASS — operator-attested real installed evidence |
| No credential-material regeneration | Restart and DeepSeek/MiniMax operations | PASS — operator-attested within same profile scope |
| Privacy and secret-handling discipline | No plaintext/secret in evidence; prior privacy contracts/observation | PASS — automated plus operator-attested evidence |
| Production dependency audit | `high=0`, `critical=0` on merged source baseline | PASS — automated evidence |
| Required cleanup/migration/architecture contracts | Existing contract suite and desktop gates | PASS — automated evidence |

### Remaining rows and ownership

| Row | Classification | Boundary |
| --- | --- | --- |
| Host unavailable, requires re-entry, partial recovery | AUTOMATED PASS / DOCUMENTED RESIDUAL | Fail-closed contracts pass; no unsafe installed injection is claimed |
| Corrupted Desktop envelope, interrupted pre-commit | NO SAFE INSTALLED SEAM / NOT CLAIMED | No random kill, ciphertext/journal/userData editing, DPAPI destruction, or ASAR patching |
| Clean first install | PASS — supplementary | Does not transfer 0.8 distribution ownership into 0.7 |
| Adjacent-version upgrade, uninstall/reinstall, signing, release assets, distribution lifecycle | DEFERRED TO 0.8 | Distribution/lifecycle scope remains in the roadmap's 0.8 phase |
| Different machine/account, copied `userData`, general DPAPI portability | MANUAL-ONLY / NON-CLAIM | No portability or cross-profile guarantee |

### Final 0.7 verdict

- Real Credential Cleanup：**PASS — operator-attested real installed-app evidence within the stated scope**
- 0.7 Windows acceptance：**PASS / COMPLETE within the 0.7-owned closure contract**
- 0.7 overall：**COMPLETE**

The COMPLETE verdict closes the 0.7 credential-security blockers only. It does not mark any deferred, no-safe-seam, or portability row as PASS.

## 2026-08-14 · 0.8 Windows Distribution / Lifecycle Phase 1 baseline checkpoint

状态：**Phase 1 COMPLETE；0.8 overall IN PROGRESS**。本节只建立 distribution contract、自动化 foundation 和真实 Windows acceptance 方法；它不把尚未执行的 adjacent upgrade、uninstall/reinstall、签名或 release promotion 写成 PASS。详细 ownership、threat model、路径和 rollback contract 见 [`docs/windows-desktop-distribution.md`](windows-desktop-distribution.md)。

本节的 A–W matrix 保留 Phase 1 checkpoint 的历史状态；2026-08-15 的 Phase 2A operator evidence 和当前 closure verdict 见下方。

### Current packaging evidence

- Application: `review-workspace` / product name `错题复盘` / version `0.2.2`
- Electron: `43.2.0`
- Electron Forge: `7.11.2`
- Maker: `@electron-forge/maker-squirrel@7.11.2`
- Generator: `electron-winstaller@5.4.4`
- Squirrel runtime: vendor `Squirrel.exe` ProductVersion `2.0.1+eef37460ae`，FileVersion `2.0.1.1`
- Expected install root: `%LOCALAPPDATA%\review_workspace\`; expected Electron userData: `%APPDATA%\错题复盘\`
- Expected artifact: `out\make\squirrel.windows\x64\ReviewWorkspace-0.2.2-Windows-x64-Setup.exe`
- Current signing state: **PENDING** — no production certificate/publisher/CI signing identity is configured.

`%LOCALAPPDATA%\review_workspace\` and `%APPDATA%\错题复盘\` are ownership expectations derived from the current package/product identity and Squirrel configuration, with the latter matching prior same-profile observation. A future real acceptance record must confirm the actual paths without publishing local usernames or absolute paths.

### 0.8 lifecycle matrix

Status vocabulary is intentionally strict: `CURRENTLY PASS`, `AUTOMATED PASS`, `MANUAL PASS`, `PENDING`, `DEFERRED`, `NOT SAFE TO INJECT`, and `NON-CLAIM`. A theory or package build is not a manual lifecycle PASS.

| ID | Acceptance case | Status | Evidence / next safe method |
| --- | --- | --- | --- |
| A | Clean install | CURRENTLY PASS | Supplementary operator-attested 0.2.2 clean-profile first install; repeat on a future candidate |
| B | First run | CURRENTLY PASS | `--squirrel-firstrun` started the normal Electron app after clean install |
| C | Normal second launch | CURRENTLY PASS | Same installed app full close/reopen observed within the same profile; not a portability claim |
| D | Same-version Setup while app closed | PENDING | Repeated/overlapping same-version Setup previously hit file-lock/transaction failures; no safe reinstall claim |
| E | Same-version Setup while app running | PENDING | Only an isolated disposable profile may be used; do not repeat on developer profile |
| F | Adjacent-version overwrite upgrade | PENDING | Requires real `0.2.2 → 0.2.3`/`0.3.x` candidate and fully closed base app |
| G | Upgrade while app running | PENDING | Separate isolated manual case; no forced process kill or shortcut workaround |
| H | Full app close/reopen after upgrade | PENDING | Must observe the new version after a real adjacent upgrade |
| I | `userData` preservation after upgrade | PENDING | Compare safe non-secret core data and actual `app.getPath("userData")` before/after |
| J | Credential availability after upgrade | PENDING | Observe existing 0.7 authority after real upgrade; do not infer from same-version restart |
| K | Uninstall while app closed | PENDING | Record install-root, `Update.exe`, `SquirrelTemp` and `userData` behavior in a dedicated profile |
| L | Uninstall while app running | PENDING | Real Squirrel case only; no random process kill or data editing |
| M | Uninstall + reinstall same version | PENDING | Historical same-version lock diagnostic makes this an explicit unresolved case |
| N | Uninstall + reinstall newer version | PENDING | Must separately verify data, schema compatibility and credential boundary |
| O | Stale shortcut / execution stub behavior | PENDING | Current custom main has no explicit shortcut create/remove code; observe actual targets |
| P | Previous `app-<version>` directory cleanup | PENDING | Check old-version retention/deletion after adjacent upgrade, not from unpacked artifact |
| Q | Installer interrupted before app launch | NOT SAFE TO INJECT | No safe installed seam; random kill is prohibited acceptance evidence |
| R | Installer interrupted after files deployed | NOT SAFE TO INJECT | No safe installed seam; do not edit Squirrel transaction/userData state |
| S | Squirrel lifecycle args behavior | AUTOMATED PASS | Direct contract covers install/updated/uninstall/obsolete and rejects `--squirrel-firstrun` as lifecycle quit |
| T | Signing / publisher identity | PENDING | Requires production Authenticode identity, timestamping and post-sign verification |
| U | Release asset identity | AUTOMATED PASS | Workflow contract checks tag/version, Windows x64, installer naming and SHA-256 manifest; remote promotion remains follow-up evidence |
| V | Installer hash evidence | CURRENTLY PASS | Existing 0.2.2 record: `80DAA2073B655D22265FFCED5B3D501EE0592E588F4E27D665BACDA3CB7E2932`; future candidate must record its own hash |
| W | Corrupted / partial install recovery | NOT SAFE TO INJECT | No safe seam; ASAR patching, DPAPI destruction and profile surgery are prohibited |

### Current Squirrel diagnostic boundary

An older already-installed profile repeatedly launching the same `0.2.2` Setup produced `Update.exe --install .`, file-lock errors, and failures removing an existing directory/full package. The clean dedicated profile launched the same installer once and completed normally. The bounded conclusion is:

> Repeated or overlapping same-version Setup execution can conflict with an existing installation and locked files. Clean single-run first install passed. Same-version reinstall and all lifecycle flows remain unproven.

This observation is not a GPU/renderer diagnosis and does not justify `--no-sandbox`, disabling GPU/sandbox, deleting `Update.exe`, bypassing the root execution stub, or changing `BrowserWindow` show behavior.

### Phase 1 automated coverage

- `desktop/squirrel-lifecycle.ts` classifies only `--squirrel-install`, `--squirrel-updated`, `--squirrel-uninstall` and `--squirrel-obsolete`.
- `--squirrel-firstrun` is covered as a normal launch, and the source contract verifies lifecycle exit precedes single-instance lock and window creation.
- `desktop/desktop-release.contract.test.ts` locks package/product identity, Forge/MakerSquirrel setup naming, Electron/Forge/winstaller versions, and the absence of a Main-process `userData` redirect.
- Existing `desktop/desktop.contract.test.ts` and `scripts/desktop-preload-artifact.contract.test.mjs` continue to guard context isolation, sandbox, web security, ASAR/preload shape and bridge surface.
- This 2026-08-14 Phase 1 checkpoint is historical: it described the former
  `desktop-release.yml` path and must not be read as the current release
  trigger. The current trusted path is
  `.github/workflows/trusted-desktop-release.yml`; the legacy workflow is
  deleted/historical. Neither path adds auto-update, certificate secrets or
  user/profile data to artifacts.

### Real acceptance procedure

Use a dedicated Windows x64 user/profile and a disposable/revocable test credential. Record only package version, source SHA, status, sanitized observations and timestamps.

1. Build from a known SHA with Node 22; record installer name, architecture, maker, Squirrel runtime, SHA-256 and signing state.
2. For A–C, start from a profile without install root, `SquirrelTemp`, `Update.exe` or app process; launch Setup once and observe process/lifecycle completion.
3. For F–J, install `0.2.2`, fully close the app, then install a separately built adjacent candidate. Verify new version, root stub, old directory, shortcuts, actual `userData`, core data and credential availability.
4. For K–N, record whether Squirrel removes only binaries or also `userData`; no destructive cleanup is added by Phase 1.
5. For Q–W, stop at the first unsafe boundary and record `NOT SAFE TO INJECT` / `NON-CLAIM`; do not create evidence by killing processes or mutating profile files.

### 0.8 Phase 1 verdict

- Packaging stack, identity and lifecycle ownership: **AUDITED**
- Binary/userData separation contract: **DOCUMENTED**
- Lifecycle and packaging automated foundation: **AUTOMATED PASS**
- 0.7 credential-security regression: **not observed; existing security contracts unchanged**
- Phase 1: **COMPLETE**
- 0.8 overall: **IN PROGRESS**
- Still pending for later 0.8 phases: adjacent-version real PASS, uninstall/reinstall real PASS, shortcut/old-directory observations, production signing, signed publisher verification, release asset promotion/provenance and any safe interrupted-install recovery seam.

## 2026-08-15 · 0.8 Windows Distribution Phase 2A acceptance closure

状态：**Phase 2A COMPLETE within scoped binary/userData/restart acceptance；0.8 overall IN PROGRESS**。本节记录真实 `0.2.2 → 0.2.3` overwrite-upgrade operator evidence；credential operation、shortcut creation/UX、uninstall/reinstall、signing 和 portability 不被冒充为 PASS。

### Candidate identity

- Candidate package version: `0.2.3`（`package.json`、`package-lock.json` root 与 `packages[""].version` 一致）
- Installer identity: `ReviewWorkspace-0.2.3-Windows-x64-Setup.exe`
- Candidate artifact source SHA (existing build record): `da46193de710fa11b638793eb34401b305a713ae`
- Candidate installer SHA-256: `FBC9D0553926BCFBB8634E31E2108FE3BA555FF999389CBB8403BB1A6B084B22`
- Squirrel package identity: `review_workspace`; architecture: Windows x64
- Electron / Forge / Maker / generator / Squirrel runtime: `43.2.0` / `7.11.2` / `7.11.2` / `5.4.4` / `2.0.1+eef37460ae`
- Signing: **PENDING**；本 candidate 不创建 tag、不发布 GitHub Release、不声称 production publisher
- Candidate artifact source SHA、installer SHA-256、`RELEASES` 和 `review_workspace-0.2.3-full.nupkg` 的 identity 保留既有 exact-head candidate build record；本轮只追加 operator evidence 文档，不重建或重跑 installer/Setup，正式 release provenance 仍为 **PENDING**。安装器不提交 Git

任务指定的已知 `0.2.2` baseline installer 已重新计算并匹配 SHA-256 `80DAA2073B655D22265FFCED5B3D501EE0592E588F4E27D665BACDA3CB7E2932`；它完成了 clean install、normal restart 和 sentinel persistence preflight。

### Phase 2A closure matrix

| Row | Verdict | Evidence boundary |
| --- | --- | --- |
| Known `0.2.2` baseline install/restart | PASS | Specified hash matched; clean dedicated-profile install, Finished Squirrel Updater and normal restart observed |
| Pre-upgrade production sentinel | PASS | `upgrade-acceptance-2026-08-15` created through production UI and persisted through baseline restart |
| Candidate identity / artifact shape | AUTOMATED CONTRACT | Version, lock root, Forge naming and artifact tests; not installed-app evidence |
| Adjacent-version overwrite upgrade | PASS | One closed-app `0.2.2 → 0.2.3` Setup run; no process kill or profile surgery |
| Running-app upgrade | PENDING / NON-CLAIM | Not executed; only the fully closed-app adjacent upgrade is in scope |
| Squirrel normal completion / Update exit | PASS | `Program: Finished Squirrel Updater`; Setup and Update exited normally |
| New `app-0.2.3` deployment / root stub | PASS | Real install root deployed `app-0.2.3`; root stub launched it |
| Shortcut current-version launch | NO PRODUCT SHORTCUT OBSERVED / N/A | No product `.lnk` found in searched Start Menu/Desktop locations; root stub launch passed; shortcut UX remains residual |
| Old app-version cleanup | PASS | `app-0.2.2` absent after `cleanDeadVersions` |
| `userData` path and product data preservation | PASS | Actual `%APPDATA%\\错题复盘` path and production sentinel preserved after upgrade and restart |
| Desktop credential authority / existing operation | PENDING / NOT EXECUTED | No credential re-entry or operation in this closure; do not infer PASS; 0.7 remains unchanged |
| Post-upgrade full restart | PASS | All app processes exited, root stub relaunched `app-0.2.3`, sentinel remained |
| Same-version reinstall / uninstall-reinstall | PENDING / NON-CLAIM | Incidental 13:02 same-version observation is not a general safety claim; uninstall/reinstall is out of Phase 2A |
| Signing / publisher / release promotion | PENDING | Later distribution work |
| Different machine/account or copied `userData` | NON-CLAIM | Not a portability test |

### Real operator evidence

Evidence scope was one Windows machine, one dedicated local test user/profile and one application profile, starting clean with no copied `userData`; no credential/plaintext/DPAPI manipulation occurred.

- Baseline `0.2.2` launched from `app-0.2.2`, completed `Program: Finished Squirrel Updater`, used `%APPDATA%\\错题复盘`, and preserved `upgrade-acceptance-2026-08-15` across the baseline restart sequence.
- An additional same-version `0.2.2` Setup ran at 13:02 during the baseline sequence. It detected the existing install, redeployed `app-0.2.2`, and finished successfully. This is **INCIDENTAL SUCCESSFUL SAME-VERSION REINSTALL OBSERVATION**, not a general reinstall-safety PASS and not part of Phase 2A closure.
- Before the adjacent run, `review-workspace.exe` and `Update.exe` were exited. The candidate hash matched, `0.2.3` Setup ran once, no process was killed, and no directory, shortcut, userData, journal or ciphertext was edited.
- Squirrel detected the existing root, deployed `app-0.2.3`, ran `cleanDeadVersions`, recorded `Program: Finished Squirrel Updater`, and exited Setup/Update normally. The root execution stub launched `app-0.2.3`; `app-0.2.2` was absent afterward.
- The actual userData path remained `%APPDATA%\\错题复盘`; the sentinel survived the upgrade, full close, and normal root-stub restart. No product shortcut was found after searching current-user Start Menu/Desktop, ProgramData Start Menu and Public Desktop for the relevant names/targets. This is **NO PRODUCT SHORTCUT OBSERVED / N/A**, not shortcut PASS or FAIL.
- No credential operation was performed for this closure. Credential availability remains **PENDING / NOT EXECUTED** and is not a portability or 0.7 authority claim.

### Operator stop point for future candidates

Use a new dedicated Windows profile with no `review_workspace` root, `SquirrelTemp`, `Update.exe` or app process. Recalculate the specified baseline hash, run its Setup once, wait for Setup/Update/app first-run completion, and create a non-sensitive sentinel through the production UI. Close and normally reopen `0.2.2` to prove the sentinel persists, then close every app process and run `ReviewWorkspace-0.2.3-Windows-x64-Setup.exe` exactly once. Do not double-click, kill `Update.exe`, delete version directories, clear `SquirrelTemp`, edit shortcuts/userData/journal/ciphertext, or run the candidate in parallel. Record only sanitized version/process/lifecycle/path-category/status facts and timestamps; stop on the first failure and preserve logs.

### Phase 2A verdict

- Phase 2A: **COMPLETE within scoped adjacent-version binary/userData/product-data/restart acceptance**
- Shortcut: **NO PRODUCT SHORTCUT OBSERVED / N/A**; shortcut creation/UX remains a separate distribution residual
- Credential availability after upgrade: **PENDING / NOT EXECUTED**; no credential PASS is claimed
- 0.7 credential-security closure: **COMPLETE / unchanged**
- 0.8 overall: **IN PROGRESS**

## Historical 2026-08-12 · 0.7 Desktop Credential Acceptance Closure

历史状态：**PARTIAL — PENDING ITEMS REMAIN**。本节保留 2026-08-12/13 当时的失败、验收和未执行 cleanup 事实；当前状态以上方 2026-08-14 closure record 为准。

本历史节中的 `PENDING`、`BLOCKING REQUIRED` 和 `IN PROGRESS` 表述均带有其原始验收时间语境；它们不是对当前 2026-08-14 verdict 的重述。

### 0.7 closure interpretation

The installed-app matrix keeps the truthful `PASS` / `PENDING` labels. The additional closure classification answers what a pending row means:

- `AUTOMATED PASS / DOCUMENTED RESIDUAL`: deterministic contracts cover the fail-closed behavior, but no installed-app observation is claimed.
- `NO SAFE INSTALLED SEAM / NOT CLAIMED`: no safe seam exists for corruption or interruption injection; random process kills, userData/ciphertext/journal editing, DPAPI destruction, real credential corruption, and ASAR patching are prohibited evidence methods.
- `DEFERRED TO 0.8`: adjacent-version upgrade and uninstall/reinstall are Windows distribution/lifecycle ownership, not a transfer of 0.7 credential-security semantics.
- `MANUAL-ONLY / NON-CLAIM`: different machine/account, copied userData, and general DPAPI portability remain unverified and unsupported by this record.
- `BLOCKING REQUIRED / PENDING — NOT EXECUTED`: real Credential Cleanup remains a 0.7 credential-security closure gate. The Cleanup Foundation is automated/readiness evidence only.

### Evidence boundary

#### 2026-08-12 installed-app failure and preload regression boundary

The real Windows 11 x64 installed-app run for commit `c85f2f3f87903d73ca5db4ba07d90d9fc410bb14` passed installation and first launch but did not render the `Desktop 凭据保护` panel under Settings → AI connections. The panel was absent rather than showing the safe unavailable state, so Web → Desktop migration could not begin. This is a failed acceptance observation, not a product or test pass.

The confirmed cause was the packaged `.desktop/preload.js` being emitted as ESM (`import { contextBridge, ipcRenderer } from "electron"`) while the Electron 43.2.0 BrowserWindow used `sandbox: true`. Electron sandboxed preloads run without an ESM context, so preload execution stopped before the three narrow `contextBridge` surfaces were exposed. Existing contracts, fake-Desktop E2E, and Desktop compile tests missed this because they checked source/adapter seams but did not inspect or execute the final staged and ASAR preload artifact.

The repaired boundary is now `desktop/preload.cts` → `.desktop/preload.cjs` → `.desktop-app/.desktop/preload.cjs` → `app.asar`, with an artifact regression asserting CommonJS format, no runtime local imports, the exact three bridge names, no stale `preload.js`, and hash equality across compiled, staging, and packaged output. A real sandboxed Electron BrowserWindow smoke also checks boolean evidence for the existing credential bridge without sending secrets.

At that 2026-08-12 checkpoint, Windows installed-app acceptance remained **PENDING MANUAL ACCEPTANCE** until the repaired installer was installed and executed through the first checkpoint below. Do not mark 0.7 complete from package success or the automated regression alone.

- 自动化 contract evidence：`npm run test:contracts`、`npm run test:desktop` 与 `e2e/desktop-credential-migration.spec.ts`。fake Desktop bridge 只证明产品 gating、显式动作、非空测试 credential 的 protect/unprotect round-trip、journal 读取/写入边界和安全 UI 投影，不证明 Windows DPAPI。
- Electron integration evidence：`npm run desktop:compile`、`npm run test:desktop` 以及实际 Electron 开发/打包运行；这些检查不能替代安装版生命周期证据。
- Installed Windows manual evidence：必须记录真实安装器版本、commit SHA、安装/升级步骤、脱敏结果和失败类别。只有实际观察到的项目才可标记 PASS。

### Exact installed-app procedure

1. 在 Windows x64、Node 22 环境从待验 commit 执行 `npm run desktop:make`，保存生成的 Squirrel 安装器文件名、SHA-256、commit SHA 与 package version；使用隔离的非生产测试凭据，绝不把凭据写进记录或截图。
2. 安装并启动应用，确认 `设置 → AI 连接 → Desktop 凭据保护` 显示真实保护能力可用。确认只打开 Settings/AI 连接不会生成 `review-workspace:credential-migration:v1` journal 写入，也不会开始迁移。
3. Desktop authority establishment：在隔离 Desktop profile 通过现有正式保存流程准备一个非空 Web v2 测试凭据，只通过用户点击 `迁移到 Desktop 保护` 启动迁移；记录 preflight、staging、verification、ready-to-commit、commit 与 complete 的实际可见结果。确认 migration journal 为 `state=complete`、backend policy 为 `desktop_preferred`，并且安全 authority 事实已经进入 Desktop authoritative 状态；Web source 仍保留作恢复证据。打开 Settings alone 不能替代这一 cutover 证据。
4. Fresh Desktop credential flow（仅在已完成 cutover 的同一 profile 中执行）：新增一个非空测试 credential，或将已迁移 credential 修改为另一个非空测试值。该写入必须遵循 Desktop-only policy；使用既有安全 authority / journal / behavior evidence 验证没有 silent Web fallback，不新增 secret 或 backend introspection 调试接口。然后关闭安装版并重新启动。
5. Restart usability：重启后执行该 credential 预期的最小产品操作，确认 credential 仍可用；检查正常 renderer state、diagnostics、备份/导出、日志和 UI 不包含 plaintext、完整 token/API key、ciphertext、IV、Desktop payload、路径或 stack trace。若 Desktop protection 暂时不可用，写入/读取必须安全失败且不能改写 Web source。
6. Failure/recovery：分别使用可安全复现的 controlled fixture 或 Host test seam 验证 protection unavailable、commit 前中断、带 resumable journal 重启、requires-reentry、context mismatch/corrupted Desktop envelope 与 partial commit recovery。每项都确认显示安全状态、可恢复路径和 source retention；任何 Desktop authority 失败都不得 silently downgrade 到 Web。
7. Installed lifecycle：执行 close/reopen、立即相邻版本覆盖升级，记录 `userData` 是否保留及 credential availability 是否保持。只有实际执行过的 install、restart、upgrade 结果可写 PASS；不得把预期行为写成观察结果。
8. 不要在没有实际执行的情况下声称换机、Windows 账户变化、复制 userData/blob、卸载重装恢复或 DPAPI portability；这些仍是 manual-only residual cases。

### Evidence interpretation

- WebCrypto persistence：仅说明 Web v2 在 cutover 前的既有 Web 路径可读写；它不能证明 Desktop `safeStorage` 或 DPAPI。
- Desktop `safeStorage` persistence：只有在真实 Desktop authority 已建立、非空 credential 的保存确实经过 Desktop backend，并在真实安装版重启后仍可用时，才可记录为该 backend 的 persistence evidence。
- Windows installed-app persistence：必须来自安装后的真实 close/reopen 或升级观察；fake Desktop Browser E2E、contracts、compile 和 package 成功都不能替代它。
- Windows DPAPI portability：同一 Windows 用户、同一机器和同一 profile 的重启不证明换机、换账户、复制 `userData`、卸载重装或 DPAPI portability。

### Acceptance record

记录至少包含：`environment`、Windows version、installer/package version、commit SHA、测试 profile、每个 matrix case 的 `PASS/FAIL/PENDING`、安全失败类别和人工观察时间。不得记录 API Key、Cookie、密文、完整 URL、OS 路径或原始错误文本。当前状态为 **PARTIAL — PENDING ITEMS REMAIN**；cleanup confirmation 另行执行，且本轮没有删除任何 retained Web credential material。

### 0.7 Credential Cleanup Execution Entry boundary

本轮交付 cleanup foundation 上的最小 production entry：physical inventory、独立 cleanup journal、eligibility/reconciliation、幂等 source primitives、last-step Web key API、隔离 executor，以及 Desktop-only 的显式 review → acknowledgement → confirmation UI。Settings → AI 连接中的 `Credential cleanup` 只通过窄 execution facade 调用 executor；Web 不显示 Desktop cleanup surface，mount/startup/reload 不执行 destructive cleanup。

自动证据必须来自合并后的新 commit，并且只能证明 fake/test fixture 的 no-write/no-decrypt/no-key-generation inventory、fresh revalidation、Host unprotect recoverability probe、source-before-key ordering、partial/recovery semantics、journal preservation 和 UI execution boundary。Desktop verification 会通过 fake Host unprotect boundary，但只立即丢弃返回 secret，不持久化、记录、比较或暴露 credential plaintext。不得以 `desktop:make`、旧 installed-app build、package 成功、proxy tests 或 fake host E2E 声称真实 Windows cleanup/DPAPI 证据。当前 cleanup 状态为 **EXECUTION ENTRY IMPLEMENTED / AUTOMATED EVIDENCE ONLY — REAL CLEANUP NOT EXECUTED — WINDOWS PENDING**；0.7 overall 仍为 **IN PROGRESS**。

Production entry acceptance contract：

- 未完成 acknowledgement 或 confirmation 时，destructive call 数为零。
- 确认后重新收集 physical inventory、Host 状态和 Desktop record verification；stale inventory、Host unavailable、invalid envelope、mixed authority、re-entry、unknown/invalid/orphan state 或 `legacy-v1` 都 fail closed。
- 已删除 source 后的错误只能进入 `partial` 或 `recovery_required`；Resume/Reconcile 必须由用户显式点击，先 reconciliation，再 fresh inventory/Host/eligibility，不自动 rollback、fallback 或生成 replacement Web key。
- Migration journal、Desktop envelope 和 schema/IPC/preload 边界保持不变；shared Web key 仍是最后 destructive step。

本轮没有执行真实 credential read、真实 Web source 删除、真实 shared Web key 删除、真实 legacy JWK 删除、安装版 cleanup 或 provider operation。Real Credential Cleanup 仍为 **BLOCKING REQUIRED / PENDING — NOT EXECUTED**；`0.7 WINDOWS ACCEPTANCE` 仍为 **PARTIAL — PENDING ITEMS REMAIN**。

## 2026-08-13 · 0.7 Windows Installed-App Acceptance Record

正式 verdict：**0.7 WINDOWS ACCEPTANCE PARTIAL — PENDING ITEMS REMAIN**。

核心 real Windows installed-app credential path：**PASS**。本记录只证明同一台机器、同一 Windows 用户、同一 application profile 中，真实安装版的 Desktop-authoritative credential persistence across restart；不扩展为换机、换账户、复制 `userData`、卸载重装或 general DPAPI portability 通过。

### Environment and build identity

- Windows：Microsoft Windows 11 家庭版 中文版，version `10.0.26200`，build `26200`，x64
- Test profile boundary：same application profile；记录不包含本机路径或用户名
- Observed：2026-08-13；latest observed connection at 12:43 was successful
- Commit：`61aef1e4a4ee3eb316ac81d86b149136ab5855d4`
- Package：`0.2.2`
- Installer：`ReviewWorkspace-0.2.2-Windows-x64-Setup.exe`
- Size：`186,863,616` bytes
- SHA-256：`8518172ED8D59E903AF849B4E0C7CFC52B55E3FDBE94EABE490A6194D6CFA999`

### Installed-app acceptance matrix

| Case | Status | Evidence / reason | Closure classification |
| --- | --- | --- | --- |
| Installation | PASS | installed-app behavioral | PASS / EVIDENCED |
| First launch | PASS | installed-app behavioral | PASS / EVIDENCED |
| Packaged preload / Host capability | PASS | installed-app behavioral + packaged artifact regression | PASS / EVIDENCED |
| Desktop credential protection | PASS | installed-app behavioral | PASS / EVIDENCED |
| Explicit Web → Desktop migration | PASS | installed-app behavioral | PASS / EVIDENCED |
| Desktop authority | PASS | installed-app behavioral | PASS / EVIDENCED |
| Credential usability after restart | PASS | installed-app behavioral | PASS / EVIDENCED |
| Repeated restart persistence | PASS | installed-app behavioral | PASS / EVIDENCED |
| DeepSeek connection test | PASS | real installed-app provider operation | PASS / EVIDENCED |
| Privacy inspection | PASS | manual installed-app observation | PASS / EVIDENCED |
| Same-version replacement | PASS | installed-app behavioral | PASS / EVIDENCED |
| Host unavailable | PENDING | automated-only | AUTOMATED PASS / DOCUMENTED RESIDUAL |
| Requires re-entry | PENDING | automated-only | AUTOMATED PASS / DOCUMENTED RESIDUAL |
| Context mismatch | PENDING | automated-only | AUTOMATED PASS / DOCUMENTED RESIDUAL |
| Corrupted envelope | PENDING | automated-only | NO SAFE INSTALLED SEAM / NOT CLAIMED |
| Interrupted pre-commit | PENDING | no safe installed-app seam | NO SAFE INSTALLED SEAM / NOT CLAIMED |
| Partial commit recovery | PENDING | automated-only | AUTOMATED PASS / DOCUMENTED RESIDUAL |
| Adjacent-version upgrade | PENDING | deferred until an isolated Windows environment/device is available | DEFERRED TO 0.8 |
| Different machine | PENDING | manual-only | MANUAL-ONLY / NON-CLAIM |
| Different Windows account | PENDING | manual-only | MANUAL-ONLY / NON-CLAIM |
| Copied `userData` | PENDING | manual-only | MANUAL-ONLY / NON-CLAIM |
| Uninstall/reinstall | PENDING | manual-only | DEFERRED TO 0.8 / MANUAL-ONLY |
| Credential cleanup | PENDING | separate phase; not performed | BLOCKING REQUIRED / PENDING — NOT EXECUTED |

### Recorded evidence boundary

- Desktop 凭据保护 panel visible：PASS
- Explicit Web → Desktop migration / cutover：PASS
- Desktop authority establishment：PASS
- DeepSeek saved connection exists and authentication state was verified
- First and second real restart credential usability：PASS
- Plaintext credential exposure：not observed
- Silent Web fallback：not observed
- Retained Web recovery evidence：preserved
- Credential cleanup：not performed

Recovery contracts：**38 / 38 PASS**。这是 automated evidence，不等同于真实 installed-app failure/recovery evidence。`protection unavailable`、`requires-reentry`、`context mismatch`、`corrupted Desktop envelope`、`interrupted pre-commit` 和 `partial commit recovery` 的 installed-app 状态均保持 **PENDING**；`protection unavailable`、`requires-reentry`、`context mismatch` 和 `partial commit recovery` 是 documented residual，`corrupted Desktop envelope` 与 `interrupted pre-commit` 明确为 **NO SAFE INSTALLED SEAM**。本轮没有执行 random process kill、`userData`/ciphertext/journal editing、DPAPI destruction 或 real credential corruption。

### Adjacent-version and portability boundary

已确认存在 genuine older installer：version `0.2.1`，commit `04e91d03b62de11a4c041e4c8b77961fc6e20e9b`，installer `ReviewWorkspace-0.2.1-Windows-x64-Setup.exe`，size `190,152,192` bytes，SHA-256 `364C169FACAB5DA4C2F6A8CD510E0972F479EF407CA7CDED9927C1EDCA5F501D`。由于当前没有安全隔离的 Windows environment/device，Adjacent-version upgrade：**PENDING — deferred until a separate Windows environment/device is available**，并归属 0.8 Windows desktop distribution。Same-version replacement **不等于** adjacent-version upgrade。

This record uses commit `61aef1e4a4ee3eb316ac81d86b149136ab5855d4`, which predates the merged Cleanup Foundation commit `402fa3ac0d8dc443565442a3612830919ddaf3fd`. It is valid historical evidence for the core migration/persistence path only; it cannot prove `402fa3` cleanup runtime behavior or any future real cleanup acceptance. Historical installer identity and evidence are preserved unchanged.

Different machine、different Windows account、copied `userData`、uninstall/reinstall 和 general DPAPI portability 均未验证；这些不是本记录的 PASS。Privacy inspection 的结论仅为 **Secret leakage: not observed**，不是 `proved impossible`。0.7 overall 仍为 **IN PROGRESS**，real Credential Cleanup 仍为 **BLOCKING REQUIRED / PENDING — NOT EXECUTED**。

## 2026-08-09 · Data Reliability Phase 2

1. 在隔离 profile 制造一条无父对话的 `aiConversationRunSteps`，确认 Health 只把它标为“可定向修复”；attempt/message/turn/knowledge dangling、缺密钥与 Vault 问题只能显示手动路径且没有修复按钮。
2. 打开修复预览，确认只显示 scope、精确 ID、动作、低风险、恢复能力和验证计划，不显示 step 文本、prompt、凭据、Vault 正文或原始响应；明确说明目标孤立元数据不能通过生成的快照恢复，关闭 preview 后数据库不变。
3. 确认未下载 fresh V2 修复安全恢复快照、只勾选“文件已保存”或只勾选“理解目标不可恢复”时都不能提交。两项确认后检查快照可通过 restore preflight 且不含 targeted orphan，执行修复并刷新；孤立元数据消失，正常会话、消息与其他学习记录保持。
4. 模拟 repair delete 完成但 transaction 内 verify 失败，确认 transaction 回滚、目标诊断证据仍存在且不会继续执行其他 repair。
5. Seed `prepared` job 后启动：业务数据保持、暂存被清理且显示明确结果。Seed `applying` job 后启动：previous snapshot 恢复并验证后才挂载业务 controller，job 随后清理。
6. **真实强制中断仍需人工验证**：开始 restore，DevTools 确认 transfer job 已到 `applying` 后强制关闭 Web profile 或结束 Electron 进程；重启应先显示恢复检查，再恢复旧快照、显示可见结果且不存在半恢复工作台。CI seeded job 不等同于真实 process kill。
7. 破坏 previous manifest 或模拟 IndexedDB 写/验证失败，确认启动停留在“无法安全打开本地数据”，job 保留；“重新尝试”不得 reset、清库或删除 job。
8. 对真实 Vault 分别撤销 permission、制造 conflict/disconnected/hash 不一致，确认 Health 只读报告 manual-only；mapping、目录授权和 Markdown 正文前后完全一致。

## 2026-08-09 · Data Reliability Phase 1

1. 在隔离 profile 创建错题、知识、对话、自动化和扩展代表数据，点击“检查数据健康”，确认只读报告不修改计数、不输出密文/Vault 正文，并与上方 Vault 权限诊断一致。
2. 下载 V2 备份，核对 manifest 的应用/schema、included stores、excluded categories 和逐表计数；搜索确认没有 Key、Token、Cookie、密文、IV、目录句柄、Vault 正文或厂商原始响应。
3. 删除一条用户可见对话后导入备份、确认替换并刷新，确认记录恢复且凭据/Vault 明确要求重新配置。
4. 分别导入未知数据库/表、敏感字段、错误/伪造 manifest、重复 ID、关键悬空关联、超过 100MB/记录限制的包；确认在出现替换确认前拒绝，刷新后现有数据完全不变。
5. 在隔离 profile 模拟 core 成功而 extension 写入/验证失败，确认旧快照恢复；在 `applying` 后强制关闭页面，重启时必须先回滚并清理 transfer job，不能进入半套业务数据。
6. 真实浏览器配额不足、IndexedDB blocked/写失败和 Vault permission lost 仍需人工执行；应用不得声称这些跨数据库/Vault 操作具有 ACID。

## 2026-07-28 · Electron 与数据迁移

1. 同时运行 Web 与桌面开发入口，确认 Codex 浏览器仍可访问 `http://localhost:3000`，Electron 展示同一套 React/CSS。
2. 依次打开 11 个 `?example=` URL；确认完整列表、选中详情和操作存在，IndexedDB、网络与文件系统无变化。
3. 在 `credential-recovery` 下验证名称和 Base URL 左对齐，状态、最近测试和操作居中；检查 1115×792、1536×1024、390×844、浅色与深色。
4. 验证正常恢复、错误版本、100MB 上限、重复 ID、悬空关联、事务失败和启动中断回滚；确认凭据与 Vault 句柄不在备份。
5. 安装版验证稳定 origin、随机 loopback、无令牌 403、单实例、关闭后子进程清理、重启与覆盖安装的数据保留。
6. 验证 JSON、SSE、音频、模型目录、MCP、摄像头、麦克风、屏幕共享与 Obsidian 目录选择。
7. 篡改随包资源后确认启动被阻止；非法导航、新窗口和外部非 HTTPS 地址应被拒绝。
8. 运行完整 Web 门禁、`test:desktop`、Forge Windows x64 打包与干净环境安装。
9. 手动运行 Desktop Release 时确认只生成 Actions artifact；使用匹配 `package.json` 的 `v*` 标签时确认创建 Draft Release、安装包与 `SHA256SUMS.txt`，不自动发布或启用更新。
9. 使用 `@electron/fuses` 读取安装版可执行文件，确认 RunAsNode、NODE_OPTIONS、CLI Inspect、额外 `file://` 权限和 browser-process-specific snapshot 均关闭；Cookie 加密、ASAR 完整性、OnlyLoadAppFromAsar 与 WasmTrapHandlers 均开启。


## 2026-07-16 学习闭环与声明式扩展

- 在 1536×1024 与 390×844 打开“插件 → 声明式扩展市场”，确认官方包展示来源、权限、版本、摘要和签名状态，无横向溢出。
- 安装并启用“专注纸张”，确认主题立即生效；停用后恢复原主题。安装并启用“申论结构教练”，确认只新增一个自定义人设；停用/卸载后移除且不影响其他人设。
- 导出已安装包后重新导入，确认先显示预览再安装；手工增加未知字段、修改签名或使用 `../evil.js` 路径时必须拒绝。
- 打开辅导：拒绝摄像头权限应显示可行动提示；允许后点击“看这里”，轨道由浏览器终止时预览和内存关键帧入口应清空。
- 连续语音转写期间触发朗读应可通过“打断朗读”或再次开始转写立即停止；离线时保留输入并禁止发送，恢复网络后可继续。
- 完成一次 AI 辅导后提交 1–3 题微测，确认显示确定性得分并生成间隔复练计划；记录“有帮助/换种讲法”和本轮反馈秒数。
- DevTools 检查 `review_workspace` 仍为 v16，`review_extensions` 为独立 v1；辅导表中不得出现 `data:image`、`data:audio`、`data:video` 或 `blob:`。

## 2026-07-15 AI 活动、Google 与记忆 v2

- 使用已保存 Google 连接读取目录并发送 8-token “仅回答 OK”测试；确认官方请求为 `/v1beta/interactions` 或 `:generateContent`，失败卡包含模型、协议、阶段和脱敏错误。
- 连接测试卡任意时刻只能有一个“进行中”，失败后的步骤显示“未执行”；DOM 中不得出现三栏活动面板、假 composer、会话列表或右侧工具链。
- 在同一对话中从 Google 切换到 Claude/DeepSeek，确认请求保留本地可见历史顺序；不得包含隐藏 thought、Key、附件正文或厂商原始响应。
- 新用户检查自动记忆默认开启；旧用户保持原开关。验证明确“记住”、三轮/45 秒提取、生效/待处理/归档筛选、冲突、秘密丢弃、撤销和刷新恢复。
- 真实厂商只测试应用中已配置连接；未配置项记录 `skipped`。报告不得输出 Key、响应正文、模型清单或额度。

## 2026-07-15 模型目录与对话链回归

- 在已保存 Google、DeepSeek、MiniMax 连接中获取模型；打开“测试模型 ID”后确认当前选择不会隐藏其他候选，MiniMax 同时可见 M3、M2.7、M2.7-highspeed 与账号返回的历史模型。
- 保存连接后检查默认文本、默认多模态和对话模型菜单使用同一目录；静态首屏出现后应继续刷新，移动端不得产生横向溢出。
- 分别用本地 mock 验证 OpenRouter、Groq、Mistral、SiliconFlow、Kimi、Qwen 目录与最小生成；未知模型不得出现未经核验的视觉、推理或速度选项。
- 连续发送两轮消息并刷新，确认每轮固定为用户、必要工具、AI；“准备上下文/选择模型/调用模型/流式输出/完成”只在折叠详情内。
- 真实只读目录仅在 `RUN_LIVE_MODEL_CATALOG_TESTS=1` 且提供对应 Key 时运行 `npm run test:model-catalog-live`；不得打印模型清单、数量、响应体或凭据。

## 2026-07-15 Google 双协议与品牌回归

- 使用本地 mock 分别验证 Gemini 2.5 请求 `:generateContent`、`gemini-3.5-flash` 请求 `/v1beta/interactions`；后者必须包含 `store:false`，且页面不得发生双发。
- 验证 Interactions 图片、结构化输出和流式增量；测试卡应把协议不匹配显示为协议问题，而不是笼统的参数 400。
- 在默认文本、多模态和“更多默认能力”中检查连接与模型下拉：触发器和选项均有正确厂商图标，键盘、Escape、Tab 和焦点恢复正常。
- 检查 Obsidian 插件卡、详情标题与知识入口使用相同本地品牌图标；断网后仍可显示。
- MiniMax mock 必须分别断言模型目录 `X-Api-Key` 和消息 Bearer。真实 Google/MiniMax smoke 仅在显式环境变量和凭据存在时运行。

## 2026-07-15 品牌、Gemini 与粉笔快捷导入

- 在 AI 连接、模型菜单和额度表格确认 OpenAI、Gemini、Claude、xAI、DeepSeek、GLM、MiniMax 等均使用本地 Lobe SVG；断网后图标仍可显示，深浅色单色资产对比度正常。
- 在额度页检查可靠分母显示整数剩余百分比，颜色仅为绿/橙/红/灰；无分母显示 `—`，悬浮/聚焦仍能读取准确金额，刷新按钮可操作。
- 本地 mock 分别验证 Gemini 标准档无 `serviceTier`、优先档为 `serviceTier: "priority"`、文本与 `inlineData` 图片请求成功；测试卡显示脱敏参数/模型/配额分类而非裸 400。
- 打开“公考 → 导入资料”，配置实验 Cookie 后验证同步阶段、进度、取消、异常草稿默认显示、正常草稿折叠、确认前错题数不变和确认后 30 秒撤销。401/403 与结构变化必须显示 PDF/Word 兜底。
- 真实粉笔只读 smoke 仅在 `RUN_LIVE_FENBI_TESTS=1` 且提供 `FENBI_COOKIE` 时运行 `npm run test:fenbi-live`；不得打印 Cookie、题目、数量或响应体。

## 2026-07-14 设置与额度专项

- 在额度表格确认每行最右侧是刷新按钮，厂商名旁仅保留次级配置入口；有上限时圆环比例正确，只有余额时不得显示伪造百分比。悬浮 450ms、键盘聚焦和 390px 触屏点击均能读取精确指标，外部点击与 Escape 可关闭。
- 使用本地 mock 验证 MiniMax 中国大陆站只请求 `api.minimaxi.com` 且只发送 Bearer；M3 图片进入 `image` block，视频进入独立 `video` block，默认多模态列表可选 M3。
- 真实 MiniMax smoke 仅在 `RUN_LIVE_MINIMAX_TESTS=1` 且提供凭据时执行最小文本/极小图片请求；未提供凭据必须记录“真实厂商 smoke 未执行”，不得用 mock 替代。

- 编辑已保存连接，修改 Base URL/Key 但不保存后执行测试；确认新草稿地址收到请求，旧地址未收到请求。紧凑结果卡桌面宽度为 352±2px，卡内不存在会话列表或输入栏。
- 保存 Gemini 连接后指定默认多模态模型，上传 1×1 小图并通过本地 mock 断言最终请求包含 `inlineData`。
- 在“个性化 → 记忆”验证手动 CRUD、刷新恢复、pending 建议确认、角色/记忆/全部三类重置隔离；在“诊断 → 数据管理”检查数量和完整重置确认文字。
- 启用额度来源后确认状态立即落库并首次刷新；隐藏页面与断网时暂停，恢复时只刷新过期项，临时失败继续显示上次快照并标记过期。
- 在 1536×1024 与 390×844 检查模型菜单：初始聚焦不弹提示、鼠标停留 450ms 后单例提示、触屏无浮层、连续三帧宽度和页面高度稳定。
- 检查 20 家厂商无重复、整行点击、方向键、Home/End、首字母检索、Enter、Escape 和 Tab。
- 检查弥散默认关闭；开启后刷新、深浅模式切换与主题预设切换仍保留，仅重置主题关闭。
- 检查个性化和额度独立导航，AI 连接和内置集成页不再出现额度副本。
- CI 使用 mock 额度响应。真实 smoke 仅在显式设置 `RUN_LIVE_QUOTA_TESTS=1` 与对应环境变量后运行 `npm run test:quota-live`；不得输出密钥、余额数值或原始响应。
- Gemini 真实多模态 smoke 仅在显式设置 `RUN_LIVE_GEMINI_TESTS=1` 与 `GEMINI_API_KEY` 后运行 `npm run test:gemini-live`；只发送极小图片并限制输出，不记录响应体或 Key。

## 2026-07-13 对话与 AI 连接专项

- 用鼠标、触屏和键盘把对话移入文件夹、文件夹移入嵌套目录并拖回固定根目录目标；刷新后确认位置持久化，非法嵌套被拒绝。
- 打开模型选择器，确认弹层紧凑且不显示来源/核验日期；点击模型后立即保存并保持弹层打开，页面中不存在“使用此模型”全局确认按钮。
- 新建 AI 连接时只选择厂商并填写凭据；确认没有用途选择。保存后在独立默认能力区选择连接和具体模型。
- 分别记录七家重点厂商最小探针结果；没有真实 Key 的厂商标记为未验证，不伪造成功。
- 在 1536×1024 与 390×844 检查模型弹层、AI 连接页、拖拽覆盖层、控制台、框架错误与横向溢出；另在 200% 缩放检查焦点环、tooltip 与视口碰撞。

## 单栏模型与对话树 smoke

- 将对话和二级子文件夹拖入嵌套目录，再通过拖拽期间出现的“移到根目录”目标移出；刷新后检查 `folderId` 仍正确。
- 新对话确认最近使用厂商排首位，其余按英文名排序；进入厂商后不得出现空白栏或重叠旧层，只显示当前连接、模型与可用运行选项，不显示全局确认操作。
- 桌面依次测量厂商、模型、普通运行、预算层宽度为 208/240/160/200px（允许 ±2px）；两档层不得保留七档空白，七档尾部空白不超过 16px。
- 在模型层和运行层使用上下方向键、Tab 与 Escape：方向键只移动当前 radio 组，Tab 离开弹层后不抢回焦点，Escape 关闭整个弹层并恢复模型触发器焦点。
- 悬停和键盘聚焦带说明的行时检查 `role="tooltip"`，触屏点击后也可读取；菜单不再常驻七个圆形 `i`。
- 手动模型 ID 同时验证 Enter 与行尾提交图标；普通模型仍点击即保存，切换模型后弹层保持打开。
- 分别验证官方目录在线成功与断网回退；MiniMax 回退首项为 `MiniMax-M3`，GLM 回退包含 `glm-5.2`。
- 设置中保存连接时不出现模型字段；后台默认文本模型变化不得改变既有或空白对话的会话模型。
- 在 1536×1024 与 390×844 检查对话画布无外围断层、输入器可达且页面无横向溢出。

## 范围

此清单用于 CI 之外的真实浏览器与真实 Vault 发布验收。CI 仍不得连接真实 Vault、真实模型服务或外网 API Key。

## 基础质量门

- 运行 `npm run lint`。
- 运行 `npm run test:contracts`。
- 运行 `npm run build`。
- 涉及 UI 或关键流程时运行 `npm run test:e2e`。

## 浏览器通用冒烟

- 首页 title 为“错题复盘”。
- 总览配置健康面板可见。
- 新对话可达；点击和 `Ctrl+N` 只打开空白 composer，不在侧栏创建空会话；发送第一条消息后刷新，项目、会话、消息和工具摘要仍可恢复。
- `Ctrl+K` 打开命令面板，可搜索会话、项目、公考模块和设置。
- 设置中不出现插件目录；粉笔导入位于公考，Obsidian 位于知识库，AI 额度使用独立设置项。
- 设置 -> MCP 可达，可新增 mock server、启用/禁用、探测 tools/resources/prompts 摘要并删除。
- 顶层“插件”入口可达，列表与右侧详情不恢复卡片墙；MCP 仍只在设置中配置。
- 新对话模型按钮先展示厂商图标和悬浮提示，再展示连接档案与具体模型；切换模型后刷新可恢复，且不会新增连接档案。
- 输入器和 AI 连接输入控件没有蓝色内/外阴影，键盘焦点仍显示中性 1px outline。
- 对话加号菜单只保留文件、摄像头、屏幕共享、截图分析、知识检索、MCP、Obsidian 提案和历史辅导记录；语音、实时通话、模型与推理直接显示在底栏。MCP 调用前必须显示 Server、工具与参数键确认。
- 在空白对话输入 `/`，确认提示词与工具命令可筛选、方向键选择、Enter/Tab 执行、Escape 关闭，且首条消息前 `/mcp` 仍进入阻止提示。
- 手动复盘进入和切题后保持 `00:00`，点击开始后才累计；暂停、继续、重置和次级倒计时可用。
- 设置 -> AI 连接只编辑连接档案；默认能力区再选择连接和模型。高级设置、额度行默认折叠，手动模型兜底可用，连接测试必须经过本地 provider adapter。
- 设置 -> 诊断可达，诊断报告可复制，页面无 Next/React overlay。
- 粉笔导入在缺默认多模态连接时提示 OCR 受限但文本导入仍可用。
- 已安排可达，预览读取范围、试运行失败恢复入口、收件箱详情可见。
- 项目 -> 公考可达且默认折叠，桌面和移动端各只出现一套模块与板块筛选。首页展示导入/错题、知识沉淀、知识训练、AI 辅导、已安排复盘和 Obsidian 输出链路。
- 控制台无 runtime error，页面无横向溢出。

## Obsidian Vault 真实授权冒烟

- connect：使用真实浏览器选择临时 Vault，确认托管目录和权限状态显示正常。
- sync：首次同步应导入 Vault 中已有托管 Markdown，也应写入本地未映射知识资料。
- conflict：应用侧与 Vault 侧同时修改同一条映射后必须进入冲突，不得静默覆盖。
- proposal confirm：确认一条 `create` / `merge` / `link` 提案前会复读 Vault；过期 hash 必须拒绝，失败后 proposal 保持 pending 可重试。
- proposal visibility：从知识库相关面板能看到 pending 提案、生成诊断、确认和忽略按钮。
- conversation proposal：从当前对话勾选知识摘要生成提案，消息流显示来源、模型、解析和 pending 步骤；重新授权、冲突和失败重试均保持 proposal pending。

## 已安排外部采集 smoke（2026-07-21）

1. 在 1536×1024 与 390×844 分别打开行测、申论、面试采集模板；确认来源默认停用，URL/RSS/MCP、origin 白名单、内容策略和 A/B 模型控件可键盘操作且无横向溢出。
2. 点击“预览读取范围”，确认只展示来源、允许域名和预计读取数；网络面板中不得出现采集或模型请求，任务、run、proposal 与 `nextRunAt` 均不得变化。
3. 使用本地 mock provider 和拦截的采集响应试运行三个模板；确认只出现临时结果，不进入运行收件箱和待确认提案。
4. 正式运行后检查发现、抓取、去重、A/B/C、争议与复核状态；MCP 非白名单 URL 必须丢弃，原始 MCP 结果和完整网页不得出现在 IndexedDB。
5. 在提案页筛选领域、等级和复核状态，展开段落证据，确认脚注 URL、发布时间、哈希和模型分歧说明可读；争议项选择框和确认按钮必须禁用。
6. 使用临时真实 Vault 批量确认 A/B 项：开始写入前修改一个来源和一个 Vault 目标，确认两项被预检阻止；模拟中途写失败，成功项 accepted，失败与剩余项 pending，重试不产生重复笔记。
7. 刷新页面复核任务、运行摘要、pending/accepted 状态和 Obsidian `source-refs` 持久化；检查控制台、Next/React overlay、键盘焦点与截图差异。

## 剩余风险记录

- 真实 Vault 写入仍只在人工 smoke 中验证，不能放进 CI。
- 数据层索引升级必须先有真实慢查询记录和页面访问路径证据。
- 若发现性能瓶颈，先记录页面、操作、数据量、耗时、调用 repository，再设计 Dexie schema 版本升级。

## 设置导航与确认稿 UI smoke（2026-07-14）

1. 进入设置后快速依次点击 AI 连接、额度、个性化，等待父级快照刷新，确认最终停留在最后点击项且不会回到外观；返回应用后再次进入设置才回到外观。
2. 在 1536×1024 检查连接表单、默认能力、额度表格、记忆列表和数据管理分别不超过 720/560/760/840/760px，桌面行高保持 32–36px。
3. 在 390×844 与 200% 缩放下检查无页面级横向溢出、粗指针目标至少 44px；更多默认能力、手动模型、额度配置、记忆编辑和完整重置均可键盘操作。
4. 打开记忆、额度配置与完整重置弹层，验证 Tab 焦点不离开弹层、Escape/遮罩关闭、关闭后恢复触发器焦点，且控制台没有 warning/error 或框架覆盖层。

# 对话工作台补充验收

1. 在 AI 连接保存文本、多模态和 Google Gemini 转写连接，分别执行“仅回复 OK”与录制“语音输入测试”。
2. 在桌面拖动对话到嵌套文件夹，在移动端通过移动抽屉回到根目录；确认刷新后仍保持。
3. 选择文档、图片、音频，确认仅显示附件名、类型、尺寸和摘要；图片缺少多模态连接时应阻止发送。
4. 检查输入栏图标均有悬浮提示，无自绘闪烁竖线，并在 1536×1024 与 390×844 检查无横向溢出。
5. 点击普通标题、导航和消息文字，确认 caret 不显示；点击输入框，确认原生 caret 仍可见。
6. 在 AI 连接刷新一次官方模型目录；断网后确认回退静态目录，且 localStorage 中不出现 API Key 或厂商原始响应。
## 公考树、拖拽与知识演进 smoke

1. 在 1536×1024 与 390×844 下确认公考、模块、板块筛选均默认折叠，逐层展开无横向溢出。
2. 创建文件夹和持久化对话，从名称区域拖入折叠文件夹，确认高亮、自动展开、浮层与 `review_workspace.aiConversations.folderId`；再拖回固定根目录目标并刷新复核。
3. 检查侧栏、设置、输入工具栏、工具步骤与额度行使用 Lucide，厂商位置使用本地品牌 SVG，所有图标按钮具有 `aria-label` 和悬浮提示。
4. 对已保存的七家重点厂商连接分别运行用途最小探针；未保存 Key 的厂商记录为未验证，不得伪造成功。
5. 生成知识演进提案，确认对象包络与历史数组都可解析；拒绝旧提案后来源可再次生成，最终空结果展示 provider、model、request ID、解析数与过滤数。
6. 检查控制台、网络错误恢复提示、敏感字段不落库，并完成 lint、contracts、build 与全套 E2E。
# 模型与实时语音人工 smoke

- 在 1536×1024 与显式 390×844（不得使用 393×727 默认设备）检查输入器无蓝色阴影、模型选择厂商层/模型层/运行层/返回操作和横向溢出；粗指针下所有选项与返回按钮至少 44px。
- 在对话 A 修改模型/运行档位后立即切到 B，确认 B 不显示 A 的乐观值；快速连续选择两项后最终值以最后点击为准，模拟写入失败时回滚并提示。发送消息前直接读取 `review_workspace.aiConversations`，确认选择已经落库；刷新后仍可恢复。
- 使用本地 mock provider 验证 `glm-5.2` 七档、旧 GLM 两档、Gemini 2.5 自定义预算、Claude 预算与未知 GLM；不得使用真实 Key 或外网。`glm-5.2-custom` 与 `glm-999` 不应显示运行菜单。
- 使用真实 Key 分别试听 OpenAI、Gemini、MiniMax、GLM 音色，确认只出现厂商支持字段且错误可见。
- 使用真实 OpenAI Key 完成 WebRTC 通话；首条最终用户转写前确认 `review_workspace` 没有新空白对话，结束后确认只保存最终双方转写。
- GLM 中继仅在单实例 `next start` 下验证；多实例和 Serverless 必须明确视为不支持。
# P1 错题、复盘与知识列表

- 1536×1024：进入“学习数据 → 批量管理”，验证筛选、全选、条目选择与右侧详情；进入“开始复盘”核对答案与轮次侧栏；进入知识库新增资料并确认列表与编辑区同步。
- 390×844：确认学习数据页仍显示“批量管理”，条目点击后进入顶栏下方全屏详情，返回按钮不被顶栏遮挡；复盘作答操作可见且页面无横向滚动。
- 深色模式：从设置切换后返回学习数据，复查列表边线、选中态、输入框和移动详情；同时检查控制台与框架错误层。
# P1 辅导与面试当前轮次 smoke（2026-07-23）

1. 从公考首页点击“开始对话辅导”，确认发送首条消息后才创建对话与关联辅导会话；刷新后可恢复可见消息、本轮目标、卡点、微测和复练计划。
2. 切换当前对话模型与运行档位后发送辅导请求，检查请求使用会话选择；模拟失败并重试，确认用户消息保留且 session、turn、plan 不重复。
3. 在 1536×1024 检查辅导双栏和面试双栏；在 390×844 打开“本轮进度/本题要点”抽屉，检查 Escape、焦点恢复、滚动锁定、44px 触控目标、安全区及无横向溢出。
4. 面试题库载入三类示例题，分别检查结构化、结构化小组和无领导小组的真实阶段 `aria-current`；语音不可用时必须可用键盘输入。
5. 提交文字稿并结束作答，确认直接进入真实复盘结果且原文字稿仍在；未结束前只显示“复盘后生成”，不得显示伪实时分数。
6. DevTools 检查 `review_workspace` 仍为 v16，辅导/面试表中不存在原始录音、摄像头帧、屏幕帧、`data:` 或 `blob:`。
7. 浅色和深色分别保存桌面/移动截图，与 `docs/design/p1-tutoring-interview/` 的四张确认稿对照；检查控制台、框架错误层、键盘路径和减少动态效果。
# P2 已安排与设置发布 Smoke

1. 在 1536×1024 打开“已安排”，确认摘要来自当前任务，任务与运行收件箱同时可见；搜索、状态筛选、选择、启停、立即运行和编辑不改变原调度语义。
2. 打开新建/编辑层，确认桌面侧栏与移动全屏流程可用；按 Escape、点遮罩后恢复触发器焦点，页面滚动恢复。
3. 在 390×844 切换任务/收件箱页签并打开任务详情抽屉，确认无横向溢出、触控目标不小于 44px、安全区有效。
4. 打开设置并切换 AI 连接；验证保存连接表格/移动列表、无密钥详情、连接测试和文本/多模态/语音默认能力。
5. 使用移动分区选择器依次进入外观、额度、MCP、诊断，刷新后仍保持仓储数据；返回应用后再次进入设置应回到外观。
6. 浅色/深色分别检查控制台、框架错误、键盘路径、`prefers-reduced-motion` 和页面级溢出。

# P3 全产品最终收口 Smoke

1. 在 1536×1024 打开导入资料，确认来源/草稿 38/62 主从布局，文件、文本、粉笔实验导入、诊断、批量确认和撤销仍可达；确认前错题库与知识库计数不变。
2. 在 390×844 依次切换“来源、草稿、确认”，检查 44px 触控目标、安全区、步骤状态保持和零文档级横向溢出。
3. 进入知识训练，检查队列筛选、闭卷画布、会了/犹豫/不会和刷新恢复；移动底部操作区不遮挡正文。
4. 进入“学习数据 → 薄弱分析”，切换 7/30/90 天和全部；验证孤立复盘被忽略，少于 5 次显示“数据不足”，动作只进入复盘或知识训练。
5. 打开插件管理，确认只有声明式扩展市场、Obsidian Vault、粉笔导入；详情显示来源、状态、能力、签名说明、本地数据边界与恢复动作，MCP 不出现。
6. 从触发按钮打开全局搜索，使用上下键、Enter、Tab、Shift+Tab 与 Escape；桌面为居中面板，移动为覆盖顶栏的全屏层，关闭后焦点回到触发器。
7. 浅色/深色在 1536×1024 与 390×844 检查 14 个 ViewKey、主要编辑层和底部抽屉；检查控制台、框架错误、减少动态效果和页面级溢出。

# P3 ReviewWorkspace 架构收口 Smoke

1. 运行架构契约，确认 `review-workspace.tsx` 不超过 150 行，顶层 controller/router 不超过 300 行，领域 controller 与任意 React component 不超过 500 行。
2. 确认 route 文件不导入 repository/service，低频视图仍使用模块顶层的显式 `next/dynamic`，加载占位只渲染 `WorkspaceViewState`。
3. 复验旧 `stats` 入口、首次消息后创建对话、导入确认、复盘计时、知识训练、Obsidian 删除预检和设置恢复导航。
4. 运行 `npx tsc --noEmit`、`npm run lint`、`npm run test:contracts`、`npm run build` 与完整 `npm run test:e2e`。
5. 在 1536×1024 与 390×844、浅色与深色下抽查 P3 基准表面；确认零新增布局偏差、零控制台错误、零页面级横向溢出和零失效键盘路径。

# 0.2.0 升级闭环 Smoke

1. 运行 `typecheck`、`lint`、210 个 contracts、生产 build、bundle 5% 门禁与桌面/移动 axe；确认业务源码兼容类型引用为 0，核心 facade 均小于 500 行。
2. 使用本地 mock 验证 AI 连接、对话流、模型切换、SSE、拖拽、MCP discover/call、粉笔导入、已安排成功/失败与根错误恢复。
3. 在 1536×1024、390×844、浅色/深色、键盘、200% 缩放和减少动态效果下检查控制台、框架错误、焦点恢复、横向溢出和 serious/critical axe。
4. 真实 Vault 与真实模型凭据只做人工本机 smoke；仅登记脱敏环境、成功/失败和失败类别，不保存正文、额度、密钥或原始响应。

## 2026-07-23 自动验收记录

- 通过：typecheck、lint、210 contracts、Next 16.2.11 生产构建、5% 包体预算、生产 audit 的 0 high/critical。
- 通过：51 项 Playwright 桌面/390×844 回归，包含 AI、对话、真实指针拖拽、MCP/粉笔 mock、已安排、浅深色与双端 axe。
- 通过：应用内浏览器总览、动态设置与诊断页 smoke；控制台 0 error，诊断页正确显示版本 `0.2.0`。
- 未执行：真实 Obsidian Vault、真实模型与额度凭据；等待人工提供临时 Vault/凭据环境后按本清单登记脱敏结果。

## 2026-07-27 · 统一工作台验收

1. 在 1536×1024 与 1115×792 分别打开总览、空白对话、历史对话、设置和 AI 连接；确认 `.chrome-content-frame` 与 `<main>` 的 `top` 均精确为 12px、底部贴合视口。
2. 展开和折叠侧栏，确认页面始终只有一个 `.chrome-shell`，设置往返后同一 DOM 节点仍存在；折叠后工作区仍保持 12px 上沿。
3. 开关浅色/深色与弥散，确认顶部区和侧栏只由 `.chrome-shell::before` 绘制连续背景，工作区共边无阴影、渐隐或重复边框。
4. 在 1115×792 使用“重新输入密钥”恢复态，确认编辑/重新输入、测试、删除三个动作均可见且不换行，表头与数据列中心线一致。
5. 在 390×844 打开设置抽屉并用 Tab、Shift+Tab、Escape 验证焦点锁定和恢复；确认工作区从横跨顶栏下方开始、取消左上圆角、三个连接动作全部保留且页面无横向溢出。
6. 保存桌面总览、对话、1115×792 AI 连接与 390×844 AI 连接截图；检查控制台、Next 错误层、滚轮/触控/键盘滚动和页面级横向溢出。

- 自动验收结果：typecheck、lint、247 项 contracts、Next 16.2.12 生产构建通过；Playwright 55 项通过，1 项仅用于显式归档的视觉采集按设计跳过。
- 应用内 Browser 可直接验收开发服务器；确认 React 调试不再触发 CSP 错误，同时生产响应的 `script-src` 仍不包含 `unsafe-eval`。
# v0.2.1 增量验收

- 在 1536×1024 与 390×844 检查开发示例：总览的“今日队列/薄弱板块”、已安排的“任务/运行收件箱”必须同时非空。
- 面试训练检查载入三类示例题、重复载入不新增、逐题删除、暂停/继续、结束冻结以及刷新后暂停状态。
- 安装版检查 `review-app://workspace`、随机 loopback 与令牌边界、关闭后的子进程清理、覆盖安装后的数据保留。
- 在安装副本中分别模拟资源哈希异常和 Next 启动失败，确认错误文案分别为资源校验失败与桌面服务未能启动。

# v0.2.2 增量验收

- 在 1536×1024 验证对话主题窄栏、高亮与点击定位；在 390×844 验证“主题 N”底部抽屉、焦点锁定和 Escape/遮罩关闭。
- 验证无溢出和位于底部时不显示跳转按钮；向上阅读后出现仅图标按钮，流式新消息不强制滚动，点击后回到底部。
- 逐个载入示例场景，确认真实组件非空、退出后个人数据恢复、一键清理不删除个人记录，并检查示例模式无网络、文件、Vault 或真实 AI 调用。
- 面试分别验证零回答中止、未提交文字的部分复盘、已有回答中止、刷新后冻结和训练计划完成次数不变。
- 粉笔验证纯 Cookie、`Cookie:` 前缀、换行、401/重定向、429、超时和格式变化反馈；失败候选不得覆盖已有密文。
- 桌面版首次选择 Vault 后重启恢复；验证路径穿越、符号链接、非 Markdown 和超限正文均被 IPC 拒绝。
- 从 Squirrel 根启动器立即启动安装副本，验证首次瞬时 spawn 自动恢复、连续失败诊断、手动重试清理、覆盖安装和用户数据保留。

# 2026-07-30 · UI 审查、同步与目录验收

1. 先清理全部审查记录，逐个一级视图验证首次空白；再安装当前模块与完整包，刷新后确认正常、密集、长内容、筛选无结果和未选择详情状态可达。
2. 重复安装同一包，确认记录数不增长；用原有编辑和逐条删除修改审查记录；执行“删除审查数据”后确认 `ui-review:` 记录归零且预先创建的个人记录、真实连接元数据和 Vault 配置未变化。
3. 审查数据存在期间尝试对话发送、粉笔验证、MCP discovery/调用、立即运行任务和 Obsidian 同步；所有入口必须在请求或文件 I/O 前被拒绝。清理后恢复真实入口。
4. 使用本地 mock Registry 验证分页、5 分钟缓存、latest/active/Streamable HTTP 过滤、超时和响应上限；目录添加后必须停用，完成鉴权与 discovery 后才能启用。
5. 粉笔分别输入纯 Cookie、完整 `Cookie:` 请求头和 Copy as cURL；验证候选替换、401/403/登录重定向、分页重复、内容哈希兜底、结构变化、限流与日志脱敏。
6. 使用临时真实 Vault 验证 Electron 递归监听、1 秒防抖、运行中补跑、权限丢失、冲突和无同步循环；renderer 事件不得出现正文、文件名或绝对路径。
7. 在 1536×1024、1115×792、390×844 的浅色与深色下检查总览、错题、复盘、知识、训练、统计、对话、导入、已安排、面试、辅导、设置、MCP、扩展和 Obsidian；检查键盘、焦点、滚动、横向溢出和控制台。
8. 对照 `docs/design` 最新页面设计和 `docs/ui-review-fidelity-ledger.md` 保存实现截图。已安排在 1115×792 下必须切为单列，收件箱筛选与按钮不得被裁切；主要几何偏差目标不超过 2px。
9. Node 22 执行 `typecheck`、`lint`、`test:contracts`、桌面/移动 E2E、`audit:prod`、`build`、`check:bundle`、`desktop:compile`、桌面测试与打包。

# 2026-08-02 · 粉笔专用导入与审查启动器验收

1. 普通生产入口不显示空 UI 审查工具；使用 `?ui-review=1` 后显示紧凑入口，设置外观分区没有 AI 场景，AI 连接分区显示密集与凭据恢复场景。
2. 1536×1024 验证审查弹层不改变侧栏宽高；390×844 验证底部层无横向溢出，并可载入、刷新持久化和清理。
3. 粉笔导入只显示账户同步、官方导出/截图和粉笔文本；验证批次五态、逐批页码、异常校对、批量确认和 30 秒撤销。
4. 知识库生成模板草稿后在知识库内完成编辑、删除和确认，不再跳转粉笔页面。
5. 抽查关闭、返回、编辑、刷新、保存、同步、删除与确认按钮的图标、可访问名称、键盘焦点和 Tooltip。

# 2026-08-02 · Codex 对话、插件与 Electron 顶栏增量验收

1. 在 1536×1024 载入多轮对话，确认消息区宽度不再为主题目录预留固定列；短横线默认紧凑，hover/focus 展开标签，活动主题使用更强中性色，点击后滚动到对应用户消息。
2. 在 390×844 确认桌面轨道隐藏、“主题 N”入口打开底部抽屉；验证 Tab 锁定、Escape、遮罩关闭与触发器焦点恢复。
3. 插件列表不得出现表头、分隔线、常驻详情列或市场伪插件行；行主体打开详情，开关和三点不触发行点击，三点只在 hover/focus 或粗指针环境显示。
4. 停用 Obsidian 与粉笔后，知识库和导入入口仍可见但不得执行同步/导入；提示应导航插件页。重新启用后数据、Vault 配置、草稿和凭据保持不变。
5. 安装声明式目录包后确认一级插件行出现；停用后撤销主题/人设效果，卸载后记录立即消失，官方目录仍可重新安装。内置插件菜单不得出现卸载。
6. Electron 安装版检查 52px 标题栏拖动、双击最大化、系统最小化/最大化/关闭按钮与深浅主题对比；浏览器版顶栏保持 52px 且不绘制伪窗口按钮。
7. 双端检查 16px 导航图标、0.8rem 文字、页面横向溢出、控制台、Next 错误层、键盘焦点和 serious/critical axe，并保存对话、插件列表与详情截图。
8. 桌面确认主题轨道围绕消息正文中线且只有最后一条常驻高亮；hover 旧项应出现摘要卡，离开后恢复弱色。移动端抽屉应显示摘要和附件数。
9. 打开 Composer 上下文面板并切换模型，确认分母与余量更新；历史足够时执行压缩，刷新后摘要边界仍在且最近六轮保持原文。
10. 插件页默认不得直接进入详情；插件市场需验证搜索、真实权限/版本/签名/SHA-256、本地导入预览，且不重复展示已安装卡片区。
