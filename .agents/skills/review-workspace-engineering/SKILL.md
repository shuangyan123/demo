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

For roadmap work, read:

```text
docs/product-roadmap-0.3-to-1.0.md
```

and the relevant architecture document.

---

# 2. STARTUP STALE-WORKTREE RECONCILIATION + HARD PREFLIGHT

For every new mode B write task, first reconcile stale disposable worktrees from
earlier completed tasks when the local environment permits it. This startup
housekeeping is intentionally decoupled from the lifetime of the Codex process
that originally created the worktree.

From the canonical main worktree, inspect:

```bash
git status --short
git status -sb
git branch --show-current
git rev-parse HEAD
git fetch origin
git rev-parse origin/main
git worktree list --porcelain
npm run worktree:audit
```

If and only if the invoking canonical worktree is attached, clean, free of an
unfinished merge/rebase/cherry-pick/revert, on `main`, and can be synchronized
without discarding user work, run:

```bash
git pull --ff-only origin main
npm run worktree:audit
npm run worktree:cleanup
npm run worktree:audit
```

Startup cleanup is automatic for entries classified `SAFE_TO_REMOVE`. Do not ask
the user for a separate cleanup confirmation. The repository-owned guard is the
authority and must fail closed. Never replace it with directory-name guesses,
manual directory deletion, `git worktree remove --force`, `git worktree prune`,
branch deletion, stash/reset/restore/clean, or any other operation that can discard
or obscure user work.

If startup cleanup cannot run safely because the canonical main worktree is dirty,
detached, mid-operation, unavailable, stale in a way that cannot fast-forward, or
otherwise ambiguous, preserve all state and skip the cleanup mutation. A skipped
cleanup is not permission to modify the blocker. Continue the new task only when
an independent safe task location can still be established from the exact latest
`origin/main`; otherwise STOP and report the blocker.

After startup reconciliation, the mode B preflight must establish:

* latest `origin/main` SHA is known
* the selected task location is clean and attached
* no unfinished merge/rebase/cherry-pick/revert exists
* there are no unknown local changes
* unrelated WIP/worktrees do not need to be altered
* the fresh task branch is based on the exact verified latest `origin/main`

For mode C, inspect the existing PR first and verify its exact head branch, the
local checkout, and the PR HEAD SHA. Startup stale-worktree reconciliation is not
required before continuing an existing PR when doing so would disturb that PR's
checked-out worktree. A dirty state is only continuable when it is proven to belong
to that exact PR task.

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

# 7. Establish or continue the task branch

For mode B, after the hard preflight create and switch to a fresh task-specific branch from the validated `origin/main`:

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
git diff --check
```

Also run any repository-provided AGENTS, Skill, Markdown, or rules validation that applies. Do not mechanically run product build, Playwright, or Electron packaging when no runtime boundary changed; state the rules-only scope and the commands actually run in the PR.

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

If checks are pending, continue checking until they reach a terminal state when the environment permits.

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

If requested feedback substantially expands scope:

do not perform an unrelated roadmap phase just to satisfy it.

Keep the PR focused and report the scope conflict.

---

# 20. Delivery authorization and auto-merge hard gate

For an ordinary scoped repository engineering task, the user's authorization to do
the task covers the normal delivery lifecycle through commit, push, PR, independent
review, exact-head CI, Squash Merge, final-main verification, and safe cleanup unless
the user explicitly narrows the boundary. Do not ask for a redundant "merge?"
confirmation after ordinary scoped work is technically eligible.

If a separate reviewer/orchestrator owns the review gate, the implementation worker
must not treat its own implementation as independent review. It should hand off the
exact PR HEAD and verification evidence at `READY FOR REVIEW`. The reviewer/orchestrator
may complete Merge and cleanup when the hard gate below is satisfied.

A later user instruction such as "PR only", "do not merge", "stop after tests", or
"leave this open" narrows the task and must be obeyed.

Task-specific explicit approval remains required for externally consequential actions,
including:

* package publication, GitHub Release creation, public launch, or deployment that
  changes an external release boundary
* paid/live provider execution or other batch operations that incur cost or transmit
  non-public inputs
* purchases or paid services
* destructive or hard-to-reverse deletion of important persistent data, repositories,
  cloud resources, or production state
* production credentials, permissions, authentication, or security-policy changes
* unscoped product-direction, data-migration, privacy-policy, or architecture decisions
  with material user-data consequences

If one of these actions is required but was not authorized in the current task, stop
at `EXPLICIT APPROVAL REQUIRED`; do not perform it.

Automatic Merge for ordinary scoped work is allowed only when all applicable conditions are true:

```text
local required gates PASS
remote required checks PASS
GitHub Actions PASS
no merge conflict
no Changes Requested
no unresolved blocking review
no sensitive files
no unexpected scope expansion
PR base = main
PR HEAD = the validated HEAD
```

Immediately before Merge:

re-read PR HEAD SHA.

If it changed since validation:

**do not Merge.**

Validate the new HEAD first.

A required check that is pending or failed is a hard stop. Do not merge a PR with a conflict, Changes Requested, or an unresolved blocking review thread.

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

# 23. Branch and worktree cleanup

After successful Merge, first confirm remote evidence that the merged PR base is
`main`, its head SHA is the exact validated HEAD, and final `main` contains the
merge result.

For local disposable worktrees, prefer the repository-owned guard:

```bash
npm run worktree:audit
npm run worktree:cleanup
npm run worktree:audit
```

The cleanup command may remove only entries proven `SAFE_TO_REMOVE`: clean,
attached, non-current, non-default worktrees whose unique merged PR matches the
branch and exact HEAD, with no open/dependent PR and proven current-user ownership.
Apply mode additionally requires execution from a clean, attached, exact latest
`main`. It uses `git worktree remove` without `--force`.

If the implementation process ends before Merge, it does not need to stay alive.
The next new-task startup reconciliation in section 2 must recover and remove any
now-safe stale worktree.

Do not manually delete a worktree directory, force-remove it, prune metadata, or
touch dirty/ambiguous/user-owned work to achieve cleanup.

Remote or local task-branch deletion is optional and separate from worktree cleanup.
Delete a branch only when ownership is proven and no open/stacked PR depends on it.
Do not delete a branch merely because its worktree was safely removed.

---

# 24. Sync final main

After Merge:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status
```

Do not use `reset --hard` as the default sync mechanism.

---

# 25. Post-merge verification

Run lightweight checks against final `main`.

At minimum for substantial TypeScript architecture changes:

```bash
npm run typecheck
npm run test:contracts
```

When appropriate also:

```bash
npm run build
```

For high-risk workflow changes, run the relevant smoke / E2E path.

This confirms the actual merged commit—not merely the feature branch—is healthy.

---

# 26. Stop after the requested task

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

# 27. Failure policy

If push, PR, CI or Merge cannot complete:

identify the actual blocker.

Examples:

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

Otherwise stop at the last safe state.

Never claim:

```text
pushed
merged
tests passed
```

unless verified.

---

# 28. Final report

After successful delivery report:

```text
Implementation
- concise description

Validation
- typecheck: PASS/FAIL
- lint: PASS/FAIL
- contracts: PASS/FAIL
- build: PASS/FAIL
- e2e: PASS/FAIL if applicable

Git
- branch
- commits

Pull Request
- number
- title
- URL
- remote checks

Merge
- method
- result
- final main SHA

Post-merge
- checks executed

Residual risks
- only real unresolved issues
```

Keep the report concise.

---

# 29. Core completion rule

The normal successful workflow is:

```text
Understand
↓
Startup stale-worktree reconciliation for new write tasks when locally safe
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
Clean branch
↓
Sync main
↓
Post-merge verification
↓
STOP
```

If a separate reviewer/orchestrator owns the review gate, the implementation worker
may stop at `READY FOR REVIEW` after handing off the exact PR HEAD; it does not need
to remain alive until Merge. Any stale merged worktree is reconciled by the next
new-task startup when proven `SAFE_TO_REMOVE`.

If any critical condition fails:

stop at the last safe state instead of bypassing the guardrail.

The quality of the resulting `main` branch matters more than successfully completing an automated Merge.
