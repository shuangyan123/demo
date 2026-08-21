# Windows installer migration M2 — fresh-profile real Windows NSIS acceptance

Status: **M2 FRESH-PROFILE NSIS ACCEPTANCE: PASS**

## Purpose and boundary

M2 closes the accepted bundled NSIS candidate against a supplied,
operator-attested real-Windows acceptance run. The run used a genuinely fresh
disposable Windows user profile and remained network-isolated through
installation, first launch, sentinel creation, ordinary close, ordinary
restart, and persistence observation.

This documentation closure does not execute the installer, install NSIS into
the developer profile, launch an installed application, uninstall anything,
implement migration logic, or begin M3. The real-Windows result below is
operator-attested evidence supplied for this closure; it was not independently
replayed in Codex.

The M2 result must be exactly one of:

~~~text
M2 FRESH-PROFILE NSIS ACCEPTANCE: PASS
M2 FRESH-PROFILE NSIS ACCEPTANCE: FAIL
M2 FRESH-PROFILE NSIS ACCEPTANCE: BLOCKED / INCONCLUSIVE
~~~

The accepted final result is recorded below as operator-attested evidence for
this exact candidate and the test-m2-final profile. It is not a universal
portability, migration, uninstall, signing, or updater claim.

## Baseline and candidate provenance

M0 is accepted and merged. M1 candidate packaging is accepted and merged by
PR #94. The verified remote starting point for this preparation task was:

| Item | Value |
| --- | --- |
| Starting origin/main | 561db11040def4071771944afa35c505590fbd11 |
| M2 candidate source SHA | 561db11040def4071771944afa35c505590fbd11 |
| Preparation branch | test/windows-nsis-m2-fresh-install-acceptance |
| Package / product | review-workspace / 错题复盘 |
| Version | 0.2.4 |
| Executable | review-workspace.exe |
| Electron | 43.2.0 |
| electron-builder | 26.15.3 |
| Target | bundled NSIS, Windows x64 |
| Compatibility appId proposal | com.squirrel.review_workspace.review-workspace |
| Bundled Node | v22.23.1 |
| Configured per-user intent | perMachine=false, selectPerMachineByDefault=false |
| Configured run-after-finish | false |
| Configured shortcuts | Desktop and Start Menu |

The candidate was built before this documentation change from the exact M2
candidate source SHA above. The later documentation commit is not the source
SHA that generated the already-built candidate.

The final real-Windows run used this exact candidate provenance. The supplied
run evidence is classified as operator-attested and does not convert the later
documentation commit into the candidate's source SHA.

## Candidate artifact and readback

The candidate uses the accepted M1 pipeline and existing
electron-builder.nsis.cjs. No second M2 packaging configuration was created,
and the artifact filename was not changed merely to rename the phase.

| Item | Recorded value |
| --- | --- |
| Candidate path | out/builder-nsis/ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe |
| Candidate filename | ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe |
| Candidate byte size | 122661636 |
| Candidate SHA-256 | 35299acc20a28709c7469b118d7ef7bbf522686f0416a3a5a686bb3cad1cb5a0 |
| Candidate evidence | out/builder-nsis/candidate-evidence.json |
| Unpacked executable | out/builder-nsis/win-unpacked/review-workspace.exe |
| app.asar | out/builder-nsis/win-unpacked/resources/app.asar |
| Bundled runtime | out/builder-nsis/win-unpacked/resources/.desktop-runtime |

The installer hash and byte size identify this exact build. A later rebuild
may have different packaging metadata and therefore a different installer
hash; byte reproducibility is not claimed.

The following packaging and artifact facts were independently read back from
the local Windows candidate:

| Gate | Result | Evidence |
| --- | --- | --- |
| Package/product/version identity | PASS | review-workspace / 错题复盘 / 0.2.4 |
| Electron | PASS | 43.2.0 |
| electron-builder | PASS | 26.15.3 |
| Target | PASS | NSIS x64 |
| Installer exists | PASS | exact path and size above |
| resources/app.asar | PASS | 13 files; no node_modules tree |
| resources/.desktop-runtime | PASS | present once in the unpacked candidate |
| Runtime manifest | PASS | SHA-256 manifest matched all 1,530 files |
| Bundled Node | PASS | v22.23.1 |
| Compiled preload equals packaged preload | PASS | b4c8f42c0631b430cf7605c543e7003b775aff7822fd565327c14b3c458688ee |
| Strict nine Electron V1 fuses | PASS | complete wire read back from final executable |
| strictlyRequireAllFuses | PRESERVED | true |
| Embedded ASAR integrity | PASS | expected and actual raw-header SHA-256 both 076447aea6a507395c85260b4e0aaa0f0389c437f95afcae9f5a0c768abffa08 |
| latest.yml | ABSENT | no updater metadata in the candidate output |
| .blockmap | ABSENT | no updater metadata in the candidate output |
| Signing | NOT EXECUTED | unsigned M1 candidate boundary |

The nine read-back fuse states are:

~~~text
RunAsNode: DISABLE
EnableCookieEncryption: ENABLE
EnableNodeOptionsEnvironmentVariable: DISABLE
EnableNodeCliInspectArguments: DISABLE
EnableEmbeddedAsarIntegrityValidation: ENABLE
OnlyLoadAppFromAsar: ENABLE
LoadBrowserProcessSpecificV8Snapshot: DISABLE
GrantFileProtocolExtraPrivileges: DISABLE
WasmTrapHandlers: ENABLE
~~~

The builder reported the default Electron icon because no approved repository
ICO is configured. This is retained as a known candidate fact and is not
converted into an installed-app UX claim.

## Candidate validation

The following commands were executed from the candidate source SHA using
Node v22.23.1. The repository-specific production audit returned zero
low/moderate/high/critical vulnerabilities. The npm CLI also printed its
broader installed-tree advisory summary during npm ci; no forced dependency
repair was performed.

~~~text
npm ci
npm run audit:prod
npm run typecheck
npm run lint
npm run test:contracts
npm run build
npm run check:bundle
npm run test:desktop
npm run test:desktop:integration
npm run desktop:builder:nsis
npm run test:desktop:builder:nsis:source
npm run generate:desktop:builder:nsis:evidence
npm run test:desktop:builder:nsis:artifact
~~~

Observed results:

- production audit: PASS, 0 blocking production vulnerabilities;
- typecheck: PASS;
- lint: PASS;
- contracts: PASS, 498/498;
- production build: PASS;
- bundle budget: PASS, no failures;
- desktop contracts: PASS, 30/30;
- desktop preload integration smoke: PASS;
- NSIS build: PASS;
- NSIS source contracts: PASS, 7/7;
- fresh artifact evidence readback: PASS, 1/1.

The desktop integration smoke is not installed-app acceptance. It does not
replace the operator-attested Start Menu launch or fresh-profile evidence.

## Operator-attested final real-Windows M2 evidence

This section records the supplied final run, not a new Codex execution.

| Item | Operator-attested result |
| --- | --- |
| Evidence classification | OPERATOR-ATTESTED; not independently replayed |
| Fresh profile | test-m2-final |
| Windows | Windows 11 x64 |
| Candidate source SHA | 561db11040def4071771944afa35c505590fbd11 |
| Candidate filename | ReviewWorkspace-0.2.4-Windows-x64-NSIS-M1-Candidate.exe |
| Candidate size | 122661636 bytes |
| Candidate SHA-256 | 35299acc20a28709c7469b118d7ef7bbf522686f0416a3a5a686bb3cad1cb5a0 |

### Continuous network-isolated run

Network isolation was maintained through fresh-profile preflight,
installation, first launch, production-UI sentinel creation, ordinary close,
ordinary restart, and sentinel persistence observation.

Final post-restart TCP checks were:

~~~text
github.com: TCP/443 UNREACHABLE / PASS
raw.githubusercontent.com: TCP/443 UNREACHABLE / PASS
~~~

This supports the scoped claim that the accepted candidate did not require
those public endpoints for the offline install/launch/restart path. It is not
packet-level proof that no DNS or network request was attempted.

### Installed layout and userData

Observed NSIS installation root:

~~~text
C:\Users\test-m2-final\AppData\Local\Programs\review-workspace
~~~

Observed installed executable:

~~~text
C:\Users\test-m2-final\AppData\Local\Programs\review-workspace\review-workspace.exe
~~~

Observed bundled Node:

~~~text
C:\Users\test-m2-final\AppData\Local\Programs\review-workspace\resources\.desktop-runtime\node\node.exe
~~~

Observed bundled runtime server:

~~~text
C:\Users\test-m2-final\AppData\Local\Programs\review-workspace\resources\.desktop-runtime\app\server.js
~~~

Observed userData:

~~~text
C:\Users\test-m2-final\AppData\Roaming\错题复盘
~~~

Electron child process command lines explicitly contained:

~~~text
--user-data-dir="C:\Users\test-m2-final\AppData\Roaming\错题复盘"
~~~

UserData compatibility: **PASS**.

### Install, registration, shortcuts, and shell

The supplied final run observed:

- per-user installation: PASS;
- runAfterFinish=false: PASS;
- installer transaction completion: PASS;
- no unexpected installer/helper residual: PASS;
- Desktop shortcut: PASS;
- Start Menu shortcut: PASS.

Both shortcut targets resolved to:

~~~text
C:\Users\test-m2-final\AppData\Local\Programs\review-workspace\review-workspace.exe
~~~

The current-user uninstall registration was observed read-only. The supplied
closure does not enumerate each registry value, so this document claims the
observation only and does not invent DisplayIcon, Publisher, or uninstall
command values.

Windows shell observation:

~~~text
Name: 错题复盘
AppID: com.squirrel.review_workspace.review-workspace
Configured compatibility proposal: com.squirrel.review_workspace.review-workspace
Shell AppID/AUMID: OBSERVED
Compatibility: MATCH
~~~

No app.setAppUserModelId() was added.

### Production data, ordinary close, and restart

The following sanitized sentinel was created through normal production UI:

~~~text
nsis-m2-final-acceptance-2026-08-21
~~~

The supplied evidence states that no DevTools, IndexedDB manual mutation,
filesystem injection, test-only API, or database script was used. The
sentinel was visibly present in the production UI before close.

After ordinary user-facing close:

- no installed Review Workspace Electron processes: PASS;
- no installed bundled Node runtime: PASS.

The application was restarted normally through the installed Start Menu
shortcut while still offline. After restart:

- installed app/runtime: PASS;
- same userData: PASS;
- no conflicting --user-data-dir: PASS;
- shell AppID/AUMID: MATCH;
- sentinel visible in normal production UI: PASS;
- sentinel persistence after ordinary close/restart: PASS.

An earlier diagnostic run used another fresh profile but had an interruption
in network isolation. It is not used as the final acceptance and is
superseded by the continuous-offline test-m2-final run; it is not classified
as a product failure.

## Fresh disposable profile requirement

The accepted final run used a genuinely fresh disposable local Windows
account/profile. The account had never launched or installed:

- Review Workspace;
- 错题复盘;
- the accepted Squirrel installer;
- the M0 NSIS artifact;
- the M1 NSIS artifact.

Before Setup starts, preserve a baseline transcript showing:

~~~text
no Review Workspace process
no bundled Review Workspace node.exe
no Review Workspace NSIS installation
no Squirrel Review Workspace installation
no relevant current-user uninstall registration
no Review Workspace Desktop shortcut
no Review Workspace Start Menu shortcut
%APPDATA%\错题复盘 is absent
~~~

Do not reuse an old installer test account containing Squirrel, userData, or
shortcut evidence. The NSIS install directory was observed during the final
run and is recorded in the operator-attested evidence above.

## Network-isolated acceptance design

Network isolation must be established before Setup starts and kept in place
through installation, first launch, sentinel creation, ordinary close,
ordinary restart, and persistence observation.

The operator should verify before Setup that public endpoints used during
earlier Squirrel investigation are unreachable, including:

~~~text
github.com
raw.githubusercontent.com
~~~

This is an offline-environment acceptance, not packet-level proof that no DNS
or network request was attempted. Do not overclaim request absence. Do not
disable Windows security products globally.

## Manual acceptance procedure reference

The following checklist is the procedural reference used for the final
operator run. The result of that run is recorded in the operator-attested
section above and in the acceptance matrix below. No independent replay is
claimed.

### 1. Baseline and isolation

- [ ] Use the disposable fresh local Windows account/profile.
- [ ] Record Windows version, account/profile identity, and test timestamp.
- [ ] Confirm the baseline absence list above.
- [ ] Establish network isolation before Setup starts.
- [ ] Record the reachability checks for github.com and
      raw.githubusercontent.com.
- [ ] Preserve the candidate file and its SHA-256 before launching it.

### 2. Installer UX and transaction

Run the candidate Setup manually only after the baseline is preserved.

- [ ] Wizard installer appears.
- [ ] Per-user installation is selected or clearly intended.
- [ ] Installation does not require administrator-only machine-wide elevation
      merely to satisfy the current per-user configuration.
- [ ] An unsigned-publisher or reputation warning, if shown, is recorded as
      expected unsigned M2 evidence.
- [ ] SmartScreen is not disabled globally.
- [ ] Finish does not automatically launch the application because
      runAfterFinish=false.
- [ ] Setup process exits.
- [ ] NSIS helper processes exit.
- [ ] No unexpected persistent installer process remains.
- [ ] Installation root exists.
- [ ] review-workspace.exe exists in the observed installation root.
- [ ] resources/app.asar exists.
- [ ] resources/.desktop-runtime exists.
- [ ] No application process is attributed to the installer before the
      operator deliberately launches the installed app.

Record the actual values, without assuming the old Squirrel directory:

~~~text
actual installation root: C:\Users\test-m2-final\AppData\Local\Programs\review-workspace
actual installed executable path: C:\Users\test-m2-final\AppData\Local\Programs\review-workspace\review-workspace.exe
actual resources path: C:\Users\test-m2-final\AppData\Local\Programs\review-workspace\resources
actual bundled Node path: C:\Users\test-m2-final\AppData\Local\Programs\review-workspace\resources\.desktop-runtime\node\node.exe
actual uninstaller path: observed in current-user registration; exact value not enumerated in supplied closure
~~~

### 3. Uninstall registration observation only

Read the actual current-user uninstall registration after installation and
record any values Windows exposes:

~~~text
DisplayName
DisplayVersion
DisplayIcon
Publisher
InstallLocation
UninstallString
QuietUninstallString
NoModify / NoRepair or equivalent
~~~

This is observation-only input for M4. Do not invoke UninstallString or
QuietUninstallString. Do not uninstall, repair, reinstall, or delete registry
entries during M2.

Do not require the registry shape used by Squirrel.

### 4. Shortcut acceptance

Because the accepted candidate explicitly configures both shortcuts, M2
requires both to exist:

- [ ] Desktop .lnk exists.
- [ ] Start Menu .lnk exists.
- [ ] Desktop .lnk path is recorded.
- [ ] Start Menu .lnk path is recorded.
- [ ] Both shortcuts resolve to the actual installed
      review-workspace.exe.

Reject stale targets pointing to:

~~~text
Squirrel Update.exe
app-0.2.4
the developer build tree
the installer file itself
~~~

### 5. First launch and process layout

After installation is fully complete, launch through the installed Start Menu
shortcut only. Do not launch from win-unpacked, the repository, the
installer, or an old Squirrel stub.

Record executable paths and command lines for the application process and
children. The expected installed layout is:

~~~text
<actual install root>\review-workspace.exe
<actual install root>\resources\.desktop-runtime\node\node.exe
<actual install root>\resources\.desktop-runtime\app\server.js
~~~

- [ ] Installed review-workspace.exe starts from the observed NSIS install
      root.
- [ ] Electron child processes come from the same installed application.
- [ ] Bundled Node comes from the installed resources path.
- [ ] The runtime server is the installed resources .desktop-runtime app.
- [ ] No developer-tree or win-unpacked process is mistaken for the installed
      application.

### 6. userData hard gate

Observe the Electron child process command line and filesystem. The existing
application identity expectation is:

~~~text
%APPDATA%\错题复盘
~~~

- [ ] Actual userData path is recorded.
- [ ] Actual userData path is the expected %APPDATA%\错题复盘 path.

Do not change code to force this result. If a different userData path appears,
M2 is:

~~~text
M2 FRESH-PROFILE NSIS ACCEPTANCE: FAIL
~~~

unless evidence proves the observation method itself was wrong. Do not
silently redefine compatibility.

### 7. Production-UI sentinel

Using the normal production UI, create one sanitized unique sentinel in a
normal local workspace or study-data field already supported by the product:

~~~text
nsis-m2-final-acceptance-2026-08-21
~~~

- [ ] Sentinel was entered through normal production UI.
- [ ] Sentinel appears in normal production UI.
- [ ] Evidence captures the visible production state.

Do not use the developer console, IndexedDB manual editing, filesystem
injection, a test-only API, or a database mutation script. Do not enter any
provider key, MCP credential, account secret, or token.

### 8. Full ordinary close

Close the app using ordinary user-facing close behavior and wait for
shutdown.

- [ ] No installed review-workspace.exe remains.
- [ ] No installed bundled runtime node.exe remains.
- [ ] No Review Workspace Electron child process remains.

Filter by executable path and command line. Do not classify unrelated system,
Adobe, or other node.exe processes as Review Workspace residuals.

Ordinary close must pass before restart testing.

### 9. Ordinary restart and persistence

Remain offline and restart only through the installed Start Menu shortcut.
Do not invoke developer commands, the installer, or win-unpacked.

- [ ] Installed review-workspace.exe starts.
- [ ] Installed bundled Node starts from resources/.desktop-runtime.
- [ ] The same userData path is used.
- [ ] Production UI loads.
- [ ] The previously created sentinel is still visible.

Sentinel persistence after full close and restart is a hard M2 gate.

### 10. Shell, AppID, and AUMID observation

Collect stable Windows shell evidence where reasonably available without
changing runtime code:

- [ ] Get-StartApps result for 错题复盘 is recorded, if present.
- [ ] Desktop shortcut target is recorded.
- [ ] Start Menu shortcut target is recorded.
- [ ] Any exposed AppID/AUMID value is recorded.
- [ ] Shell/AppID evidence is classified as OBSERVED or NOT OBSERVABLE.
- [ ] Compatibility with the configured appId proposal is classified as
      MATCH, MISMATCH, or INCONCLUSIVE.

Do not add app.setAppUserModelId() in M2 and do not change runtime code merely
to force a shell value. A mismatch is important input for M3 and must remain
visible.

### 11. Narrow single-instance observation

If the existing desktop contract promises single-instance behavior, the
operator may perform one narrow observation after restart:

- [ ] With the first installed instance running, invoke the same installed
      Start Menu shortcut once.
- [ ] Record whether a second independent application window or process root
      is created.

Do not loop or stress-test. If source contracts do not promise this behavior,
record the observation without inventing a new acceptance requirement.

### 12. Preserve the test state

After M2 evidence is complete:

- [ ] Preserve the fresh test profile and installed candidate until evidence
      is archived.
- [ ] Do not run the uninstaller.
- [ ] Do not delete the install directory.
- [ ] Do not delete registry entries.
- [ ] Do not reinstall, repair, or run a second installer.

## M2 acceptance matrix

| Acceptance item | Final status | Evidence boundary |
| --- | --- | --- |
| Fresh disposable profile | PASS (operator-attested) | test-m2-final, Windows 11 x64 |
| Network-isolated installation | PASS (operator-attested) | continuous run; final endpoint checks unreachable |
| Wizard and per-user intent | PASS (operator-attested) | per-user installation observed |
| No unexpected administrator-only install | PASS (operator-attested) | no machine-wide elevation requirement observed |
| Finish does not auto-launch | PASS (operator-attested) | runAfterFinish=false observed |
| Installer transaction completion | PASS (operator-attested) | Setup/helper completion and no residual observed |
| Actual NSIS installation root | PASS (operator-attested) | observed test-m2-final install root |
| Actual resources and bundled Node paths | PASS (operator-attested) | installed filesystem/process paths recorded above |
| Current-user uninstall registration | PASS (observation only) | registration observed; individual values not enumerated here |
| Desktop shortcut | PASS (operator-attested) | .lnk target resolved to installed executable |
| Start Menu shortcut | PASS (operator-attested) | .lnk target resolved to installed executable |
| First installed launch | PASS (operator-attested) | Start Menu launch and installed process layout |
| Expected userData path | PASS (operator-attested) | explicit --user-data-dir matched %APPDATA%\错题复盘 |
| Production-UI sentinel | PASS (operator-attested) | nsis-m2-final-acceptance-2026-08-21 |
| Full ordinary close | PASS (operator-attested) | no installed app/runtime residual |
| Ordinary restart | PASS (operator-attested) | Start Menu restart while offline |
| Sentinel persistence | PASS (operator-attested) | sentinel visible after close/restart |
| Shell/AppID/AUMID | OBSERVED / MATCH | Name 错题复盘; AppID matched proposal |
| Narrow single-instance observation | NOT REPORTED / OPTIONAL | no new requirement inferred |
| Credentials / DPAPI | NOT IN SCOPE | no credentials entered or evaluated |

## Evidence boundary and non-claims

The accepted M2 result combines the M1 packaging/readback evidence with the
supplied operator-attested final run. The real-Windows observations are scoped
to the exact candidate provenance, the test-m2-final profile, and the same
Windows 11 x64 environment. They are not independently replayed in Codex.

### PROVEN REAL WINDOWS M2 — OPERATOR-ATTESTED

- fresh disposable per-user installation;
- continuous offline install, launch, close, restart, and persistence path;
- actual NSIS installation layout and bundled runtime paths;
- current-user uninstall registration observation only;
- Desktop and Start Menu shortcuts resolving to the installed executable;
- shell AppID/AUMID OBSERVED and MATCHING the configured proposal;
- first installed launch;
- expected userData path;
- production-UI sentinel creation;
- ordinary close with no installed app/runtime residual;
- ordinary restart;
- sentinel persistence after close/restart.

### STILL NOT EXECUTED / NOT PROVEN

- existing Squirrel 0.2.4 -> NSIS migration;
- coexistence or cleanup of a legacy Squirrel installation;
- credentials, safeStorage, or DPAPI;
- different-machine or copied-userData portability;
- NSIS uninstall;
- reinstall;
- running-app uninstall;
- rollback;
- signing;
- publisher identity;
- SmartScreen reputation mitigation;
- updater or electron-updater;
- production NSIS cutover;
- byte-for-byte reproducibility across rebuilds;
- universal network-request absence or general portability.

The operator-attested run does not establish the individual uninstall
registration field values that were not included in the supplied closure, and
the optional single-instance observation was not reported.

## Explicit phase boundaries

~~~text
M3: PENDING
M4: PENDING
M5: PENDING
~~~

M3 owns existing Squirrel -> NSIS migration and coexistence acceptance. M4
owns uninstall, reinstall, rollback, and running-app lifecycle acceptance. M5
owns signing, publisher/SmartScreen release readiness, updater, and production
cutover. None was executed or implemented by this closure.

## Final result

The final result is scoped to the operator-attested M2 evidence above:

M2 FRESH-PROFILE NSIS ACCEPTANCE: PASS
