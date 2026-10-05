import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { JSON_SCHEMA, load } from "js-yaml";
import ts from "typescript";
import { CI_CHANGE_GATES, PURE_RECALL_CONTRACT_PATHS, classifyChangedFiles } from "./classify-ci-changes.mjs";

const workspaceRoot = process.cwd();
const classifierPath = resolve(workspaceRoot, "scripts", "classify-ci-changes.mjs");
const ciPath = resolve(workspaceRoot, ".github", "workflows", "ci.yml");
const trustedReleasePath = resolve(workspaceRoot, ".github", "workflows", "trusted-desktop-release.yml");
const draftReleaseRoundTripPath = resolve(workspaceRoot, "scripts", "verify-draft-release-roundtrip.mjs");
const ci = readFileSync(ciPath, "utf8");
const trustedRelease = readFileSync(trustedReleasePath, "utf8");
const draftReleaseRoundTrip = readFileSync(draftReleaseRoundTripPath, "utf8");

function allGates(value) {
  return {
    installer_sensitive: value,
    migration_sensitive: value,
    browser_runtime_sensitive: value,
    windows_runtime_sensitive: value,
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
    windows_runtime_sensitive: false,
  });
  assert.deepEqual(classifyChangedFiles(["app/globals.css"]), {
    installer_sensitive: false,
    migration_sensitive: false,
    browser_runtime_sensitive: true,
    windows_runtime_sensitive: false,
  });
});

test("desktop and installer changes enable the appropriate desktop gates", () => {
  assert.deepEqual(classifyChangedFiles(["desktop/main.ts"]), {
    installer_sensitive: true,
    migration_sensitive: true,
    browser_runtime_sensitive: false,
    windows_runtime_sensitive: true,
  });
  assert.deepEqual(classifyChangedFiles(["electron-builder.nsis.cjs"]), {
    installer_sensitive: true,
    migration_sensitive: true,
    browser_runtime_sensitive: false,
    windows_runtime_sensitive: true,
  });
  assert.deepEqual(classifyChangedFiles(["scripts/windows-squirrel-m3-migration.ps1"]), {
    installer_sensitive: true,
    migration_sensitive: true,
    browser_runtime_sensitive: false,
    windows_runtime_sensitive: true,
  });
  assert.deepEqual(classifyChangedFiles(["scripts/review-workspace-version.contract.test.mjs"]), {
    installer_sensitive: true,
    migration_sensitive: false,
    browser_runtime_sensitive: false,
    windows_runtime_sensitive: true,
  });
  assert.deepEqual(classifyChangedFiles(["public/brand/recall/app/recall.ico"]), {
    installer_sensitive: true,
    migration_sensitive: false,
    browser_runtime_sensitive: true,
    windows_runtime_sensitive: true,
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

test("only exact pure Recall contracts avoid environmental gates, including mixed documentation", () => {
  for (const file of PURE_RECALL_CONTRACT_PATHS) {
    assert.ok(existsSync(resolve(workspaceRoot, file)), `${file} must be an audited existing file`);
    assert.deepEqual(classifyChangedFiles([file]), allGates(false), file);
    assert.deepEqual(classifyChangedFiles([file, "docs/recall-kernel-architecture.md"]), allGates(false), file);
  }
  assert.deepEqual(classifyChangedFiles([
    "app/services/learning-kernel/derive-learner-state.ts", "app/features/review/review-workspace.tsx",
  ]), { ...allGates(false), browser_runtime_sensitive: true });
  for (const file of [
    "app/services/learning-kernel/compatibility-snapshot.ts",
    "app/services/learning-kernel/learning-event.ts",
    "app/services/learning-kernel/derive-evidence.ts",
    "app/services/learning-kernel/evidence-policy.ts",
    "app/services/learning-kernel/legacy-event-adapter.ts",
    "app/services/learning-kernel/verified-assessment-adapter.ts",
    "app/services/learning-kernel/new-consumer.ts",
    "app/types/domains/review.ts",
  ]) {
    const result = classifyChangedFiles([file]);
    assert.equal(result.browser_runtime_sensitive, true, file);
    assert.equal(result.windows_runtime_sensitive, true, file);
  }
});

test("Windows risks include shared storage, credentials, Host consumers and Windows scripts", () => {
  for (const file of [
    "app/platform/desktop/desktop-host-adapter.ts", "app/platform/credential-protection.ts",
    "app/db/index.ts", "app/services/credential-backend.ts", "app/services/obsidian-vault-adapter.ts",
    "app/features/settings/use-desktop-credential-migration.ts", "app/features/fenbi/fenbi-workspace.tsx",
    "app/features/shared/workspace-shell.tsx", "app/features/shared/use-desktop-titlebar-theme.ts",
    "app/types/review-desktop.d.ts", "scripts/read-windows-authenticode-signature.ps1",
    "scripts/windows-future-storage.ps1", "e2e/settings.spec.ts",
  ]) assert.equal(classifyChangedFiles([file]).windows_runtime_sensitive, true, file);
  for (const file of [
    "package.json", "package-lock.json", ".github/workflows/ci.yml", "app/unclassified/new.ts",
    "playwright.config.ts", "next.config.ts", "postcss.config.mjs", "tailwind.config.ts",
    "scripts/read-windows-authenticode-signature.ps1", "scripts/windows-future-storage.ps1",
    "scripts/release-artifact-provenance.mjs", "scripts/finalize-release-artifact.mjs", "scripts/verify-release-artifact.mjs",
    "scripts/new-storage-helper.mjs", "scripts/classify-ci-changes.mjs",
    "scripts/ci-cost-classification.contract.test.mjs", "app/features/performance/architecture-boundary.contract.test.ts",
    "app/services/learning-kernel/unknown-module.ts", "app/services/verification-source/new-owner.ts",
    "app/services/learning-kernel/../learning-kernel/derive-learner-state.ts",
    "app/services/learning-kernel//derive-learner-state.ts",
    "App/services/learning-kernel/derive-learner-state.ts",
  ]) assert.deepEqual(classifyChangedFiles([file]), allGates(true), file);
});

function runtimeSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSources(file);
    return /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(file) && !/\.test\.[^/\\]+$/.test(file) ? [file] : [];
  });
}

function runtimeImports(file, source) {
  const imports = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const inspect = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings
        && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every((item) => item.isTypeOnly));
      if (!typeOnly) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      imports.push(node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression))
      imports.push(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return imports;
}

test("pure source allowlist has no external runtime consumer, including transitive imports", () => {
  const safe = new Set(PURE_RECALL_CONTRACT_PATHS.filter((file) => !file.endsWith(".test.ts")).map((file) => resolve(workspaceRoot, file)));
  const files = ["app", "desktop", "scripts"].flatMap((directory) => runtimeSources(resolve(workspaceRoot, directory)));
  const graph = new Map(files.map((file) => [file, runtimeImports(file, readFileSync(file, "utf8")).map((specifier) =>
    (specifier.startsWith("@/") ? resolve(workspaceRoot, specifier.slice(2)) : resolve(dirname(file), specifier)).replace(/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/, ""))]));
  const byModule = new Map(files.map((file) => [file.replace(/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/, ""), file]));
  const visited = new Set();
  const visit = (file) => {
    assert.ok(!safe.has(file), `${file} has a runtime consumer and must leave the pure allowlist`);
    if (visited.has(file)) return;
    visited.add(file);
    for (const target of graph.get(file) ?? []) if (byModule.has(target)) visit(byModule.get(target));
  };
  for (const file of files) if (!safe.has(file)) visit(file);
  for (const file of safe) if (file.includes(`${join("types", "domains")}`)) {
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    assert.ok(ast.statements.every((node) => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)), `${file} must remain type-only`);
  }
});

test("production Host importers cannot silently become Linux-only", () => {
  for (const file of runtimeSources(resolve(workspaceRoot, "app"))) {
    if (runtimeImports(file, readFileSync(file, "utf8")).some((specifier) => /(?:^|\/)platform\//.test(specifier)))
      assert.equal(classifyChangedFiles([file.slice(workspaceRoot.length + 1)]).windows_runtime_sensitive, true, file);
  }
});

function gateRuns(jobId, event, gates, result = "success", buildResult = "success") {
  const job = workflowJobs()[jobId];
  const outputs = Object.fromEntries(Object.entries(gates).map(([key, value]) => [key, String(value)]));
  return runInNewContext(String(job.if).replaceAll("needs.private-release-checkout", 'needs["private-release-checkout"]'), {
    github: { event_name: event }, always: () => true,
    needs: { "private-release-checkout": { result, outputs }, build: { result: buildResult } },
  });
}

test("actual job expressions separate PR classification from main push, failing safe on missing outputs", () => {
  const jobs = ["e2e", "windows-e2e", "windows-m3", "windows-nsis-production"];
  const cases = [
    [["docs/architecture.md"], []],
    [["app/services/learning-kernel/derive-learner-state.ts"], []],
    [["app/services/verification-source/verification-source-admission.ts"], []],
    [["app/features/shared/ui-primitives.tsx"], ["e2e"]],
    [["desktop/preload.cts"], ["windows-e2e", "windows-nsis-production"]],
    [["electron-builder.nsis.cjs"], ["windows-e2e", "windows-m3", "windows-nsis-production"]],
    [["package.json"], jobs], [[".github/workflows/ci.yml"], jobs], [["app/unknown.ts"], jobs],
    [["playwright.config.ts"], jobs], [["next.config.ts"], jobs],
    [["scripts/read-windows-authenticode-signature.ps1"], jobs],
    [["scripts/release-artifact-provenance.mjs"], jobs],
    [["app/services/learning-kernel/derive-learner-state.ts", "app/features/shared/ui-primitives.tsx"], ["e2e"]],
  ];
  for (const [files, expected] of cases) {
    const gates = classifyChangedFiles(files);
    assert.deepEqual(jobs.filter((job) => gateRuns(job, "pull_request", gates)), expected, files.join(", "));
    for (const job of jobs) assert.equal(gateRuns(job, "push", gates), false, `main push: ${job}`);
  }
  for (const job of jobs) {
    assert.equal(gateRuns(job, "pull_request", {}), true, `missing outputs: ${job}`);
    assert.equal(gateRuns(job, "pull_request", allGates(false), "failure"), true, `classifier failure: ${job}`);
    assert.equal(gateRuns(job, "pull_request", allGates(false), "skipped"), true, `classifier skipped: ${job}`);
  }
  assert.equal(gateRuns("e2e", "pull_request", allGates(true), "success", "failure"), false);
});

test("combined Linux E2E preserves both projects, CI worker/reporter and failure evidence with one setup", () => {
  const job = workflowJobs().e2e;
  assert.equal(job.env.CI, "1");
  assert.equal(job.strategy, undefined);
  for (const command of ["npm ci", "npm run build", "npx playwright install --with-deps chromium", "npm run test:e2e"])
    assert.equal(job.steps.filter((step) => step.run === command).length, 1, command);
  const upload = job.steps.find((step) => step.name === "Upload Playwright evidence");
  assert.equal(upload.if, "failure()");
  assert.equal(upload.with.path, ".playwright-results");
  assert.equal(upload.with["include-hidden-files"], true);
  const playwright = readFileSync(resolve(workspaceRoot, "playwright.config.ts"), "utf8");
  assert.match(playwright, /workers: process\.env\.CI \? 1 : 4/);
  assert.match(playwright, /reporter: process\.env\.CI \? "github" : "list"/);
  assert.match(playwright, /testIgnore:.*mobile.*spec/);
  assert.match(playwright, /testMatch:.*mobile.*spec/);
  assert.match(playwright, /width: 390, height: 844/);
  assert.doesNotMatch(JSON.stringify(job), /continue-on-error|--project|--max-failures/);
});

test("security runs the unchanged lockfile audit without installing node_modules", () => {
  const job = workflowJobs().security;
  assert.equal(job.steps.length, 3);
  assert.equal(job.steps[0].uses, "actions/checkout@v5");
  assert.equal(job.steps[1].with["node-version"], "24.20.0");
  assert.equal(job.steps[2].run, "npm run audit:prod");
  const audit = readFileSync(resolve(workspaceRoot, "scripts/audit-production.mjs"), "utf8");
  assert.ok([...audit.matchAll(/from "([^"]+)"/g)].every((match) => match[1].startsWith("node:")));
  assert.match(audit, /"high", "critical"/);
  assert.doesNotMatch(JSON.stringify(job), /npm ci|npm install|continue-on-error/);
});

test("trusted-base shell rejects old, missing and malformed classifiers without trusting PR policy", async (t) => {
  const script = workflowJobs()["private-release-checkout"].steps.find((step) => step.id === "classify").run.replaceAll("\r\n", "\n");
  const bash = process.platform === "win32"
    ? resolve(dirname(execFileSync("where.exe", ["git"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]), "..", "bin", "bash.exe")
    : "bash";
  const rows = (gates) => CI_CHANGE_GATES.map((gate) => `${gate}=${gates[gate]}\n`).join("");
  const cli = (output) => `process.stdout.write(${JSON.stringify(output)});\n`;
  const scenarios = [
    { name: "trusted base wins over PR classifier", source: readFileSync(classifierPath, "utf8"), expected: allGates(true), changed: "package.json" },
    { name: "trusted docs-only classification", source: readFileSync(classifierPath, "utf8"), expected: allGates(false), changed: "README.md", keepPolicy: true },
    { name: "old three-output base safely boots the fourth gate", source: cli("installer_sensitive=false\nmigration_sensitive=false\nbrowser_runtime_sensitive=false\n"), expected: allGates(true) },
    { name: "unreadable base revision", source: cli(rows(allGates(false))), expected: allGates(true), missingBase: true },
    { name: "missing base classifier", expected: allGates(true) },
    { name: "classifier exception", source: 'throw new Error("fixture failure");\n', expected: allGates(true) },
    { name: "duplicate output with missing gate", source: cli("installer_sensitive=false\ninstaller_sensitive=false\nmigration_sensitive=false\nbrowser_runtime_sensitive=false\n"), expected: allGates(true) },
    { name: "invalid boolean", source: cli(rows({ ...allGates(false), windows_runtime_sensitive: "unknown" })), expected: allGates(true) },
    { name: "extra output", source: cli(rows(allGates(false)) + "extra=false\n"), expected: allGates(true) },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, (child) => {
    const root = mkdtempSync(join(tmpdir(), "ci-trusted-base-"));
    child.after(() => rmSync(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init");
    git("config", "user.name", "CI contract");
    git("config", "user.email", "ci-contract@example.invalid");
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "README.md"), "base\n");
    if (scenario.source) writeFileSync(join(root, "scripts", "classify-ci-changes.mjs"), scenario.source);
    git("add", ".");
    git("commit", "-m", "trusted base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(root, scenario.changed ?? "README.md"), "PR change\n");
    // PR 中的 classifier 永远声明 safe，用于证明它没有获得自我降门禁权限。
    if (!scenario.keepPolicy) writeFileSync(join(root, "scripts", "classify-ci-changes.mjs"), cli(rows(allGates(false))));
    git("add", ".");
    git("commit", "-m", "PR changes");
    const outputPath = join(root, "outputs");
    execFileSync(bash, ["-e", "-o", "pipefail", "-c", script], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PR_BASE_SHA: scenario.missingBase ? "0".repeat(40) : base,
        PR_HEAD_SHA: git("rev-parse", "HEAD"), GITHUB_OUTPUT: outputPath },
    });
    assert.equal(readFileSync(outputPath, "utf8"), rows(scenario.expected));
  });
});

test("the CLI emits stable outputs for NUL-delimited git path input", () => {
  const output = execFileSync(process.execPath, [classifierPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
    input: "README.md\0",
  });
  assert.equal(output, "installer_sensitive=false\nmigration_sensitive=false\nbrowser_runtime_sensitive=false\nwindows_runtime_sensitive=false\n");
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
    "windows_runtime_sensitive",
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

test("main keeps correctness, audit and build while environmental gates run only on PRs", () => {
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
  assert.equal(e2e.strategy, undefined);
  assert.match(String(e2e.if), /github\.event_name == 'pull_request'/);
  assert.match(String(e2e.if), /needs\.build\.result == 'success'/);
  assert.match(String(e2e.if), /browser_runtime_sensitive != 'false'/);

  const windowsE2e = record(jobs["windows-e2e"], "Windows full E2E job");
  assert.equal(windowsE2e.name, "Windows Full E2E (Node 24.20.0)");
  assert.equal(windowsE2e["runs-on"], "windows-latest");
  assert.equal(windowsE2e.needs, "private-release-checkout");
  assert.match(String(windowsE2e.if), /github\.event_name == 'pull_request'/);
  assert.match(String(windowsE2e.if), /always\(\)/);
  assert.match(String(windowsE2e.if), /windows_runtime_sensitive != 'false'/);
  assert.doesNotMatch(String(windowsE2e.if), /browser_runtime_sensitive/);
  assert.match(String(windowsE2e.if), /installer_sensitive != 'false'/);
  assert.match(String(windowsE2e.if), /needs\.private-release-checkout\.result != 'success'/);

  const m3 = record(jobs["windows-m3"], "Windows M3 job");
  const nsis = record(jobs["windows-nsis-production"], "Windows NSIS job");
  for (const [job, output] of [[m3, "migration_sensitive"], [nsis, "installer_sensitive"]]) {
    assert.equal(job.needs, "private-release-checkout");
    assert.match(String(job.if), /always\(\)/);
    assert.match(String(job.if), new RegExp(`needs\\.private-release-checkout\\.outputs\\.${output} != 'false'`));
    assert.match(String(job.if), /needs\.private-release-checkout\.result != 'success'/);
    assert.match(String(job.if), /github\.event_name == 'pull_request'/);
  }
});

test("Windows exact-head and NSIS unsigned contracts remain in the gated jobs", () => {
  const jobs = workflowJobs();
  for (const jobId of ["windows-m3", "windows-e2e", "windows-nsis-production"]) {
    const job = record(jobs[jobId], `${jobId} job`);
    const source = JSON.stringify(job);
    assert.match(source, /github\.event\.pull_request\.head\.sha/);
    assert.match(source, /persist-credentials":false/);
    assert.match(source, /node-version":"24\.20\.0/);
  }
  const windowsE2e = record(jobs["windows-e2e"], "Windows full E2E job");
  assert.equal(windowsE2e.env.CI, "1");
  const windowsE2eSource = JSON.stringify(windowsE2e);
  assert.match(windowsE2eSource, /npm ci/);
  assert.match(windowsE2eSource, /npm run build/);
  assert.match(windowsE2eSource, /npx playwright install chromium/);
  assert.match(windowsE2eSource, /CI=1/);
  assert.match(windowsE2eSource, /npm run test:e2e/);
  assert.match(windowsE2eSource, /include-hidden-files":true/);
  assert.doesNotMatch(windowsE2eSource, /retries:|continue-on-error:|test\.skip|test\.fixme/);
  assert.match(JSON.stringify(jobs["windows-nsis-production"]), /CSC_IDENTITY_AUTO_DISCOVERY":"false"/);
  assert.match(JSON.stringify(jobs["windows-nsis-production"]), /desktop:builder:nsis:unpacked/);
  assert.match(JSON.stringify(jobs["windows-nsis-production"]), /desktop:builder:nsis:bundle/);
  assert.match(JSON.stringify(jobs["windows-nsis-production"]), /test:desktop:builder:nsis:source/);
  assert.match(JSON.stringify(jobs["windows-nsis-production"]), /test:desktop:builder:nsis:artifact/);
});

test("trusted desktop release workflow remains exact-SHA based and delegates Draft round-trip safety", () => {
  assert.match(trustedRelease, /workflow_run:/);
  assert.match(trustedRelease, /workflow_run\.event == 'push'/);
  assert.match(trustedRelease, /workflow_run\.head_branch == 'main'/);
  assert.match(trustedRelease, /workflow_run\.head_sha/);
  assert.match(trustedRelease, /out\/release-canonical/);
  assert.match(trustedRelease, /out\/release-roundtrip/);
  assert.match(trustedRelease, /verify-draft-release-roundtrip\.mjs/);
  assert.match(draftReleaseRoundTrip, /["']release["'],\s*["']create["']/);
  assert.match(draftReleaseRoundTrip, /--draft/);
  assert.match(draftReleaseRoundTrip, /--verify-tag/);
  assert.doesNotMatch(draftReleaseRoundTrip, /--clobber/);
});
