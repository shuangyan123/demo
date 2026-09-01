# E2E baseline closure

This report records the pre-existing Playwright debt isolated from Fenbi
embedded-workspace work. It is scoped to the exact `origin/main` baseline and
contains no product-code or Fenbi implementation changes.

## Evidence anchors

| Item | Value |
| --- | --- |
| Baseline branch | `test/e2e-baseline-closure` |
| Baseline source | `f5122e2d208e947a7b6fb27efd3930de29cb9f6b` (`origin/main`) |
| Fenbi PR #109 head used for comparison | `cdbbcf4cc617afb2eda821abf98875e6e852977b` |
| Fenbi PR | [#109](https://github.com/shuangyan123/demo/pull/109), intentionally not merged |
| Baseline worktree | `E:\AI\code save\demo\le-e2e-baseline` |

## Initial exact-main failure inventory

The first full runs were executed before any baseline test corrections:

```text
npm run test:e2e -- --project=chromium --workers=1 --reporter=line
87 tests: 62 passed, 1 skipped, 24 failed

npm run test:e2e -- --project=chromium-mobile --workers=1 --reporter=line
15 tests: 11 passed, 4 failed
```

| Project | Test | Failure signature | Classification |
| --- | --- | --- | --- |
| desktop | `configuration-health.spec.ts:4` | Expected heading `粉笔导入`; current route renders `导入` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-interaction-stability.spec.ts:43` | `.conversation-topic-preview` was not visible after the focus path | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-interaction-stability.spec.ts:143` | Expected picker view `providers`; actual view was `controls` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-interaction-stability.spec.ts:264` | DeepSeek provider was not found because the picker remained in `controls` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-model-picker.spec.ts:50` | Expected picker view `providers`; actual view was `controls` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-model-picker.spec.ts:133` | Expected empty-state region `尚未配置 AI 连接` was absent | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-model-picker.spec.ts:150` | `Local / Custom OpenAI compatible` could not be clicked | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-model-picker.spec.ts:171` | `GLM / 智谱` could not be clicked | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-model-picker.spec.ts:191` | `OpenAI` could not be clicked | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `conversation-model-runtime.spec.ts:25` | `OpenAI` could not be clicked in the stale picker path | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `cross-provider-context.spec.ts:37` | `DeepSeek` could not be clicked in the stale picker path | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `cross-provider-context.spec.ts:144` | Old `summary[aria-label="查看对话上下文用量"]` locator timed out | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `import-entry.spec.ts:74` | Button `添加` was not found; current label is `添加文件等内容` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `p0-workspace-dashboard.spec.ts:28` | Expected frame overflow `visible`; current frame is `hidden` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `p0-workspace-dashboard.spec.ts:133` | Expected `data-content-surface=plain`; current frame is `raised-surface` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `p0-workspace-dashboard.spec.ts:202` | Expected inner-main shoulder radius `18px`; current frame owns `16px` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `p0-workspace-dashboard.spec.ts:257` | `深色` was not found from the current settings navigation state | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `p3-final-ui-closure.spec.ts:31` | Expected heading `插件`; current marketplace heading is `插件市场` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `plugin-disable-boundary.spec.ts:4` | Installed Obsidian row could not be reached from the old route path | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `plugin-disable-boundary.spec.ts:22` | `插件市场` could not be reached from the old route path | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `settings-architecture.spec.ts:5` | Appearance switch was not found before entering `外观` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `settings-architecture.spec.ts:122` | Global tooltip locator matched four screen-reader tooltip nodes | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `settings-architecture.spec.ts:168` | Fixed geometry expected `mainTop=52`; current frame border yields a 1px offset | BASE FAIL + FEATURE FAIL — pre-existing stale |
| desktop | `ui-review-four-pages.spec.ts:33` | Old `插件市场` button path timed out | BASE FAIL + FEATURE FAIL — pre-existing stale |
| mobile | `conversation-model-picker.mobile.spec.ts:22` | After Escape, the stale path could not reopen the model control for the next cascade | BASE FAIL + FEATURE FAIL — pre-existing stale |
| mobile | `p1-learning-workspaces.mobile.spec.ts:40` | `.chrome-topbar` did not expose the hidden metadata title `错题库` as visible text | BASE FAIL + FEATURE FAIL — pre-existing stale |
| mobile | `p3-final-ui-closure.mobile.spec.ts:4` | Expected heading `粉笔导入`; current heading is `导入` | BASE FAIL + FEATURE FAIL — pre-existing stale |
| mobile | `ui-review-four-pages.mobile.spec.ts:27` | Helper could not find the old module entry `粉笔导入` | BASE FAIL + FEATURE FAIL — pre-existing stale |

The four mobile signatures were also present in the original PR #109 failure
set. The older PR run (`33474855680`, old head
`883657cdf08a55000a23df06130d34a9f22e992e`) reported the matching desktop and
mobile debt. The later PR run (`33478845751`, head
`cdbbcf4cc617afb2eda821abf98875e6e852977b`) still had the same stale desktop
surface and route failures plus one remaining model-picker mobile failure;
there was no observed `BASE PASS + FEATURE FAIL` signature in the recorded
comparison. PR #109 was not rerun as part of this closure.

## Corrections in this branch

- Ported the four already-proven mobile test corrections from PR #109.
- Reopened the mobile model picker through the real `选择模型` trigger after
  Escape before entering the next cascade; no force-click or pointer bypass is
  used.
- Updated only the exact-base-proven desktop test contracts for current route,
  accessibility, picker, context-compression, and shared-frame behavior.
- Preserved the required comment phrase:
  `PRE-EXISTING MOBILE E2E DEBT EXPOSED BY RESTORED ACTIONS EXECUTION`.
- Changed files are E2E specs only; no production source, Fenbi implementation,
  schema, provider, or Electron runtime file was changed.

## Final exact-main validation

After the corrections, the complete project runs passed locally from the exact
baseline source:

```text
npm run test:e2e -- --project=chromium --workers=1 --reporter=line
87 tests: 86 passed, 1 skipped

npm run test:e2e -- --project=chromium-mobile --workers=1 --reporter=line
15 tests: 15 passed
```

This report proves baseline E2E closure only. It does not claim PR #109 CI is
green, does not claim native Electron QA, and does not authorize merging either
PR.

## PERFORMANCE BASELINE RECALIBRATION

PR #110 was E2E/docs-only before this budget update. No application production
source caused the CSS drift: the exact current-main-derived production build
exceeded the stale baseline by 48 bytes (`144824 > 144776`). Two independent
clean production builds established the same current metric tuple:

```text
initialJavaScriptBytes: 1310207
initialCssBytes: 144824
largestJavaScriptChunkBytes: 589345
forbidden initial-client modules: none matched
```

`maxGrowthPercent` remains unchanged at `0.1%`. The forbidden low-frequency
initial modules remain absent. This is baseline recapture, not budget
relaxation; no performance improvement is claimed.
