import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { load, JSON_SCHEMA } from "js-yaml";

const workflow = readFileSync(new URL("../.github/workflows/desktop-release.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
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
      RELEASE_EVENT_NAME: "push",
      RELEASE_REF: `refs/tags/${fixture.tagName}`,
      RELEASE_REF_NAME: fixture.tagName,
      RELEASE_SHA: fixture.sha,
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

test("desktop release build runs the provenance guard before dependency installation", () => {
  const { build, document } = workflowContract();
  const triggers = record(document.on, "workflow triggers");
  const push = record(triggers.push, "push trigger");
  assert.ok("workflow_dispatch" in triggers);
  assert.deepEqual(push.tags, ["v*"]);
  assert.equal(build["runs-on"], "windows-latest");
  const steps = build.steps as Array<Record<string, unknown>>;
  const guardIndex = steps.findIndex((step) => step.name === "Verify release provenance and version");
  const installIndex = steps.findIndex((step) => step.name === "Install dependencies");
  assert.ok(guardIndex >= 0 && guardIndex < installIndex);
  assert.equal(steps[guardIndex].run, "node scripts/verify-desktop-release-provenance.mjs");
  assert.ok(steps.some((step) => step.run === "npm run desktop:make"));
  assert.ok(steps.some((step) => step.run === "npm run test:desktop:integration"));
  assert.ok(steps.some((step) => step.run === "npm run test:desktop:artifact"));
});

test("release publication authority is job-scoped and manual dispatch cannot publish", () => {
  const { build, document, release } = workflowContract();
  assert.equal(record(document.permissions, "workflow permissions").contents, "read");
  assert.equal(build.permissions, undefined);
  assert.equal(record(release.permissions, "release permissions").contents, "write");
  assert.match(String(release.if), /github\.event_name == 'push'/);
  assert.match(String(release.if), /refs\/tags\//);
  assert.match(String(release.if), /needs\.build-windows-x64\.outputs\.publish_authorized == 'true'/);
  assert.equal(release.needs, "build-windows-x64");
});

test("release artifact upload and download are bound to the verified release SHA", () => {
  const { build, release } = workflowContract();
  const buildSteps = build.steps as Array<Record<string, unknown>>;
  const releaseSteps = release.steps as Array<Record<string, unknown>>;
  const upload = record(buildSteps.find((step) => step.name === "Upload workflow artifact")?.with, "upload inputs");
  const download = record(releaseSteps.find((step) => step.name === "Download exact-SHA release artifact")?.with, "download inputs");
  assert.match(String(upload.name), /steps\.release_guard\.outputs\.release_sha/);
  assert.match(String(download.name), /needs\.build-windows-x64\.outputs\.release_sha/);
  assert.match(String(upload.path), /ReviewWorkspace-.*package_version.*-Windows-x64-Setup\.exe/);
  assert.match(String(upload.path), /SHA256SUMS\.txt/);
  const releaseCommand = String(releaseSteps.find((step) => step.name === "Create GitHub Release")?.run);
  assert.match(releaseCommand, /gh release create/);
  assert.match(releaseCommand, /--draft/);
  assert.doesNotMatch(JSON.stringify(build), /gh release create/);
  assert.doesNotMatch(workflow, /autoUpdater|update-electron-app/);
});

test("main release tag provenance passes with an annotated tag SHA", (t) => {
  const fixture = createReleaseFixture(t, "main");
  const result = runReleaseGuard(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, new RegExp(`release_sha=${fixture.mainSha}`));
  assert.match(result.output, /publish_authorized=true/);
});

test("tag target differing from the event commit fails closed", (t) => {
  const fixture = createReleaseFixture(t, "candidate");
  const result = runReleaseGuard(fixture, { RELEASE_SHA: fixture.mainSha });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match event commit/);
});

test("matching package version cannot authorize a non-main release commit", (t) => {
  const fixture = createReleaseFixture(t, "candidate");
  const result = runReleaseGuard(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is not an ancestor of origin\/main/);
});

test("tag and package version mismatch fails closed", (t) => {
  const fixture = createReleaseFixture(t, "main", "v1.2.4");
  const result = runReleaseGuard(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package\.json version v1\.2\.3/);
});

test("workflow dispatch remains build-only even when dispatched from a tag ref", (t) => {
  const fixture = createReleaseFixture(t, "candidate");
  const result = runReleaseGuard(fixture, { RELEASE_EVENT_NAME: "workflow_dispatch" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /publish_authorized=false/);
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
