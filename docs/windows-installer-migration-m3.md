# Windows installer migration M3 - guarded Squirrel 0.2.4 to NSIS bridge

Status: **M3 SQUIRREL -> NSIS MIGRATION: PENDING REAL WINDOWS ACCEPTANCE**

This phase implements only the separately invoked legacy-Squirrel cleanup
bridge and its safety contracts. Codex does not execute an installer, uninstall
a real installation, launch an installed application, perform destructive
cleanup, or begin M4. A disposable-account real Windows inspection reached the
pre-NSIS boundary and is recorded below; it did not complete M3 acceptance.

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
- Squirrel versus electron-builder registry identity classification;
- exact historical Squirrel package identity (filename, length, and SHA-256);
- Electron PE metadata as informational runtime metadata, never as the release identity;
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
package:     packages\review_workspace-0.2.4-full.nupkg
package size: 186836771
package SHA-256: 8FD1F7B5BF12E95778476E85EFF6A96980AC952D090BB19C80AAFBED108D9EB4
~~~

The expected NSIS root is:

~~~text
%LOCALAPPDATA%\Programs\review-workspace
~~~

The registry model keeps the legacy Squirrel uninstall identity separate from
the two electron-builder NSIS identities. The accepted legacy registration is
only:

~~~text
HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\review_workspace
~~~

For the pinned electron-builder `26.15.3` implementation, the current appId is
`com.squirrel.review_workspace.review-workspace`. electron-builder derives the
NSIS GUID with UUIDv5 using namespace
`50e065bc-3134-11e6-9bab-38c9862bdaf3`; the deterministic result is
`6e1e4cd2-13e9-52d1-a05a-25028be9da88`. The helper implements and contracts
that derivation, rather than introducing a new explicit `nsis.guid`.

The resulting current-user NSIS keys are:

~~~text
install-registry key:
HKCU\Software\6e1e4cd2-13e9-52d1-a05a-25028be9da88

uninstall-registry key:
HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\6e1e4cd2-13e9-52d1-a05a-25028be9da88
~~~

These keys have different responsibilities in electron-builder 26.15.3. The
install-registry key carries `InstallLocation`, which must equal the expected
NSIS root. The uninstall-registry key independently carries the exact builder
key identity, configured display name `错题复盘`, version `0.2.4`, and
`UninstallString`/`QuietUninstallString` pointing to the expected
`Uninstall review-workspace.exe` with the `/currentuser` semantics. The
electron-builder template does not require `InstallLocation` on the uninstall
entry; requiring it there would misclassify a legitimate NSIS installation.

An exact Squirrel registration plus both positively identified NSIS keys is
valid coexistence, not ambiguity. Any additional same-product uninstall entry
that is not one of these exact identities remains ambiguous and blocks
cleanup. Invalid expected NSIS values also block cleanup. The identity logic
is fixture-tested from sanitized registry facts. Fixture contracts do not prove
live HKCU enumeration, CIM process discovery, or Shell.Application `.lnk`
resolution; those remain part of later real Windows M3 acceptance.

The existing NSIS identity remains unchanged: package `review-workspace`,
product name `错题复盘`, version `0.2.4`, executable
`review-workspace.exe`, appId `com.squirrel.review_workspace.review-workspace`,
and the existing `persist:review-workspace` session partition. M3B adds no
installer hook and changes no application identity, userData location, schema,
or credential implementation.

The helper validates canonical paths, exact root identity, the pinned
historical package, registry values, process executable paths, shortcut
targets, and reparse points. PE ProductVersion/FileVersion and other Electron
metadata are reported only as informational facts; they do not prove the
Squirrel release version. Sibling roots, path traversal, conflicting
registrations, unexpected residuals, and ambiguous state refuse cleanup.

Only these active legacy targets may be removed:

- validated app-0.2.4 payload;
- validated Squirrel root stub;
- Desktop/Start Menu .lnk whose resolved target is inside the exact legacy
  root;
- the exact legacy Squirrel uninstall registry key.

The NSIS install-registry key and NSIS uninstall-registry key are preservation
identities only and can never enter the deletion plan. No registry-provided
uninstall command is executed.

Shortcuts are never deleted by filename, display name, AppID, or product name.
An absent historical Desktop or Start Menu shortcut is valid and creates no
cleanup action. An NSIS-target shortcut is preserved; a shortcut is deleted
only when it exists and its resolved target is inside the exact validated
legacy root. Known inert Squirrel residuals such as .dead, Update.exe,
RELEASES, and packages are reported separately and are not deleted merely to
make the directory empty.

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

M3 ACCEPTED SQUIRREL ARTIFACT: RECOVERED

The exact accepted installer was recovered and is the only artifact permitted
for real M3 execution. The previously found same-name local artifact remains
rejected and must not be substituted:

~~~text
size:    190381056
SHA-256: 87966A61FBC23F5124F7568319CDFABFCAE6C922BDEF2B8A0F661103674A4233
~~~

The recovered installer contains the exact installed Squirrel package anchor:

~~~text
name:     review_workspace-0.2.4-full.nupkg
size:     186836771
SHA-256:  8FD1F7B5BF12E95778476E85EFF6A96980AC952D090BB19C80AAFBED108D9EB4
~~~

Therefore:

~~~text
REAL M3 WINDOWS ACCEPTANCE:
PENDING AFTER CODE CORRECTION
~~~

## Real-Windows pre-NSIS inspection finding

The first real M3 execution began on the disposable same-machine Windows
account `test-m3-final`. The exact accepted installer
`ReviewWorkspace-0.2.4-Windows-x64-Setup.exe` (size `186909184`, SHA-256
`2A28CB47E3485DC2D67CEE80ED2208E705607452372A0C34B1FC323E186626EE`) installed
the historical Squirrel application successfully.

The observed legacy root was `%LOCALAPPDATA%\review_workspace`, with root
stub `review-workspace.exe` length `292864` and SHA-256
`E8D5964F78412D441A859F6B077852A44A1CF97928EF30EDEF9B1D8D7C61A087`. The
`app-0.2.4\review-workspace.exe` payload was length `225613824` and SHA-256
`A4EE7D8D94CF23606576955793D1A3EF26DC0D1A899140D481E7AB1315DCB98B`. Both
executables reported Electron PE metadata: `FileVersion` and `ProductVersion`
`43.2.0`, `ProductName` and `FileDescription` `Electron`, and
`InternalName`/`OriginalFilename` `electron.exe`. This is runtime metadata, not
the Squirrel application release identity. The installed package anchor was
`packages\review_workspace-0.2.4-full.nupkg`, length `186836771`, SHA-256
`8FD1F7B5BF12E95778476E85EFF6A96980AC952D090BB19C80AAFBED108D9EB4`.

No Review Workspace Desktop shortcut and no Review Workspace Start Menu
shortcut were observed, and the Squirrel log contained no shortcut creation
record. Shortcut `ABSENT` is therefore a legitimate historical state and is
not an identity failure.

The first helper invocation was inspect mode and was non-destructive:

~~~text
mode:               inspect
cleanupPerformed:   false
legacyRoot:         INVALID
legacyRegistration: VALID
legacyVersion:      unexpected
cleanupEligible:    false
~~~

It safely failed closed because the helper incorrectly compared the Electron
PE version `43.2.0` with the application release `0.2.4`. No NSIS installer was
installed, no cleanup was executed, and no userData or credential state was
modified. This PR corrects the classification by requiring the independent
Squirrel facts, especially the exact package identity, while keeping PE
metadata informational.

Execution was intentionally stopped before NSIS installation and before
cleanup. Full real Windows M3 acceptance remains pending after this code
correction; same-account credential continuity and legacy cleanup are not yet
proven.

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
