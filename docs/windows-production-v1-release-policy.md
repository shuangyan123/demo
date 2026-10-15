# Windows production-v1 release policy

当前私有 Pilot 状态（2026-10-15）：见 [Recall 0.3.1 Windows Pilot](recall-0.3.1-windows-pilot.md)。
PR #125 已于 2026-09-07 合并；当前 `main` 包含 Electron `43.5.0`，但这不代表真实 Setup 生命周期验收或发行授权。
PR #126 仍为历史 Draft，不能重放其旧运行时 tuple。本次没有 tag/Release/公开发布，仍需独立审查。
以下 M5-G 阶段标签及记录保留其历史上下文，不能作为当前 Pilot 的通过证据。

历史 M5-G 状态：**M5-G RECOVERY FIX / 0.3.1 SOURCE CANDIDATE / NOT YET FROZEN /
NOT TAGGED / NOT ACTIVATED; PR #125 DRAFT / WINDOWS PRODUCTION RELEASE NOT READY**。

本文是首个 Windows production-v1 发布的签名、完整性、发布流程与剩余
blocker 的事实源。它不修改既有 M3/M4 历史证据，也不把实现后的 pipeline
误写成真实 tag/Draft 执行或 Level 3 acceptance。M5-F originally froze and
recorded the historical `0.3.0` production tuple. A subsequent activation attempt
failed the trusted Windows release E2E gate; the exact `v0.3.0` tag therefore
remains an immutable unpublished failed candidate. The recovery candidate's
`main` source SHA remains dynamically bound by the later freeze/main state。
M5-E 已完成 build finalization、staged-byte SHA-256/manifest readback、实际
unsigned Authenticode 检查，以及 exact-SHA Actions artifact 下载后的 checksum
readback；不得把这些证据扩大为已发布或已完成最终 Windows acceptance。

本轮 M5-G recovery candidate 为 package version `0.3.1`。原 `v0.3.0`、SHA
`6e7ccc35e69c6a6b4f0337ebf77f27f8dd4ab1e3` 是 **FAILED UNPUBLISHED CANDIDATE /
IMMUTABLE**：其 exact tag 必须保持在该 SHA，不得删除、移动、强制更新、复用或
发布；当前没有对应 GitHub Release。当前 `0.3.1` 仅是 source candidate；本轮不
创建 `v0.3.1` tag、Draft Release 或 GitHub Release，也不代表 Windows production
release 已 ready。

## Canonical product decision

```text
WINDOWS PRODUCTION-V1: INTENTIONALLY UNSIGNED
PRODUCTION-V1 SIGNING POLICY: INTENTIONALLY UNSIGNED
PRODUCTION WINDOWS INSTALLER IS EXPECTED TO BE UNSIGNED
```

Production-v1 不购买、配置、集成或模拟代码签名。以下项目不是 M5
production-v1 requirement 或 blocker：

- code-signing certificate、OV 或 EV certificate；
- Azure Artifact Signing、SignPath 或 DigiCert KeyLocker；
- PFX、hardware signing token 或 production signing key；
- Authenticode signature、publisher certificate chain 或 verified publisher；
- RFC3161 timestamp 或 timestamp server；
- signing secret、certificate rotation 或 signing-key compromise procedure；
- SmartScreen reputation attainment。

未来可以建立独立里程碑：

```text
FUTURE: WINDOWS CODE SIGNING / PUBLISHER IDENTITY
```

只有在 meaningful adoption、安装警告造成显著摩擦、enterprise distribution、
future updater architecture 或明确商业依据出现时再重新评估；本 M5 不设计
provider integration。

## Accepted production-v1 residuals

以下是明确接受的产品限制，不是 build failure 或 release acceptance failure：

- Windows 可能显示 `Unknown Publisher`；
- Microsoft Defender SmartScreen 可能显示 warning 或额外确认；
- 没有 verified Authenticode publisher identity；
- 没有 certificate-backed artifact identity；
- 没有 established SmartScreen publisher reputation；
- 没有 auto-updater。

不得声称 Authenticode integrity、certificate-chain validation、RFC3161
timestamping、verified publisher 或 no-warning installation。仅出现预期的
`Unknown Publisher` / SmartScreen warning 不能单独使候选失败。

## Production-v1 security model

```text
trusted source provenance + exact artifact SHA-256
```

Unsigned 不降低 SEC-04。Production-v1 必须保留：

- trusted/reviewed `main`；
- successful main CI；
- trusted default-branch `workflow_run`；
- exact authorized main SHA；
- exact `v${package.version}` tag target；
- exact-SHA build 与 artifact identity binding；
- SHA-256 checksum；
- Draft GitHub Release；
- owner/operator publication approval。

当前 trusted workflow 已按 exact authorized SHA 构建 canonical
electron-builder + NSIS production-equivalent installer。Forge/MakerSquirrel
仍保留在仓库，作为历史 0.2.x、迁移、回滚和兼容性验证路径；它不再是
production/default builder。当前 package/runtime baseline 为 `0.3.1` / Electron
`43.5.0`（GHSA-qmv3-fv6v-rmhq 安全修复 source candidate，尚未集成或发布）；M5-F 的历史 Electron `43.4.1` main-process readback 记录 embedded Node
`24.18.1`，bundled application/sidecar Node 仍为 `24.20.0`。首个 NSIS
production recovery source candidate 为 `0.3.1`；M5-F 的 `0.3.0` tuple 只保留为
历史 freeze 与后续失败候选证据。

M5-F static tuple：package version `0.3.0`、expected tag `v0.3.0`、stable、
Windows x64、NSIS、per-user、installer
`ReviewWorkspace-0.3.0-Windows-x64-Setup.exe`、intentionally unsigned、
`NO AUTO-UPDATER`。在 M5-F milestone 当时，`v0.3.0` tag 尚未创建；后续
activation attempt 使用了 exact SHA 后 trusted Windows release E2E gate 失败，
因此当前 exact tag 仍固定在 `6e7ccc35e69c6a6b4f0337ebf77f27f8dd4ab1e3`，且没有
published Release。`sourceCommit` 继续由 trusted checkout 的 exact Git SHA 在构建
时绑定，不能在 PR 中预写最终 main SHA。

## Mandatory 0.3.1 production tuple re-freeze

PR #125 is **M5-G RECOVERY FIX** only. It prepares the `0.3.1` source candidate
and the exact Windows/Node `24.20.0` full-E2E gate; it does not freeze the final
`0.3.1` production tuple, create its tag, or activate M5-G. After PR #125 merges,
the recovery source changes may be on `main`, but the `0.3.1` production tuple is
still **NOT YET FROZEN**.

A later dedicated, reviewed and merged freeze milestone is mandatory before any
real M5-G activation. That change must record the following static identity and
security fields; the final source/main SHA is the exact result of that freeze
merge and must be followed by an exact post-freeze `main` CI pass.

| field | required frozen value or boundary |
| --- | --- |
| package version | `0.3.1` |
| expected tag | `v0.3.1` |
| installer filename | `ReviewWorkspace-0.3.1-Windows-x64-Setup.exe` |
| platform / architecture | Windows / x64 |
| channel / installer | stable / NSIS / per-user |
| Electron | `43.5.0` security source candidate; requires the later reviewed re-freeze |
| Electron embedded Node | `24.19.0` actual main-process readback for the security source candidate |
| bundled Node | `24.20.0` |
| electron-builder | `26.16.0` |
| app identity | appId `com.squirrel.review_workspace.review-workspace`; productName `错题复盘`; executable `review-workspace` |
| signing boundary | intentionally unsigned; `CSC_IDENTITY_AUTO_DISCOVERY=false`; Authenticode `NotSigned`; signer absent; timestamp signer absent |
| publishing / updater | `publish=null`; `NO AUTO-UPDATER`; `latest.yml` absent; blockmap absent |
| strict fuse tuple | `strictlyRequireAllFuses=true`; `RunAsNode=false`; `EnableCookieEncryption=true`; `EnableNodeOptionsEnvironmentVariable=false`; `EnableNodeCliInspectArguments=false`; `EnableEmbeddedAsarIntegrityValidation=true`; `OnlyLoadAppFromAsar=true`; `LoadBrowserProcessSpecificV8Snapshot=false`; `GrantFileProtocolExtraPrivileges=false`; `WasmTrapHandlers=true` |

The required order is:

```text
PR #125 M5-G recovery fix
  -> exact Windows + Node 24.20.0 full E2E PASS
  -> owner-authorized PR #125 merge
  -> exact post-merge main CI PASS
  -> NEW 0.3.1 PRODUCTION TUPLE FREEZE MILESTONE
  -> freeze the static tuple above in a reviewed/merged change
  -> exact post-freeze main CI PASS
  -> owner authorization for activation
  -> confirm v0.3.1 tag and Release are absent
  -> create v0.3.1 at the exact frozen main SHA and verify the tag
  -> rerun the same successful main CI
  -> trusted workflow -> NSIS artifact -> Draft Release round-trip
```

The `0.3.1` re-freeze is therefore a hard prerequisite for M5-G activation;
PR #125 must not be described as the final production freeze.

## Unsigned artifact contract

### Expected

- production installer 没有 project Authenticode signature；
- repository 没有 production signing backend 或 signing secret；
- unsigned status 是显式产品决策；
- Windows build 禁止意外 certificate auto-discovery；
- `CSC_IDENTITY_AUTO_DISCOVERY=false` 或等价边界必须随 active NSIS production
  path 保留；
- `forceCodeSigning: true` 不得用于 production-v1。

### Failure

- production documentation 声称 installer 已签名或 publisher 已验证；
- production workflow 意外发现或使用 signing identity；
- 出现 unknown/unapproved project signing certificate；
- checksum 生成后 installer bytes 发生变化；
- unsigned 状态被描述为偶发配置失败；
- tested、Draft Release 和 published asset 的 bytes/hash 不一致。

## SHA-256 integrity policy

SHA-256 是 production-v1 的关键完整性控制。最终实现必须按此顺序执行：

M5-E 的 trusted workflow 现在按以下顺序完成 final staged artifact boundary：

1. bind authorized source commit；
2. build final installer；
3. clean `out/release/` and copy the canonical NSIS installer；
4. hash the FINAL staged installer bytes；
5. require source SHA-256 == staged SHA-256；
6. write and independently parse `SHA256SUMS.txt` with exactly two spaces and the
   package-version-derived filename；
7. reconcile `production-evidence.json` with the same source/staged bytes；
8. inspect the final staged installer with Windows `Get-AuthenticodeSignature` and
   require `NotSigned` with no signer or timestamp signer；
9. verify the exact two-file release boundary before Actions upload；
10. verify the downloaded exact-SHA Actions artifact again before Draft creation；
11. read back the actual Draft Release metadata, download its two asset records by
    asset ID into a distinct directory, and compare the independently hashed bytes
    and byte sizes against the canonical directory。

M5-G recovery implementation supplies the remaining Draft round-trip controls;
the later re-freeze and real activation still require:

1. bind intended source/tag/release tuple；
2. create or safely resume only a stable, unpublished Draft Release with the exact
   two expected assets；
3. re-download the actual Draft Release asset records；
4. re-hash the downloaded bytes；
5. compare against the canonical final SHA-256 and byte size；
6. verify source/tag/artifact tuple reconciliation before operator publication and
   again after publication；published assets must not be silently replaced。

不得先验收一组 bytes，再用同一 tag/checksum 静默替换 installer。

## Production-v1 release notes

Release notes 必须包含与下列含义等价的显式说明：

> This Windows installer is currently unsigned. Windows may display Microsoft
> Defender SmartScreen or Unknown Publisher warnings during download or
> installation.

最终 release notes 还必须记录：version、source SHA、installer filename、
installer SHA-256、architecture、Windows support scope、migration/upgrade
notes、known residuals 和 recovery/rollback guidance。不得声称 signed
publisher identity。

## Version, channel, and updater

- current recovery NSIS source candidate：`0.3.1`；
- expected recovery tag：`v0.3.1`，继续遵循 `v${package.version}`；本轮不创建实际 tag；
- initial channel：stable only；
- distribution：manual GitHub Release/download；
- production-v1 updater policy：`NO AUTO-UPDATER`。

Production-v1 不引入 `electron-updater`、`autoUpdater`、
`update-electron-app`、`latest.yml`、blockmap publication、background polling
或 client-side private GitHub PAT。Updater 是独立未来里程碑。

历史 `0.2.x`、M3 和 M4 identity/evidence 保持原版本和原 claim boundary；不得
批量改写为 `0.3.0`；该版本是失败候选历史证据，必须保持 immutable。

## Remaining M5 production blockers

1. M5-G — execute the merged exact-SHA Draft Release asset round-trip against the
   final authorized tag and successful CI run；
2. M5-H — perform final Level 3 Windows acceptance on the exact final artifact；
3. M5-I — complete the release/rollback/operator runbook；
4. M5-J — operator publication and post-release verification。

GHSA-qmv3-fv6v-rmhq 是具体安全原因：当前 source candidate 将 Electron 从
`43.4.1` 升级至已验证候选 `43.5.0`，Recall 当前最低安全准入版本保持 `43.5.0`。
[Electron 项目维护者公告](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq)
的 43.x 修复版本列出 `43.4.2`；
[GitHub Advisory Database](https://github.com/advisories/GHSA-qmv3-fv6v-rmhq)
列出 `43.5.0`。两处来源的版本记录存在差异，不代表 Recall 已验证或准入 `43.4.2`。
旧 M5-F/F5 artifact 与历史验收记录保持原版本；
当前本地安全候选仍需独立账户的实际 production-entry 启动验证和后续发布门禁。
当前受控 NSIS builder 为 `electron-builder 26.16.0`；M5-F 已单独冻结最终 tuple。
不得以 prerelease/alpha 规避 tuple 验收。最终 tuple 必须分别记录 Electron version、
Electron embedded Node、bundled application/sidecar Node `24.20.0`、stable
electron-builder、历史/兼容 Forge/Squirrel、Windows architecture、NSIS mode、
exact main SHA、tag 和 package version。

## Final unsigned Level 3 boundary

最终 exact Draft Release asset 仍必须进行真实 Windows Level 3 replay：fresh
install、launch/close/restart/process-tree closure、closed-app uninstall、exact
candidate reinstall、same-account/profile userData 与 safeStorage/DPAPI continuity、
disposable credential live use、running-app uninstall、supported Squirrel baseline
迁移以及 final recovery。证据不得包含真实 credential。

除既有 lifecycle hard stop 外，以下情况必须停止：candidate/source/tag/hash 不匹配、
distributed bytes 与 tested bytes 不同、unexpected signing certificate、checksum
mismatch、userData/credential loss、需要 credential re-entry、owned process 残留、
需要 taskkill/delete/registry surgery、unexpected active Squirrel state 或 installer
无法完成正常 lifecycle。仅出现预期 Unknown Publisher 不是 hard stop。

## Production-v1 release sequence

```text
M5-B wait for stable electron-builder containing #10051
  -> M5-C controlled builder upgrade and regression validation
  -> M5-D NSIS production cutover (implemented)
  -> M5-E finalize unsigned artifact contracts and checksum provenance
  -> M5-F freeze 0.3.0 production tuple
  -> M5-G recovery E2E + exact-SHA Draft Release pipeline
  -> M5-H final Level 3 real-Windows replay
  -> M5-I release, rollback, and operator runbook
  -> M5-J operator publish and post-release verification
```

### M5-G recovery and activation boundary

M5-G 的 PR #125 只提供 recovery E2E synchronization、contracts、version-derived
source 和治理文档；它不创建真实 `v0.3.1` tag、Draft Release 或 publication。
PR #125 merge 后的 exact main CI 只证明 recovery source 已进入 main，不等于
`0.3.1` production tuple 已冻结，也不等于有 activation authority。

只有在单独的 `0.3.1` production tuple re-freeze milestone 完成 reviewed/merged
freeze、并且该 freeze merge 的 exact main CI 成功后，trusted owner/operator 才能
按以下顺序申请 activation：确认 `v0.3.1` tag 与 Release 仍不存在，确认
`v0.3.0` tag 仍精确指向 `6e7ccc35e69c6a6b4f0337ebf77f27f8dd4ab1e3` 且没有 Release，
再经 owner authorization 创建指向 exact frozen main SHA 的 `v0.3.1` tag 并验证
目标。随后必须重新运行同一成功 main CI；tag push 单独不触发 release authority，
也不能替代 `workflow_run`。

Trusted workflow 成功后必须仍停在 Draft，并保存 source SHA、tag commit、Actions
artifact identity、Draft Release/asset IDs、canonical 与 round-trip bytes/hash 的
machine-readable evidence。

任何既有 Release 的 published/non-Draft/prerelease 状态、额外或缺失 asset、tag
漂移、byte-size/hash mismatch 或 updater metadata 都是 hard stop。禁止移动 tag、
删除或替换 asset、使用 `--clobber`、发布 Release，或以 M5-H Level 3/M5-I/M5-J
未完成的工作替代本阶段 evidence。

发布流程中不存在 signing step。Actions quota 不可用时，不得移除 CI gate、绕过
SEC-04、提前创建 tag、用 local build 替代 trusted production artifact 或削弱
workflow security。

## Rollback

- never move an existing release tag；
- never silently replace an asset under the same tag；
- preserve previous stable installers；
- prefer a higher-version hotfix；
- preserve userData compatibility and document downgrade support；
- do not overwrite historical release bytes。

Certificate revocation/rotation 不属于 production-v1 blocker；仅在未来 signing
里程碑中定义。

## Classification

```text
M5-D: NSIS PRODUCTION CUTOVER IMPLEMENTED
M5-E: UNSIGNED ARTIFACT / CHECKSUM PROVENANCE IMPLEMENTED
M5-F: HISTORICAL 0.3.0 PRODUCTION TUPLE FREEZE
POST-ACTIVATION OUTCOME: v0.3.0 IMMUTABLE FAILED UNPUBLISHED CANDIDATE
M5-G: RECOVERY FIX / PR #125 DRAFT
0.3.1: SOURCE CANDIDATE / NOT YET FROZEN / NOT TAGGED / NOT ACTIVATED
MANDATORY NEXT: NEW 0.3.1 PRODUCTION TUPLE FREEZE BEFORE M5-G ACTIVATION
REAL ACTIVATION: PENDING
M5-H/I/J: INCOMPLETE
PRODUCTION-V1 SIGNING POLICY: INTENTIONALLY UNSIGNED
WINDOWS PRODUCTION RELEASE READY: NO
```
