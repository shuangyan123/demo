# Recall brand assets

This directory contains the repository-only portion of the locked Recall visual
package from `recall_locked_final_brand_assets_v2.zip` and the approved v2
wordmark extraction packages. The files are copied without redrawing,
recoloring, vectorizing, cropping, or runtime masking.

## Canonical files

- `source/recall-master-transparent-1254.png` — approved transparent master.
- `app/recall-app-icon-{1024,512,256,128,64}.png` — repository-only standard exports.
- `app/recall-optical-32.png` — canonical optical export; an intentional
  byte-identical runtime copy is kept under `public/` for the 28 px top-bar
  mark.
- `app/recall-optical-{24,16}.png` — repository-only tiny exports.
- `wordmark/recall-wordmark-{B,C}-transparent.png` — approved light-background
  wordmark exports.
- `wordmark/recall-wordmark-{B,C}-dark-transparent.png` — approved
  dark-background wordmark exports.
- `wordmark/recall-lockup-{B,C}-transparent.png` and
  `wordmark/recall-lockup-{B,C}-dark-transparent.png` — approved mascot +
  wordmark lockup exports.

The runtime/browser files remain under `public/brand/recall/`:

- `app/recall-optical-32.png` — top-bar browser URL asset. This is an
  intentional byte-identical duplicate of the canonical repository export
  above, and its approved SHA-256 is locked by the asset contract test.
- `app/recall-app-icon-48.png` — approved standard runtime export.
- `app/recall.ico` — Windows executable, installer, uninstaller, shortcut, and
  packaged BrowserWindow resource.
- `web/favicon.ico`, `web/favicon-32.png`, `web/favicon-16.png` — browser URL assets.
- `wordmark/` — byte-identical runtime copies used by the shared wordmark and
  lockup renderer components.

The Next.js root favicon entry at `app/favicon.ico` is the required runtime copy
of `public/brand/recall/web/favicon.ico`.

## Usage boundaries

The workbench top bar uses the optical 32 px asset at a 28 × 28 px rendered size;
the mark remains square and is not cropped or masked. Forge and both opt-in
electron-builder configurations use the local public `app/recall.ico`; Squirrel
keeps its no-remote-`iconUrl` behavior. The visual asset change does not rename
the package, executable, appId, userData path, install identity, or upgrade
identity. Keeping the master and non-runtime exports out of `public/` prevents
`prepare-desktop-runtime.mjs` from copying them into the packaged runtime.

`RecallBrandWordmark` and `RecallBrandLockup` are the renderer entry points for
the locked B/C artwork. Callers must select `theme="light"` or `theme="dark"`
explicitly so the supplied asset variant is chosen deterministically; neither
component retypes, recolors, crops, stretches, or filters the artwork. B is
the formal/brand presentation variant, while C is the compact everyday UI
variant. The existing 28 px top-bar mascot, favicon, Windows icon, taskbar
icon, and other 16–32 px contexts remain mascot-only.

The wordmark packages were supplied and verified on 2026-08-29:

- `recall_wordmark_locked_assets_v2.zip` — SHA-256
  `62929cdd5f90e3cde63d2de41d41a35be182f97cd445166af28c38fcd848cacd`
- `recall_wordmark_dark_assets.zip` — SHA-256
  `7feb855e467cbe59bb097c5d1b3ad3abda74b3890147a87122ef7302d561234c`

The source ZIPs and the extraction-check previews are intentionally not stored
in this repository or copied to the runtime payload. The canonical/runtime
wordmark copies are kept byte-identical and are guarded by the Recall asset
contract test.

Do not use the crop-check preview or an earlier Recall variant as a runtime
asset. Do not regenerate these files as part of the build.
