# Windows installer migration M1 — NSIS candidate packaging

Status: **M1 candidate path implemented; final result is pending an exact-head
Windows GitHub Actions build/readback.** This document does not declare NSIS
production-ready and does not authorize installer execution.

## Scope and prerequisite

M1 is additive candidate packaging infrastructure plus an independent Windows
CI rebuild/readback. It is not production distribution cutover, Squirrel → NSIS
migration, installed-app acceptance, updater work, or signing.

The accepted M0 prerequisite is PR #93, merged into `main` as
`0d9479248011cdfe1ac49daf138d2a4649fdcdfe`:

```text
M0 COMPATIBILITY POC: PASS
```

M1 starts from that accepted `origin/main` SHA. The task branch is
`infra/windows-nsis-m1-candidate-ci`. The exact M1 source SHA is always taken
from `git rev-parse HEAD` locally or the verified exact PR head in CI and is
recorded as `sourceCommit` in `out/builder-nsis/candidate-evidence.json`.
The evidence generator fails closed if the worktree or checked-out SHA is
ambiguous.

## Fixed baseline

| Item | M1 value |
| --- | --- |
| Package / product | `review-workspace` / `错题复盘` |
| Version | `0.2.4` |
| Executable | `review-workspace.exe` |
| Electron | `43.2.0` |
| electron-builder | `26.15.3` |
| Windows target | x64, bundled `nsis` only |
| Compatibility appId | `com.squirrel.review_workspace.review-workspace` |
| Protocol | `review-app://workspace/` |
| Session partition | `persist:review-workspace` |
| Observed current userData | `%APPDATA%\\错题复盘` (M1 does not recreate or validate it) |
| Prepared runtime | `resources/.desktop-runtime` with Node `22.23.1` |
| Existing Squirrel path | unchanged production/default path |

## Candidate path

`electron-builder.nsis.cjs` is deliberately separate from
`electron-builder.m0.cjs`, `desktop:make`, and `desktop:package`.

The candidate uses:

- `target: nsis`, never `nsis-web`;
- `publish: null` and `--publish never`;
- artifact `ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe`;
- `perMachine: false` and `selectPerMachineByDefault: false` as the explicit
  per-user intent supported by electron-builder 26.15.3's installed schema;
- `shortcutName: 错题复盘` and `uninstallDisplayName: 错题复盘`;
- `signExecutable: false` with resource editing retained, so M1 is unsigned
  without relying on a local certificate. CI also sets the supported
  `CSC_IDENTITY_AUTO_DISCOVERY=false` boundary;
- no custom NSIS script, migration macro, installer directory override, icon
  URL, updater, or release publisher.

The NSIS toolchain may be downloaded by electron-builder during the build. This
is a build-time dependency for the pinned packaging tool, not an install-time
web payload. The generated candidate is bundled and contains no updater feed,
`latest.yml`, or `.blockmap`.

The path continues to consume the existing `desktop:prepare` outputs:

```text
resources/app.asar
resources/.desktop-runtime
```

It does not add a root `node_modules` tree, a duplicate runtime inside
`app.asar`, or a `resources/app` unpacked application directory.

## Security and artifact readback

The M1 candidate has one custom fuse writer, using the repository-pinned
`@electron/fuses@2.1.3` API and `strictlyRequireAllFuses: true`. The artifact
contract reads the final executable and requires this complete Electron 43 V1
wire:

```text
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

The exact current artifact is read back, not a stale M0 hash. The readback
requires:

- `resources/app.asar` and its SHA-256;
- the raw ASAR header SHA-256 and the PE `INTEGRITY/ELECTRONASAR` value to be
  equal;
- `.desktop/main.js`, `.desktop/preload.cjs`, and package metadata;
- no root `node_modules`, no `node_modules` in `app.asar`, duplicate runtime, or
  unpacked `resources/app`;
- every runtime manifest entry to exist and match its SHA-256;
- bundled `node.exe --version` to be `v22.23.1`;
- compiled and packaged preload hashes to match;
- no updater metadata.

## Machine-readable evidence

`npm run generate:desktop:builder:nsis:evidence` writes:

```text
out/builder-nsis/candidate-evidence.json
```

Schema version `1` records the source SHA, candidate identity, installer byte
size/SHA-256, relative artifact paths, executable versions, ASAR hashes, PE
integrity comparison, runtime manifest count/result, preload hashes, complete
fuse map (raw wire values plus state names), per-user intent, signing boundary, updater metadata, and—on CI—the
`GITHUB_RUN_ID`, job name, and exact checked-out head SHA. It contains no
credentials, tokens, raw provider data, or user-specific absolute paths.

The artifact contract performs a fresh Windows readback and compares it with
the recorded JSON. Local and CI installer SHA-256 values are not required to
match; each artifact must independently pass the same readback.

The hardcoded fallback in `app/config/app-metadata.ts` remains outside the
browser's full package metadata import, but M1 adds a contract that proves it
equals `package.json.version` so future version changes cannot silently drift.

## Windows CI

The additive `Windows NSIS Candidate` job runs only for pull requests on
`windows-latest` with Node `22.23.1`. It checks out
`github.event.pull_request.head.sha`, verifies that exact SHA, runs
`npm ci`, the production dependency audit, `desktop:prepare`, the unpacked and
bundled M1 builds, source contracts, artifact readback, and evidence
generation. It uploads the unsigned installer and evidence as a private
workflow artifact named:

```text
review-workspace-nsis-m1-<exact-pr-head-sha>
```

Retention is seven days. No tag, GitHub Release, public upload, or updater
feed is created. The terminal run ID, job ID, exact head, artifact identity,
and evidence result are recorded in the final PR delivery report and in the
CI evidence JSON.

## Evidence boundary

### PROVEN by M1 source/artifact contracts and exact-head CI

- candidate configuration is additive and opt-in;
- package, product, version, executable, Electron, x64, appId, NSIS target, and
  bundled runtime identity;
- strict nine-fuse readback and `strictlyRequireAllFuses=true` configuration;
- current app.asar contents, preload equality, runtime manifest, and bundled
  Node version;
- current PE embedded ASAR integrity equality;
- no updater metadata, install-time web payload, signing, or Squirrel path
  replacement;
- exact source SHA and independent CI artifact evidence.

### CONFIGURED / INFERRED

- per-user installer intent from `perMachine: false`;
- shortcut and uninstall display identity configuration;
- compatibility appId/AUMID proposal;
- absence of an approved repository product `.ico` and the resulting default
  icon behavior not being treated as accepted UX.

### PENDING REAL WINDOWS

- actual NSIS installation path;
- Start Menu/Desktop shortcut behavior and shell/AUMID continuity;
- installed NSIS `userData` path and production sentinel persistence;
- credential, safeStorage, and DPAPI behavior;
- Squirrel → NSIS existing-user upgrade and cleanup;
- uninstall, reinstall, and running-app uninstall lifecycle;
- signing, publisher identity, SmartScreen, and updater behavior.

M1 performs none of those operations and does not launch the Electron app or
run either installer.
