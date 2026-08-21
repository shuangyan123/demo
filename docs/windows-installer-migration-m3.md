# Windows installer migration M3 - guarded Squirrel 0.2.4 to NSIS bridge

Status: **M3 SQUIRREL -> NSIS MIGRATION: PENDING REAL WINDOWS EXECUTION**

This phase implements only the separately invoked legacy-Squirrel cleanup
bridge and its safety contracts. It does not execute an installer, uninstall a
real installation, launch an installed application, perform the real M3
migration, or begin M4.

## M3A decision and two-stage contract

M3 uses Strategy A:

1. Keep the existing Squirrel installation intact.
2. Install NSIS side-by-side.
3. Launch NSIS and verify the same userData, the old production sentinel,
   Desktop credential migration state, credential health, and ordinary restart.
4. Invoke the cleanup helper explicitly only after those checks pass.
5. Recheck the NSIS installation and userData after cleanup.

Destructive cleanup is deliberately not part of an electron-builder NSIS hook.
preInit, customInit, customInstall, installer finish, and application first
launch happen before an installed application can prove IndexedDB,
safeStorage/DPAPI, sentinel, and restart continuity. The helper is a separate
post-verification operator action.

## Helper

Path: scripts/windows-squirrel-m3-migration.ps1

Default inspect/dry-run:

~~~powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\windows-squirrel-m3-migration.ps1
~~~

Explicit cleanup requires both flags:

~~~powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\windows-squirrel-m3-migration.ps1 -ExecuteCleanup -Stage1Verified
~~~

The helper never executes a registry-provided UninstallString, never invokes
an arbitrary Update.exe, never starts or terminates a process, and never opens
or parses credentials. Snapshot input exists only for contract tests and
always rejects cleanup.

Inspect output is JSON and reports only non-secret state:

- legacy root, registration, version and process status;
- Desktop and Start Menu shortcut target classification;
- userData existence and path only;
- NSIS root existence;
- cleanupEligible, blocking reasons, and a narrow cleanup plan;
- active legacy state versus known inert residuals.

## Identity and allowlist

The only accepted legacy identity is:

~~~text
root:        %LOCALAPPDATA%\review_workspace
registry:    HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\review_workspace
version:     0.2.4
stub:        review-workspace.exe
version dir: app-0.2.4
~~~

The expected NSIS root is:

~~~text
%LOCALAPPDATA%\Programs\review-workspace
~~~

The existing NSIS identity remains unchanged: package `review-workspace`,
product name `错题复盘`, version `0.2.4`, executable
`review-workspace.exe`, appId `com.squirrel.review_workspace.review-workspace`,
and the existing `persist:review-workspace` session partition. M3B adds no
installer hook and changes no application identity, userData location, schema,
or credential implementation.

The helper validates canonical paths, exact root identity, executable
metadata, registry values, process executable paths, shortcut targets, and
reparse points. Sibling roots, path traversal, conflicting registrations,
unexpected residuals, and ambiguous state refuse cleanup.

Only these active legacy targets may be removed:

- validated app-0.2.4 payload;
- validated Squirrel root stub;
- Desktop/Start Menu .lnk whose resolved target is inside the exact legacy
  root;
- the exact legacy Squirrel uninstall registry key.

Shortcuts are never deleted by filename, display name, AppID, or product name.
An NSIS-target shortcut is preserved. Known inert Squirrel residuals such as
.dead, Update.exe, RELEASES, and packages are reported separately and are not
deleted merely to make the directory empty.

## Never-touch boundaries

The helper never deletes, moves, copies, rewrites, or recreates:

~~~text
%APPDATA%\错题复盘
~~~

This includes IndexedDB, Local Storage, persistent partition state, credential
envelopes, secure key material, Vault state, migration journal, and caches.
The expected NSIS root is also excluded from every deletion plan.

The helper blocks when a process has an executable path inside the legacy root.
It does not kill review-workspace.exe, node.exe, Update.exe, or any other
process. An unrelated Node process outside the legacy root is not product
state.

## Credential continuity evidence

The helper does not implement credential checks. For the later real Windows
M3 run, the operator must use the normal application UI to:

1. configure a disposable credential in the old Squirrel app;
2. complete Desktop credential migration;
3. confirm migration state is complete and connection health is ready;
4. after NSIS launch and ordinary restart, confirm the same state and health;
5. perform cleanup explicitly, then confirm health remains ready.

The existing non-secret signals are unchanged and are the authority for that
operator observation:

- `DesktopCredentialMigrationPanel` exposes `data-status="complete"` only
  when the migration journal is complete with `backendPolicy=desktop_preferred`
  and the Desktop protection status is available;
- `desktop/credential-storage.ts` reports the Main-process
  `safeStorage`/OS-protected status and performs the typed unprotect boundary;
- `app/services/credential-backend.ts` reads the saved Desktop envelope through
  `unprotectCredential`; a successful normal UI connection/health check must
  therefore be based on successful unprotect, not merely on an envelope or
  journal existing.

No secret, debug endpoint, raw localStorage value, or live provider payload is
part of this contract. The helper does not call safeStorage or the credential
backend.

## Historical artifact gate

The required historical artifact is:

~~~text
ReviewWorkspace-0.2.4-Windows-x64-Setup.exe
size:     186909184
SHA-256:  2A28CB47E3485DC2D67CEE80ED2208E705607452372A0C34B1FC323E186626EE
source:   1c41e53488fe8b4427d1c78831e3b524a114a2da
~~~

M3 ACCEPTED SQUIRREL ARTIFACT: NOT RECOVERED

The same-name local artifact is not accepted and must not be substituted:

~~~text
size:    190381056
SHA-256: 87966A61FBC23F5124F7568319CDFABFCAE6C922BDEF2B8A0F661103674A4233
~~~

Therefore:

~~~text
REAL M3 WINDOWS ACCEPTANCE:
BLOCKED ON EXACT HISTORICAL SQUIRREL ARTIFACT
~~~

## Real-Windows M3 checklist

Use a new disposable Windows x64 account, not test or test-m2-final.

- Establish a clean profile and record the absence of old roots, processes,
  shortcuts, registrations, and userData.
- Install the exact accepted Squirrel 0.2.4 artifact once.
- Create a production-UI sentinel and complete Desktop credential migration.
- Record non-secret health ready before migration.
- Install NSIS side-by-side and verify NSIS root, resources, registration,
  shortcut targets, same userData, sentinel, credential health, and restart.
- Run the helper explicitly with -ExecuteCleanup -Stage1Verified.
- Verify active Squirrel registration, active version payload, root stub,
  legacy-target shortcuts, and legacy process are absent.
- Verify NSIS executable, resources\app.asar, .desktop-runtime, NSIS
  registration, both NSIS shortcuts, userData, sentinel, and credential health
  remain available.

Any failed or ambiguous step stops the run. No automatic retry, rollback,
shortcut recreation, userData repair, or destructive profile surgery is
allowed.

## Boundaries

M3 owns only existing-user Squirrel-to-NSIS migration and same-account,
same-machine continuity. NSIS uninstall/reinstall, running-app uninstall,
repair, portability, signing, SmartScreen, release publication, and updater
behavior remain M4/M5 PENDING.

M4: **PENDING**

M5: **PENDING**
