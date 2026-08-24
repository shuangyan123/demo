# Windows installer migration M4A — NSIS application lifecycle audit

Status: **M4 NSIS APPLICATION LIFECYCLE ACCEPTANCE: PASS**

M4 acceptance status: **PASS (operator-attested real-Windows acceptance)**. This
closure records the controlled Windows run on the exact candidate below. The
tested candidate was built from source `0aa7988a25523745e3b5e2bc6af0ce5717dce6c1`;
the later docs-only closure commit and final PR HEAD are intentionally different
and are not presented as the binary's build source. No secret, raw credential
envelope, provider payload, or complete userData dump was recorded.

## Scope and ownership

M4 owns the lifecycle of the existing per-user NSIS application after the M3
Squirrel-to-NSIS migration:

- normal NSIS uninstall with the application closed;
- reinstall after uninstall;
- same-account, same-machine `userData` continuity;
- Desktop-protected credential continuity without credential re-entry;
- shortcut and NSIS registry lifecycle;
- running-application uninstall;
- same-version install/reinstall while the application is running;
- process termination and restart boundaries; and
- classification of protected state and legitimate residuals.

M4 does not own the Squirrel-to-NSIS migration or Squirrel cleanup (M3),
signing/SmartScreen/reputation, updater or release cutover, production
publishing/readiness, cross-machine or cross-Windows-account credential
portability, or architecture redesign (M5 or out of scope).

The accepted baseline is the M3 squash merge on `origin/main`:

```text
d18ccfbc4b49978607fa4c26a68726e859115363
```

The lifecycle identity remains:

```text
package:          review-workspace
productName:      错题复盘
version:          0.2.4
executable:       review-workspace.exe
appId:            com.squirrel.review_workspace.review-workspace
Electron:         43.2.0
electron-builder: 26.15.3
install mode:     assisted NSIS, current-user acceptance path
install root:     %LOCALAPPDATA%\Programs\review-workspace
userData:         %APPDATA%\错题复盘
session partition: persist:review-workspace
NSIS GUID:        6e1e4cd2-13e9-52d1-a05a-25028be9da88
```

The configured NSIS lifecycle values are intentionally unchanged:

```text
oneClick:                  false
perMachine:                false
selectPerMachineByDefault: false
runAfterFinish:             false
differentialPackage:       false
shortcutName:              错题复盘
uninstallDisplayName:      错题复盘
createDesktopShortcut:     true
createStartMenuShortcut:   true
```

The assisted installer exposes an install-mode page. The accepted M4 run
explicitly selected and verified the current-user path; the configuration's
per-user intent was confirmed by live registry and path readback.

## Evidence boundary

The following are source/template findings, independently readable from the
checked-out repository and the installed dependency tree:

- `electron-builder.nsis.cjs` contains no custom NSIS include, installer hook,
  uninstaller hook, or `deleteAppDataOnUninstall` setting.
- `package.json` invokes the bundled NSIS target with `--publish never`.
- The installed `app-builder-lib` and `electron-builder` versions are both
  `26.15.3`.
- The relevant NSIS templates and macros were read from the installed
  `node_modules/app-builder-lib/templates/nsis` tree.
- `desktop/main.ts` and `desktop/runtime.ts` were read for application and
  child-process shutdown behavior.

The accepted M4 candidate provenance is:

```text
source commit: 0aa7988a25523745e3b5e2bc6af0ce5717dce6c1
filename:      ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe
byte size:     125440440
SHA-256:       B984A7130786D5A109F8CC0D2EF4017110E89EA7E5FCAF2B5FBD6CF4FE4515B9
```

The operator independently reverified the name, byte size, and SHA-256 before
the reinstall and final recovery stages. Every destructive transition used this
same byte-identical candidate; a rebuilt same-name executable would not be the
same acceptance subject.

The accepted environment was disposable Windows account
`DESKTOP-7J3BLKU\test-m4-final` with profile `C:\Users\test-m4-final`. The claim
scope is Windows, one machine, one Windows account/profile, current-user NSIS,
version `0.2.4`, and the exact candidate above. It does not claim credential
portability to another account or machine, copied-userData DPAPI portability,
signing/SmartScreen readiness, updater readiness, or release cutover.

## Current NSIS lifecycle behavior

### Normal uninstall with the application closed

For the current assisted per-user configuration, the generated uninstaller
uses the following behavior from electron-builder 26.15.3:

1. `un.onInit` invokes the generated `CHECK_APP_RUNNING` macro.
2. The normal uninstall section sets the output path outside the install root
   and runs `RMDir /r $INSTDIR`.
3. That recursive removal covers the installed executable, `resources/app.asar`,
   `resources/.desktop-runtime`, the bundled Node runtime, the uninstaller,
   and other files below the NSIS install root, subject to normal Windows file
   locking rules.
4. `WinShell::UninstAppUserModelId` and `WinShell::UninstShortcut` are invoked
   for the configured Desktop and Start Menu links, followed by deletion of
   those `.lnk` files and an optional empty Start Menu directory.
5. The current-user NSIS uninstall key and install key are deleted.

The generated uninstaller does not have an application-owned cleanup hook in
this repository. Ordinary registry uninstall commands contain `/currentuser`
and, for the quiet entry, `/S`; they do not contain `--delete-app-data`. The
current config also does not define `DELETE_APP_DATA_ON_UNINSTALL`. Therefore
the ordinary path does not execute the template's `RMDir /r` calls for
`%APPDATA%\${APP_FILENAME}`, `%APPDATA%\${APP_PRODUCT_FILENAME}`, or
`%APPDATA%\${APP_PACKAGE_NAME}`.

The template does expose an explicit `--delete-app-data` command-line path.
That path is outside the M4 continuity acceptance and must not be used in the
normal-uninstall run. If a test command includes it, the run is invalid for
the continuity claim and must stop.

As a result, the ordinary generated path has no intentional operation that
removes or rewrites Electron session storage, IndexedDB, Local Storage,
application caches below `userData`, the Desktop credential envelope, or the
OS-managed `safeStorage`/DPAPI key material. The template also contains no
custom schedule-for-deletion or application cleanup path; a locked install
file may simply remain as a residual and must be reported.

`RMDir /r $INSTDIR` is a best-effort filesystem operation from the template;
the source does not prove that every locked file will disappear. A successful
M4 run must therefore read back the root and classify any residual rather than
deleting it manually to force an empty directory.

### Reinstall after uninstall

The source-level expected behavior is:

- the installer recreates the NSIS payload and uninstaller under the default
  current-user root;
- `registryAddInstallInfo` recreates both NSIS registry identities;
- `addDesktopLink` and `addStartMenuLink` recreate the configured links when
  the fresh-install policy applies;
- the unchanged package/product identity continues to resolve Electron's
  `userData` to `%APPDATA%\错题复盘`; and
- the unchanged `persist:review-workspace` partition and Desktop credential
  envelope remain in the same user-scoped storage boundary.

The operator-attested Stage 7 and Stage 8 record below confirms the expected
payload, registry, shortcut, sentinel, and same-account credential continuity
after the exact same candidate was reinstalled.

### Uninstall while the application is running

The generated `CHECK_APP_RUNNING` macro is the only current installer-side
running-process mechanism:

- When Windows PowerShell and `Get-CimInstance` are available, it enumerates
  `Win32_Process` rows whose executable path starts with `$INSTDIR`.
- It prompts with the generated running-app message. On confirmation it first
  requests normal termination, waits, then uses `Stop-Process -Force` and
  retries until the path-scoped processes disappear.
- If the process remains after the retry loop, it asks for retry/cancel and
  does not silently continue past an unresolved active process.
- If the PowerShell/CIM path is unavailable, the fallback uses `tasklist` and
  `taskkill` for the exact `review-workspace.exe` image and current user. That
  fallback does not independently match the bundled `node.exe`, so a run on
  that path cannot claim child-process cleanup without separate process-tree
  evidence.

The PowerShell path is broader than the application image name and is intended
to catch Electron renderer/utility processes and the bundled Node process
because their executable paths are below the install root. The accepted
snapshots distinguished the active product processes from the uninstaller/NSIS
helper; the Stage 9 observer limitation is recorded explicitly below.

The operator-attested Stage 9 record below confirms running-app detection,
installer-assisted application close, and completed uninstall. The intended
PowerShell transition observer was not actually active, so this closure does
not claim the internal `CHECK_APP_RUNNING` branch, transition timing, or
whether the PowerShell/CIM or fallback path was selected.

### Install/reinstall while the application is running

The generated install section invokes `CHECK_APP_RUNNING` before it invokes
`uninstallOldVersion`. If the user confirms the generated close prompt, the
same process handling above runs before file replacement. If the process
cannot be closed, the installer stops rather than claiming a safe transition.

For an existing installation, `uninstallOldVersion` reads the recorded
uninstaller, copies it to the NSIS temporary directory, and executes it with
`/S`, `/KEEP_APP_DATA`, the selected install-mode flag, and `--updated` when
the data-delete path is not selected. It waits for the uninstaller and retries
up to the template limit before reporting failure. The `--updated` path uses
the template's atomic rename/restore logic for the old install, which is
intended to avoid silently leaving a mixed payload when a file is locked.

`runAfterFinish: false` means the current assisted installer does not
automatically restart the application after the transition. This closure
accepts the exact-candidate reinstall after closed-app and running-app
uninstall. It does not add a separate live in-place same-version install-while-
running claim because that observation was not captured.

## UserData and Desktop credential boundary

The application source preserves the existing boundary:

- no `app.setPath("userData", ...)` or `app.setName(...)` override is present;
- the Electron session uses `persist:review-workspace`;
- `desktop/credential-storage.ts` uses Electron asynchronous `safeStorage`;
- `basic_text` is rejected on Linux and there is no plaintext fallback;
- the product stores the Desktop credential envelope in the persisted renderer
  storage under the stable key `review-workspace:desktop-credentials:v1`; and
- the envelope is `desktop-v1`, context-bound, and decrypted only through the
  typed Desktop capability boundary.

The M4 evidence must never print or persist the credential value, raw envelope,
provider payload, or a complete localStorage dump. Valid evidence is limited to
non-secret UI facts:

```text
Desktop credential protection / migration: complete
credential or connection health: ready / verified
normal UI connection: succeeds without credential re-entry
```

This is intentionally a same-account, same-machine continuity claim. It does
not prove DPAPI portability to another Windows account or machine, nor does it
prove that copied userData can be decrypted elsewhere.

## Registry lifecycle

The GUID is derived by electron-builder 26.15.3 from the unchanged appId and
its standard UUIDv5 namespace; the repository does not override `nsis.guid`.
For the current-user acceptance path the exact keys are:

```text
install key:
HKCU\Software\6e1e4cd2-13e9-52d1-a05a-25028be9da88

uninstall key:
HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\6e1e4cd2-13e9-52d1-a05a-25028be9da88
```

The install key is expected to contain `InstallLocation` equal to
`%LOCALAPPDATA%\Programs\review-workspace`, plus the shortcut bookkeeping
written by the template. The uninstall key is expected to contain:

```text
DisplayName:          错题复盘
DisplayVersion:       0.2.4
UninstallString:      "<install root>\Uninstall review-workspace.exe" /currentuser
QuietUninstallString: "<install root>\Uninstall review-workspace.exe" /currentuser /S
DisplayIcon:          "<install root>\review-workspace.exe,0"
```

The uninstall registry entry is not required to carry `InstallLocation`; the
install key is the location authority. A live check requiring
`InstallLocation` on the uninstall entry would be an incorrect failure.

## Shortcut lifecycle

The configured shortcut name is `错题复盘` and no menu category is configured.
The expected current-user paths and target are:

```text
Desktop:
%USERPROFILE%\Desktop\错题复盘.lnk

Start Menu:
%APPDATA%\Microsoft\Windows\Start Menu\Programs\错题复盘.lnk

Target for both:
%LOCALAPPDATA%\Programs\review-workspace\review-workspace.exe

Shortcut AppUserModelID:
com.squirrel.review_workspace.review-workspace
```

Shortcut validation is target-aware. Resolve each `.lnk` target and, where
available, its AUMI; compare the normalized target to the exact installed
executable. Filename presence alone is not evidence. A link that exists but
targets the old Squirrel root, another installation, or an unrelated path is
an acceptance failure.

### Exact lifecycle table

This table records the operator-attested closed-app uninstall and exact-candidate
reinstall path. The separate running-app and final-recovery readback is recorded
in the acceptance stages below.

| Item | Before normal uninstall | After normal uninstall | After reinstall of the same candidate |
| --- | --- | --- | --- |
| NSIS install key | Present under exact HKCU GUID; `InstallLocation` is the NSIS root | Absent | Present under the same exact HKCU GUID with the same location |
| NSIS uninstall key | Present under exact HKCU uninstall GUID; display/version/commands match | Absent | Present under the same exact HKCU uninstall GUID with refreshed commands |
| Install root | Present at `%LOCALAPPDATA%\Programs\review-workspace` | Absent | Present at the same root |
| `review-workspace.exe`, `resources\app.asar`, `.desktop-runtime` | Present below the install root | Absent with the root | Present and read back from the same candidate |
| Desktop shortcut | Present and targets the exact NSIS executable | Absent | Present and targets the exact NSIS executable |
| Start Menu shortcut | Present and targets the exact NSIS executable | Absent | Present and targets the exact NSIS executable |
| `%APPDATA%\错题复盘` | Absent before first launch; then present with sentinel and non-secret UI state | Present and unchanged | Present at the same path; sentinel and credential continuity rechecked |
| `persist:review-workspace` state | Created under the persisted Electron session boundary | Preserved with userData | Reused; restart remained continuous |
| Product processes | `0` before launch / uninstall preflight | `0` | `0` before launch; native launch produced `4` Electron + `1` bundled Node |
| `%LOCALAPPDATA%\review-workspace-updater\installer.exe` candidate cache | May be present because the embedded NSIS template copies the installer there | Present as an installer-cache residual | Present or refreshed by install; not treated as active product or M5 updater evidence |

## Process lifecycle model

The expected product-owned process paths are:

| Process role | Expected path/ownership | Shutdown evidence required |
| --- | --- | --- |
| Electron browser/main process | `<install root>\review-workspace.exe` | Normal app close reaches `before-quit`; no product process remains |
| Electron renderer/utility processes | Usually the same `review-workspace.exe` image under the install root with Electron process arguments | No same-root Electron process remains after close or before uninstall proceeds |
| Bundled Node runtime | `<install root>\resources\.desktop-runtime\node\node.exe`, spawned by `desktop/runtime.ts` with `app/server.js` | `runtime.stop()` completes and no same-root `node.exe` remains |
| Next standalone server | Not a separate executable; it is `server.js` hosted by the bundled Node process | No listening runtime process remains after app close |
| NSIS/uninstaller helpers | Installer/uninstaller processes, not product state | Exclude the active uninstaller from product counts, then verify no product process remains after completion |

The application requests an Electron single-instance lock. The packaged
application explicitly owns one bundled Node child and calls `stopChild` from
`before-quit`; startup failure cleanup also stops that child. No other
application-side `spawn`/`fork` path was found under `desktop/`.

The source does not create a Windows Job Object or an explicit process-tree
kill for descendants of the bundled Node process. The default NSIS PowerShell
path is the broader path-scoped safety net; the fallback is image-name based.
The operator-attested snapshots observed four `review-workspace.exe` processes
and one bundled Node process after launch, zero product processes after normal
close, five processes after native Start Menu restart, and zero after the final
normal close. The running-app uninstall observer was not active during the
transition, so no internal process-termination branch or timing claim is added.

## Residual policy

| Residual/state | Classification | M4 handling |
| --- | --- | --- |
| `%APPDATA%\错题复盘`, IndexedDB, Local Storage, persisted session state, credential envelope, Vault/user facts | Expected persistent user state | Must remain; verify path and non-secret UI continuity only |
| `%LOCALAPPDATA%\review-workspace-updater\installer.exe` or similar installer cache created by the template | Expected installer cache, subject to live readback | Record separately; do not turn M4 into updater cleanup |
| Desktop or Start Menu link after a successful normal uninstall | Unexpected shortcut residual | Stop and record; do not recreate or delete it manually |
| Either NSIS registry identity after a successful normal uninstall | Unexpected registry residual | Stop and record; do not repair live registry state |
| `review-workspace.exe`, `.desktop-runtime`, or bundled `node.exe` still active after the running-app gate | Unexpected active executable/process residual | Stop; do not kill it from Codex and do not continue the destructive run |
| Locked payload file or non-active file left below the NSIS root | Unknown residual until inspected | Record exact path/type; never delete merely to make the root absent |
| Any unexpected reparse point, sibling install root, mixed-version payload, or unknown same-product registry entry | Unknown/ambiguous state | Stop before uninstall/reinstall and preserve the profile |

The old Squirrel residual policy remains M3-owned. M4 must not silently reuse
or extend the M3 cleanup helper to remove unrelated files, registry entries, or
shortcuts.

## Real-Windows acceptance record

The following record is operator-attested evidence from disposable Windows
account `DESKTOP-7J3BLKU\test-m4-final` (`C:\Users\test-m4-final`). It is limited
to one Windows machine, one Windows account/profile, current-user NSIS, version
`0.2.4`, and the exact candidate identified above. Codex did not execute the
installer, uninstaller, process termination, registry mutation, or live
credential operation.

### M4 Stage 1 — clean profile and candidate provenance: PASS

The fresh profile initially had no NSIS install root, userData, legacy Squirrel
root, NSIS install or uninstall registry key, legacy Squirrel uninstall key,
Desktop shortcut, Start Menu shortcut, or product process.

The candidate was verified as:

```text
source SHA:  0aa7988a25523745e3b5e2bc6af0ce5717dce6c1
filename:    ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe
size:        125440440 bytes
SHA-256:     B984A7130786D5A109F8CC0D2EF4017110E89EA7E5FCAF2B5FBD6CF4FE4515B9
```

Result: `M4 STAGE 1 CLEAN PROFILE: PASS`; `M4 CANDIDATE PROVENANCE: PASS`.

### M4 Stage 2 — fresh current-user NSIS install: PASS

The fresh install read back:

```text
NsisRootPresent       : True
NsisExePresent        : True
AppAsarPresent        : True
DesktopRuntimePresent : True
RuntimeNodePresent    : True
UserDataStillAbsent   : True
InstallKeyPresent     : True
UninstallKeyPresent   : True
```

The install location was:

```text
C:\Users\test-m4-final\AppData\Local\Programs\review-workspace
```

The uninstall registration matched `错题复盘`, version `0.2.4`, the exact
installed executable icon, and the expected `/currentuser` plus quiet `/S`
commands:

```text
DisplayName:           错题复盘
DisplayVersion:        0.2.4
DisplayIcon:            C:\Users\test-m4-final\AppData\Local\Programs\review-workspace\review-workspace.exe,0
UninstallString:       "C:\Users\test-m4-final\AppData\Local\Programs\review-workspace\Uninstall review-workspace.exe" /currentuser
QuietUninstallString:  "C:\Users\test-m4-final\AppData\Local\Programs\review-workspace\Uninstall review-workspace.exe" /currentuser /S
```

Both Desktop and Start Menu shortcuts existed and targeted exactly:

```text
C:\Users\test-m4-final\AppData\Local\Programs\review-workspace\review-workspace.exe
```

No product process remained after installation; userData remained absent until
the application was first launched.

Result: `M4 STAGE 2 FRESH NSIS INSTALL STRUCTURE: PASS`.

### M4 Stage 3 — first-launch baseline: PASS

After normal first launch, userData existed and the observed product tree was
four `review-workspace.exe` processes plus one bundled `node.exe`, all below
the exact NSIS root. `UnexpectedSameRootProcesses` was `0`.

The production UI sentinel was:

```text
nsis-m4-final-acceptance-2026-08-22
```

A disposable DeepSeek connection was configured through the normal UI. The
operator verified the sentinel, complete Desktop credential protection,
ready/verified connection health, and a successful live connection test. No
secret, API key, encrypted envelope, storage dump, or provider payload was
recorded.

Result: `M4 STAGE 3 FIRST-LAUNCH BASELINE: PASS`.

### M4 Stage 4 — normal close and Start Menu restart: PASS

After ordinary close, the readback was:

```text
SameRootProcessCount         : 0
ReviewWorkspaceProcessCount  : 0
BundledNodeProcessCount      : 0
UserDataStillPresent         : True
StartMenuShortcutPresent     : True
```

Launching from the actual Start Menu shortcut produced four Electron processes
and one bundled Node process. The sentinel, Desktop protection, ready/verified
health, and live connection remained intact without API-key re-entry.

Result: `M4 STAGE 4 NORMAL CLOSE: PASS`; `M4 STAGE 4 RESTART CONTINUITY: PASS`.

### M4 Stage 5/6 — closed-app ordinary NSIS uninstall: PASS

Before uninstall, the application was closed and the install root, userData,
both NSIS keys, and both shortcuts were present. The registered ordinary
uninstall command contained `/currentuser` and did not contain
`--delete-app-data`.

Windows Settings was used to uninstall the closed application. Afterward:

```text
ProductProcessCount      : 0
InstallRootPresent       : False
UserDataPresent          : True
InstallKeyPresent        : False
UninstallKeyPresent      : False
DesktopShortcutPresent   : False
StartMenuShortcutPresent : False
```

`%LOCALAPPDATA%\review-workspace-updater` remained. This is classified only as
an installer-cache residual, not active product state or M5 updater evidence;
it was not manually deleted.

Results: `M4 STAGE 5 CLOSED-APP UNINSTALL PREFLIGHT: PASS`; `M4 STAGE 6
CLOSED-APP NSIS UNINSTALL: PASS`.

### M4 Stage 7 — exact same-candidate reinstall: PASS

The same candidate was reverified before reinstall with size `125440440` and
SHA-256 `B984A7130786D5A109F8CC0D2EF4017110E89EA7E5FCAF2B5FBD6CF4FE4515B9`.
Before reinstall the install root was absent and userData was present. After
reinstall, the payload, both NSIS keys, and both shortcuts returned with the
same expected identities and no product process running. Both shortcuts
targeted the NSIS executable exactly.

Result: `M4 STAGE 7 EXACT-CANDIDATE REINSTALL PREFLIGHT: PASS`; `M4 STAGE 7
EXACT-SAME-CANDIDATE REINSTALL: PASS`.

### M4 Stage 8 — userData, safeStorage/DPAPI, and native shortcut continuity: PASS

After reinstall, the sentinel remained present, Desktop credential protection
remained complete, the connection remained ready/verified, the DeepSeek API key
did not need re-entry, and a live connection test succeeded.

An intermediate terminal-launched observation saw an incomplete snapshot and
the application later appeared to exit. The operator clarified that the
PowerShell/terminal used in that test had been closed. Matching Windows
Application Error/WER events were `0`, product-related Application events were
`0`, and no confirmed product crash was found. A controlled passive observation
then confirmed the product and bundled Node appeared and remained running; after
214.65 seconds the final tree was four Electron processes plus one bundled Node.
`desktop-runtime.log` was absent.

This terminal observation is a harness artifact, not a product regression. The
accepted lifecycle evidence is the native Start Menu launch, which remained
running normally after the observation terminal was closed.

Results: `M4 NATIVE SHORTCUT PROCESS INDEPENDENCE: PASS`; `M4 STAGE 8
REINSTALL CONTINUITY: PASS`; `M4 STAGE 8 SAFESTORAGE / DPAPI CONTINUITY: PASS`.

### M4 Stage 9 — running-app detection, assisted close, and uninstall: PASS

The application was launched through native Windows UI and kept running. The
operator then used Windows Settings → Installed apps → `错题复盘` → Uninstall.
The NSIS uninstaller detected the running application, presented the continuation
prompt, and closed the application on the normal Continue/confirm path before
completing uninstall. The operator did not manually close the app, use Task
Manager, use `Stop-Process`/`taskkill`, or manually delete files.

The intended PowerShell transition observer did not execute because its
interactive terminal was waiting at the multi-line `>>` prompt. Therefore this
record does not claim intermediate transition timing, the internal
`CHECK_APP_RUNNING` branch, or whether the PowerShell/CIM or fallback path was
selected.

Post-uninstall readback was:

```text
ProductProcessCount      : 0
InstallRootPresent       : False
UserDataPresent          : True
InstallKeyPresent        : False
UninstallKeyPresent      : False
DesktopShortcutPresent   : False
StartMenuShortcutPresent : False
UpdaterCachePresent      : True
```

`UpdaterCachePresent` is the same installer-cache residual classification only.

Results: `M4 STAGE 9 RUNNING-APP DETECTION: PASS`; `M4 STAGE 9 INSTALLER-
ASSISTED APP CLOSE: PASS`; `M4 STAGE 9 RUNNING-APP UNINSTALL: PASS`.

### M4 Stage 10 — final recovery after running-app uninstall: PASS

The exact candidate provenance was verified again before reinstall. The final
reinstall restored the install root, executable, bundled runtime, userData,
both NSIS keys, and both shortcuts with the expected identities and zero product
processes before launch.

Native Windows UI launch produced four Electron processes plus one bundled Node
process. The sentinel, Desktop credential protection, no-reentry condition, and
functional DeepSeek connection remained intact. After final normal close, the
product process count was `0`.

Result: `M4 STAGE 10 FINAL RECOVERY: PASS`.

### Overall M4 classification

**M4 NSIS APPLICATION LIFECYCLE ACCEPTANCE: PASS**

Supported claims are limited to the accepted environment and candidate above:

- fresh current-user NSIS install works and does not create userData merely by
  installing;
- normal application close terminates the observed Electron plus bundled Node
  tree, and Start Menu restart works;
- ordinary closed-app uninstall removes the active NSIS payload, registry
  identity, and shortcuts while preserving application userData;
- the exact same candidate reinstalls cleanly and the sentinel survives;
- Desktop-protected credentials survive uninstall/reinstall on the same machine
  and same Windows account without credential re-entry;
- the live DeepSeek connection remained ready and succeeded;
- running-app uninstall detects the running application and the uninstaller
  closes it successfully;
- running-app uninstall leaves no active product process or install root; and
- final reinstall restores a healthy application and final normal close leaves
  zero product processes.

Explicit nonclaims and residual boundaries:

- no different-account DPAPI credential portability claim;
- no different-machine or copied-userData portability claim;
- no claim about the exact internal running-app detection branch or transition
  timing because the intended observer was not active;
- no separate in-place same-version install-while-running claim beyond the
  accepted uninstall/reinstall and recovery paths recorded here;
- the updater cache is not active product state and is not updater readiness;
- no signing, SmartScreen, release, update, rollback, or production cutover
  readiness claim; and
- M5 continues to own the explicit production-v1 unsigned policy,
  SmartScreen/Unknown Publisher residual, updater/release/cutover, and related
  production readiness. Code signing and publisher identity are deferred future
  capabilities, not production-v1 blockers.

The candidate remains unsigned. M4 did not decide the production policy; the
later production-v1 decision intentionally remains unsigned. An expected
SmartScreen/Unknown Publisher warning is an accepted production-v1 residual,
not an M4 lifecycle failure. See
[`windows-production-v1-release-policy.md`](windows-production-v1-release-policy.md).

## Stop conditions and remaining boundaries

The following are hard stops:

- installer provenance or exact candidate hash is not known;
- the current-user account/profile is not clean or the install mode is not
  current-user;
- the product, registry, shortcut, executable, or runtime identity differs;
- the normal uninstaller includes `--delete-app-data` or userData changes;
- the application, renderer/utility process, bundled Node, or another active
  same-root product process survives a required boundary;
- an uninstaller or installer reports a locked/mixed payload;
- a shortcut target or AUMI is ambiguous;
- userData, sentinel, Desktop protection, health, or no-reentry connection
  continuity is lost;
- an unexpected registry key, reparse point, sibling root, or unknown residual
  appears; or
- evidence would require recording a secret, raw credential envelope, cookie,
  provider payload, or complete userData dump.

These hard-stop criteria governed the operator run; none was triggered for the
accepted stages. The installer-cache residual was preserved and classified, not
deleted to manufacture a clean result. The intended running-app transition
observer was not active, so the closure intentionally retains the corresponding
branch/timing nonclaim. Codex did not execute or simulate any destructive
Windows lifecycle operation.

## Implementation decision

**M4 NSIS APPLICATION LIFECYCLE ACCEPTANCE: PASS.**

The current source/configuration and unchanged builder identity passed the
operator-attested lifecycle cases without application, Electron, builder,
credential, registry, shortcut, or installer-hook changes. The observed result
covered fresh current-user install, native launch/restart, closed-app uninstall
and exact-candidate reinstall, same-account safeStorage/DPAPI continuity,
running-app detection and installer-assisted close, running-app uninstall, and
final recovery.

The PowerShell/CIM versus fallback process behavior and the template's
best-effort handling of locked files remain source-level implementation context;
the accepted running-app result does not identify which internal branch ran.
The updater-cache residual remains M5-owned installer-cache state. No
preemptive change to builder config, product identity, fuses, security settings,
or application lifecycle code is warranted by this acceptance.

## M5 boundary

This M4 pass does not establish Authenticode signing, SmartScreen reputation,
updater behavior, release artifact publication, production cutover, rollback
policy, cross-machine portability, copied-userData portability, or cross-account
DPAPI portability. The later production-v1 policy intentionally accepts the
unsigned/Unknown Publisher boundary and defers signing; all other unproven claims
remain M5 or explicitly out of scope.

## Audit sources

- `electron-builder.nsis.cjs`
- `package.json`
- `desktop/main.ts`
- `desktop/runtime.ts`
- `desktop/credential-storage.ts`
- `app/services/credential-backend.ts`
- `app/services/credential-storage-format.ts`
- `docs/windows-installer-migration-m3.md`
- `node_modules/app-builder-lib/templates/nsis/uninstaller.nsh`
- `node_modules/app-builder-lib/templates/nsis/installSection.nsh`
- `node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh`
- `node_modules/app-builder-lib/templates/nsis/include/installer.nsh`
- `node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh`
- `node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js`
