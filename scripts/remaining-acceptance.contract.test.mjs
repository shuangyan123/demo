import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { indexedDB } from "fake-indexeddb";
import { load } from "js-yaml";
import { reviewDependencies } from "./dependency-risk-review.mjs";
import { storageExpression } from "./install-acceptance-cdp.mjs";

const source = file => readFileSync(new URL(file, import.meta.url), "utf8");
const workflow = load(source("../.github/workflows/recall-install-acceptance.yml"));
const policy = JSON.parse(source("./nsis-install-acceptance.json"));

test("install workflow uses a PR-only explicit trigger, fixed binary, one hosted runner and read permissions", () => {
  assert.deepEqual(workflow.on, { pull_request: { types: ["labeled"] } });
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  const job = workflow.jobs["fixed-install"];
  assert.equal(job["runs-on"], "windows-latest");
  assert.ok(job["timeout-minutes"] <= 20);
  assert.match(job.if, /number == 148/);
  assert.ok(job.if.includes(policy.label));
  assert.match(job.if, /head\.repo\.full_name == github.repository/);
  assert.match(job.if, /run_attempt == 1/);
  assert.equal(Object.keys(workflow.jobs).length, 1);
  assert.equal(job.steps.some(step => /npm ci|desktop:builder|--allusers|pull_request_target/.test(step.run ?? "")), false);
  assert.equal(policy.sourceCommit, "5c1e28c515b3779c1ddeb6030391f24201416f73");
  assert.equal(policy.installerSha256, "ad1b2e64c01247238dbd1323f969a1d31e876691d44a4b800da3c259cdf06a4f");
});

if (process.platform === "win32") test("both native scripts refuse execution outside GitHub-hosted Windows before creating a directory", () => {
  for (const script of ["download-install-acceptance.ps1", "windows-nsis-install-acceptance.ps1"]) {
    assert.throws(() => execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", `scripts/${script}`], { env: { ...process.env, GITHUB_ACTIONS: "false" }, encoding: "utf8", stdio: "pipe" }), error => /Hosted Windows runner only/.test(error.stderr));
  }
});

test("uninstall assertions precede fixture cleanup and cleanup cannot fake uninstall success", () => {
  const script = source("./windows-nsis-install-acceptance.ps1");
  assert.match(script, /Installer SHA256 rechecked immediately before execution/);
  assert.match(script, /\/S \/currentuser \/D=/);
  assert.match(script, /ReparsePoint/);
  assert.ok(script.indexOf("Uninstall-Fixed\n  Clean-Synthetic-Data") > 0);
  assert.doesNotMatch(script, /Remove-Item.*HKCU|Remove-Item.*HKLM|--delete-app-data|Verb RunAs/);
  assert.match(source("./download-install-acceptance.ps1"), /artifactDigest/);
  assert.match(source("./download-install-acceptance.ps1"), /Unexpected archive entries/);
});

test("synthetic browser storage survives separate contexts while read mode cannot synthesize missing records", async () => {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const context = () => vm.createContext({ indexedDB, localStorage, location: { origin: "review-app://workspace" }, document: { readyState: "complete", body: { innerText: "学习工作台".repeat(100) } } });
  const missing = await vm.runInContext(storageExpression("read"), context());
  assert.equal(missing.data, undefined);
  assert.equal(missing.config, null);
  const written = await vm.runInContext(storageExpression("write"), context());
  const retained = await vm.runInContext(storageExpression("read"), context());
  assert.deepEqual(JSON.parse(JSON.stringify(retained)), JSON.parse(JSON.stringify(written)));
  assert.equal(retained.data.count, 17);
  assert.throws(() => storageExpression("reset"));
});

const advisory = { source: 1, name: "tar", severity: "critical", range: "<=6.2.1", title: "Fixture archive traversal", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" };
const report = vulnerabilities => ({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: Object.keys(vulnerabilities).length, total: Object.keys(vulnerabilities).length } }, vulnerabilities });
const leaf = { severity: "critical", isDirect: false, via: [advisory], nodes: ["node_modules/tar"] };
test("risk review resolves inherited findings, records fixed packages and never grants acceptance", () => {
  const before = report({ tar: leaf, forge: { ...leaf, via: ["tar"], nodes: ["node_modules/forge"] } });
  const after = report({ tar: leaf });
  const result = reviewDependencies(before, after);
  assert.equal(result.riskAccepted, false);
  assert.equal(result.packages.find(p => p.package === "forge").status, "NO_LONGER_REPORTED");
  const active = result.packages.find(p => p.package === "tar");
  assert.equal(active.status, "UNRESOLVED_NOT_ACCEPTED");
  assert.equal(active.advisories[0].exposure, "downloaded-build-archive");
  assert.equal(active.severity, "critical");
});
test("new unclassified advisories, missing dependency edges and invalid audit responses fail closed", () => {
  assert.throws(() => reviewDependencies(report({ unknown: { ...leaf, via: [{ ...advisory, name: "unknown" }] } }), report({})), /Unclassified/);
  assert.throws(() => reviewDependencies(report({ parent: { ...leaf, via: ["absent"] } }), report({})), /Missing audit edge/);
  assert.throws(() => reviewDependencies({ error: { code: "E429" } }, report({})), /Invalid audit/);
  assert.throws(() => reviewDependencies({ ...report({}), vulnerabilities: [] }, report({})), /Invalid audit/);
  assert.throws(() => reviewDependencies({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }, report({})), /Invalid audit/);
  assert.throws(() => reviewDependencies(report({ cycle: { ...leaf, via: ["cycle"] } }), report({})), /Invalid finding/);
});
