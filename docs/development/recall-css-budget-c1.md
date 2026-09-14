# Recall Wave 3 / C1 CSS Budget Closure

## Exact baseline

- Parent: `a583f26660fdc2083a6ad500516bfaa80bbd960b`
- Hard limit: `floor(144824 * 1.001) = 144968` bytes
- Parent production measurement: `initialCssBytes = 146066`, excess `1098` bytes
- Parent JavaScript: `initialJavaScriptBytes = 1227625`; largest chunk `590746` bytes
- Parent initial CSS assets: `05hjb3q17is4s.css` (130850 bytes) and `2rtr1g_77recm.css` (15216 bytes)

The initial CSS graph is rooted at `app/globals.css`, which imports `tokens.css`,
`base.css`, `shell.css`, `ui.css`, and `conversation.css`. The initial module
asset also contains `learning-insight-view`, `review-entry-view`,
`workspace-view-state`, and `application-error-state`; lazy-only CSS was not
optimized.

## Cleanup

- Removed the unreferenced global `.ui-board-title`, `.ui-board-row`,
  `.ui-board-row:last-child`, and mobile `.ui-board-header` rules; the active
  `.ui-board-panel` remains unchanged.
- Consolidated duplicated conversation-tree button sizing, hover/focus states,
  and truncation declarations without changing selector specificity.
- Consolidated repeated initial-surface hover, muted text, paragraph, and
  send/voice declarations.
- Removed the duplicate collapsed-sidebar boundary rule and moved the shared
  chevron declarations into the existing UI rule.
- No TSX class wiring was needed. No behavior, lazy boundary, data, schema,
  dependency, or build configuration changed.

## Result

- Head production measurement: `initialCssBytes = 144811`
- Reduction: `1255` bytes (`0.8592%` from the exact parent)
- Headroom: `157` bytes below the hard limit
- Head JavaScript: `initialJavaScriptBytes = 1227625`; largest chunk `590746` bytes
- `failures = []`
- Head initial CSS assets: `1zcxu51mtmna1.css` (129595 bytes) and
  `2rtr1g_77recm.css` (15216 bytes)

The existing budget file and budget-check script are unchanged. Broader CSS
normalization remains deferred.

## Validation

- Node `24.20.0`; npm `11.19.0`
- `npm run typecheck`
- `npm run lint` (0 errors; one pre-existing warning)
- `npm run test:contracts` — 687 passed
- `npm run build`
- `npm run check:bundle` — PASS
- `git diff --check`
- Focused Playwright: desktop dashboard/shell and 390×844 mobile sidebar/tree
  flows; 7 existing tests passed. Representative screenshots were inspected
  locally for desktop and mobile layout invariants.
