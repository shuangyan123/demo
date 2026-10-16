# Recall 0.3.1 Windows private Pilot candidate

This remains a private review candidate. Operator-attested Windows scenarios have passed within the scopes below; overall Pilot readiness and public release are not approved by those results.
The final reviewer must assess the exact PR head, CI, artifact manifest and lifecycle evidence before merging.
No tag, GitHub Release, signing purchase, production credential or paid model call is authorized by this delivery.

## Scope and historical sources

- Start from `main` `8b8c3ffdd9cce0f2fde78a0ac775693c2bdeec66` in the separate `release/recall-0.3.1-pilot-rc` worktree.
- Review #146 (`174152ee814913fcf195116372229077f255339d`) as the main-integrated successor to #144. Retain its trusted-base, fail-safe CI classification, model-picker blur fix and semantic E2E readiness changes. Do not replay #144's old dependency changes.
- #127's P1/P2 lazy-module readiness fixes are already represented by #146. Do not merge the historical branch again.
- #126 describes an older Electron tuple. Do not copy its obsolete runtime values or present its historical checks as current acceptance. Current tuple contracts derive version/runtime facts from this tree.
- The learning recommendation keyboard regression now waits for its disclosure to render before the original bounded Tab traversal. Tab budgets, focus outline, Enter expansion and navigation assertions remain unchanged.
- The dual-model collection E2E waits for a persisted successful run and its disputed summary before navigating. A model-request counter is incremented before the response and cannot prove that proposal persistence finished. A controlled delayed-response diagnostic reproduced the missing-proposal failure before this barrier and passed after it; the remote trace was unavailable because artifact quota blocked upload, so this does not establish the unique cause of the hosted failure.

## AUD-10 security boundary

The old check-then-fetch flow could resolve a public address during preflight and a private address during connection. A second preflight alone cannot remove that race.

`app/server/http/policy-fetch.ts` uses an explicitly pinned `undici@7.29.1` Agent per request. The dependency was already in the production lockfile; declaring it directly makes use of its public connector API explicit. Every new connection resolves and validates all A/AAAA answers, supplies only that snapshot to the connector lookup, and checks the connected peer address/port before handing the socket to HTTP. DNS and connect have bounded waits; cancellation destroys the dispatcher, including delayed DNS completion. Agents are not reused across requests or connection permissions.

The URL and hostname remain intact for HTTP authority, TLS SNI, CA-chain and hostname verification. IPv4, compressed/expanded IPv6, mapped IPv4 and special-use ranges use one classifier. LAN permission does not authorize metadata, link-local, CGNAT or reserved networks. Production test-domain bypasses are removed; fixtures supply explicit DNS mocks instead.

Coverage includes acquisition per-hop requests, Provider generation/stream/model-directory, speech/transcription, downloaded speech audio, quota HTTP, realtime token exchange and every MCP SDK HTTP request. Acquisition retains its exact origin list, manual redirects, three-hop, ten-second and 1 MB budgets and cancels redirect bodies. Provider and MCP HTTP fail closed on redirects. MCP also rejects any request outside its authorized origin.

Google Interactions uses the existing HTTP protocol adapter with the same endpoint, payload, `store:false`, stream parsing and no automatic retries. The installed Google SDK converts fetch options to a standard `Request` and drops the dispatcher; retaining that path would leave the socket unbound. This is a static transport choice, not a runtime provider/model fallback.

No preload/IPC permissions, credential authorization, schema, database version or learning authority changes are included. Existing explicit local/LAN connection permission remains required. Native Node environment-proxy mode (`NODE_USE_ENV_PROXY=1` or `--use-env-proxy`) is unsupported by this binding implementation and fails with `outbound_proxy_unsupported`; it must not silently fall back to direct access. Ordinary service endpoints, including explicitly configured local bridge endpoints, retain their existing permission rules. OS routes, a compromised OS/CA and transparent network interception remain outside the guarantee.

The connection API follows the installed Node 24.20.0 [custom dispatcher contract](https://nodejs.org/download/release/v24.20.0/docs/api/globals.html#custom-dispatcher). Local socket and controlled-CA TLS checks supplement the contract suite; neither constitutes testing against a real paid Provider.

## Production dependency assessment

The delivery updates js-yaml `5.3.0 → 5.4.3`, ip-address `10.4.0 → 10.7.4`, Hono `4.12.34 → 4.13.13`, and baseline-browser-mapping `2.10.33 → 2.11.28`. These stay within existing major versions. js-yaml is reachable through imported Obsidian frontmatter; its DoS fix is relevant to untrusted local documents. Hono/IP fixes remove avoidable transitive server/security findings; the application IP classifier does not rely on ip-address's vulnerable classifiers.

The inspected production audit after these updates reports zero high/critical and three moderate package findings: Mammoth → argparse → sprintf-js. The application dynamically calls Mammoth `extractRawText` for DOCX; it does not execute Mammoth's command-line argument parser or supply attacker-controlled printf format strings. The automatic suggestion to downgrade Mammoth to `0.3.29` is a major backwards change and is rejected. Retain this explicitly assessed residual and recheck the exact lockfile audit before acceptance. A successful high/critical audit gate does not mean zero advisories.

## Candidate artifact and verification record

The private handoff directory must include:

- `ReviewWorkspace-0.3.1-Windows-x64-Setup.exe` and `SHA256SUMS.txt`;
- exact `sourceCommit`, Electron/embedded Node/bundled Node tuple, production evidence and artifact manifest;
- a complete command ledger, local logs with SHA-256 hashes, exact-head CI links and final independent-review findings;
- this installation/recovery/rollback guide and a lifecycle record distinguishing passed, failed and unexecuted checks.

The candidate is intentionally unsigned and has no auto-updater. Verify its exact SHA-256 before opening it. SmartScreen/Unknown Publisher prompts are expected; there is no verified publisher claim. A package built or tested only as win-unpacked does not establish Setup acceptance.

## Installation, configuration and upgrade

Use a disposable Windows account or VM for acceptance. First take a local data backup from Settings → local data management, retain its file outside the installation directory, and verify restoration into a separate test profile. Credentials, cookies, directory handles and Vault content are excluded from the backup; re-enter credentials and reselect authorized directories locally. Do not include credentials or real learner data in evidence.

Run the verified Setup as the test user, choose the per-user installation, launch it and confirm its version and local startup. Configure only controlled/mock endpoints during acceptance; a real AI request is not required. Test export/import and restart with deterministic fixture learning history and compare record IDs/counts and review outcomes.

For v0.2.2 upgrade, use the retained v0.2.2 Setup in the disposable environment, seed and back up deterministic data, then run this exact 0.3.1 Setup. Squirrel and NSIS registrations may coexist; do not execute old registry-provided uninstall commands or guess which installation root to delete. The existing M3 cleanup tool is pinned to v0.2.4 and must not be run unmodified against v0.2.2. Confirm historical data and newly saved facts after restart, uninstall the candidate, reinstall it, and restore the backup into a separate clean profile. Record each actual installer exit, version, restart and data comparison.

## Windows lifecycle acceptance record

### First-launch correction after the reported Setup trial

The operator originally reported successful installation of the `0b224189e965d833219d679a7b77a3f079801058` CI Setup (SHA-256 `9ae157162df203d40e3eadfd94a871a60778b6d60e86fa52675f98b8ee42237a`) in Windows account `3`, followed by `initialization_candidate_changed` on Create. The failure scene, including its 490-byte `Local State` and absent Identity/Bootstrap, was preserved until the operator's no-wipe recovery trial recorded below.

An isolated real packaged Main reproduces the failure when Electron first flushes `Local State` while native confirmation is open. Directory, lock and Host bindings remain unchanged. The correction waits for that first strict runtime-only publication after Ready and before generating a one-use candidate or asking for authorization; all existing create-only, binding, namespace and identity verification remains intact. See [fresh-profile bootstrap](recall-fresh-profile-bootstrap.md). Old Setup hashes and account-3 failure evidence must not be used as acceptance evidence for the new source or rebuilt artifacts. The controlled Main regression remains distinct from the subsequent manual Setup outcomes.

### Operator-attested results (2026-10-16)

The [human operator acceptance record](https://github.com/shuangyan123/demo/pull/147#issuecomment-6211258211) reports testing the exact CI-built NSIS candidate from source `3a48b8472fd23c73a531f6df39638b055a61a8d5`, [workflow 38753920069](https://github.com/shuangyan123/demo/actions/runs/38753920069) (8/8 successful jobs). The tested Setup SHA-256 is `8ffbdbd061cc4db8383a6497a80b366cf6ea5411c13f63f24256112e58e21072`. The original failed `0b224189` Setup is a different artifact.

The following PASS statuses are human-reported manual Windows outcomes in disposable local accounts. They are not newly executed automated tests, independently collected raw machine logs or an independent final PR review. This documentation-only correction does not rerun Setup or CI and does not modify user profiles or historical evidence.

| Account | Operator-tested scenario | Recorded outcome |
| --- | --- | --- |
| 4, clean profile | Setup SHA verified; per-user fresh install; native Create local learning profile; workspace launch; Identity/Bootstrap publication; local data health; independent restart | **PASS**, within the reported fresh-install scope |
| 4 | Synthetic question tagged `PILOT-031` imported; answer/explanation/tag retained across restart; JSON backup exported with `schemaVersion: 2` and `credentialsExcluded: true` | **PASS**, for synthetic learning-data persistence and backup export |
| 5, clean profile | Same exact Setup; account-4 backup copied and SHA verified; application restore; restored question/fields; health and independent restart | **PASS**, for cross-account backup restore, not credential portability |
| 5 | Normal current-user NSIS uninstall removed the executable and uninstall registry entry while retaining the profile, Identity and Bootstrap; exact-candidate reinstall recognized the existing profile without Create; synthetic question, health and restart preserved | **PASS**, for normal uninstall/reinstall and same-profile continuity |
| 6, v0.2.2 baseline | Actual Squirrel v0.2.2 launch; old synthetic question `UPGRADE-022-031`, restart and legacy backup; same-user 0.3.1 NSIS install; old question/fields/counts retained; new `POST-UPGRADE-031` question written; both survived restart; health passed | **PASS**, for business-data continuity and post-upgrade writes; legacy payload cleanup remains unresolved below |
| 3, original failure scene | Fixed candidate installed without wiping AppData; profile created from the preserved failed-first-launch state; workspace entered; Identity/Bootstrap confirmed; health and restart passed | **PASS**, for the specific in-place failed-first-launch recovery scenario |
| 7, clean profile | Same Setup SHA verified; first Create dialog cancelled with no Identity/Bootstrap; independent restart and Create published both anchors; health and further restart recognized the existing profile | **PASS**, for Cancel→Restart→Create and profile persistence |

Account 4 exported `review-workspace-backup-2026-10-16.json`, SHA-256 `38f11c04c726edc6d261e4642857b879ecbab30bd3fe531a81aaad605d8f9b60`; the operator verified the same bytes on account 5 before restoring. Account 6's v0.2.2 pre-upgrade backup is a separate 4,941-byte file, SHA-256 `465ff50ddcc61b68c32cc8aebb25d680633545c8f8eea6b49fa911445c8c168b`. Account 5's Identity and Bootstrap hashes were identical before and after normal uninstall/reinstall. These hashes and readbacks are operator attestations; backup contents, credentials and raw profile data are not reproduced here.

### Remaining v0.2.2 Squirrel cleanup-policy gap

The operator reports that account 6 still has the legacy `%LOCALAPPDATA%\review_workspace` tree containing `app-0.2.2`, the root stub, `Update.exe` and historical `.nupkg` files alongside the new NSIS installation root and registry. No legacy process was found, no direct legacy-target shortcut was found in the checked Desktop/Start Menu/Public Desktop locations, and no matching legacy uninstall entry surfaced in the inspected registry paths. Those limited negative observations do not establish that the old payload was removed or is unlaunchable.

This is an unresolved installation-residual compatibility/cleanup-policy issue, not a confirmed userData regression or data-corruption finding. The existing guarded M3 cleanup tool is pinned to **v0.2.4**; its authorization must not be presumed safe for **v0.2.2**. Do not run it unmodified against this payload or manually delete old roots, profiles, registry keys or artifacts. Maintainers must decide on a scoped compatible cleanup policy or explicitly document and accept the retained payload before the final readiness decision; this correction does not resolve that policy or clean any files.

### Evidence boundaries and remaining review gates

- Account 3's pre-existing AppData was not cleaned or reset during the reported recovery. That PASS supports the precise operator-tested scenario, not a general corrupt-profile recovery guarantee.
- Cross-account backup restore does not validate cross-account credential portability. Credentials and Vault paths are excluded by design; no secret migration claim follows from accounts 4/5.
- Production signing, automatic-update behavior and public release remain outside this acceptance. The candidate is intentionally unsigned and has no auto-updater. The record makes no paid-provider or real-learner-data claim.
- The [P2 review finding](https://github.com/shuangyan123/demo/pull/147#discussion_r4292512364) identifies the stale unexecuted lifecycle statement and missing v0.2.2 residual-policy disposition. This local correction reconciles the document; the PR description must also be reconciled after maintainer review without losing the existing technical, CI, security or compatibility evidence.
- Keep **Draft**. Codex independently reviewed source `3a48b8472fd23c73a531f6df39638b055a61a8d5` and reported one P2 documentation finding. This correction addresses the stale lifecycle ledger, but the revised documentation and PR description still require maintainer approval. The v0.2.2 Squirrel residual-policy decision remains open. No merge, release or `PILOT_READY` claim is authorized.

## Rollback and decision

Stop distribution on any blocker. Preserve the exact candidate, its checksum, logs and pre-upgrade backup. Close the app before changing binaries. In the disposable environment, remove only the verified candidate installation using its own uninstaller, reinstall the retained v0.2.2 Setup and restore a backup known to be compatible with v0.2.2. Do not blindly open a newer profile in older binaries or overwrite current learner data. If compatibility is uncertain, keep the profile and backup untouched and investigate in a copy.

Source rollback uses an ordinary reviewed revert PR; it does not move historical tags, rewrite history or modify evidence. Reverting the network binding restores the old AUD-10 risk, so that revert is not itself a safe release. The operator-reported PASS scopes above do not resolve the v0.2.2 cleanup-policy gap or substitute for post-correction maintainer approval. Keep Draft; no merge, release or Pilot-ready claim is authorized by this document correction.
