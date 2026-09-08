---

name: review-workspace-engineering
description: Use for implementation, refactoring, bug fixes, architecture migrations, UI changes, testing, repository maintenance, or release-ready code changes in the Review Workspace repository when the task should be carried through architecture audit, implementation, validation, commit, push, pull request, CI verification, squash merge, cleanup, and post-merge verification. Do not use for read-only questions or when the user explicitly requests analysis only or disables commit, push, PR, or merge.
---

# Review Workspace Engineering

Use this Skill to deliver a scoped engineering task in the Review Workspace repository from investigation through verified GitHub merge.

The goal is not maximum automation.

The goal is:

> a minimal, correct, tested, reviewable change that safely reaches `main`.

Always obey the repository `AGENTS.md` and any more specific nested instructions.

---

# 1. Determine the requested scope

Start by identifying exactly what the user asked to change.

Classify the task:

```text
feature
fix
refactor
UI
architecture migration
maintenance
```

Identify explicit exclusions.

Do not automatically expand the task into adjacent Roadmap phases.

## 1.1 Select the workflow mode

Use exactly one of these modes before choosing a branch:

### A. Read-only task

Examples: audit, review, explain, inspect, or research.

If no file will be modified, do not create a branch. Read the repository state and report the evidence only.

### B. New write task

Examples: feature, fix, refactor, UI, architecture migration, maintenance, rules maintenance, docs maintenance, or test modification.

This mode requires the hard preflight in section 2 and a task-specific fresh branch from the latest `origin/main` before the first file edit. Rules-only changes are still write tasks.

### C. Existing PR continuation

If the user explicitly asks to continue an existing open PR or to address its review, CI, or stabilization work, inspect and continue that PR's exact head branch. Do not create another branch or a second PR. Verify the PR head branch, local branch, and PR HEAD SHA before writing.

## 1.2 Task authorization covers the healthy same-task lifecycle

For a normal scoped engineering task, the user's authorization applies to that same task through:

```text
implementation
→ local validation
→ commit
→ push
→ PR
→ task-related CI/review fixes
→ Merge
→ post-Merge verification
→ repository synchronization
→ task cleanup
```

Do not request another routine confirmation merely to Merge a healthy PR. When every applicable hard gate in section 20 is satisfied, Merge automatically. This authority does not permit unrelated scope expansion, release/publication work, or any operation the user explicitly excluded. If the user explicitly disables commit, push, PR, Merge, or cleanup, honor that narrower boundary.

For roadmap work, read:

```text
docs/product-roadmap-0.3-to-1.0.md
```

and the relevant architecture document.

---

# 2. HARD PREFLIGHT BEFORE WRITING

For mode B, before editing, run:

```bash
git rev-parse --show-toplevel
git status --short
git status -sb
git branch --show-current
git rev-parse HEAD
git fetch origin
git rev-parse origin/main
git worktree list --porcelain
git status --short
```

The preflight must establish:

* the current worktree is clean
* the current branch is `main`
* `HEAD` equals `origin/main`
* there are no unknown local changes
* no other worktree must be modified or resolved to begin this task

Also inspect whether a merge, rebase, cherry-pick, revert, or bisect is in progress, and inspect the path, branch, HEAD, and status of every other listed worktree when needed to identify active task or user WIP ownership. A clean unrelated worktree does not block this task; an ambiguous or conflicting one does.

If any condition fails, STOP. Do not stash, reset, restore, clean, checkout away local changes, commit unrelated changes, delete/prune worktrees, or alter WIP branches.

For mode C, inspect the existing PR first and verify its exact head branch, the local checkout, and the PR HEAD SHA. A dirty state is only continuable when it is proven to belong to that exact PR task.

Never discard unknown user changes.

Never use `git reset --hard` as a routine synchronization method.

---

# 3. Load relevant architecture context

Read only documentation relevant to the task.

Common sources:

```text
AGENTS.md
README.md
docs/architecture.md
docs/application-layer-migration.md
docs/product-roadmap-0.3-to-1.0.md
CHANGELOG
```

Then inspect actual implementation.

When documentation and code disagree:

* trust verified runtime / code behavior
* determine whether docs are stale
* update docs if this task touches that boundary

Do not implement based only on filenames or documentation assumptions.

---

# 4. Perform a proportional architecture audit

For small fixes, keep this brief.

For architecture/refactor/business workflow changes, determine:

```text
current entry point
call chain
state owner
data flow
persistence boundary
external side effects
error flow
security boundary
test coverage
rollback boundary
```

For multi-step use cases specifically identify:

```text
step order
partial commits
retry safety
cleanup
idempotency
external side effects
```

Do not pretend local persistence and external APIs form one ACID transaction.

---

# 5. Choose the minimum sufficient design

Prefer the smallest design that genuinely improves:

* correctness
* maintainability
* testability
* architecture boundaries

Before introducing an abstraction ask:

> Does this represent a real business or substitution boundary?

Do not introduce without strong evidence:

```text
BaseUseCase
BaseRepository
Manager
Coordinator
GatewayFactory
DI Container
Service Locator
CommandBus
EventBus
CQRS framework
new global state library
```

Prefer:

```text
Controller
→ Use Case
→ existing Service / Repository
```

when sufficient.

---

# 6. Preserve scope

Do not perform unrelated refactors.

Do not automatically:

* upgrade major dependencies
* change Dexie schema
* introduce new DB
* redesign unrelated UI
* expand Electron permissions
* expand preload IPC
* migrate another Roadmap phase
* replace the stack

If an unrelated issue blocks correctness, fix the minimum blocker and explain why.

Otherwise record it as residual work.

---

# 7. Choose the task worktree and establish the branch

Worktrees are optional, not mandatory ceremony. After the hard preflight, choose exactly one valid mode for a new write task.

### A. Simple current-worktree mode

Use this for an ordinary isolated task when branch switching will not disturb other work:

```text
clean synchronized main
→ fresh task branch
→ implementation / validation
→ PR / CI / Merge
→ sync the normal worktree to main
→ clean up the task branch
```

### B. Disposable task-worktree mode

Prefer a separate task worktree when another task or user WIP must remain checked out, the normal worktree should stay on `main`, parallel work exists, switching would disturb active work, a release task needs isolation, or the repository explicitly requires isolation. Do not create one merely for a trivial isolated task.

If mode B is used:

* give the worktree and branch clear ownership by this task
* create it from the validated `origin/main` with a fresh task-specific branch
* choose a path that is not an existing worktree and preserve every unrelated worktree
* treat removing it as a post-Merge delivery step, subject to the checks in section 25

Never remove an unknown or user-owned worktree. Never routinely use `git worktree remove --force`.

For either mode, establish a fresh task-specific branch from the validated `origin/main`:

Use:

```text
feature/<scope>
fix/<scope>
refactor/<scope>
chore/<scope>
```

For Roadmap architecture migrations prefer:

```text
refactor/<phase-or-domain>
```

Example:

```bash
git switch -c chore/<scope> origin/main
```

Confirm the branch and clean state before the first file edit. If the desired branch name already exists locally or remotely, inspect its history and ownership; never overwrite unknown history.

If Git reports that the branch is already used by another worktree, STOP and report the conflicting branch, worktree path, current HEAD, and current branch. Do not switch to detached HEAD, silently use an unrelated branch, delete the worktree, or force the operation.

For mode C, continue the verified exact PR head branch instead of creating a new branch. Read-only mode requires no branch.

Never perform a new write task directly on `main`, detached HEAD, an unrelated feature branch, or a WIP branch.

---

# 8. Implement incrementally

Follow existing project architecture.

Keep UI, Controller, Application, Service, Repository and Platform responsibilities separated.

When changing Application Layer:

* no React
* no JSX
* no DOM
* no Feature View dependency
* no Electron preload global
* explicit dependencies
* stable typed business result
* stable failure boundary
* direct executable tests

When changing React:

* keep domain orchestration out of views
* avoid giant hooks
* preserve loading/error/empty states
* preserve keyboard and accessibility behavior

When changing Desktop:

* preserve context isolation
* preserve sandbox
* preserve minimal preload
* do not widen filesystem or navigation permissions casually

When changing persistence:

* preserve existing user data
* avoid schema changes without clear need
* document migrations and rollback semantics

---

# 9. UI work

For a local UI fix:

implement within the existing design system.

Do not block on generating mockups.

For a major new page or substantial redesign:

use the available Web/UI design Skill where appropriate and inspect the rendered result.

Always check:

```text
responsive behavior
keyboard interaction
focus
loading
empty
error
disabled
overflow
scrolling
accessibility
```

Do not use glow, blur or decorative gradients to hide structural layout defects.

---

# 10. Add tests that exercise behavior

Architecture regex / source checks are useful but cannot replace direct behavior tests.

For new business Use Cases prefer:

```text
real use-case invocation
+
fake/stub dependencies
+
asserted call order
+
asserted inputs
+
asserted results
+
asserted failure semantics
```

For multi-step flows cover meaningful failure points.

Explicitly test partial-commit behavior when applicable.

Do not invent fake transaction guarantees only to simplify tests.

---

# 11. Run local quality gates

For rules-only changes limited to repository instructions and the engineering Skill, run at least:

```bash
git status --short
git diff --check
```

Inspect the complete diff, confirm that only authorized Skill/rules files changed, validate frontmatter and required structural markers, and run any repository-provided AGENTS, Skill, Markdown, or rules validation that applies. If no such checker exists, perform the direct structural inspection and say so. Do not mechanically run product build, Playwright, or Electron packaging when no runtime boundary changed; state the rules-only scope and the commands actually run in the PR.

For ordinary TypeScript / React / Service / Application changes run at minimum:

```bash
npm run typecheck
npm run lint
npm run test:contracts
npm run build
```

For user-visible workflows run relevant E2E.

If there is no reliable targeted E2E and the risk justifies it:

```bash
npm run test:e2e
```

If bundle boundaries changed:

```bash
npm run check:bundle
```

If Electron / shared desktop behavior changed:

```bash
npm run test:desktop
```

Run additional domain-specific tests discovered in the repository.

Do not claim a test passed unless it actually ran and passed.

---

# 12. Handle failures correctly

If a quality gate fails:

first determine whether it is:

```text
regression introduced by this task
existing repository failure
environment failure
external service failure
```

Fix regressions introduced by this task before proceeding.

Do not make tests green by:

* deleting assertions
* `.skip`
* lowering architecture budgets without justification
* disabling lint rules
* broad `any`
* suppressing TypeScript errors
* disabling security checks

If a real external/environment blocker cannot be resolved safely, stop before Merge and report it.

---

# 13. Review the final diff

Before committing run:

```bash
git status
git diff --check
git diff
```

Review the complete patch as if reviewing another engineer's PR.

Look for:

```text
unrelated changes
debug logs
temporary code
TODO hacks
dead code
duplicated logic
unsafe retries
secret leakage
unexpected schema changes
unexpected permission changes
unnecessary abstractions
missing tests
stale documentation
```

Do not commit generated artifacts unless the repository intentionally tracks them.

Never commit:

```text
.env
API keys
tokens
cookies
passwords
private keys
personal user data
local logs
test recordings containing secrets
build output
installer output
```

---

# 14. Update documentation only when required

Update relevant docs for real changes to:

* architecture
* data contract
* development workflow
* security boundary
* roadmap phase status
* public behavior

Do not update every doc mechanically.

Do not turn `AGENTS.md` into a changelog.

For Roadmap phase completion, record only what was actually completed and verified.

Never mark an entire phase complete if defined work remains pending.

---

# 15. Commit

Only commit after required local quality gates pass.

For a normal authorized task, committing is part of the same delivery authorization; do not pause for routine confirmation. Commit only the reviewed, in-scope change.

Use Conventional Commits.

Examples:

```text
feat: add ...
fix: correct ...
refactor: extract ...
test: cover ...
docs: record ...
```

Prefer a small number of logically complete commits.

Do not split changes only to produce more commits.

Do not use:

```text
update
changes
fix stuff
final
final2
```

---

# 16. Push

Push the work branch after local verification.

For a new branch:

```bash
git push -u origin <branch>
```

For an existing upstream:

```bash
git push
```

Force pushes are prohibited:

```bash
git push --force
git push --force-with-lease
```

Do not use either command, including to repair a rejected or divergent push.

If rejected as non-fast-forward:

inspect remote history.

Do not overwrite it.

---

# 17. Create the Pull Request

Create a PR:

```text
base: main
head: current work branch
```

PR title should summarize the actual change.

PR body must include:

## Summary

What changed and why.

## Architecture / Behavior

Only important architectural or behavioral facts.

## Compatibility

State relevant:

* data compatibility
* schema impact
* Electron / Host impact
* API compatibility
* retry / partial commit impact

## Testing

List only commands actually executed.

Example:

```text
- npm run typecheck
- npm run lint
- npm run test:contracts
- npm run build
- npm run test:e2e
```

Never use:

```text
Not run (not requested)
```

when the task requires validation.

If something was not run, give the real reason.

## Residual risks

Only real remaining risks.

---

# 18. Inspect remote PR state

After creating the PR inspect:

```text
PR HEAD SHA
mergeability
merge conflicts
required checks
GitHub Actions
reviews
changes requested
unresolved blocking review threads
branch protection
```

Do not assume local PASS means remote PASS.

If checks are pending, continue checking until they reach a terminal state when the environment permits. If remote inspection is unavailable, treat the missing evidence as a blocker rather than inferring success.

---

# 19. Respond to review feedback

If blocking review feedback appears and is within scope:

```text
inspect
→ fix
→ test
→ commit
→ push
→ wait for new CI
```

Do not merge based on old CI after changing the PR HEAD.

Task-related CI or review corrections remain within the original task authorization only when they do not expand the authorized files, behavior, security boundary, or release boundary. After every new commit, repeat local validation, remote checks, and exact-HEAD verification.

If requested feedback substantially expands scope:

do not perform an unrelated roadmap phase just to satisfy it.

Keep the PR focused and report the scope conflict.

---

# 20. Auto-merge hard gate

For a normal authorized task, healthy PR plus every applicable hard gate below means the agent should Merge automatically. Do not request routine user Merge confirmation. Automatic Merge is allowed only when all of these are verified:

1. Required local validation passed.
2. The PR base is the intended `main` branch.
3. The PR HEAD is the exact expected task HEAD.
4. The locally validated HEAD still equals the current PR HEAD.
5. Required CI checks completed successfully.
6. Relevant GitHub Actions completed successfully.
7. The PR is mergeable and has no merge conflict.
8. No `Changes Requested` review exists.
9. No unresolved blocking review thread exists.
10. Changed filenames match the authorized task.
11. No unexpected scope expansion is present.
12. No sensitive material or credential exposure is present.
13. No branch or worktree dependency would be broken by Merge or cleanup.
14. Any repository-specific security, provenance, release, artifact, or trust gate applicable to this task is satisfied.
15. The task has not crossed into a separately authorized publication or release boundary.

Immediately before Merge, re-read PR metadata, the exact PR HEAD SHA, required checks for that SHA, changed filenames, mergeability, conflicts, reviews, and blocking comments. If the HEAD changed after validation, do not Merge based on old validation; validate the new HEAD first. A pending or failed required check is a hard stop.

---

# 21. Never bypass GitHub protections

Do not:

```text
admin bypass
force merge
disable branch protection
remove required checks
direct push main instead of PR
merge a failing PR
merge a conflicting PR
merge an unverified new HEAD
```

Automation is subordinate to correctness.

---

# 22. Merge strategy

When all hard gates pass:

prefer:

```text
Squash and merge
```

Use a clear Conventional Commit-style squash title.

Example:

```text
refactor: extract automation execution application use case
```

Do not use a meaningless default title.

---

## 22.1 Release and publication boundaries remain separate

Normal task authorization and a healthy PR authorize only the scoped PR Merge. They do not implicitly authorize:

* creating tags or GitHub Releases
* publishing packages or other public artifacts
* signing artifacts or changing signing/trusted-publisher configuration
* enabling updater publication or changing release channels
* production rollout or release-workflow trust/permissions changes

Preserve exact authorized source SHA, artifact/checksum provenance, CI-source binding, least-privilege permissions, and existing release-trigger restrictions. Perform release or publication work only when it is explicitly part of the authorized task and allowed by the existing repository rules.

---

# 23. Verify the Merge result

After Merge, do not stop. Fetch `origin`, verify remotely that:

* the PR is actually merged
* the expected final main result exists
* the resulting remote `main` is the intended state

Record the verified pre-Merge PR HEAD SHA, PR number/link, merge strategy, merge/squash commit SHA, and resulting `origin/main` SHA.

Only after the PR merge and final remote `main` are verified may repository cleanup begin. A successful Merge and a later cleanup blocker are separate states: never erase a successful delivery by reporting cleanup as if it had succeeded.

---

# 24. Synchronize the normal main worktree

After a verified Merge, identify the normal repository/main worktree and inspect it before modifying it. If it is safe:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git rev-parse HEAD
git rev-parse origin/main
git status
```

The local `main` must equal the expected `origin/main` and be clean, with no merge, rebase, cherry-pick, revert, or bisect in progress. If a disposable task worktree was used, perform these operations in the known normal main worktree; do not switch or overwrite an unrelated worktree.

Hard STOP synchronization if the normal worktree contains unknown local changes, untracked user work that could be affected, unfinished operations, ambiguous detached ownership, or another active task. Do not stash, reset, restore, clean, or overwrite it. Preserve it and report the cleanup blocker while keeping the verified delivery status separate.

Do not use `reset --hard` as the default synchronization mechanism.

---

# 25. Clean up the task worktree

If no disposable task worktree was used, report:

```text
Task worktree: NOT USED
```

If one was used, remove it automatically only after verifying all of the following:

* it belongs to the current task
* the corresponding PR is confirmed merged
* the exact task/PR HEAD and final remote main result are verified
* the worktree is clean
* no merge, rebase, cherry-pick, revert, or bisect is unfinished
* no uncommitted task data would be lost
* no other process, task, or workflow still requires it

Remove it normally without `--force`, then verify it no longer appears in `git worktree list`. If it is dirty or ownership is ambiguous, preserve it and report the exact blocker. Never remove an unknown or user-owned worktree.

---

# 26. Clean up local and remote task branches

After successful Merge, after the normal main worktree is synchronized when safe, and only after no worktree uses the task branch:

1. Check for open or stacked PRs that depend on the branch.
2. Prefer `git branch -d <task-branch>` for a merged local task branch.
3. Because squash Merge may leave the original tip non-ancestor of `main`, `git branch -D <task-branch>` is allowed only when every condition below is true:

   * the branch was created or explicitly owned by the current task
   * its PR is confirmed merged
   * its name equals the verified PR head branch
   * its local tip equals the previously verified PR HEAD SHA
   * final remote `main` is verified
   * no open or stacked PR depends on it
   * no worktree uses it
   * no uncommitted changes would be lost
   * ownership is unambiguous

Never use `git branch -D` for an unknown, user-WIP, unmerged, changed-after-verification, worktree-owned, stacked, or ambiguously owned branch.

Then inspect the remote task branch. If it is already absent, report `Remote task branch: ALREADY ABSENT`. If it belongs to this merged task, is no longer needed, and is not referenced by another PR or workflow, delete it normally and report `Remote task branch: REMOVED`. Otherwise preserve it and report why. Remote branch deletion never permits force-push.

---

# 27. Post-merge quality verification

Run the checks required for the actual task category against final `main`, not merely the feature branch. For rules-only Skill/instruction changes, use the proportional structural checks from section 11, including `git diff --check` and complete authorized-file/frontmatter/structure inspection. For substantial TypeScript architecture changes, run at minimum:

```bash
npm run typecheck
npm run test:contracts
```

When appropriate also run `npm run build`; for high-risk workflow changes run the relevant smoke or E2E path. Do not run meaningless product, Electron, packaging, release, or publication work merely for ceremony, and do not claim any check that did not run.

This confirms the actual merged commit—not merely the feature branch—is healthy.

---

# 28. Stop after the requested task

Do not automatically start the next Roadmap task.

For example:

```text
Automation Phase 2 merged
```

means stop.

Do not continue to:

```text
Import Phase 3
Conversation migration
Data reliability
```

unless the user explicitly requested multiple phases.

---

# 29. Failure policy

If push, PR, CI, or Merge cannot complete, identify the actual blocker and preserve the continuation state. Examples include:

```text
authentication
permission
branch protection
remote divergence
merge conflict
failed CI
external outage
environment limitation
```

Resolve only when safe and within scope.

If delivery did not Merge, do not perform successful-delivery cleanup: preserve the task branch, task worktree, commits, PR, and useful diagnostic state. If Merge succeeded but synchronization or cleanup is blocked by user-owned or ambiguous state, keep the verified delivery result and report cleanup as incomplete; do not destructively resolve the blocker.

Otherwise stop at the last safe state.

Never claim:

```text
pushed
merged
tests passed
```

unless verified.

---

# 30. Final report

Report exact state rather than vague completion claims. For a successful delivery, include:

```text
Implementation
- concise description

Validation
- commands/checks actually run with PASS/FAIL

GitHub delivery
- task branch
- commit SHA
- PR number/link
- exact verified PR HEAD SHA
- CI/check result
- merge strategy
- merge commit SHA
- final origin/main SHA

Cleanup
- main worktree: SYNCED + CLEAN / BLOCKED
- task worktree: REMOVED / NOT USED / PRESERVED
- local task branch: REMOVED / PRESERVED
- remote task branch: REMOVED / ALREADY ABSENT / PRESERVED

Post-merge verification
- PASS / FAIL / BLOCKED

Residual risks
- only real unresolved issues
```

Include the task worktree path when one was used. Do not report `complete`, `merged`, `clean`, or `PASS` for any state that was not actually verified.

---

# 31. Core completion rule

The normal successful workflow is:

```text
Understand
↓
Audit
↓
Implement
↓
Direct tests
↓
Local quality gates
↓
Review complete diff
↓
Commit
↓
Push
↓
Pull Request
↓
Remote CI / Review
↓
Verify HEAD SHA
↓
Squash Merge
↓
↓
Sync main
↓
Verify final remote main
↓
Clean task worktree and branches
↓
Post-merge verification
↓
STOP
```

If any critical condition fails:

stop at the last safe state instead of bypassing the guardrail.

The quality of the resulting `main` branch matters more than successfully completing an automated Merge.
