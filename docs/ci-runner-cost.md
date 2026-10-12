# GitHub-hosted runner cost policy

Scope: CI scheduling and setup policy. Playwright assertions/config, release
authority, NSIS provenance and dependency-audit failure semantics remain enforced.
The accompanying model-picker focus repair and workspace-readiness helpers do
not grant CI exemptions. The original proposal remains a Draft PR; local
integration and validation do not authorize remote delivery or merge.

## Validation placement

Every PR runs the private trusted-ref checkout/classifier, static checks
(typecheck, lint, full contracts, desktop compile/contracts and M3 helper
contracts), production dependency audit, production build and bundle budget.
Only expensive environment jobs are path classified.

Main push runs static checks, production audit and production build/bundle. It
does not automatically repeat Linux desktop/mobile E2E, Windows E2E, M3 or NSIS.
Browser verification belongs to the pre-merge PR. A direct push to main or an
unreviewed merge would therefore lack that browser evidence; preserve PR delivery.

Trusted Desktop Release still requires successful `CI` + `push` + `main`, a
verified exact SHA on main and the matching package-version tag. Neither the
workflow nor `verify-desktop-release-provenance.mjs` requires named browser jobs
in main CI. Its authorized Windows build independently runs typecheck, lint,
contracts, desktop contracts/integration, audit, build/bundle, both Playwright
projects and full NSIS source/evidence/artifact validation. SHA/tag authority,
staged bytes/checksum, unsigned policy and Draft round-trip remain unchanged.

## Classification

The four outputs are `browser_runtime_sensitive`, `windows_runtime_sensitive`,
`migration_sensitive` and `installer_sensitive`.

| Change | Linux browser | Windows E2E | M3 | NSIS |
| --- | --- | --- | --- | --- |
| Documentation / repository-only Recall artwork | no | no | no | no |
| Exact pure Recall allowlist | no | no | no | no |
| Dedicated verification-source admission contract tests | no | no | no | no |
| Learner-state derivation/policies and verification-source admission runtime modules | yes | yes | no | no |
| Ordinary Web View/style | yes | no | no | no |
| Shared business, DB, types, server/API, platform | yes | yes | no | no |
| Settings, Fenbi, native shell/titlebar consumers | yes | yes | no | no |
| Desktop preload / runtime / Vault | no | yes | no | yes |
| Desktop main / migration / installer configuration | no | yes | yes | yes |
| Public packaged asset | yes | yes | no | yes |
| E2E tests | yes | yes | no | no |
| Dependency/runtime pins, framework/Playwright config, workflow, classifier, architecture guard | yes | yes | yes | yes |
| Unknown path / malformed input / classifier failure | yes | yes | yes | yes |
| Pure Recall + runtime consumer | runtime file determines the union of gates | | | |

The pure allowlist contains exact existing files, not `app/services/**` or
`app/types/**`: the Evidence shadow report without external runtime consumers,
eight dedicated contract tests and the two type-only domain files. Classifier
contracts scan production imports transitively and require allowlisted domain
files to remain type-only. A new direct or transitive runtime consumer fails the
guard and requires removal from the exemption. Host importers must classify as
Windows sensitive.

Phase E/F diagnostic assessment submission and durable-history reconstruction
now consume learner-state derivation/policies and verification-source admission.
The audited runtime list therefore includes `derive-learner-state.ts`,
`learner-state-policy.ts`, `verification-policy.ts`,
`verification-source-admission.ts` and `verification-source-admission-core.ts`.
Changing any one of them enables browser and Windows E2E, while leaving installer
and migration gates false. Pure functional implementation alone does not justify
a runtime exemption.

Phase D `compatibility-snapshot` is already used by `learner-state-service`.
Its Evidence, adapter and event dependencies are therefore excluded from the
pure source exemption, including the verified adapter imported by Evidence.
New Kernel/admission files are unknown and enable all gates until audited.

Windows classification intentionally remains conservative for shared business,
storage, credentials and server/Host code. Settings/Fenbi and native shell/theme
consumers are also covered. Desktop/installer paths imply Windows E2E; existing
installer and migration boundaries are retained. Unrecognized scripts enable all
gates; recognized Windows scripts always enable Windows verification.
Authenticode, release finalization and other unclassified provenance helpers
remain full-gate changes, so a Windows-only label cannot suppress NSIS readback.

The classifier is loaded from the PR base SHA and receives the NUL-delimited
base-to-head path diff. Its own policy changes cannot reduce that PR's gates.
Failures, unreadable revisions, invalid/missing/extra outputs enable all gates;
job conditions accept only explicit `false` as an exemption. During deployment,
the old three-output base also enables every gate because four valid outputs
are now required. This workflow PR must itself run all heavyweight PR jobs.

## Setup changes

Linux E2E runs both existing projects with one checkout, pinned Node, `npm ci`,
production build and Chromium installation. Project matching/isolation, mobile
390x844 viewport, GitHub reporter, CI single worker and retained failure traces
remain unchanged. The combined job has no fail-fast cutoff and uploads the
hidden `.playwright-results` directory on failure.

Production audit uses only Node built-ins, npm CLI, lockfile and official npm
advisory endpoints; its job needs no `npm ci`. It still blocks high/critical and
fails on unresolved infrastructure errors. No build artifacts are shared across
jobs, no new cache action/dependency/runner is introduced.

## Measured baseline (2026-10-05, UTC)

Sources: [PR #143 exact-head CI](https://github.com/shuangyan123/demo/actions/runs/37306626730)
at `d502ec644d0912c0e3a1580fc24c5c020457d0fe` and
[main push CI](https://github.com/shuangyan123/demo/actions/runs/37308148519)
at `f03a7e1d3be9c5fa1e337b8be4d23c9530bcd9a3`.
All started jobs below succeeded. Durations are `completed_at - started_at`,
excluding queue time; they approximate runner usage, not billed rounded minutes.

| Run | Job | OS | Started UTC | Completed UTC | Seconds | Install / build / browser coverage |
| --- | --- | --- | --- | --- | --- | --- |
| PR | Trusted checkout | Linux | 12:00:46 | 12:00:55 | 9 | none |
| PR | Audit | Linux | 12:00:46 | 12:01:28 | 42 | install 22s, no build |
| PR | Static | Linux | 12:00:46 | 12:02:27 | 101 | install 23s, no build |
| PR | Build | Linux | 12:02:30 | 12:04:00 | 90 | install 28s, build 45s |
| PR | Chromium E2E | Linux | 12:04:02 | 12:11:36 | 454 | install 28s, build 49s, browser install 27s, desktop tests 331s |
| PR | Mobile E2E | Linux | 12:04:02 | 12:06:38 | 156 | install 18s, build 34s, browser install 26s, mobile tests 57s |
| PR | Windows full E2E | Windows | 12:00:57 | 12:08:13 | 436 | install 44s, build 30s, browser install 13s, both projects 323s |
| Main | Audit | Linux | 12:14:27 | 12:15:10 | 43 | install 22s, no build |
| Main | Static | Linux | 12:14:26 | 12:16:00 | 94 | install 17s, no build |
| Main | Build | Linux | 12:16:03 | 12:17:39 | 96 | install 29s, build 47s |
| Main | Chromium E2E | Linux | 12:17:42 | 12:24:57 | 435 | install 26s, build 45s, browser install 26s, desktop tests 322s |
| Main | Mobile E2E | Linux | 12:17:42 | 12:20:46 | 184 | install 25s, build 47s, browser install 26s, mobile tests 69s |

PR M3 and NSIS were skipped with no assigned runner (0 seconds). Main trusted
checkout and all three Windows jobs were likewise skipped without runners.
Do not count those UI entries as savings. The baseline PR started six Linux and
one Windows runners, performing six installs and four production builds across
OSes. Main started five Linux runners, performing five installs and three builds.

## Before/after estimate

PR baseline: Linux 852s (14.20 min), Windows 436s (7.27 min).
Main baseline: Linux 852s (14.20 min), Windows 0.
The merged Linux job is estimated at 511s (454s desktop job + 57s mobile tests),
saving the mobile job's 99s setup/server/cleanup overhead. Audit saves the
measured 22s installation. Static/classifier contract overhead and hosted-runner
variation can change these estimates; exact-head measurements should be reported
separately. M3/NSIS durations are represented below as M/N because #143 did not
start them; a fabricated zero-duration installer baseline would be misleading.
These figures describe the historical 2026-10-05 workload, before Phase E/F and
the current runtime tuple; they are not measurements of this refreshed
integration. Runner savings also do not resolve Artifact storage quotas. Upload
requirements and retention settings remain unchanged.

| Scenario | Before started jobs | After started jobs | Linux saving | Windows saving |
| --- | --- | --- | --- | --- |
| A: audited shadow/type/contract-only files | checkout, static, audit, build, two Linux E2E, Windows E2E | checkout, static, audit, build | ~10.53 min (14.20 -> 3.67) | ~7.27 min (7.27 -> 0) |
| B: ordinary Web UI | same as A | checkout, static, audit, build, combined Linux E2E | ~2.02 min (14.20 -> 12.18) | ~7.27 min (7.27 -> 0) |
| C: desktop/preload | checkout, static, audit, build, Windows E2E, NSIS | same jobs | ~0.37 min | 0 (7.27 + N retained) |
| D: installer config | checkout, static, audit, build, Windows E2E, M3, NSIS | same jobs | ~0.37 min | 0 (7.27 + M + N retained) |
| E: merge-to-main | static, audit, build, two Linux E2E | static, audit, build | ~10.68 min (14.20 -> 3.52) | 0 (already none) |
| F: Recall state/admission runtime modules | same as A | checkout, static, audit, build, combined Linux E2E, Windows E2E | ~2.02 min | 0 (Windows retained) |

Normal Web UI keeps both Linux projects; Windows verification remains on actual
Host/credential/storage/desktop risks. Pure source changes retain full direct
contracts and architecture tests. Release validation remains independently full.
No test/assertion is deleted or weakened to save quota.

Residual limitations: new runtime adoption must remove the corresponding pure
exemption and pass the import/architecture guards; Windows shared-code categories
intentionally sacrifice some possible savings. A combined job's wall-clock can
be longer than either old matrix leg, while total runner usage falls. Release
build/compile duplication and cross-job build reuse are deferred.
