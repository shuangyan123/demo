# Recall U2 — Core Learning Loop Continuity

Lane A starts at `d54f23b68b027612e0b5e662637a561c703b2667` on
`origin/feat/recall-dashboard-constellation-flow`. Delivery is branch/commit/push
only, without a PR, merge, Actions dispatch, tag, or Release.

## Baseline flow audit

The unmodified parent was built and exercised with isolated browser learning
facts and real result buttons. The existing completion/learner-state contracts
also passed (22 tests).

| Path | Observed behavior before U2 |
| --- | --- |
| Mistake library → review | The unified detail panel offered a new conversation, but no direct review action. |
| One review result | Repository commit and shared refresh update due work immediately. |
| Review queue exhausted | Only “今日队列已清空” and an empty-state suggestion; no next-step button. |
| One knowledge result | Repository commit updates knowledge attempts and due entries. |
| Knowledge queue exhausted | Empty canvas and queue; no cross-module continuation. The all/favorite lists retain submitted entries. |
| Weakness | Existing priority cards already pass target IDs. The review controller could silently fall back to another due item for a target outside the due queue. |
| Scheduled | Existing explicit navigation opens definitions and the run inbox. No schedule creation is needed for U2. |
| Dashboard after review | Its existing next-action resolver correctly changes to knowledge training after actual review commits. |

The controller audit also found that retaining a nonzero index while the due
queue shrinks can falsely produce an empty review view with remaining work.

## UI and completion boundary

The existing repository transactions remain the only result writers.
`useReviewWorkspaceData.refreshData` still reloads normalized facts and the
existing learner-state snapshot. No schema, scoring, event model, or stored
completion state is added.

`useLearningSubmission` holds transient UI-only IDs for results committed in the
current round, prevents duplicate submissions, and gates continuation on the
shared refresh. Submitted IDs are excluded from the current round, including
wrong answers that remain due and entries in all/favorite filters. They are not
removed from learning facts or recommendations. Explicitly starting another
round resets these UI IDs; a reload does not restore a completion card.

After a commit, remaining items stay in the active interaction. Once there are
no remaining items and at least one result was committed, review and knowledge
share `LearningCompletion`. It displays the real submitted count and focuses
the inline completion heading. Navigation requires a button click.

If saving succeeds but refreshing fails, no next-action CTA is exposed. Manual
recovery only rereads the shared snapshot; it never repeats the result write.

## Next-step source

`resolveLearningNextSteps` is a pure presentation mapping of
`learnerState.recommendations`, retaining their original order. Only ready
recommendations with evidence and valid local review/knowledge targets are
shown. It does not inspect or recalculate scores. Repeated destination modules
are collapsed, with at most two recommendation buttons. The first is primary.

Existing enabled automation definitions or unread runs permit “查看已安排” as
an additional secondary button. With no valid learning recommendation, the
primary fallback is “返回总览”. There are at most three buttons. Dashboard
ranking remains unchanged. Tutoring/interview actions retain the existing
module-entry navigation semantics; U2 does not auto-start a plan.

The library gains an explicit selected-mistake review action. A target outside
the due queue becomes a one-item manual round rather than selecting another
question. Weakness analysis retains its existing model and list; its training
buttons require an exact target in an existing ready learner-state
recommendation. Data without such a target remains informational.

## Validation entry points

- `npm run typecheck`
- `npm run lint`
- `npm run test:contracts` (the existing dashboard feature test entry also loads the U2 presentation contracts)
- `npm run build`
- `npm run check:bundle`
- `node --test --experimental-strip-types app/services/learning-loop-completion.contract.test.ts app/services/learner-state-service.contract.test.ts`
- `npm run test:e2e -- e2e/recall-u2-continuity.spec.ts e2e/recall-u2-continuity.mobile.spec.ts --workers=2`
- `git diff --check`

Use Node 24.20.0 / npm 11.19.0. Browser tests use the unchanged standalone
startup script with `PORT=4320` and `HOSTNAME=127.0.0.1`; Playwright configuration
is unchanged. Desktop and 390×844 mobile tests cover real commits, target
navigation, empty evidence, keyboard focus, overflow, scheduled navigation,
duplicate submission, and refresh-only recovery. Screenshot/trace outputs are
local ignored test artifacts, not product data or committed evidence.

Lane B ownership files, release identity, dependencies, lockfile, workflows,
and the three explicitly protected E2E files remain outside U2's write scope.

## Validation result and remaining issue

The required typecheck, lint, 568 contracts, build, 22 existing learning-state
contracts, and focused desktop/mobile browser checks pass. Lint retains the
existing `application-error-state.tsx` navigation warning. The browser suite
also includes the six unchanged dashboard/Recall foundation regressions.

The supplementary bundle check is **not green**: initial CSS is 145,911 bytes
against the existing 144,968-byte limit. JavaScript and lazy-module checks pass.
No CSS files or budget configuration were changed. A controlled source scan
and compilation using the installed Tailwind compiler produced byte-identical
global CSS for the exact parent and U2 (129,347 bytes each); U2 adds no generated
global CSS. This does not make the existing production bundle budget pass.
An additional nested parent build required an explicit temporary build root
and produced different asset aggregation, so its total is not used as the
production baseline. That temporary configuration is outside committed source.

## Changed files

```text
app/features/knowledge/knowledge-training-view.tsx
app/features/review/dashboard-next-action.contract.test.ts
app/features/review/learning-completion.tsx
app/features/review/learning-data-explorer.tsx
app/features/review/learning-insight-view.tsx
app/features/review/learning-next-step.contract.test.ts
app/features/review/learning-next-step.ts
app/features/review/review-session-view.tsx
app/features/review/review-stats-view.tsx
app/features/review/review-workspace-core-views.tsx
app/features/review/review-workspace-secondary-views.tsx
app/features/review/use-learning-submission.ts
app/features/review/use-review-knowledge-controller.ts
app/features/review/use-review-learning-controller.ts
docs/recall-core-learning-loop-u2.md
e2e/helpers/u2-continuity.ts
e2e/recall-u2-continuity.mobile.spec.ts
e2e/recall-u2-continuity.spec.ts
```
