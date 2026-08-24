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
state was `active`; the repository workflow disable API returned HTTP 204, and
the subsequent independent readback returned `disabled_manually`.

That repository-level disabled state is the primary evidence that ordinary tag
or event triggers can no longer start the historical workflow. The current-tree
deletion in PR #100 is additional defense in depth and is not the sole proof of
historical authority closure.

No runtime tag acceptance is required. Re-enabling the legacy workflow or
creating a production-like tag would mutate the accepted control and would not
provide stronger evidence than the authoritative disabled-state readback.

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
6. The read-only build job runs only after authorization and produces an
   exact-SHA artifact. Only the final draft release job receives
   `contents: write` and consumes that exact artifact.

There is intentionally no tag `push`, `workflow_dispatch`, or
`repository_dispatch` trigger in the privileged workflow. A release tag must
already point at the successful main CI commit. If the tag is created after its
CI run completed, a new successful main CI run is required; tag push alone does
not authorize publication.

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

- **Path A — arbitrary branch/tag to historical Desktop Release:** cut at the
  platform trigger boundary by the `disabled_manually` workflow state.
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
- Code signing, SmartScreen reputation, updater behavior, rollback, and
  production installer cutover remain later M5 concerns and are not established
  by this SEC-04 acceptance.

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
