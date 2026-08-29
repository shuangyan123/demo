# Recall brand assets

This directory contains the repository-only portion of the locked Recall visual
package from `recall_locked_final_brand_assets_v2.zip`. The files are copied
without redrawing, recoloring, vectorizing, cropping, or runtime masking.

## Canonical files

- `source/recall-master-transparent-1254.png` — approved transparent master.
- `app/recall-app-icon-{1024,512,256,128,64}.png` — repository-only standard exports.
- `app/recall-optical-32.png` — canonical optical export; an intentional
  byte-identical runtime copy is kept under `public/` for the 28 px top-bar
  mark.
- `app/recall-optical-{24,16}.png` — repository-only tiny exports.

The runtime/browser files remain under `public/brand/recall/`:

- `app/recall-optical-32.png` — top-bar browser URL asset. This is an
  intentional byte-identical duplicate of the canonical repository export
  above, and its approved SHA-256 is locked by the asset contract test.
- `app/recall-app-icon-48.png` — approved standard runtime export.
- `app/recall.ico` — Windows executable, installer, uninstaller, shortcut, and
  packaged BrowserWindow resource.
- `web/favicon.ico`, `web/favicon-32.png`, `web/favicon-16.png` — browser URL assets.

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

Do not use the crop-check preview or an earlier Recall variant as a runtime
asset. Do not regenerate these files as part of the build.
