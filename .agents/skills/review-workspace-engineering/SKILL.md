---

name: review-workspace-engineering
description: Use for scoped engineering write tasks in the Review Workspace repository, from investigation through the task's explicitly authorized delivery ceiling. Do not use for read-only questions or audits that do not modify files.
---

# Review Workspace Engineering

Use this Skill to deliver a scoped engineering task in the Review Workspace repository from investigation through its explicitly authorized delivery ceiling.

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

Use exactly one of these modes before choosing a branch. The authoritative base, anchor, worktree, and ownership invariants are in `AGENTS.md` section 20.1.

### A. Read-only task

Examples: audit, review, explain, inspect, or research.

If no file will be modified, do not create a branch. Read the repository state and report the evidence only.

### B. New write task

Examples: feature, fix, refactor, UI, architecture migration, maintenance, rules maintenance, docs maintenance, or test modification.

This mode requires the hard preflight in section 2 and a task-specific branch/worktree before the first file edit. If no base is specified, use the validated latest `origin/main`; if the task specifies a base ref or exact SHA, that explicit base overrides the default. Rules-only changes are still write tasks.

### C. Existing task continuation

If the user explicitly identifies an existing non-PR task by branch, worktree, and exact head SHA, verify all three and continue that task. Do not create another branch merely because no PR exists.

### D. Existing PR continuation

If the user explicitly asks to continue an existing open PR or to address its review, CI, or stabilization work, inspect and continue that PR's exact head branch. Do not create another branch or a second PR. Verify the PR head branch, local branch, and PR HEAD SHA before writing.

## 1.2 Establish the delivery ceiling

Read the task's explicit delivery ceiling before implementation. A lower ceiling overrides the normal workflow; implementation authorization does not authorize PR creation, PR authorization does not authorize Merge, and Merge authorization does not authorize tags or Releases. The Skill remains applicable when commit, push, PR, or Merge is disabled; it stops at the authorized ceiling.

For an ordinary scoped engineering write task with no narrower instruction, the default ceiling is:

```text
implementation → proportional validation → commit → push → STOP
```

PR creation, remote CI/review inspection or waiting, Merge, cleanup, tag, Release, and publication require explicit task scope.

For roadmap work, read:

```text
docs/product-roadmap-0.3-to-1.0.md
```

and the relevant architecture document.

---

# 2. HARD PREFLIGHT BEFORE WRITING

For a new write task or an existing-task continuation, before editing run the preflight required by `AGENTS.md` section 20.1:

```bash
git status --short
git status -sb
git branch --show-current
git rev-parse HEAD
git fetch origin
git rev-parse <selected-base-ref>
git worktree list
git status --short
```

The anchor may be any clean, attached branch; do not switch or modify it merely to satisfy a default-base or exact-base task. Resolve `origin/main` only when no base is specified. When a base ref or exact SHA is specified, resolve that explicit base, verify the exact SHA when supplied, and stop on drift. Verify that the target branch/worktree path is unused and that ownership is unambiguous. For an existing task or PR continuation, verify the specified branch, worktree, and exact head facts before writing.

If any condition fails, STOP. Do not stash, reset, restore, clean, checkout away local changes, commit unrelated changes, delete/prune worktrees, or alter WIP branches.

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

After the hard preflight, apply the selected mode from `AGENTS.md` section 20.1:

* for DEFAULT-BASE NEW WRITE, create the task-specific branch/worktree from the validated latest `origin/main`;
* for EXACT-BASE NEW WRITE, create it from the validated explicit base or exact SHA, using the requested fresh sibling worktree when specified;
* for EXISTING TASK CONTINUATION or EXISTING PR CONTINUATION, continue the verified task/PR branch instead of creating another one.

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

Confirm the branch and clean state before the first file edit. If the desired branch name already exists locally or remotely, inspect its history and ownership; never overwrite unknown history.

If Git reports that the branch is already used by another worktree, STOP and report the conflicting branch, worktree path, current HEAD, and current branch. Do not switch to detached HEAD, silently use an unrelated branch, delete the worktree, or force the operation.

Read-only mode requires no branch. A clean anchor on a non-`main` branch is valid when the selected task mode preserves it.

Never write into an unrelated feature branch, a WIP branch, or an ambiguous worktree. A new task must not write directly into `main`; use the selected task branch/worktree.

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

# 11. Run proportional local quality gates

Use the validation matrix in `AGENTS.md` section 19:

* rules/docs only: `git diff --check` plus any applicable repository rules, Markdown, Skill, or frontmatter validation;
* small localized TypeScript / Service changes: targeted behavioral tests, typecheck, and lint, broadening only when the changed boundary requires it;
* data/schema/migration/cross-layer business logic: focused and relevant full contracts, typecheck, lint, build, and migration/compatibility coverage;
* user-visible flows: relevant Playwright, without unrelated full E2E when reliable focused coverage exists;
* bundle, Electron, or release changes: the corresponding specific gates.

Do not mechanically run product build, Playwright, or Electron packaging for rules-only changes with no runtime boundary. Do not claim a test passed unless it actually ran and passed.

Once a gate passes for the current exact tree/state, do not rerun it merely for ceremony. Rerun when code, base/integration tree, or material environment changed, when the previous run failed, or when unresolved risk requires broader coverage.

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

Commit only when the delivery ceiling authorizes commit, and only after the required proportional local quality gates pass. Do not pause for another routine confirmation when commit is explicitly in scope.

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

Push the work branch only when the delivery ceiling authorizes push, and only after local verification. If the ceiling stops at commit or local validation, stop there.

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

Create a PR only when the delivery ceiling explicitly includes PR creation. Otherwise do not create a PR merely because the branch was pushed.

When PR creation is authorized:

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

When PR creation and remote inspection are in scope, inspect:

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

Do not busy-poll or wait indefinitely. Pending checks or review are a valid safe stopping state. Recheck reasonably only when the task explicitly authorizes waiting for CI/review and the execution environment supports it.

---

# 19. Respond to review feedback

If a PR/review is in scope and blocking feedback appears within scope:

```text
inspect
→ fix
→ test
→ commit
→ push
→ recheck remote state only within the authorized ceiling
```

Do not merge based on old CI after changing the PR HEAD.

If requested feedback substantially expands scope:

do not perform an unrelated roadmap phase just to satisfy it.

Keep the PR focused and report the scope conflict.

---

# 20. Merge hard gate

Merge is allowed only when the delivery ceiling explicitly authorizes Merge and all applicable conditions are true:

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

# 23. Branch cleanup

Only after a verified Merge, and only when cleanup is within the authorized task scope:

check whether another open PR depends on the branch.

If not:

delete the merged remote work branch.

Do not delete a branch that is still used as the base of stacked work.

A push-only or local-only ceiling does not authorize branch/worktree cleanup.

---

# 24. Sync final main

After a verified Merge, when final-main synchronization is within scope and the normal main worktree is safe to modify:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status
```

Do not use `reset --hard` as the default sync mechanism.

---

# 25. Post-merge verification

Post-merge verification applies only after a verified Merge. First verify the actual merged SHA/tree and remote required checks.

Rerun local gates when the merged tree differs from the validated tree, the base changed, conflict resolution changed content, integration risk warrants it, or the release/high-risk boundary requires it. Do not mechanically duplicate full validation when the merged tree is the exact validated tree.

Use the proportional validation matrix for the actual change. For substantial TypeScript architecture changes, this normally includes:

```bash
npm run typecheck
npm run test:contracts
```

When the changed boundary requires it, also run:

```bash
npm run build
```

For high-risk workflow changes, run the relevant smoke / E2E path. This confirms the actual merged commit—not merely the feature branch—is healthy.

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

Report only the stages reached under the authorized delivery ceiling:

```text
Implementation
- concise description

Validation
- commands/checks actually run with PASS/FAIL

Git
- base ref/SHA when relevant
- task branch
- task worktree
- commit SHA
- remote branch SHA if pushed

Pull Request / remote state
- include only when authorized and inspected

Merge / post-merge
- include only after a verified Merge

Residual risks
- only real unresolved issues
```

Do not report PR, CI, Merge, release, cleanup, or post-merge results for stages that were not authorized or did not run. Keep the report concise.

---

# 29. Core completion rule

The task-specific completion flow is:

```text
Understand
↓
Audit
↓
Implement
↓
Proportional validation
↓
Review complete diff
↓
Commit if authorized
↓
Push if authorized
↓
PR / remote CI / Merge / post-merge only when explicitly in scope
↓
STOP at the delivery ceiling
```

If any critical condition fails:

stop at the last safe state instead of bypassing the guardrail.

The quality of the resulting `main` branch matters more than successfully completing an automated Merge.
