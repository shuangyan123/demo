# Recall 0.3.1 Windows private Pilot candidate

This is a private review candidate, not a published release or completed Pilot acceptance.
The final reviewer must assess the exact PR head, CI, artifact manifest and lifecycle evidence before merging.
No tag, GitHub Release, signing purchase, production credential or paid model call is authorized by this delivery.

## Scope and historical sources

- Start from `main` `8b8c3ffdd9cce0f2fde78a0ac775693c2bdeec66` in the separate `release/recall-0.3.1-pilot-rc` worktree.
- Review #146 (`174152ee814913fcf195116372229077f255339d`) as the main-integrated successor to #144. Retain its trusted-base, fail-safe CI classification, model-picker blur fix and semantic E2E readiness changes. Do not replay #144's old dependency changes.
- #127's P1/P2 lazy-module readiness fixes are already represented by #146. Do not merge the historical branch again.
- #126 describes an older Electron tuple. Do not copy its obsolete runtime values or present its historical checks as current acceptance. Current tuple contracts derive version/runtime facts from this tree.
- The learning recommendation keyboard regression now waits for its disclosure to render before the original bounded Tab traversal. Tab budgets, focus outline, Enter expansion and navigation assertions remain unchanged.

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

For v0.2.2 upgrade, use the retained v0.2.2 Setup in the disposable environment, seed and back up deterministic data, then run this exact 0.3.1 Setup. Squirrel and NSIS registrations may coexist; do not execute old registry-provided uninstall commands or guess which installation root to delete. Existing M3 inspection/cleanup authorization remains separate. Confirm historical data and newly saved facts after restart, uninstall the candidate, reinstall it, and restore the backup into a separate clean profile. Record each actual installer exit, version, restart and data comparison.

## Lifecycle evidence limitation

On the inspected build host, HKCU already registers a real v0.2.2 installation and the user's learning-data directory exists. Windows Sandbox is unavailable. No current-user install/uninstall/upgrade is performed against that state. First install, real v0.2.2-to-candidate upgrade, uninstall, reinstall and recovery remain **NOT EXECUTED** until a disposable Windows environment is available. Native Electron contracts and browser backup/restore tests do not substitute for this gate. Consequently the private Pilot remains blocked even when source checks and packaging pass.

## Rollback and decision

Stop distribution on any blocker. Preserve the exact candidate, its checksum, logs and pre-upgrade backup. Close the app before changing binaries. In the disposable environment, remove only the verified candidate installation using its own uninstaller, reinstall the retained v0.2.2 Setup and restore a backup known to be compatible with v0.2.2. Do not blindly open a newer profile in older binaries or overwrite current learner data. If compatibility is uncertain, keep the profile and backup untouched and investigate in a copy.

Source rollback uses an ordinary reviewed revert PR; it does not move historical tags, rewrite history or modify evidence. Reverting the network binding restores the old AUD-10 risk, so that revert is not itself a safe release. No merge or Pilot-ready claim is allowed while exact-head CI, independent review or the real Setup lifecycle remains incomplete.
