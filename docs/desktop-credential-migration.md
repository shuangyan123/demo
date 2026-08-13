# Desktop Credential Migration and Controlled Cutover

Status: Phase 2 COMPLETE; Phase 3 product entry and Credential Cleanup Foundation IMPLEMENTED (2026-08-13). The core real Windows installed-app credential path now has acceptance evidence for the same-machine, same-user, same-profile case, including repeated restart usability. Recovery/lifecycle residual cases remain PENDING, general DPAPI portability is NOT claimed, destructive credential cleanup has NOT occurred, and 0.7 remains IN PROGRESS. This document does not claim general Windows DPAPI portability, cleanup execution, or complete installed-app failure/recovery acceptance.

## Decision and security boundary

Phase 1 selected the narrow `desktop-v1` host capability as a future seam. Phase 2 uses the smallest production extension of that seam: each credential record is protected by Electron Main `safeStorage`, while the renderer keeps only a versioned envelope reference. A wrapping-key design was not introduced because it would add another durable key lifecycle and a broader crypto boundary without being required for this cutover.

This choice has a known residual risk: the secret exists briefly in the renderer-to-Main IPC call during protect/unprotect. The risk is constrained, not eliminated, by the following contracts:

- Main, preload, and the platform adapter use `{ ok: true, value } | { ok: false, error: { code, message } }`; raw `Error`, stack, path, OS text, and secret data never cross IPC.
- Main validates the trusted sender, product context, envelope version, payload shape, size, and context equality before calling `safeStorage`.
- Services use `app/platform/host.ts` and `credential-backend.ts`; no service or feature reads a preload global or receives a generic crypto primitive.
- `host_unavailable`, `host_protection_failed`, `host_unprotect_failed`, `host_context_mismatch`, and `host_payload_invalid` are stable machine-readable codes. Consumers do not parse localized messages.

## Inventory and formats

`collectCredentialMigrationInventory()` reads the real sources used by the existing migration path: AI connection profiles and `apiSettings.default`, quota plugin configs, current and legacy MCP settings, Fenbi credential metadata, the legacy JWK marker, the Web v2 key store, and the Desktop envelope store. Contexts come only from `secretContext`. That migration inventory may invoke the pre-existing Web compatibility normalization when the migration service explicitly runs.

`collectCredentialCleanupInventory()` is a separate physical cleanup inventory. It reads each durable source directly, records only safe presence/format/count/authority facts, and never invokes migration, normalization, decryption, key generation, journal writes, or source deletion. It intentionally reports retained Web v2, legacy-v1, masked-only, invalid/unknown records, Desktop records, the shared Web key, and legacy JWK presence in one observation so mixed physical state cannot be hidden by migration short-circuiting.

The inventory result contains stable IDs, storage format, safe source version, authority, and an inventory version. It never contains ciphertext, IV, masked value, plaintext, hash, raw error, URL, or path. A short-lived source reader closure is kept only inside the migration operation for the current record.

Storage is classified explicitly as `legacy-v1`, `web-v2`, `desktop-v1`, `missing`, `invalid`, or `unknown`; inventory additionally distinguishes `masked-only` and `unavailable`. The implementation never attempts a decrypt and then guesses which protocol succeeded. Legacy records must first complete the existing Web v1-to-v2 normalization. Missing legacy or Web keys require re-entry and never cause a replacement key to be generated.

Both Web v2 and Desktop v1 retain record context binding. Web uses the existing AES-GCM AAD. Desktop validates the context inside the protected payload after `safeStorage` unprotects it. A context substitution fails closed.

## Store, authority, and journal

The Desktop store is the excluded localStorage key `review-workspace:desktop-credentials:v1`. It contains only versioned OS-protected envelopes, context, and timestamps. The Web v2 source remains in its original Dexie/localStorage location after a successful migration so recovery can be manual and explicit; it is not deleted or dual-written indefinitely.

The migration journal is the excluded key `review-workspace:credential-migration:v1`. It contains no credential or ciphertext. Its minimum fields are migration version, state, expected IDs, staged/verified/committed IDs, safe authority values, inventory storage summaries, inventory version, timestamps, and a safe reason.

Startup does not silently stage or commit credentials. A future Settings action or another explicitly controlled caller invokes `migrateDesktopCredentials()`; the exported operation is renderer-local single-flight and remains resumable through the durable journal. This keeps background startup safe while leaving the cutover path directly testable.

The state machine is:

```text
idle -> preflight -> staging -> verifying -> ready_to_commit -> committing -> complete
                 \-> blocked
                 \-> recovery_required
                 \-> cancelled -> preflight
```

Staging, verification, and commit are sequential and bounded to one record at a time. The migration re-reads inventory before staging completes and again before authority changes. A changed inventory blocks the commit. A crash or partial host failure retains staged/committed IDs and resumes only the missing work; it never reports partial staging as complete. If one per-record authority write succeeds and a later one fails, the journal enters `recovery_required`, keeps the already committed authority explicit, and resumes the remaining records without replaying the committed record.

Before cutover, Web v2 is authoritative and Desktop is only a staged candidate. After post-commit verification, Desktop is preferred and each committed context is `desktop_primary`. The authority change is the cutover point. There is no permanent dual-write.

## Product entry and safe UI boundary

The only production entry is the `Desktop 凭据保护` panel rendered inside Settings → AI 连接. It is mounted only when the existing Host Capability resolver identifies a Desktop host; Web renders no Desktop migration action and does not simulate one.

- Opening Settings reads the Desktop protection status and the safe migration journal only. It never calls `migrateDesktopCredentials()`, stages a record, writes a journal, or starts migration automatically.
- The user must explicitly select `迁移到 Desktop 保护`. Repeated activation is guarded by the panel's busy state and the service's existing renderer-local single-flight promise.
- The UI receives only a fixed status projection: ready, in progress, complete, requires re-entry, blocked, recovery required, or Desktop protection unavailable. It does not render expected IDs, journal reasons, ciphertext, IV, protected payloads, plaintext, paths, stack traces, or raw IPC errors.
- Completion text explicitly states that Web sources remain retained recovery evidence and that cleanup was not performed. A Desktop host failure remains unavailable/fail-closed; the entry does not offer a Web downgrade.

The browser acceptance harness uses a deterministic fake Desktop capability to prove this product boundary and journal reload behavior. It is not evidence of Windows DPAPI, Electron `userData`, or installed-app lifecycle behavior.

## Read and write policy after cutover

Dual-read is deliberately asymmetric:

- Desktop is read first for `desktop_primary`.
- Web is a fallback only for a context that has not yet migrated and is still `web_primary`.
- A present but invalid Desktop envelope, context mismatch, missing Desktop record under Desktop authority, or unavailable Desktop host is a hard failure. It never silently falls back to Web.
- A write after cutover is Desktop-only. If the host is unavailable, the operation returns a safe retry-later error and does not downgrade the authority or write Web.
- Web mode remains WebCrypto-only and does not create a Desktop journal, envelope, or fake host capability.

Repository integration covers AI provider keys, quota credentials, MCP bearer tokens, and Fenbi Cookie. Legacy AI and quota compatibility sources remain read-only Web compatibility sources and are not refreshed after a Desktop-authoritative write.

## Recovery and cleanup

The old Web source, Web v2 key, and Desktop envelope remain available for this phase. The migration path may perform its existing Web v1-to-v2 normalization when explicitly invoked; any legacy-key retirement performed by that pre-existing normalization is not a Desktop cleanup action. The new cleanup foundation adds a separate journal (`review-workspace:credential-cleanup:v1`), typed eligibility/reconciliation, idempotent per-source cleanup primitives, and a narrow last-step Web key deletion API. The destructive executor is isolated for future acceptance fixtures only: no production UI imports or calls it, no startup path resumes it, and this phase makes no source deletion or Web key deletion after merge.

Cleanup eligibility remains fail-closed. It requires a complete `desktop_preferred` migration, `desktop_primary` authority for every expected context, an unchanged physical inventory, a verifiable Desktop record for each context before deletion, no unknown/invalid/orphan legacy source, no Web-primary or mixed authority, and no re-entry/new-credential condition. The shared Web key may be deleted only after source reinventory proves that no legitimate retained Web consumer remains; the cleanup path never deletes the Desktop store, resets the migration journal, regenerates a replacement Web key, or silently falls back to Web.

The implementation does not claim that a copied `userData` directory, an OS account change, a machine change, or an Electron reinstall can recover a protected credential. Those cases remain manual-only; the current installed-app evidence is limited to the same-machine, same-user, same-profile persistence boundary.

## Verification coverage

Contracts cover structured IPC failures, sender/context/payload validation, format detection, multi-source migration inventory, the separate physical cleanup inventory, legacy/missing/masked/unknown states, cleanup eligibility and reconciliation, source primitive idempotence, isolated source-before-key execution ordering, successful migration, partial staging, resume, inventory changes, commit ordering, source retention, context substitution, no-new-key decrypt behavior, Desktop-first reads, no downgrade after host failure, single-write repository behavior, MCP denied-path zero unprotect calls, Fenbi disabled-path zero unprotect calls, and Web regression behavior.

Required release gates for this phase are typecheck, lint, contracts, Desktop compile/tests, production audit, build, and bundle checks. The automated browser harness covers Web hiding, explicit initiation, no startup migration, safe completion state, and reload from the journal. The 2026-08-13 installed-app record confirms the core same-machine/same-user/same-profile credential path and repeated restart usability; controlled failure/recovery, adjacent-version, portability, and other lifecycle cases remain **PENDING**. Signing/distribution and later source cleanup remain outside this phase and outside 0.8 work.

No cleanup was performed in Phase 2, product-entry closure, or this Cleanup Foundation phase: retained Web v2 ciphertext, the Web secure key, legacy compatibility material, and source records remain subject to a later explicit cleanup confirmation/acceptance phase. The production UI exposes review/readiness and blocked/deferred impact only; it has no confirm, delete-source, delete-key, or cleanup-resume action.
