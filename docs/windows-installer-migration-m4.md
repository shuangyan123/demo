# Windows installer migration M4A — NSIS application lifecycle audit

Status: **M4 NSIS LIFECYCLE AUDIT: READY FOR REAL WINDOWS ACCEPTANCE**

M4 acceptance status: **PENDING**. This document records a source/template audit
only. No installer, uninstaller, running-app transition, registry mutation,
live userData access, or credential operation was performed during M4A.

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

The assisted installer exposes an install-mode page. The real M4 run must
explicitly select and verify the current-user path; the configuration's
per-user intent is not a substitute for live registry and path readback.

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

The existing M3 document records a prior operator-attested real-Windows
side-by-side candidate. Its recorded candidate provenance is:

```text
source commit: 31c0ec5c52352058bae1d3c61e6e685cc404b5cb
filename:      ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe
byte size:     125443533
SHA-256:       61F5699D5075474B3631C55889DA0F15DC7BF4C488DD9CAD6355C61E94A1484A
```

This is recorded provenance, not a claim that the file is currently available
to the M4 operator or that it has passed M4. Every M4 destructive stage must
pin one exact candidate by source SHA, filename, byte size, and SHA-256 and
reuse that same binary for the uninstall/reinstall transitions. A rebuilt
same-name executable is not the same candidate.

The prior M3 continuity result remains limited to the same account and
machine. It does not prove NSIS uninstall, reinstall, running-app behavior, or
M4 credential continuity.

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

These are source-derived expectations, not an M4 acceptance result. The live
run must prove that the existing sentinel remains visible and that a normal UI
connection/health check succeeds without credential re-entry after the exact
same candidate is reinstalled.

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
because their executable paths are below the install root. The real run must
record the process paths and distinguish the active product processes from the
uninstaller/NSIS helper that is performing the operation.

The template behavior is known from source, but the outcome of a live
running-app uninstall is **PENDING**. M4A did not start an application, invoke
an uninstaller, close a window, or terminate a process.

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
automatically restart the application after the transition. Whether a
same-version install actually completes with no locked-file residuals and
whether the application can be relaunched cleanly remains **PENDING** for real
Windows acceptance.

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

| Item | Before normal uninstall | After normal uninstall | After reinstall of the same candidate |
| --- | --- | --- | --- |
| NSIS install key | Present under exact HKCU GUID; `InstallLocation` is the NSIS root | Absent | Present under the same exact HKCU GUID with the same location |
| NSIS uninstall key | Present under exact HKCU uninstall GUID; display/version/commands match | Absent | Present under the same exact HKCU uninstall GUID with refreshed commands |
| Install root | Present at `%LOCALAPPDATA%\Programs\review-workspace` | Absent if no locked residual remains; otherwise residual is recorded and not deleted manually | Present at the same root |
| `review-workspace.exe`, `resources\app.asar`, `.desktop-runtime` | Present below the install root | Absent with the root; any locked active executable is an unexpected residual | Present and read back from the same candidate |
| Desktop shortcut | Present and targets the exact NSIS executable | Absent | Present and targets the exact NSIS executable |
| Start Menu shortcut | Present and targets the exact NSIS executable | Absent | Present and targets the exact NSIS executable |
| `%APPDATA%\错题复盘` | Present; sentinel and non-secret credential state are readable through the UI | Present and unchanged; disappearance is a destructive failure | Present at the same path; sentinel and credential continuity are rechecked |
| `persist:review-workspace` state | Present in the persisted Electron session boundary | Preserved with userData | Reused; ordinary restart must remain continuous |
| `%LOCALAPPDATA%\review-workspace-updater\installer.exe` candidate cache | May be present because the embedded NSIS template copies the installer there | May remain as an installer cache; do not classify it as active product payload or delete it to force an empty profile | May be refreshed by install; record rather than use as an updater/M5 claim |

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
This is why M4 must collect a process snapshot before and after each
transition. A successful browser close alone is insufficient evidence.

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

## Real-Windows acceptance matrix

One fresh disposable Windows account is sufficient. The same account and
machine should be reused because continuity, not cross-account portability,
is the subject. The operator must preserve the exact evidence after each stage;
Codex must not run the destructive stages.

### M4 Stage 1 — candidate and disposable-profile preflight

Record the exact installer source SHA, filename, byte size, SHA-256, Electron,
electron-builder, Node, architecture, appId, and current-user intent. Confirm a
clean disposable account/profile: no target install root, no product processes,
no target shortcuts, no exact NSIS keys, and no `%APPDATA%\错题复盘`.

Stop on any identity mismatch, dirty profile, extra same-product registration,
or inability to distinguish the current-user account.

### M4 Stage 2 — fresh NSIS install and structural baseline

Install the pinned candidate without running a different installer. Select
current-user mode and record the install root, executable, `resources/app.asar`,
`.desktop-runtime`, bundled Node, registry values, shortcut target paths/AUMI,
and absence of unrelated roots. Confirm the application was not auto-started by
the installer.

Stop on per-machine installation, root mismatch, registry mismatch, shortcut
filename-only evidence, or missing packaged runtime resources.

### M4 Stage 3 — production sentinel and disposable credential baseline

Use the normal production UI to create a non-secret sentinel. Configure only a
disposable credential through the UI, complete Desktop protection/migration,
confirm protection is complete and health is ready/verified, and confirm a
normal UI connection without recording the credential value.

Stop on plaintext fallback, missing protection, credential re-entry before the
baseline is complete, or any secret appearing in evidence.

### M4 Stage 4 — normal application restart continuity

Close the application normally, verify the Electron and bundled Node process
set is empty, relaunch the installed executable, and recheck the sentinel,
protection state, health, and connection without credential re-entry.

Stop if any same-root process survives a normal close or if restart continuity
requires destructive profile repair or credential re-entry.

### M4 Stage 5 — normal NSIS uninstall with the application closed

After a final normal close, invoke the current-user uninstaller through the
recorded normal path. Do not pass `--delete-app-data`; do not manually kill a
process, edit the registry, delete a shortcut, or remove a residual during the
run. Record whether the uninstaller prompts, completes, or reports a locked
file.

Stop immediately if the uninstaller command is not the expected NSIS command,
if the app is still running, or if the operation requests deletion of
`%APPDATA%\错题复盘`.

### M4 Stage 6 — post-uninstall structure and protected-state readback

Read back, without modifying state:

- no product process and no active same-root executable;
- install root and payload state;
- both exact HKCU NSIS keys;
- Desktop and Start Menu shortcut existence, target, and AUMI;
- `%APPDATA%\错题复盘` existence and sentinel visibility;
- non-secret credential protection/health state; and
- installer-cache and any other residual classification.

Expected result is the lifecycle table above. A missing userData directory,
missing sentinel, or changed credential state is a destructive failure even if
the install root is absent.

### M4 Stage 7 — reinstall the exact same candidate

Reinstall the byte-identical candidate from Stage 1 in current-user mode. Do
not rebuild it, substitute a same-name file, or use an updater. Record recreated
payload, registry identities, shortcut target/AUMI, and the preserved userData
path before launching the application.

Stop on candidate hash drift, mixed files, wrong registry hive, wrong root, or
shortcut target drift.

### M4 Stage 8 — post-reinstall continuity and restart

Launch the reinstalled executable and verify the sentinel, Desktop protection,
ready/verified health, and normal UI connection without credential re-entry.
Close and restart once more, then repeat the same non-secret checks.

Stop on any continuity loss, credential re-entry, or surviving product process
after close.

### M4 Stage 9 — running-application uninstall behavior

Run the two relevant current-user paths as two controlled subpasses when the
operator is able to preserve the same evidence:

1. Start the application and bundled runtime, invoke the normal
   `UninstallString`, and record the generated prompt/close/force/abort
   behavior and every product executable path observed.
2. Reinstall the exact same candidate with the application closed, recheck the
   sentinel and credential baseline, start the application again, and invoke
   the recorded `QuietUninstallString` (`/S`). Record whether the same process
   safety behavior occurs and whether the uninstaller completes.

If the first subpass cannot complete cleanly, stop; do not improvise a process
kill or continue to the second subpass. If PowerShell/CIM is unavailable, the
fallback must be explicitly classified and cannot claim bundled-Node cleanup
without independent process-tree evidence.

### M4 Stage 10 — recovery/reinstall after running-app lifecycle testing

Reinstall the exact candidate once more after the running-app uninstall path,
then repeat structural, sentinel, Desktop protection, health, connection, and
normal restart checks. This is the final continuity checkpoint and is the
minimum evidence needed before any M4 classification can change from PENDING.

## Stop conditions and deferred destructive work

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

All installation, uninstall, running-app, reinstall, registry/shortcut
readback, and credential-continuity stages above are deferred to an operator on
real Windows. M4A does not execute them. No residual may be deleted merely to
make a test green, and no automatic retry/rollback/profile recreation is
allowed after an ambiguous destructive outcome.

## Implementation decision

**M4 AUDIT: READY FOR REAL ACCEPTANCE WITHOUT CODE CHANGES.**

The current source/configuration provides an observable lifecycle contract for
the planned acceptance: ordinary uninstall removes the NSIS payload,
shortcuts, and registry identities without an application-data delete flag;
the application preserves the existing userData/session/credential identity;
and the generated NSIS template has explicit running-process handling before
file deletion/replacement. The remaining claims are live Windows outcomes,
not evidence that a new installer hook or application implementation is
required.

The PowerShell/CIM versus fallback process behavior and the template's
best-effort handling of locked files are recorded risks. If real M4 acceptance
shows a surviving bundled Node process, mixed-version files, uninstaller
self-interference, userData deletion, or credential continuity loss, the next
task must be a narrowly scoped implementation change based on that observed
failure. M4A does not preemptively change the builder config, product identity,
fuses, security settings, or application lifecycle code.

## M5 boundary

Even a future M4 real-Windows pass would not establish signing, SmartScreen or
reputation readiness, updater behavior, release artifact publication,
production cutover, rollback policy, cross-machine portability, or
cross-account DPAPI portability. Those claims remain M5 or explicitly out of
scope.

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
