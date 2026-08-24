# Desktop release authorization boundary

## Security status

The repository-side SEC-04 mitigation moves the production release job to
`.github/workflows/trusted-desktop-release.yml`. It is triggered only by a
successful `CI` `workflow_run` for a `push` on `main`. GitHub documents that a
`workflow_run` workflow must exist on the default branch and runs with the
default-branch `GITHUB_SHA` and `GITHUB_REF`.

This code change is **not sufficient by itself** to close the historical
self-versioned workflow attack. GitHub also documents that `push` runs workflow
files which are not merged into the default branch, and that a repository write
actor can change a workflow's requested `GITHUB_TOKEN` permissions. A tag or
branch commit can therefore retain the legacy workflow or introduce another
workflow with release write authority.

Until the platform controls below are applied and independently read back, the
correct classification is:

```text
CODE MITIGATION COMPLETE
PLATFORM CONTROL PENDING
SEC-04 REMEDIATION PARTIAL
```

Repository contract tests prove only the current-tree workflow architecture.
They do not claim that historical workflow revisions are disabled on GitHub.

## Trusted current-tree release path

1. Protected `main` receives an approved commit.
2. The `CI` workflow runs for the `main` push.
3. GitHub starts `Trusted Desktop Release` from the default-branch workflow
   revision after `CI` completes successfully.
4. `actions/checkout` performs the authenticated private-repository fetch with
   `fetch-depth: 0`, then removes checkout credentials because
   `persist-credentials: false` is set.
5. The authorization job's guard uses only local refs. It verifies the triggering workflow identity,
   conclusion, event, branch, trusted workflow ref/SHA, `origin/main` ancestry,
   and `v${package.version}` tag target before `npm ci`.
   A missing expected tag or a tag targeting another commit returns
   `publish_authorized=false` and skips the build without treating an ordinary
   main CI run as a release failure.
6. The read-only build job runs only after authorization and produces an exact-SHA artifact. Only the final draft
   release job receives `contents: write` and consumes that exact artifact.

There is intentionally no tag `push`, `workflow_dispatch`, or
`repository_dispatch` trigger in the privileged workflow. A release tag must
already point at the successful main CI commit. If the tag is created after its
CI run completed, a new successful main CI run is required; tag push alone does
not authorize publication.

## Required platform controls and acceptance

All items are mandatory before claiming `SEC-04 REMEDIATION: FIXED`:

1. Merge the trusted workflow through the protected `main` review path.
2. Disable the legacy GitHub Actions workflow ID for
   `.github/workflows/desktop-release.yml`, then read back `state=disabled`.
   Deleting or renaming the file in the current tree is not evidence that a
   historical tag revision cannot run.
3. Remove same-repository write/tag-push capability from every actor who is not
   trusted to publish releases, or disable GitHub Actions for the repository and
   move publication to a separately controlled system. With GitHub Actions
   enabled, same-repository write capability must be treated as workflow-code
   and token-permission control, not merely branch-content control.
4. Keep `main` protected so those actors cannot place a release workflow or
   release candidate on `main` without the approved review path.
5. If the repository is moved to a plan supporting private-repository rulesets,
   add active rules restricting creation, update, and deletion of release tags;
   read back the ruleset and bypass actors. Tag rules are defense in depth and
   do not replace item 3 because a write actor can introduce a non-tag workflow.
6. Perform a non-publishing platform acceptance: attempt the historical V1
   matching-tag scenario with an actor that has the intended post-remediation
   role and verify that no write-capable legacy workflow run starts. Do not
   create a real production Release for this test.

Current repository evidence at the time this document was written:

- default workflow permission is `read`;
- the legacy `Desktop Release` workflow is still active;
- the private repository's current plan does not expose repository rulesets via
  the API.

These observations keep platform acceptance pending. The restricted default
token setting is useful least privilege, but it is not the required control in
item 3 because workflow YAML can request different job permissions.

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
