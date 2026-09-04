import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { JSON_SCHEMA, load } from "js-yaml";
import { classifyChangedFiles } from "./classify-ci-changes.mjs";

const workspaceRoot = process.cwd();
const classifierPath = resolve(workspaceRoot, "scripts", "classify-ci-changes.mjs");
const ciPath = resolve(workspaceRoot, ".github", "workflows", "ci.yml");
const trustedReleasePath = resolve(workspaceRoot, ".github", "workflows", "trusted-desktop-release.yml");
const ci = readFileSync(ciPath, "utf8");
const trustedRelease = readFileSync(trustedReleasePath, "utf8");

function allGates(value) {
  return {
    installer_sensitive: value,
    migration_sensitive: value,
    browser_runtime_sensitive: value,
  };
}

function record(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function workflowDocument() {
  return record(load(ci, { schema: JSON_SCHEMA }), "CI workflow");
}

function workflowJobs() {
  return record(workflowDocument().jobs, "CI jobs");
}

test("documentation and repository-only Recall sources avoid heavyweight PR gates", () => {
  assert.deepEqual(classifyChangedFiles(["README.md"]), allGates(false));
  assert.deepEqual(classifyChangedFiles(["docs/security/desktop-release-authorization.md"]), allGates(false));
  assert.deepEqual(classifyChangedFiles(["assets/brand/recall/source/recall-master-transparent-1254.png"]), allGates(false));
});

test("browser-facing application changes only enable PR browser E2E", () => {
  assert.deepEqual(classifyChangedFiles(["app/features/shared/ui-primitives.tsx"]), {
    installer_sensitive: false,
    migration_sensitive: false,
    browser_runtime_sensitive: true,
  });
  assert.deepEqual(classifyChangedFiles(["app/globals.css"]), {
    installer_sensitive: false,
    migration_sensitive: false,
    browser_runtime_sensitive: true,
  });
});

test("desktop and installer changes enable the appropriate desktop gates", () => {
  assert.deepEqual(classifyChangedFiles(["desktop/main.ts"]), {
    installer_sensitive: true,
    migration_sensitive: true,
    browser_runtime_sensitive: false,
  });
  assert.deepEqual(classifyChangedFiles(["electron-builder.nsis.cjs"]), {
    installer_sensitive: true,
    migration_sensitive: true,
    browser_runtime_sensitive: false,
  });
  assert.deepEqual(classifyChangedFiles(["scripts/windows-squirrel-m3-migration.ps1"]), {
    installer_sensitive: true,
    migration_sensitive: true,
    browser_runtime_sensitive: false,
  });
  assert.deepEqual(classifyChangedFiles(["scripts/review-workspace-version.contract.test.mjs"]), {
    installer_sensitive: true,
    migration_sensitive: false,
    browser_runtime_sensitive: false,
  });
  assert.deepEqual(classifyChangedFiles(["public/brand/recall/app/recall.ico"]), {
    installer_sensitive: true,
    migration_sensitive: false,
    browser_runtime_sensitive: true,
  });
});

test("workflow, dependency, empty, malformed, and unknown inputs fail safe", () => {
  assert.deepEqual(classifyChangedFiles([".github/workflows/ci.yml"]), allGates(true));
  assert.deepEqual(classifyChangedFiles(["package-lock.json"]), allGates(true));
  assert.deepEqual(classifyChangedFiles([]), allGates(true));
  assert.deepEqual(classifyChangedFiles(["config/unknown-sensitive.toml"]), allGates(true));
  assert.deepEqual(classifyChangedFiles(["fixtures/notes.md"]), allGates(true));
  assert.deepEqual(classifyChangedFiles(["scripts/template.css"]), allGates(true));
  assert.deepEqual(classifyChangedFiles(["../README.md"]), allGates(true));
  assert.deepEqual(classifyChangedFiles([null]), allGates(true));
});

test("the CLI emits stable outputs for NUL-delimited git path input", () => {
  const output = execFileSync(process.execPath, [classifierPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
    input: "README.md\0",
  });
  assert.equal(output, "installer_sensitive=false\nmigration_sensitive=false\nbrowser_runtime_sensitive=false\n");
});

test("PR concurrency is isolated by pull request and only PR runs cancel", () => {
  const document = workflowDocument();
  assert.deepEqual(document.concurrency, {
    group: "ci-${{ github.event.pull_request.number || github.ref }}",
    "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
  });
});

test("classification reuses the existing private PR checkout and publishes job outputs", () => {
  const job = record(workflowJobs()["private-release-checkout"], "private release checkout job");
  assert.deepEqual(Object.keys(record(job.outputs, "classification outputs")).sort(), [
    "browser_runtime_sensitive",
    "installer_sensitive",
    "migration_sensitive",
  ]);
  const steps = job.steps;
  assert.ok(Array.isArray(steps), "private release checkout steps must be an array");
  const classifyStep = steps.find((step) => step.id === "classify");
  assert.ok(classifyStep, "classification step is missing");
  assert.match(String(classifyStep.run), /git diff --name-only --diff-filter=ACMRTUXBD -z/);
  assert.match(String(classifyStep.run), /git show.*PR_BASE_SHA.*scripts\/classify-ci-changes\.mjs/);
  assert.match(String(classifyStep.run), /cannot change its own gate policy/);
  assert.match(String(classifyStep.run), /scripts\/classify-ci-changes\.mjs/);
  assert.equal(classifyStep.env.PR_BASE_SHA, "${{ github.event.pull_request.base.sha }}");
  assert.equal(classifyStep.env.PR_HEAD_SHA, "${{ github.event.pull_request.head.sha }}");
});

test("main keeps the full validation matrix while PR heavyweight jobs are gated", () => {
  const document = workflowDocument();
  const triggers = record(document.on, "workflow triggers");
  const push = record(triggers.push, "push trigger");
  assert.ok(Array.isArray(push.branches) && push.branches.includes("main"), "main push trigger is required");

  const jobs = workflowJobs();
  assert.equal(jobs.static.if, undefined, "static validation must run on main");
  assert.equal(jobs.security.if, undefined, "production audit must run on main");
  assert.equal(jobs.build.needs, "static");
  assert.match(JSON.stringify(jobs.build.steps), /check:bundle/);

  const e2e = record(jobs.e2e, "E2E job");
  assert.deepEqual(e2e.strategy.matrix.project, ["chromium", "chromium-mobile"]);
  assert.match(String(e2e.if), /github\.event_name != 'pull_request'/);
  assert.match(String(e2e.if), /needs\.build\.result == 'success'/);
  assert.match(String(e2e.if), /browser_runtime_sensitive == 'true'/);

  const m3 = record(jobs["windows-m3"], "Windows M3 job");
  const nsis = record(jobs["windows-nsis-m1"], "Windows NSIS job");
  for (const [job, output] of [[m3, "migration_sensitive"], [nsis, "installer_sensitive"]]) {
    assert.equal(job.needs, "private-release-checkout");
    assert.match(String(job.if), /always\(\)/);
    assert.match(String(job.if), new RegExp(`needs\\.private-release-checkout\\.outputs\\.${output} == 'true'`));
    assert.match(String(job.if), /needs\.private-release-checkout\.result != 'success'/);
    assert.match(String(job.if), /github\.event_name == 'pull_request'/);
  }
});

test("Windows exact-head and NSIS unsigned contracts remain in the gated jobs", () => {
  const jobs = workflowJobs();
  for (const jobId of ["windows-m3", "windows-nsis-m1"]) {
    const job = record(jobs[jobId], `${jobId} job`);
    const source = JSON.stringify(job);
    assert.match(source, /github\.event\.pull_request\.head\.sha/);
    assert.match(source, /persist-credentials":false/);
    assert.match(source, /node-version":"24\.20\.0/);
  }
  assert.match(JSON.stringify(jobs["windows-nsis-m1"]), /CSC_IDENTITY_AUTO_DISCOVERY":"false"/);
  assert.match(JSON.stringify(jobs["windows-nsis-m1"]), /desktop:builder:nsis:unpacked/);
  assert.match(JSON.stringify(jobs["windows-nsis-m1"]), /desktop:builder:nsis:bundle/);
  assert.match(JSON.stringify(jobs["windows-nsis-m1"]), /test:desktop:builder:nsis:source/);
  assert.match(JSON.stringify(jobs["windows-nsis-m1"]), /test:desktop:builder:nsis:artifact/);
});

test("trusted desktop release workflow remains byte-identical and exact-SHA based", () => {
  assert.match(trustedRelease, /workflow_run:/);
  assert.match(trustedRelease, /workflow_run\.event == 'push'/);
  assert.match(trustedRelease, /workflow_run\.head_branch == 'main'/);
  assert.match(trustedRelease, /workflow_run\.head_sha/);
  assert.match(trustedRelease, /--draft/);
});
