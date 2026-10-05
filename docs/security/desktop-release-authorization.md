# Desktop release authorization boundary

## Security status

```text
SEC-04: PASS WITH RESIDUAL RISK
```

The repository code mitigation and platform acceptance are complete under the
current single-owner trusted-writer model. The production release path is now
defined by `.github/workflows/trusted-desktop-release.yml`, and PR #100 is
eligible for merge from the SEC-04 perspective. This status does not claim that
the repository has no residual security risk.

## Trust model

- `shuangyan123` is the sole human maintainer and is **TRUSTED TO PUBLISH**.
- Owner-authorized OpenAI, ChatGPT, and Codex tooling is **TRUSTED DELEGATED
  TOOLING**. Its repository write capability is intentional.
- No other human collaborator, repository team, pending invitation, deploy key,
  write-enabled deploy key, webhook, or positively identified untrusted writer
  was found during platform acceptance.
- The global GitHub App installation inventory is incomplete with the current
  API token. This is residual evidence uncertainty, not evidence that an
  untrusted App exists and not proof that no other App exists.

## Legacy workflow closure

The historical `Desktop Release` workflow at
`.github/workflows/desktop-release.yml` is workflow ID `323491496`. Its previous
state was `active`. Historical platform evidence recorded the disable API
response as HTTP 204 and the subsequent readback as `disabled_manually`. This
is historical SEC-04 evidence only; `disabled_manually` is not the current live
state.

Current repository/API state is different: the legacy workflow file is absent
from the current tree, and the GitHub Actions API reports workflow ID
`323491496` as `deleted`. The current privileged path is the active
`.github/workflows/trusted-desktop-release.yml` workflow. The historical
disabled readback and the current deletion are separate facts and must not be
collapsed into one platform-state claim.

No runtime tag acceptance is required. Re-enabling the legacy workflow or
creating a production-like tag would mutate the accepted control and would not
provide stronger evidence than the historical disabled-state readback together
with the current deleted state.

## Trusted current-tree release path

1. The trusted owner places an approved commit on `main`.
2. The `CI` workflow runs for the `main` push.
3. GitHub starts `Trusted Desktop Release` from the default-branch workflow
   revision after `CI` completes successfully.
4. `actions/checkout` performs the authenticated private-repository fetch with
   `fetch-depth: 0`, then removes checkout credentials because
   `persist-credentials: false` is set.
5. The authorization job's guard uses only local refs. It verifies the
   triggering workflow identity, conclusion, event, branch, trusted workflow
   ref/SHA, `origin/main` ancestry, and `v${package.version}` tag target before
   `npm ci`.
   A missing expected tag or a tag targeting another commit returns
   `publish_authorized=false` and skips the build without treating an ordinary
   main CI run as a release failure.
6. The read-only build job runs only after authorization, builds the canonical
   electron-builder + bundled NSIS installer from the exact authorized SHA, and
   finalizes the staged installer bytes with the SHA-256 manifest and actual
   unsigned Authenticode check before producing an exact-SHA artifact. The final
   release job downloads that artifact into `out/release-canonical`, checks it
   again, then creates or safely resumes the exact Draft Release only with a
   pre-existing verified tag (`--verify-tag`). It reads the actual Release back,
   requires the stable two-asset boundary, downloads those same GitHub asset
   records by asset ID into the distinct `out/release-roundtrip` directory, and
   compares the independently hashed bytes. Only that job receives
   `contents: write` and consumes the exact artifact.

There is intentionally no tag `push`, `workflow_dispatch`, or
`repository_dispatch` trigger in the privileged workflow. A release tag must
already point at the successful main CI commit. If the tag is created after its
CI run completed, a new successful main CI run is required; tag push alone does
not authorize publication.

Historical M5-F originally froze the `0.3.0` production tuple. A subsequent
activation attempt failed the trusted Windows release E2E gate; the exact
`v0.3.0` tag at SHA `6e7ccc35e69c6a6b4f0337ebf77f27f8dd4ab1e3` remains an
immutable unpublished failed candidate and has no GitHub Release. It must never
be deleted, moved, retagged, reused or published. PR #125 is the
**MERGED M5-G RECOVERY IMPLEMENTATION** for `0.3.1`; it was not the production
freeze. The current dedicated `0.3.1` production tuple re-freeze is **UNDER
REVIEW**; expected tag `v0.3.1` is absent. The final main SHA remains
dynamically bound by this later freeze/main state and cannot be hard-coded in
the pre-squash PR. M5-H/I/J remain incomplete, and the current classification is
**WINDOWS PRODUCTION RELEASE READY: NO**.

## M5-G recovery implementation, re-freeze, and later activation protocol

PR #125 is already merged and did not create `v0.3.1`, a Draft Release, or any
publication. The current dedicated re-freeze PR must remain Draft and must not
create `v0.3.1`, create a Draft Release, publish anything, or perform M5-H
Level 3 acceptance. Its static tuple definition is under review; operational
freeze is not complete until this PR is reviewed, owner-authorized and merged,
and the exact post-freeze `main` CI passes. The exact Windows + Node `24.20.0`
full E2E gate from PR #125 remains recovery evidence only.

The trusted owner/operator must complete this sequence before any real M5-G
activation:

1. Preserve the successful exact post-merge `main` CI run for merged PR #125 as
   recovery evidence.
2. Review the current dedicated `0.3.1` production tuple re-freeze PR. It records
   every static field listed in
   [`windows-production-v1-release-policy.md`](../windows-production-v1-release-policy.md),
   including package/tag/installer identity, Windows x64 stable NSIS per-user
   mode, Electron and both Node versions, electron-builder, app identity,
   intentionally unsigned/Authenticode state, `publish=null`, no-updater
   metadata, and the strict fuse tuple.
3. After owner-authorized merge, require the exact post-freeze `main` CI to pass.
   The exact main SHA produced by that freeze merge is the only source SHA eligible
   for the later activation; PR #125 is not the production freeze.
4. After owner authorization, confirm `v0.3.1` and its Release are absent, and
   confirm immutable `v0.3.0` still points to
   `6e7ccc35e69c6a6b4f0337ebf77f27f8dd4ab1e3` with no Release.
5. Create `v0.3.1` exactly at the frozen main SHA and verify the remote tag
   target. Never move, delete, recreate or retag it.
6. Re-run the same successful main CI on that SHA. Tag push alone is not a
   release authority and does not activate the privileged workflow.
7. Let the resulting successful `workflow_run` build the exact-SHA artifact,
   create or safely resume only a Draft Release, and complete the asset-ID
   download plus canonical/round-trip hash reconciliation. Stop with the
   Release still Draft; any mismatch must fail closed.

## Main protection and rulesets

The private repository currently reports `main.protected=false`. Branch
protection and repository rulesets are unavailable on the current private plan;
their APIs return HTTP 403 with GitHub's upgrade-or-public message. No branch or
tag protection is claimed to exist.

Under the current single-owner model, unprotected `main` and unavailable branch
or tag rulesets are defense-in-depth limitations rather than a demonstrated
untrusted-writer publication path. If a future untrusted writer, or any writer
outside **TRUSTED TO PUBLISH** and **TRUSTED DELEGATED TOOLING**, receives
repository write access, SEC-04 must be reassessed and branch/tag protection or
an equivalent independent publication boundary should be enabled first.

## Attack-path closure

- **Path A — arbitrary branch/tag to historical Desktop Release:** historically
  cut at the platform trigger boundary by the `disabled_manually` workflow
  state; the current legacy workflow is deleted and absent from the tree.
- **Path B — malicious self-versioned workflow:** no positively identified
  untrusted writer currently has repository workflow-write capability.
- **Path C — direct main push to trusted `workflow_run`:** only the trusted owner
  and trusted delegated tooling were identified with write authority.
- **Path D — delegated tooling compromise or misuse:** retained as a
  trusted-principal compromise risk, not an authorization escalation by an
  actor outside the trusted set.

**NO positively identified actor outside the trusted set can currently cause
arbitrary code to reach production publication.**

## Residual risks

- `main` is unprotected, and no branch or tag rulesets are available.
- The trusted owner and delegated tooling retain broad repository write
  authority.
- GitHub App installation inventory remains an evidence gap.
- All third-party Actions are allowed, and full commit-SHA pinning is not
  required by repository policy.
- Production-v1 is intentionally unsigned. Code signing, publisher identity,
  certificate timestamping/rotation, and SmartScreen reputation are deferred
  future capabilities rather than M5 blockers. Unknown Publisher or SmartScreen
  warnings are accepted product residuals; this SEC-04 acceptance does not claim
  Authenticode-backed identity or integrity.
- Rollback and Draft Release asset round-trip remain M5 concerns. M5-D's
  production NSIS cutover, M5-E's unsigned staged-artifact/checksum provenance,
  PR #125's `0.3.1` recovery implementation is merged and the dedicated
  production tuple re-freeze is under review; the
  historical M5-F `0.3.0` tuple remains historical, while its subsequent exact
  `v0.3.0` activation outcome is an immutable failed unpublished candidate; auto-updater behavior is intentionally excluded from production-v1 and remains
  a separate future milestone. The unsigned
  production security model keeps every SEC-04 control and relies on trusted source provenance plus the exact artifact SHA-256. See
  [`windows-production-v1-release-policy.md`](../windows-production-v1-release-policy.md).

## Official GitHub semantics used

- Events that trigger workflows:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Contexts reference (`workflow_ref` and `workflow_sha`):
  <https://docs.github.com/en/actions/reference/workflows-and-actions/contexts>
- Workflow token permissions:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- Disabling and enabling workflows:
  <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows>
- `actions/checkout` credential and fetch-depth behavior:
  <https://github.com/actions/checkout/blob/main/README.md>
- Ruleset availability and tag restrictions:
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
