# Windows installer migration M3 - guarded Squirrel 0.2.4 to NSIS bridge

Status: **M3 SQUIRREL -> NSIS MIGRATION: PASS (operator-attested real Windows acceptance)**

This phase implements only the separately invoked legacy-Squirrel cleanup
bridge and its safety contracts. The completed acceptance recorded below is
operator-attested evidence from one real Windows machine and one disposable
account; it is not an automated test or an independent Codex replay. Codex did
not rerun the installer or cleanup during this documentation closure. M4 and M5
remain separate phases.

## Current M3 closure state

- Implementation and accepted NSIS candidate source: `31c0ec5c52352058bae1d3c61e6e685cc404b5cb`.
- Helper blob used for the guarded live cleanup: `9154d547a6874976eccc7b3065739e03e46e5516`.
- Final classification: `M3 SQUIRREL -> NSIS MIGRATION: PASS`.
- The pass is limited to same-account, same-machine continuity, preservation of
  shared userData and the Desktop-protected credential, and controlled active
  legacy cleanup. Portability, signing, updater, and later lifecycle claims are
  intentionally excluded.

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
resolution; the operator-attested live evidence below covers those M3
boundaries without converting it into automated or independent proof.

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

The helper does not implement credential checks. The recorded operator-
attested M3 run used the normal application UI to:

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

The exact accepted installer was recovered and was the only artifact used for
the recorded real M3 execution. The previously found same-name local artifact
remains rejected and must not be substituted:

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
PASS (OPERATOR-ATTESTED, SAME ACCOUNT AND MACHINE)
~~~

The exact NSIS candidate used for the recorded side-by-side run was:

~~~text
source commit: 31c0ec5c52352058bae1d3c61e6e685cc404b5cb
file:          ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe
size:          125443533
SHA-256:       61F5699D5075474B3631C55889DA0F15DC7BF4C488DD9CAD6355C61E94A1484A
~~~

The candidate provenance was manually verified before execution. It is
unsigned; SmartScreen warning and reputation/signing readiness remain M5
risks. The evidence below does not claim production signing or release
readiness.

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

This was the historical first real-Windows finding. Execution was intentionally
stopped before NSIS installation and before cleanup, so that failed-closed
inspect caused no destructive action. The corrected source was then used for
the completed operator-attested run recorded below.

## Operator-attested real-Windows M3 acceptance

The following evidence was supplied from Windows account `test-m3-final` on
one machine. It is the final M3 acceptance record, not a claim that the
workflow was automated or independently replayed by CI.

### Closure chronology

1. The guarded M3 helper and its contract boundaries were implemented.
2. The first real-Windows inspect failed closed on the incorrect PE-version
   identity comparison and performed no cleanup.
3. Source `31c0ec5` corrected the historical Squirrel identity to the pinned
   package facts and kept Electron PE metadata informational.
4. Corrected pre-NSIS inspect passed the historical package gate and reported
   only the expected absence of NSIS state.
5. The exact NSIS candidate was installed side-by-side with Squirrel.
6. The old Squirrel application baseline and restart continuity passed.
7. The first NSIS launch preserved the sentinel, Desktop protection, credential
   usability, and connection health.
8. NSIS restart continuity passed before cleanup.
9. The helper reported a cleanup-eligible state with an empty blocking-reason
   list and a three-action plan.
10. Explicit guarded cleanup removed only the validated active legacy payload,
    root stub, and Squirrel registration.
11. Post-cleanup structure preserved NSIS, shortcuts, registry identity,
    userData, and recorded the known inert residuals.
12. Final post-cleanup NSIS application continuity passed.
13. The final classification was `M3 SQUIRREL -> NSIS MIGRATION: PASS`.

### Run identity and corrected pre-NSIS validation

The historical Squirrel source and roots were:

- Installer: `ReviewWorkspace-0.2.4-Windows-x64-Setup.exe`, size `186909184`,
  SHA-256 `2A28CB47E3485DC2D67CEE80ED2208E705607452372A0C34B1FC323E186626EE`.
- Package: `review_workspace-0.2.4-full.nupkg`, size `186836771`, SHA-256
  `8FD1F7B5BF12E95778476E85EFF6A96980AC952D090BB19C80AAFBED108D9EB4`.
- Shared userData: `%APPDATA%\错题复盘`.
- Squirrel root: `%LOCALAPPDATA%\review_workspace`.
- NSIS root: `%LOCALAPPDATA%\Programs\review-workspace`.

After source `31c0ec5`, corrected inspect validation exited 0 in `inspect` mode with
`cleanupPerformed: false`, `legacyRoot: FOUND`, `legacyRegistration: FOUND`,
`legacyVersion: 0.2.4`, and `historicalPackage: VALID` with the exact package
length and hash above. Electron runtime `43.2.0` was reported as informational
metadata. Historical Desktop and Start Menu shortcuts were both `ABSENT`,
NSIS root was `ABSENT`, and `cleanupEligible` was `false`. The only blockers
before NSIS were the expected absence of NSIS registry identity, NSIS root, and
NSIS executable; the old incorrect PE-version blockers were gone.

The only blocking reasons at that point were:

~~~text
NSIS_INSTALL_REGISTRY_IDENTITY_INVALID
NSIS_UNINSTALL_REGISTRY_IDENTITY_INVALID
NSIS_ROOT_NOT_PRESENT
NSIS_EXECUTABLE_NOT_PRESENT
~~~

### Side-by-side install and continuity

NSIS was installed per-user while the Squirrel installation remained present.
Before the NSIS launch, the Squirrel `app-0.2.4` payload, NSIS root and
executable, `resources\app.asar`, `.desktop-runtime`, and bundled Node were
present. The live registry and shortcut checks recorded:

- NSIS install `InstallLocation` exactly equal to
  `C:\Users\test-m3-final\AppData\Local\Programs\review-workspace`.
- Uninstall identity with DisplayName `错题复盘`, DisplayVersion `0.2.4`, and
  the expected `UninstallString`/`QuietUninstallString` pointing to the NSIS
  uninstaller with `/currentuser` and `/S` semantics.
- Desktop and Start Menu shortcuts both targeted the NSIS executable, not the
  Squirrel executable.

The exact old Squirrel executable was launched first:

~~~text
C:\Users\test-m3-final\AppData\Local\review_workspace\app-0.2.4\review-workspace.exe
~~~

The normal UI showed the
sentinel, completed Desktop protection migration, ready/verified credential
health, and a successful connection without credential re-entry. Closing and
restarting the same legacy executable preserved those facts:

~~~text
OLD SQUIRREL RESTART CONTINUITY: PASS
~~~

The exact NSIS executable was then launched:

~~~text
C:\Users\test-m3-final\AppData\Local\Programs\review-workspace\review-workspace.exe
~~~

All product processes were under the NSIS path. The sentinel, Desktop
protection, credential usability without re-entry, health, and connection test
all passed:

~~~text
NSIS FIRST-LAUNCH CONTINUITY: PASS
~~~

NSIS was normally closed and restarted before cleanup. UI state persisted and
the connection remained successful:

~~~text
NSIS RESTART CONTINUITY: PASS
~~~

### Guarded cleanup and post-cleanup continuity

Before cleanup, all product processes were closed. The helper blob was exactly
`9154d547a6874976eccc7b3065739e03e46e5516`. Inspect exited 0 with
`cleanupPerformed: false`, both legacy identities `FOUND`, historical version
`0.2.4`, historical package `VALID`, NSIS install/uninstall identities
`NSIS_EXPECTED`, both shortcuts `NSIS_TARGET`, process count `0`,
`cleanupEligible: true`, and no blocking reasons.

The only planned cleanup actions were:

1. Remove `%LOCALAPPDATA%\review_workspace\app-0.2.4`.
2. Remove `%LOCALAPPDATA%\review_workspace\review-workspace.exe`.
3. Remove the exact Squirrel uninstall key
   `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\review_workspace`.

The plan did not include the NSIS root or executable, NSIS registry identities,
shortcuts, `%APPDATA%\错题复盘`, or any credential action. The explicit
`-ExecuteCleanup -Stage1Verified` run exited 0 with empty stderr,
`cleanupPerformed: true`, no blockers, and outcome
`ACTIVE_REMOVED_INERT_RESIDUAL_RECORDED`. The active legacy payload, root stub,
and Squirrel uninstall registration were removed. Known inert residuals
`packages` and `Update.exe` intentionally remained; `unknownResiduals` was
empty. This is not a claim that every historical Squirrel-root file was
deleted.

Post-cleanup structure retained the NSIS root, executable, `resources\app.asar`,
`.desktop-runtime`, bundled runtime, NSIS install/uninstall identities, both
NSIS-target shortcuts, and shared userData. The final NSIS launch again ran
only from the NSIS path; sentinel, Desktop protection, credential usability
without re-entry, and the DeepSeek connection/verification all passed:

The post-cleanup readback recorded `activeLegacyState.present: false`,
`NSIS root/exe: FOUND`, `userData: PRESENT`, `NSIS install/uninstall: NSIS_EXPECTED`,
`Desktop/Start Menu: NSIS_TARGET`, and `unknownResiduals: []`.

~~~text
M3 PRE-CLEANUP INSPECTION: PASS
M3 VALIDATED LEGACY CLEANUP: PASS
M3 POST-CLEANUP STRUCTURE: PASS
M3 POST-CLEANUP APPLICATION CONTINUITY: PASS
M3 SQUIRREL -> NSIS MIGRATION: PASS
~~~

### Acceptance boundary and non-claims

This PASS is limited to Windows, the same machine, the same account, the
accepted historical Squirrel 0.2.4 installation, the exact NSIS candidate from
source `31c0ec5`, shared `%APPDATA%\错题复盘`, Desktop-protected credential
continuity, and controlled target-aware active legacy cleanup. It does not
claim:

- DPAPI credential portability across accounts or machines;
- portability of copied userData;
- production signing or SmartScreen/reputation readiness;
- updater or release cutover readiness;
- M4 uninstall/reinstall or running-app lifecycle acceptance; or
- M5 signing/release acceptance.

## Real-Windows M3 checklist and stop conditions

The recorded acceptance used a new disposable Windows x64 account and followed
these stop conditions:

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
