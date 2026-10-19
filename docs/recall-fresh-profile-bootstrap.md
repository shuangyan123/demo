# Recall — Trusted Fresh Profile Bootstrap

F5 Slice 2 adds an explicit Desktop Main creation decision to the existing F1–F4 storage and diagnostic startup path. Directory absence is an eligible creation site, not proof that the profile has never held user data. Complete deletion of all initialization records cannot be detected by this design.

## Authority and eligibility

Main first acquires the existing single-instance lock and reads effective Electron `appData`, `userData` and `sessionData` paths. Inspection accepts an absent or empty profile. On Windows, it also accepts an empty regular `lockfile` and the narrowly recognized `Local State` written by Electron 43 after a cancelled native first run. Recognition requires a regular non-link file of at most 4096 bytes, lossless compact UTF-8 JSON without duplicate fields, exactly the observed `os_crypt` and `uninstall_metrics` fields and types, canonical base64 with the DPAPI prefix, and a numeric installation-date string. A strictly validated `DevToolsActivePort` debugger discovery record is also recognized, as described below. No key is decrypted, returned or rewritten; these fields do not establish historical newness or Recall identity. Other files, unknown fields, persistent partitions and any unanchored `managed-files`, `.recall-storage` or OS bootstrap namespace reject fresh creation. The same orphan check runs before legacy identity publication. Recognizable legacy partitions and valid anchor recovery continue through the existing resolver without imposing this fresh-only format on their runtime preferences.

An opaque, one-use candidate binds the inspected paths and existing directory identities. Production imports restrict creation to Main through `desktop/managed-storage.ts`. Renderer, HTTP routes, reconstruction and Kernel outputs have no creation interface. Cancel consumes the candidate without calling creation or publishing Recall metadata/history.

## Native lifecycle and confirmation order

1. Squirrel handling → single-instance lock → synchronous existing storage resolution.
2. Existing valid profiles continue normally. Invalid or ambiguous storage stops. `uninitialized` waits for `app.whenReady()`, then Main resolves again and inspects an eligible one-use candidate before presenting consent.
3. Main presents **Create local profile / Cancel**, with Cancel as the default and escape choice.
4. Confirmation recaptures effective Host paths and rechecks binding, absent/empty or recognized runtime-only contents, and missing Recall namespaces.
5. Exclusive directory reservations precede generating one profile/epoch pair. The existing V1 anchor is published create-only and independently reread.
6. The existing external V1 bootstrap is published create-only, then bootstrap and anchor are independently reread and compared with the expected records. Unexpected namespace contents or changed bindings stop the attempt.
7. Main starts the existing authenticated standalone child runtime. Its existing composition root reserves and independently confirms diagnostic generation zero.
8. Main confirms authenticated diagnostic readiness before creating the workspace window. HTTP `/` success alone does not permit entry.

Unpackaged development uses an externally started Next server without Main-owned runtime composition. Fresh setup therefore fails closed before the creation dialog or metadata writes in that mode. Existing-profile development behavior is retained.

## Interrupted setup and corruption

| Stage | Subsequent behavior |
| --- | --- |
| Reservations exist, no confirmed anchor | Preserve ambiguous remnants; refuse fresh creation. No cleanup or reset. |
| Valid anchor published, bootstrap missing | Existing anchor recovery reconstructs bootstrap with the same profile/epoch. |
| Valid Host metadata, diagnostic domain not reserved | Existing runtime may initialize generation zero. |
| Domain reserved, history missing, corrupt or unconfirmed | Existing runtime returns incomplete/corrupt/initialization failure; no complete-empty fallback. |
| Generation zero confirmed | Restart uses the original identity and epoch, with zero attempts, Events and Evidence. |

Partial, unsupported or mismatched metadata is preserved and rejected by the existing strict record parser/resolver. Fresh publication has no automatic retry or replacement. Existing F4 durable attempt replacement is unchanged.

## Read-only readiness transport

The child already receives a random 32-byte Main runtime token. Main sends that token in both the existing `x-review-runtime-token` proxy authentication header and a separate `x-review-startup-token` header to `GET /api/internal/diagnostic-ready`. The proxy removes the generic header; the route independently validates the startup token using a constant-time comparison. Ordinary Web mode has no configured Host token and returns 404; unauthenticated desktop requests return 403.

The response contains only `{ kind }`, uses `no-store`, and returns 200 only for `ready`, otherwise 503 with the existing distinct runtime failure kind. No paths, UUIDs, epochs, answers, captures or authority records are returned. The route imports only a getter for already-composed readiness: it cannot compose, initialize, read filesystem records or mutate history. Main uses a bounded timeout and treats malformed, unauthorized or unavailable replies as failure. A typed diagnostic startup failure exits the startup path without entering the general runtime retry loop.

Before spawning the Desktop Next child, Main appends the negative `-next:*` DEBUG namespace. This blocks Next header debug sinks even when the inherited setting enables an exact namespace, `next:*` or `*`; unrelated application debug namespaces remain available. Downstream error-summary redaction is supplementary protection, not the authorization-header boundary.

## Verification and limits

The workspace protocol forwards its authenticated loopback requests with Node's `fetch`. Electron 43 `net.fetch` adds Chromium Fetch Metadata (`sec-fetch-site: none`, `sec-fetch-mode: no-cors`, `sec-fetch-dest: empty`) even when the original custom-protocol form has no such headers. That changed a legitimate native diagnostic POST into a rejected request. The forwarding seam now preserves the original metadata; the runtime token, request body, manual redirect handling and existing diagnostic origin checks are retained. No server origin exception or evidence/persistence policy was added.

The desktop aggregator includes an actual Electron form POST contract backed by the existing diagnostic HTTP handler in an isolated child runtime. It verifies pre-fix rejection, successful 303 navigation, durable evidence and public resume projection, independent runtime/Electron restart, expired session rejection and a distinct explicit repeat identity. Foreign origins and fetch-site metadata remain rejected. This contract does not itself claim packaged acceptance or reproduce the installed Next renderer; the separate packaged acceptance scope is recorded below.

New contracts are imported by the existing full and desktop aggregators. Tests use owned temporary roots, deterministic publication failures, independent Node processes, competing initialization processes and Windows ACL denial. Actual Electron tests exercise pre-ready classification, post-ready inspection, a real native dialog, Cancel/Create selection, post-choice changes and an independent Electron restart. The Cancel regression inspects files after the native process exits, then authorizes Create in a new process without deleting `Local State`, verifies its bytes are preserved, and restarts with the original profile/epoch. Test-only path overrides isolate these processes from the developer's profile; no production path override or IPC was added.

### Runtime publication during native consent

The former binding combined stable directory identities with the `Local State` inode/full-byte hash and the empty `lockfile` inode. A Windows Electron 43.5.0 experiment against `d7e9239` opened native consent after `whenReady()` and used a filesystem event to wait for Electron itself to publish `Local State`. No test code wrote that file. Publication occurred about ten seconds after readiness; choosing Create then returned `initialization_candidate_changed` and logged `RECALL_INITIAL_PROFILE_REVALIDATION:local_state_appeared`. The same behavioral test succeeds with the separated model and independently reopens the same identity. Readiness is not a runtime-file quiescence barrier. The earlier installed failure screenshot shows the same error, but that binary had no category diagnostic; its exact historical filesystem transition was not recorded.

Candidate checks now distinguish these states at consent and both metadata publication checkpoints:

| Observed state | Policy |
| --- | --- |
| Host paths or existing ancestor/profile/namespace directory identity changes | Stop; preserve data and reservations. |
| Empty regular runtime `lockfile` appears, disappears or is replaced | Revalidate its type/size when present; it does not supply directory or user-data identity. |
| Strictly recognized `Local State` first appears | Accept the runtime transition; bind its existing encrypted-key and installation-date fingerprint at this checkpoint. |
| Recognized `Local State` is atomically replaced or its Boolean audit flag changes | Revalidate the complete narrow format; retain the existing key/date binding independently of inode and audit flag. |
| Previously observed `Local State` disappears or its key/date changes | Stop without deleting or rewriting it. |
| Malformed/unknown runtime content, links, persistent partitions, unknown files or unanchored Recall namespaces | Stop; missing metadata never authorizes replacement. |

The key/date fingerprint stays process-local; keys are never decrypted, logged or returned. Recognition is a bounded file-format rule, not proof of the writer or historical newness. A stable read additionally checks the file's identity, size and timestamps around reading. Publication remains create-only, with strict independent metadata rereads and no automatic retry, delay, reset or cleanup. Regression fixtures exercise runtime transitions and hostile mutations during consent, identity publication and bootstrap publication, including a late-observed `Local State` whose subsequent security-material change must fail. The existing exact-head Windows E2E job runs these storage and real-native-dialog contracts before its browser tests; this adds no installation, new job, matrix or acceptance trigger.

Those unpackaged Electron tests and standalone browser restart tests alone do not validate installer behavior, packaged Main execution or default OS paths in a fresh Windows account.

Windows fixture roots use the native real path of TEMP, including on hosted accounts whose environment supplies an 8.3 alias such as `RUNNER~1`; the production rejection of non-canonical/redirection paths stays unchanged. The Windows CI step explicitly invokes the locked Electron package's on-demand binary download entry before launching the exe, rather than assuming `npm ci` downloaded it. Download failure fails the job; no native test is skipped or replaced with a mock.

### Debugger discovery before native consent

Installed acceptance run `39123883282` used product source `1be3f28` and harness `888a989`. Source/hash, NSIS installation, installed files, registry and shortcuts passed; the screenshot recorded `profile_not_pristine` before the creation dialog. Artifact `12134708714` contains no classified directory evidence, so it cannot retrospectively prove the exact rejected entry. It supplies no evidence that this failure was caused by `Local State`.

The acceptance harness launches the installed EXE with `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=<port>` and `--force-renderer-accessibility`. The former native fixture omitted these switches, was unpackaged and invoked storage functions rather than the full production Main. Electron [43.5.0's DevTools delegate](https://github.com/electron/electron/blob/v43.5.0/shell/browser/ui/devtools_manager_delegate.cc) supplies `sessionData` as the output directory to Chromium's debugger server. Its pinned Chromium [150.0.7871.250 writer](https://github.com/chromium/chromium/blob/150.0.7871.250/content/browser/devtools/devtools_http_handler.cc) writes `DevToolsActivePort`: a decimal port, one LF and `/devtools/browser/` plus a random lowercase UUIDv4. This is endpoint discovery metadata, not a partition, cookie store or user-history container.

The new ASAR fixture uses Electron 43.5.0, the exact production NSIS fuse hook, embedded ASAR integrity and byte-identical compiled Main, with the acceptance switches. Only a test bootstrap redirects all Host paths to an owned TEMP root and observes dialogs. With the old product it rejects before consent: the only rejected entry is `DevToolsActivePort`, whose bytes correspond to that process's live `/json/version` debugger endpoint. Direct candidate inspection of the same site reports `profile_not_pristine`. Depending on when Chromium publishes it, the preceding resolver can instead report `unrecognized_legacy_profile`; both use the same pristine predicate. With the fix the same fixture reaches the actual product native dialog, selects Cancel through the owned Windows button and confirms that no Recall metadata was published. A separate real-Electron CDP Create test confirms identity/bootstrap reuse on independent restart. No installer runs in these fixtures.

Recognition requires a regular non-link file, a stable lossless UTF-8 read, at most 64 bytes, port 1–65535 and exactly the writer's two-line UUIDv4 grammar. URLs, extra lines, arbitrary payloads, directories, links and malformed records remain rejected. First appearance is allowed; once observed, its exact content fingerprint is bound through consent and both publication checkpoints. Disappearance or content changes stop creation. As with other runtime recognition, matching the grammar proves neither the writer nor historical newness. It cannot exempt any adjacent unknown file, historical partition or Recall remnant, and introduces no cache-directory exception.

Initial refusals emit only `RECALL_INITIAL_PROFILE_INSPECTION:<fixed category>` for invalid runtime formats, historical partition presence, unknown entries or an invalid profile type. Existing revalidation diagnostics additionally distinguish `debug_port_record_binding_changed`. Paths, directory listings, endpoint identifiers, raw bytes and key material are not logged. Regression matrices retain strict Local State, nonempty lock, namespace, path, junction and concurrent replacement failures. The packaged fixture stops at consent/Cancel and therefore does not prove installed workspace startup, default account paths or NSIS lifecycle correctness; those still require the separately approved acceptance below.

Validation also exposed a separate directory-identity precision defect: JavaScript Number stats can round distinct 64-bit NTFS file IDs to the same value. An owned Windows experiment missed one of 128 real rename-and-replace operations with Number identities. Directory bindings and runtime stable-read comparisons now use BigInt stats, including nanosecond timestamps for stable reads. A 128-replacement regression retains every original directory, checks exact filesystem identities and requires each stale candidate to fail. This strengthens the existing replacement protection; it does not explain the historical `profile_not_pristine` failure. Fixtures await the ASAR write stream and their captured, executable-verified Electron process exit events before zero-retry cleanup; inherited output goes to owned files rather than extending Main's pipe lifetime.

### Completed scoped acceptance and remaining gates

F5 Slice 2 has completed its agreed local functional acceptance and is `F5_SLICE2_READY` within that tested scope. Packaged Windows A→C recovery used a new Main process C and preserved the original profile/epoch, two attempt identities and provenance, three identical historical snapshot hashes, two restored Evidence records, reconstructed learner state and WHAT. Packaged UI review and clean exit also passed.

Representative packaged fail-closed checks used a separate isolated test copy, with test-only Host path overrides and observation hooks around the production Main and real bundled Next child. Corrupt/incomplete metadata, anchor and history identity mismatches, reserved domains with missing/invalid published history, and unavailable/failing readiness stopped startup without an empty replacement profile or workspace-success signal. Captured synthetic history was preserved. Four unauthorized readiness probes were rejected with 403. This evidence does not claim execution of those negative cases against the accepted account profile.

The following limitations remain explicit:

- The B1 single-attempt snapshot was not independently recorded and remains unverified; the two-attempt A→C result does not supply a retrospective PASS.
- The historical F4 intermittent `unavailable` remains unexplained. Bounded repetitions did not reproduce it; test-only failure diagnostics improve future evidence and do not establish a historical cause or change production replacement behavior.
- The earlier scoped F5 evidence did not execute NSIS Setup. PR #148 subsequently recorded a real installed first-launch failure in run `39117755780`. The runtime-state fix has isolated Windows regression evidence; a new fixed-source NSIS acceptance remains required and needs separate user approval.
- Desktop dependency security advisories and hosted CI remain separate release gates. Scoped F5 Slice 2 readiness is not `RELEASE_READY`.

Path checks reject stable junctions/symlinks and observable changes to bound directory identities. They do not promise race-free protection against a malicious concurrent OS owner. The established single-writer assumptions, staged recovery limits and record formats remain unchanged. This is not cross-file ACID, general multi-process write coordination or arbitrary power-loss protection. There is no new reset, migration, root selection, backup recovery, cloud account, evidence authority or automatic scheduling.
