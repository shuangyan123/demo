# Windows installer migration M0 — electron-builder + bundled NSIS POC

Date: 2026-08-20

## Scope and conclusion

This is an additive compatibility proof of concept. The accepted Forge/Squirrel
path remains the default production path. M0 does not install the new NSIS
artifact and does not implement migration, uninstall, shortcut, updater, or
userData cleanup behavior.

**M0 conclusion: PASS**

The conclusion is limited to the generated Windows x64 artifact and the
provider-free local readback listed below. It is not installed-app lifecycle
acceptance.

## Fixed baseline

| Item | M0 value |
| --- | --- |
| Base main | `4243c66f62725e77f6d25afd0f6198f4092ae140` |
| Task branch | `poc/windows-nsis-m0-compatibility` |
| Package / product | `review-workspace` / `错题复盘` |
| Version | `0.2.4` |
| Executable | `review-workspace.exe` |
| Electron | `43.2.0` |
| Builder | `electron-builder@26.15.3` |
| Windows target | x64, bundled `nsis` only |
| Compatibility appId | `com.squirrel.review_workspace.review-workspace` |
| Existing renderer partition | `persist:review-workspace` |
| Existing observed userData | `%APPDATA%\错题复盘` |

The M0 appId is the current observed Squirrel AUMID compatibility proposal.
No `app.setAppUserModelId` runtime change was made.

## Packaging design

- `electron-builder.m0.cjs` is separate from `forge.config.ts` and is not
  referenced by `desktop:make`, `desktop:package`, or the release workflow.
- The builder consumes the existing `desktop:prepare` outputs: `.desktop`,
  `.desktop-app`, and `.desktop-runtime`.
- `electronDist` points to the verified local Electron 43.2.0 archive cache.
- The packaged app contains `resources/app.asar` and one
  `resources/.desktop-runtime`; the runtime is not copied into `app.asar` and
  no root `node_modules` tree is packaged.
- The NSIS target is bundled, one-click is disabled, finish-launch is disabled,
  differential packages are disabled, publishing is `null`, and no
  `latest.yml`, updater, or external payload is produced.
- The artifact name is
  `ReviewWorkspace-0.2.4-NSIS-M0-POC.exe`.

The builder's nested `@electron/fuses@1.8.0` cannot describe Electron 43's
ninth fuse. The M0 `afterPack` hook therefore uses the repository-pinned
`@electron/fuses@2.1.3` `flipFuses` API with
`strictlyRequireAllFuses: true`; the existing Forge fuse writer is unchanged.

## Actual artifact readback

Readback paths:

- Unpacked executable:
  `out/builder-m0/win-unpacked/review-workspace.exe`
- ASAR:
  `out/builder-m0/win-unpacked/resources/app.asar`
- NSIS installer:
  `out/builder-m0/ReviewWorkspace-0.2.4-NSIS-M0-POC.exe`

Observed values from the final local builder run:

| Check | Observed result |
| --- | --- |
| Installer size / SHA-256 | Recorded by the exact-head delivery readback; NSIS output metadata may vary between builds |
| ASAR size / SHA-256 | `49316` / `06c08670fb87393102fbdb45c36110039bf0856267db4e22ef761974e143057a` |
| Electron version readback | `43.2.0` |
| PE FileVersion / ProductVersion | `0.2.4` / `0.2.4.0` |
| PE ProductName / FileDescription | `错题复盘` / `错题复盘` |
| PE InternalName | `review-workspace` |
| Runtime manifest | `1530` files, SHA-256 manifest, Node `22.23.1` |
| Preload | packaged `.desktop/preload.cjs` hash equals compiled `.desktop/preload.cjs` |
| App contents | `.desktop/main.js`, `.desktop/preload.cjs`, and exact app metadata present; no root `node_modules` |
| Resources | `app.asar` and one `.desktop-runtime`; no `resources/app` directory |
| NSIS updater metadata | no `.blockmap`, no `latest.yml` |

The actual fuse wire readback is:

```text
version: 1
RunAsNode: DISABLE
EnableCookieEncryption: ENABLE
EnableNodeOptionsEnvironmentVariable: DISABLE
EnableNodeCliInspectArguments: DISABLE
EnableEmbeddedAsarIntegrityValidation: ENABLE
OnlyLoadAppFromAsar: ENABLE
LoadBrowserProcessSpecificV8Snapshot: DISABLE
GrantFileProtocolExtraPrivileges: DISABLE
WasmTrapHandlers: ENABLE
```

The actual PE `INTEGRITY/ELECTRONASAR` resource was read back from the built
executable. The `resources\\app.asar` entry equals the SHA-256 of the raw ASAR
header:

```text
expected raw ASAR header hash: 076447aea6a507395c85260b4e0aaa0f0389c437f95afcae9f5a0c768abffa08
actual PE resource value:      076447aea6a507395c85260b4e0aaa0f0389c437f95afcae9f5a0c768abffa08
```

The native builder also emits a `resources\\default_app.asar` integrity entry;
it was read back and allowed as the second Electron resource entry.

## Regression and validation evidence

- `npm ci`: PASS; npm reported existing dev-tree advisories, while the
  production audit below was clean.
- `npm run audit:prod`: PASS (`low=0`, `moderate=0`, `high=0`, `critical=0`).
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test:contracts`: PASS (`498/498`).
- `npm run build`: PASS.
- `npm run check:bundle`: PASS (`initialJavaScriptBytes=1306100`, with no
  failures).
- `npm run desktop:compile`: PASS.
- `npm run test:desktop`: PASS (`30/30`).
- `npm run test:desktop:integration`: PASS.
- `npm run desktop:prepare`: PASS; runtime manifest reported `1530` verified
  files and the verified Electron archive was reused.
- M0 unpacked builder and NSIS builder: PASS.
- M0 source and artifact contracts: PASS (`4/4` combined in the artifact run).
- Existing `npm run desktop:make` Squirrel path: PASS. The generated
  `review_workspace-0.2.4-full.nupkg` was `186833379` bytes with SHA-256
  `59730ebfaaf537dd51b8d4ce772e980240a22340167683c399d5fc521013096a`; the
  existing Squirrel artifact contract passed `3/3`.
- `git diff --check`: PASS.

## Explicit non-claims and staged migration boundary

No NSIS installer was installed, launched, upgraded, uninstalled, or used with
a real user profile. Therefore the following remain pending and are not implied
by M0: shortcut/AUMID shell continuity, `%APPDATA%\错题复盘` persistence across
installation lifecycle, credentials and DPAPI behavior, same-version
replacement, adjacent-version upgrade, uninstall cleanup, running-app safety,
and recovery after interruption. Portability and cross-machine credential
claims remain untested.

The staged migration plan is:

| Phase | Boundary |
| --- | --- |
| M0 | Artifact compatibility proof — **COMPLETE / PASS**. |
| M1 | Production-quality candidate packaging infrastructure plus independent Windows GitHub Actions rebuild/readback. |
| M2 | Fresh-profile real Windows NSIS installed-app acceptance: install, launch, expected userData, production UI sentinel, ordinary restart, and shortcut/shell/AUMID observations. |
| M3 | Existing Squirrel 0.2.4 → NSIS migration: existing-user path, userData continuity, credential/safeStorage/DPAPI continuity, and legacy Squirrel cleanup semantics. |
| M4 | NSIS uninstall, reinstall, and running-app lifecycle. |
| M5 | Signing, release, and updater work kept separately scoped. |

The immediate next task after M0 is **M1 candidate packaging plus independent
Windows CI rebuild/readback**. Real Windows NSIS installer execution is M2 and
remains pending; it is not the next task and is not implied by this M0 proof.
