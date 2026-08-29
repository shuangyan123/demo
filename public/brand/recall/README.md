# Recall brand assets

This directory contains the locked Recall visual package from
`recall_locked_final_brand_assets_v2.zip`. The files are copied without
redrawing, recoloring, vectorizing, cropping, or runtime masking.

## Canonical files

- `source/recall-master-transparent-1254.png` — approved transparent master.
- `app/recall-app-icon-{1024,512,256,128,64,48}.png` — standard application surfaces.
- `app/recall-optical-{32,24,16}.png` — genuinely tiny UI surfaces.
- `app/recall.ico` — Windows executable, installer, uninstaller, and shortcut resource.
- `web/favicon.ico`, `web/favicon-32.png`, `web/favicon-16.png` — browser assets.

The Next.js root favicon entry at `app/favicon.ico` is the required runtime copy
of `web/favicon.ico`. It is the only intentional duplicate.

## Usage boundaries

The workbench top bar uses the 48 px standard asset. Forge and both opt-in
electron-builder configurations use the local `app/recall.ico`; Squirrel keeps
its no-remote-`iconUrl` behavior. The visual asset change does not rename the
package, executable, appId, userData path, install identity, or upgrade identity.

Do not use the crop-check preview or an earlier Recall variant as a runtime
asset. Do not regenerate these files as part of the build.
