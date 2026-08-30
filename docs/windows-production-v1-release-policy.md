# Windows production-v1 release policy

状态：**M5 READINESS PLANNING COMPLETE / IMPLEMENTATION NOT STARTED**。

本文是首个 Windows production-v1 发布的签名、完整性、发布流程与剩余
blocker 的事实源。它不修改既有 M3/M4 历史证据，也不代表 NSIS production
cutover、最终 tuple、完整的 exact-SHA Draft round-trip pipeline 或 Level 3
acceptance 已完成。当前 workflow 的 final-byte hash/manifest 生成和 Draft
上传只属于部分实现，不得写成完整 pipeline 已完成。

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

当前 trusted workflow 仍构建 Forge/MakerSquirrel；当前 NSIS path 仍是
candidate-only。本政策不改变两条路径，也不关闭 Squirrel -> NSIS production
cutover blocker。

当前 production/default release path 仍是 Squirrel；NSIS 只有在独立的 future
production cutover 完成后才可成为 production path。当前 package/runtime
baseline 为 `0.2.4` / Electron `43.4.1`；首个 NSIS production target 仍规划为
`0.3.0`。

## Unsigned artifact contract

### Expected

- production installer 没有 project Authenticode signature；
- repository 没有 production signing backend 或 signing secret；
- unsigned status 是显式产品决策；
- Windows build 禁止意外 certificate auto-discovery；
- `CSC_IDENTITY_AUTO_DISCOVERY=false` 或等价边界必须随未来 NSIS cutover 保留；
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

现有 workflow 的 final-byte hash/manifest 生成、exact-SHA artifact 命名和 Draft
上传只部分满足这些要求；它尚未完成上传后 round-trip 或最终 tuple reconciliation。
完整 future pipeline 必须：

1. bind authorized source commit；
2. bind intended source/tag/release tuple；
3. build final installer；
4. hash the FINAL artifact bytes；
5. publish Draft artifact and `SHA256SUMS.txt` manifest；
6. re-download the uploaded Draft artifact；
7. re-hash the downloaded bytes；
8. compare against the recorded final SHA-256；
9. verify source/tag/artifact tuple reconciliation before operator publication and
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

- first production NSIS target：`0.3.0`；
- tag：`v0.3.0`，继续遵循 `v${package.version}`；
- initial channel：stable only；
- distribution：manual GitHub Release/download；
- production-v1 updater policy：`NO AUTO-UPDATER`。

Production-v1 不引入 `electron-updater`、`autoUpdater`、
`update-electron-app`、`latest.yml`、blockmap publication、background polling
或 client-side private GitHub PAT。Updater 是独立未来里程碑。

历史 `0.2.x`、M3 和 M4 identity/evidence 保持原版本和原 claim boundary；不得
批量改写为 `0.3.0`。

## Remaining M5 production blockers

1. GitHub Actions execution availability for required CI/release evidence；
2. first suitable stable electron-builder release containing upstream #10051；
3. controlled builder upgrade and regression validation；
4. Squirrel -> NSIS production cutover；
5. final `0.3.0` source/package/installer tuple freeze；
6. complete exact-SHA Draft Release round-trip pipeline；
7. final Level 3 Windows acceptance on the exact final artifact；
8. release/rollback/operator runbook。

Electron 保持已接受的 `43.4.1`，除非出现具体 security/compatibility 原因。
electron-builder `26.15.3` 不是最终 M5 tuple；不得用缺少 #10051 的 `26.15.7`
或 prerelease/alpha 规避等待。最终 tuple 必须分别记录 Electron version、
Electron embedded Node、bundled application/sidecar Node `22.23.1`、stable
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
  -> M5-D NSIS production cutover
  -> M5-E finalize unsigned artifact contracts and checksum provenance
  -> M5-F freeze 0.3.0 production tuple
  -> M5-G exact-SHA Draft Release pipeline
  -> M5-H final Level 3 real-Windows replay
  -> M5-I release, rollback, and operator runbook
  -> M5-J operator publish and post-release verification
```

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
M5 READINESS: PLANNING COMPLETE
PRODUCTION-V1 SIGNING POLICY: INTENTIONALLY UNSIGNED
WINDOWS PRODUCTION RELEASE READY: NO
```
