# Credential Cleanup Foundation

Status: **IMPLEMENTED foundation; REAL CLEANUP NOT EXECUTED; 0.7 IN PROGRESS** (2026-08-13).

This phase establishes the physical inventory, safety gates, journal, reconciliation rules, idempotent source primitives, and a future-only executor for Desktop credential cleanup. It deliberately does not perform cleanup in production UI, startup, migration, build, packaging, or installed-app smoke.

## Scope and non-goals

The Desktop cutover remains the authority boundary:

- Desktop is read-first after `desktop_primary` authority and Desktop-only for writes.
- Web is never silently restored when Desktop is unavailable.
- The existing migration journal remains independent and is never deleted, reset, or rewritten by cleanup.
- `review_workspace` stays v16 and `review_extensions` stays v1; no schema or preload/IPC expansion is part of this foundation.
- No real provider, OS credential, installed-app profile, or user data is used by cleanup tests.

The production Settings surface is review-only. It may show safe counts, impact, readiness, blocked reason class, and the fact that retained Web material remains. It cannot confirm deletion, delete a source, delete the shared Web key, resume a partial cleanup, or invoke the destructive executor.

## Physical inventory

`collectCredentialCleanupInventory()` is separate from `collectCredentialMigrationInventory()`.

It directly observes:

- AI connection profiles and the legacy `apiSettings.default` compatibility record;
- quota plugin configurations;
- current and legacy MCP settings;
- Fenbi credential metadata;
- Desktop envelope references;
- the Web v2 key record by presence and safe shape only;
- the legacy JWK storage key by key presence only.

It does not call `attemptStoredSecretsMigration()`, normalize a legacy source, decrypt, compare secret values, generate a key, write a journal, or delete anything. Inventory values are limited to stable internal source/context identifiers, storage kind/format, authority, presence, safe counts, and typed reason codes. Ciphertext, IV, masked values, plaintext, hashes, raw errors, URLs, paths, provider responses, and payloads are excluded.

The inventory reports both a Web source and a Desktop source when both physically exist. It does not use migration authority as a reason to hide retained Web material. A present `legacy-v1` source is an explicit cleanup blocker with reason `legacy_source_present`; it must be normalized or re-entered through a separate explicit flow before cleanup eligibility. Cleanup never calls migration or converts `legacy-v1` into Web v2. A legacy JWK may be deleted only after physical inventory proves zero `legacy-v1` sources.

## Journal and reconciliation

The cleanup journal is `review-workspace:credential-cleanup:v1`. It contains only version, state, expected IDs, cleaned/retained IDs, inventory version, Web key state, source states, timestamps, and typed reason codes. It is excluded from backup/export.

Normal states are `idle`, `preflight`, `awaiting_confirmation`, `verifying`, `deleting_sources`, `deleting_web_key`, and `complete`. Exceptional states are `blocked`, `partial`, `recovery_required`, and `cancelled`.

Reconciliation never guesses after a crash. A source that reappears after being marked cleaned, a changed inventory, a key that remains after a delete record, a key-delete phase with a retained Web source, or a completed journal with physical material present becomes `recovery_required`. Startup never resumes destructive work automatically.

## Eligibility gates

Destructive cleanup requires all of the following:

1. A present, complete migration journal with `backendPolicy=desktop_preferred`.
2. Every expected context has `desktop_primary` authority and a physical Desktop record.
3. The Desktop host is available and each expected Desktop record passes a separate pre-delete verification. Host availability is read again after Desktop verification and immediately before shared Web key deletion.
4. The current physical inventory matches the confirmed inventory; new credentials or re-entry states block.
5. No Web-primary or mixed authority exists.
6. No `legacy-v1`, invalid/unknown format, orphan legacy source, missing canonical AI profile, ambiguous quota legacy source, or migration recovery/partial state exists.
7. Source cleanup completes and a fresh physical inventory shows no retained Web source or legacy JWK before the shared Web key step.
8. The shared Web key is deleted only last, through `deletePrimaryWebCredentialKeyForCleanup()`. Missing key is an idempotent no-op; unavailable or malformed key state fails closed. No replacement key is generated.

Inventory readiness is separate from destructive preflight. A review can report that a future cleanup is eligible without authorizing execution.

## Source primitives

The isolated primitives preserve product configuration and clear only credential-bearing Web fields:

- AI: retain canonical profile/default metadata; clear encrypted key/IV and neutralize the old mask. The profile is not deleted.
- Quota: retain provider, enabled state, team ID, budget and manual values; clear selected encrypted credential fields and legacy fields.
- MCP: retain endpoint, auth mode, permissions, discovery metadata and profile; clear bearer token fields in current/legacy storage.
- Fenbi: retain the structural credential record and sync marker context; clear encrypted Cookie/IV and neutralize `maskedCookie`/`verifiedAt`.
- Legacy JWK: remove only after the inventory proves zero legacy ciphertext sources.

All primitives require the relevant Desktop authority, return typed safe results, avoid raw errors/secrets, and are idempotent. They are exercised only with fake/test fixtures in this phase.

## Validation and acceptance boundary

Automated coverage includes no-write/no-decrypt/no-key-generation inventory tests, format and presence classification, eligibility gates, journal sanitization, crash/reappearance reconciliation, source primitive idempotence, source-before-key ordering, single-flight execution, migration journal preservation, and static production UI checks. Browser E2E covers Web hiding, pre-migration blocking, post-migration readiness review, reload, and proof that review does not change source/key/journal state.

Required gates are typecheck, lint, contracts, Desktop compile/tests, production audit, build, bundle check, targeted cleanup E2E, existing migration E2E, and `git diff --check`. No `desktop:make`, real installed-app cleanup, real migration cleanup, provider call, or production credential deletion is evidence for this foundation.

Windows acceptance remains **PARTIAL/PENDING**. This document does not claim DPAPI portability, cleanup success, or `0.7 COMPLETE`.
