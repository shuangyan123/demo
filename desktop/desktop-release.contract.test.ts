import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { load, JSON_SCHEMA } from "js-yaml";

const workflow = readFileSync(new URL("../.github/workflows/trusted-desktop-release.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const releaseAuthorization = readFileSync(new URL("../docs/security/desktop-release-authorization.md", import.meta.url), "utf8");
const productionV1Policy = readFileSync(new URL("../docs/windows-production-v1-release-policy.md", import.meta.url), "utf8");
const releaseSmoke = readFileSync(new URL("../docs/release-smoke.md", import.meta.url), "utf8");
const windowsDistribution = readFileSync(new URL("../docs/windows-desktop-distribution.md", import.meta.url), "utf8");
const legacyWorkflowUrl = new URL("../.github/workflows/desktop-release.yml", import.meta.url);
const releaseGuardSource = readFileSync(new URL("../scripts/verify-desktop-release-provenance.mjs", import.meta.url), "utf8");
const electronArchive = readFileSync(new URL("../scripts/prepare-electron-archive.mjs", import.meta.url), "utf8");
const desktopHostPreparation = readFileSync(new URL("../scripts/prepare-desktop-host.mjs", import.meta.url), "utf8");
const forgeConfig = readFileSync(new URL("../forge.config.ts", import.meta.url), "utf8");
const squirrelNuspecTemplate = readFileSync(new URL("../scripts/squirrel.nuspec.template", import.meta.url), "utf8");
const electronWinstallerNuspecTemplate = readFileSync(new URL("../node_modules/electron-winstaller/template.nuspectemplate", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const releaseGuard = new URL("../scripts/verify-desktop-release-provenance.mjs", import.meta.url);

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function workflowContract() {
  const document = record(load(workflow, { schema: JSON_SCHEMA }), "workflow");
  const jobs = record(document.jobs, "workflow jobs");
  return {
    authorize: record(jobs["authorize-release"], "authorization job"),
    build: record(jobs["build-windows-x64"], "build job"),
    document,
    release: record(jobs.release, "release job"),
  };
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createReleaseFixture(
  t: { after(callback: () => void): void },
  tagTarget: "main" | "candidate",
  tagName = "v1.2.3",
) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-provenance-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const origin = join(root, "origin.git");
  const repository = join(root, "repository");
  execFileSync("git", ["init", "--bare", origin]);
  execFileSync("git", ["init", repository]);
  git(repository, "config", "user.name", "Release Contract");
  git(repository, "config", "user.email", "release-contract@example.invalid");
  writeFileSync(join(repository, "package.json"), '{"version":"1.2.3"}\n', "utf8");
  git(repository, "add", "package.json");
  git(repository, "commit", "-m", "main release candidate");
  git(repository, "branch", "-M", "main");
  git(repository, "remote", "add", "origin", origin);
  git(repository, "push", "-u", "origin", "main");
  const mainSha = git(repository, "rev-parse", "HEAD");
  git(repository, "switch", "-c", "candidate");
  writeFileSync(join(repository, "candidate.txt"), "candidate-only\n", "utf8");
  git(repository, "add", "candidate.txt");
  git(repository, "commit", "-m", "candidate-only commit");
  const candidateSha = git(repository, "rev-parse", "HEAD");
  const targetSha = tagTarget === "main" ? mainSha : candidateSha;
  git(repository, "tag", "-a", tagName, targetSha, "-m", "release contract tag");
  git(repository, "switch", "--detach", tagName);

  return {
    mainSha,
    repository,
    sha: git(repository, "rev-parse", `refs/tags/${tagName}`),
    tagName,
  };
}

function runReleaseGuard(
  fixture: ReturnType<typeof createReleaseFixture>,
  overrides: Partial<NodeJS.ProcessEnv> = {},
) {
  const outputPath = join(fixture.repository, "github-output.txt");
  const result = spawnSync(process.execPath, [fileURLToPath(releaseGuard)], {
    cwd: fixture.repository,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      RELEASE_DEFAULT_REF: "refs/heads/main",
      RELEASE_DEFAULT_SHA: fixture.mainSha,
      RELEASE_EVENT_NAME: "workflow_run",
      RELEASE_SHA: fixture.sha,
      RELEASE_TRIGGER_CONCLUSION: "success",
      RELEASE_TRIGGER_EVENT: "push",
      RELEASE_TRIGGER_HEAD_BRANCH: "main",
      RELEASE_TRIGGER_WORKFLOW: "CI",
      RELEASE_WORKFLOW_REF: "shuangyan123/demo/.github/workflows/trusted-desktop-release.yml@refs/heads/main",
      RELEASE_WORKFLOW_SHA: fixture.mainSha,
      ...overrides,
    },
  });

  return {
    ...result,
    output: result.status === 0 ? readFileSync(outputPath, "utf8") : "",
  };
}

test("PR 共享门禁包含桌面编译与契约", () => {
  assert.match(ci, /npm run desktop:compile/);
  assert.match(ci, /npm run test:desktop/);
});

test("production release authority is anchored to successful main CI workflow_run", () => {
  const { authorize, build, document } = workflowContract();
  const triggers = record(document.on, "workflow triggers");
  const workflowRun = record(triggers.workflow_run, "workflow_run trigger");
  assert.deepEqual(workflowRun.workflows, ["CI"]);
  assert.deepEqual(workflowRun.types, ["completed"]);
  assert.deepEqual(workflowRun.branches, ["main"]);
  assert.equal(triggers.push, undefined);
  assert.equal(triggers.workflow_dispatch, undefined);
  assert.equal(triggers.repository_dispatch, undefined);
  assert.equal(authorize["runs-on"], "ubuntu-latest");
  assert.match(String(authorize.if), /workflow_run\.conclusion == 'success'/);
  assert.match(String(authorize.if), /workflow_run\.event == 'push'/);
  assert.match(String(authorize.if), /workflow_run\.head_branch == 'main'/);
  const authorizationSteps = authorize.steps as Array<Record<string, unknown>>;
  const checkout = authorizationSteps.find((step) => step.name === "Checkout exact successful main CI commit and trusted refs");
  const checkoutInputs = record(checkout?.with, "release checkout inputs");
  assert.match(String(checkoutInputs.ref), /workflow_run\.head_sha/);
  assert.equal(checkoutInputs["fetch-depth"], 0);
  assert.equal(checkoutInputs["persist-credentials"], false);
  const guard = authorizationSteps.find((step) => step.name === "Verify trusted release provenance and version");
  assert.equal(guard?.run, "node scripts/verify-desktop-release-provenance.mjs");
  assert.match(String(build.if), /needs\.authorize-release\.outputs\.publish_authorized == 'true'/);
  const buildSteps = build.steps as Array<Record<string, unknown>>;
  assert.ok(buildSteps.some((step) => step.run === "npm run desktop:make"));
  assert.ok(buildSteps.some((step) => step.run === "npm run test:desktop:integration"));
  assert.ok(buildSteps.some((step) => step.run === "npm run test:desktop:artifact"));
});

test("release publication authority is job-scoped and consumes only guard authorization", () => {
  const { authorize, build, document, release } = workflowContract();
  assert.equal(record(document.permissions, "workflow permissions").contents, "read");
  assert.equal(build.permissions, undefined);
  assert.equal(record(release.permissions, "release permissions").contents, "write");
  assert.match(String(release.if), /needs\.authorize-release\.outputs\.publish_authorized == 'true'/);
  assert.deepEqual(release.needs, ["authorize-release", "build-windows-x64"]);
  assert.equal(authorize.permissions, undefined);
});

test("release artifact upload and download are bound to the verified release SHA", () => {
  const { build, release } = workflowContract();
  const buildSteps = build.steps as Array<Record<string, unknown>>;
  const releaseSteps = release.steps as Array<Record<string, unknown>>;
  const upload = record(buildSteps.find((step) => step.name === "Upload exact-SHA workflow artifact")?.with, "upload inputs");
  const download = record(releaseSteps.find((step) => step.name === "Download exact-SHA release artifact")?.with, "download inputs");
  assert.match(String(upload.name), /needs\.authorize-release\.outputs\.release_sha/);
  assert.match(String(download.name), /needs\.authorize-release\.outputs\.release_sha/);
  assert.match(String(upload.path), /ReviewWorkspace-.*package_version.*-Windows-x64-Setup\.exe/);
  assert.match(String(upload.path), /SHA256SUMS\.txt/);
  const releaseCommand = String(releaseSteps.find((step) => step.name === "Create draft GitHub Release")?.run);
  assert.match(releaseCommand, /gh release create/);
  assert.match(releaseCommand, /needs\.authorize-release\.outputs\.release_tag/);
  assert.match(releaseCommand, /--draft/);
  assert.doesNotMatch(JSON.stringify(build), /gh release create/);
  assert.doesNotMatch(workflow, /autoUpdater|update-electron-app/);
});

test("production-v1 is intentionally unsigned without weakening exact-artifact provenance", () => {
  const { build, release } = workflowContract();
  const buildEnvironment = record(build.env, "production build environment");
  assert.equal(buildEnvironment.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.doesNotMatch(
    workflow,
    /WIN_CSC_LINK|CSC_LINK|WIN_CSC_KEY_PASSWORD|CSC_KEY_PASSWORD|forceCodeSigning|AZURE_CLIENT_SECRET|SignPath|KeyLocker|RFC3161/,
  );
  assert.match(workflow, /Windows SmartScreen.*未签名.*未知发布者/);
  assert.match(productionV1Policy, /WINDOWS PRODUCTION-V1: INTENTIONALLY UNSIGNED/);
  assert.match(productionV1Policy, /PRODUCTION-V1 SIGNING POLICY: INTENTIONALLY UNSIGNED/);
  assert.match(productionV1Policy, /PRODUCTION WINDOWS INSTALLER IS EXPECTED TO BE UNSIGNED/);
  assert.match(productionV1Policy, /trusted source provenance \+ exact artifact SHA-256/);
  assert.match(productionV1Policy, /Unknown Publisher/);
  assert.match(productionV1Policy, /M5 READINESS: PLANNING COMPLETE/);
  assert.match(productionV1Policy, /WINDOWS PRODUCTION RELEASE READY: NO/);
  assert.match(productionV1Policy, /FUTURE: WINDOWS CODE SIGNING \/ PUBLISHER IDENTITY/);
  assert.match(releaseAuthorization, /Production-v1 is intentionally unsigned/);
  assert.match(releaseAuthorization, /trusted source provenance plus the exact[\s\S]*artifact SHA-256/);
  assert.match(releaseSmoke, /Current M5 policy:[\s\S]*production-v1 is intentionally unsigned/);
  assert.match(windowsDistribution, /Current M5 policy:[\s\S]*production-v1 is intentionally unsigned/);

  const buildSteps = build.steps as Array<Record<string, unknown>>;
  const checksumIndex = buildSteps.findIndex((step) => step.name === "Generate SHA-256 manifest");
  const uploadIndex = buildSteps.findIndex((step) => step.name === "Upload exact-SHA workflow artifact");
  assert.ok(checksumIndex >= 0 && checksumIndex < uploadIndex);
  const releaseSteps = release.steps as Array<Record<string, unknown>>;
  const boundaryIndex = releaseSteps.findIndex((step) => step.name === "Verify release artifact boundary");
  const draftIndex = releaseSteps.findIndex((step) => step.name === "Create draft GitHub Release");
  assert.ok(boundaryIndex >= 0 && boundaryIndex < draftIndex);
});

test("trusted main CI commit with an annotated matching tag passes", (t) => {
  const fixture = createReleaseFixture(t, "main");
  const result = runReleaseGuard(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, new RegExp(`release_sha=${fixture.mainSha}`));
  assert.match(result.output, /release_tag=v1\.2\.3/);
  assert.match(result.output, /publish_authorized=true/);
});

test("matching package version cannot authorize a non-main release commit", (t) => {
  const fixture = createReleaseFixture(t, "candidate");
  const result = runReleaseGuard(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is not an ancestor of origin\/main/);
});

test("missing expected package-version tag skips publication", (t) => {
  const fixture = createReleaseFixture(t, "main", "v1.2.4");
  const result = runReleaseGuard(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /publish_authorized=false/);
});

test("expected tag targeting another commit skips publication", (t) => {
  const fixture = createReleaseFixture(t, "candidate");
  const result = runReleaseGuard(fixture, { RELEASE_SHA: fixture.mainSha });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /publish_authorized=false/);
});

test("untrusted event or workflow identity fails closed", async (t) => {
  const cases: Array<[string, Partial<NodeJS.ProcessEnv>, RegExp]> = [
    ["manual dispatch", { RELEASE_EVENT_NAME: "workflow_dispatch" }, /requires workflow_run/],
    ["wrong workflow", { RELEASE_TRIGGER_WORKFLOW: "Attacker CI" }, /successful CI push run on main/],
    ["pull request run", { RELEASE_TRIGGER_EVENT: "pull_request" }, /successful CI push run on main/],
    ["non-main run", { RELEASE_TRIGGER_HEAD_BRANCH: "candidate" }, /successful CI push run on main/],
    ["failed CI", { RELEASE_TRIGGER_CONCLUSION: "failure" }, /successful CI push run on main/],
    ["non-main workflow ref", { RELEASE_WORKFLOW_REF: "shuangyan123/demo/.github/workflows/trusted-desktop-release.yml@refs/heads/candidate" }, /not anchored to the trusted main workflow/],
  ];

  for (const [name, overrides, expected] of cases) {
    await t.test(name, (child) => {
      const fixture = createReleaseFixture(child, "main");
      const result = runReleaseGuard(fixture, overrides);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
    });
  }
});

test("private checkout contract fetches trusted refs before removing credentials", () => {
  const ciDocument = record(load(ci, { schema: JSON_SCHEMA }), "CI workflow");
  const ciJobs = record(ciDocument.jobs, "CI jobs");
  const job = record(ciJobs["private-release-checkout"], "private checkout job");
  assert.equal(record(job.permissions, "private checkout permissions").contents, "read");
  const steps = job.steps as Array<Record<string, unknown>>;
  const checkoutInputs = record(steps[0].with, "private checkout inputs");
  assert.equal(checkoutInputs["fetch-depth"], 0);
  assert.equal(checkoutInputs["persist-credentials"], false);
  assert.match(String(steps[1].run), /refs\/remotes\/origin\/main/);
  assert.match(String(steps[1].run), /extraheader/);
  assert.doesNotMatch(releaseGuardSource, /\bfetch\b/);
});

test("SEC-04 documentation records completed platform acceptance with residual risk", () => {
  assert.equal(existsSync(legacyWorkflowUrl), false);
  assert.match(releaseAuthorization, /SEC-04: PASS WITH RESIDUAL RISK/);
  assert.match(releaseAuthorization, /workflow ID `323491496`/);
  assert.match(releaseAuthorization, /disabled_manually/);
  assert.match(releaseAuthorization, /TRUSTED TO PUBLISH/);
  assert.match(releaseAuthorization, /TRUSTED DELEGATED TOOLING/);
  assert.match(releaseAuthorization, /main\.protected=false/);
  assert.match(releaseAuthorization, /rulesets are unavailable on the current private plan/i);
  assert.match(releaseAuthorization, /GitHub App installation inventory is incomplete/i);
  assert.match(releaseAuthorization, /future untrusted writer[\s\S]*SEC-04 must be reassessed/i);
  assert.match(releaseAuthorization, /current-tree[\s\S]*not the sole proof/i);
  assert.doesNotMatch(releaseAuthorization, /PLATFORM CONTROL PENDING/);
  assert.doesNotMatch(releaseAuthorization, /SEC-04 REMEDIATION PARTIAL/);
  assert.doesNotMatch(releaseAuthorization, /legacy Desktop Release workflow is still active/i);
});

test("Electron 官方归档在 runner 缓存缺失时下载并继续校验 checksum", () => {
  assert.match(electronArchive, /downloadArtifact/);
  assert.match(electronArchive, /checksums/);
  assert.match(electronArchive, /isVerifiedArchive\(archivePath\)/);
  assert.doesNotMatch(electronArchive, /请先完成 npm install/);
});

test("Forge and package metadata keep the Windows installer identity stable", () => {
  assert.equal(packageJson.name, "review-workspace");
  assert.equal(packageJson.productName, "错题复盘");
  assert.equal(packageJson.version, "0.2.4");
  assert.equal(packageLock.name, packageJson.name);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.match(desktopHostPreparation, /const hostPackageJson = \{/);
  assert.match(desktopHostPreparation, /name: packageJson\.name/);
  assert.match(desktopHostPreparation, /productName: packageJson\.productName/);
  assert.match(desktopHostPreparation, /version: packageJson\.version/);
  assert.match(desktopHostPreparation, /main: "\.desktop\/main\.js"/);

  assert.match(forgeConfig, /outDir:\s*"\.\.\/out"/);
  assert.match(forgeConfig, /name:\s*"review-workspace"/);
  assert.match(forgeConfig, /executableName:\s*"review-workspace"/);
  assert.match(forgeConfig, /new MakerSquirrel\(/);
  assert.match(forgeConfig, /name:\s*"review_workspace"/);
  assert.match(
    forgeConfig,
    /setupExe: `ReviewWorkspace-\$\{process\.env\.npm_package_version \?\? "0\.2\.4"\}-Windows-x64-Setup\.exe`/,
  );

  assert.equal(packageLock.packages["node_modules/electron"].version, "43.4.1");
  assert.equal(packageLock.packages["node_modules/@electron-forge/maker-squirrel"].version, "7.11.2");
  assert.equal(packageLock.packages["node_modules/electron-winstaller"].version, "5.4.4");
});

test("checked-in Squirrel nuspec preserves the installed template except for icon metadata", () => {
  const normalize = (value: string) => value.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const expectedTemplate = normalize(electronWinstallerNuspecTemplate).replace(
    /^\s*<iconUrl>.*<\/iconUrl>\n/m,
    "",
  );

  assert.equal(normalize(squirrelNuspecTemplate), expectedTemplate);
  assert.doesNotMatch(squirrelNuspecTemplate, /<iconUrl\b/i);
  assert.doesNotMatch(
    squirrelNuspecTemplate,
    /raw\.githubusercontent\.com\/electron\/electron\/.*electron\.ico/i,
  );
});

test("Forge uses the checked-in no-icon Squirrel nuspec template", () => {
  assert.match(
    forgeConfig,
    /const squirrelNuspecTemplate = join\(process\.cwd\(\), "scripts", "squirrel\.nuspec\.template"\)/,
  );
  assert.match(forgeConfig, /nuspecTemplate:\s*squirrelNuspecTemplate/);
});

test("desktop artifact gate includes the generated Squirrel package metadata regression", () => {
  assert.match(packageJson.scripts["test:desktop:artifact"], /scripts\/squirrel-package\.contract\.test\.mjs/);
});

test("userData remains separate from the Squirrel binary root", () => {
  assert.match(main, /const partition = "persist:review-workspace"/);
  assert.doesNotMatch(main, /app\.setPath\(\s*["']userData["']/);
  assert.doesNotMatch(main, /app\.setName\(/);
  assert.equal(packageJson.productName, "错题复盘");
});
