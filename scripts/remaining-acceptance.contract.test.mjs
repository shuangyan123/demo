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
  assert.equal(policy.sourceCommit, "264bb1193b8b01b2aaa298df740b52bce288c08f");
  assert.equal(policy.runId, 39200193208);
  assert.equal(policy.artifactId, 12163412765);
  assert.equal(policy.artifactDigest, "3cc3a4efc3879dd18689ae0e5056f7e56d8b4cb302b4289c6c5b0c4d04c917b1");
  assert.equal(policy.installerSha256, "a31591ba9ca922a788e56c521f2e267b5337a7533468b00251891354e8bfd611");
  assert.equal(policy.label, "recall-install-acceptance-264bb11");
});

if (process.platform === "win32") test("both native scripts refuse execution outside GitHub-hosted Windows before creating a directory", () => {
  for (const script of ["download-install-acceptance.ps1", "windows-nsis-install-acceptance.ps1"]) {
    assert.throws(() => execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", `scripts/${script}`], { env: { ...process.env, GITHUB_ACTIONS: "false" }, encoding: "utf8", stdio: "pipe" }), error => /Hosted Windows runner only/.test(error.stderr));
  }
});

if (process.platform === "win32") test("artifact ZIP requests use JSON negotiation while release assets explicitly use octet-stream", () => {
  // 只提取下载函数并注入无网络 fake；绝不执行安装或整段 hosted 脚本。
  const command = `$ErrorActionPreference='Stop'; $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/download-install-acceptance.ps1'),[ref]$null,[ref]$null); $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Save-Artifact'},$true); Invoke-Expression $fn.Extent.Text; $headers=@{Accept='application/vnd.github+json'}; $script:seen=@(); function Invoke-WebRequest {param($Headers,$Uri,$OutFile,$TimeoutSec) $script:seen+=,$Headers.Accept}; function Get-FileHash {param($LiteralPath,$Algorithm) @{Hash='ABC'}}; Save-Artifact 'https://api.github.com/repos/owned/repo/actions/artifacts/1/zip' 'unused' 'abc'; Save-Artifact 'https://api.github.com/repos/owned/repo/releases/assets/1' 'unused' 'abc' 'application/octet-stream'; ConvertTo-Json -InputObject $script:seen -Compress`;
  const result = execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), ["application/vnd.github+json", "application/octet-stream"]);
});

if (process.platform === "win32") test("registry discovery handles empty keys and absent optional values under strict mode without touching the host registry", () => {
  const command = `$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest; $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/windows-nsis-install-acceptance.ps1'),[ref]$null,[ref]$null); $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Registry-Entries'},$true); Invoke-Expression $fn.Extent.Text; function Get-ChildItem {param($Path,$ErrorAction) @('empty','null','ordinary','recall')|ForEach-Object {[pscustomobject]@{PSPath=$_}}}; function Get-ItemProperty {param($LiteralPath) switch($LiteralPath){empty{[pscustomobject]@{}} null{$null} ordinary{[pscustomobject]@{DisplayName='Other App'}} recall{[pscustomobject]@{DisplayName='ReviewWorkspace'}}}}; $entries=@(Registry-Entries); if($entries.Count -ne 4){throw 'Expected one fixture per hive/view'}; if(@($entries|Where-Object {$_.values.DisplayVersion -ne '' -or $_.values.InstallLocation -ne ''}).Count){throw 'Optional values must normalize'}; 'PASS'`;
  assert.equal(execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }).trim(), "PASS");
});

if (process.platform === "win32") test("installation location is read from the independent NSIS application key and missing location fails", () => {
  const command = `$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest; $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/windows-nsis-install-acceptance.ps1'),[ref]$null,[ref]$null); $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Installation-Registry'},$true); Invoke-Expression $fn.Extent.Text; $guid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; $record=[pscustomobject]@{key=('Microsoft.PowerShell.Core\\Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$guid);hive='HKCU:'}; $script:missing=$false; function Get-ItemProperty {param($LiteralPath,$ErrorAction) if($LiteralPath -ne ('HKCU:\\Software\\'+$guid)){throw 'Wrong registry branch'}; if($script:missing){[pscustomobject]@{}}else{[pscustomobject]@{InstallLocation='D:\\owned\\installed'}}}; $r=Installation-Registry $record; if($r.location -ne 'D:\\owned\\installed'){throw 'Wrong installation location'}; $script:missing=$true; $failed=$false; try{Installation-Registry $record}catch{if($_.Exception.Message -eq 'Missing application installation location'){$failed=$true}else{throw}}; if(-not $failed){throw 'Missing location must fail'}; 'PASS'`;
  assert.equal(execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }).trim(), "PASS");
});

if (process.platform === "win32") test("installed-file identity uses an existing file handle and rejects nonexistent targets", () => {
  const command = `$ErrorActionPreference='Stop'; $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'scripts/windows-nsis-install-acceptance.ps1'),[ref]$null,[ref]$null); $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Resolve-Installed-File'},$true); Invoke-Expression $fn.Extent.Text; $exe=(Get-Command node.exe).Source; $same=Join-Path (Split-Path $exe) './node.exe'; if((Resolve-Installed-File $exe) -ne (Resolve-Installed-File $same)){throw 'Equivalent existing paths must identify the same file'}; $failed=$false; try{Resolve-Installed-File ($exe+'.not-present')}catch{$failed=$true}; if(-not $failed){throw 'Nonexistent targets cannot pass'}; 'PASS'`;
  assert.equal(execFileSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }).trim(), "PASS");
});

test("uninstall assertions precede fixture cleanup and cleanup cannot fake uninstall success", () => {
  const script = source("./windows-nsis-install-acceptance.ps1").replace(/\r\n/g, "\n");
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

test("hosted native consent probes the owned TaskDialog only and retains post-click lifecycle checks", () => {
  const script = source("./windows-nsis-install-acceptance.ps1");
  assert.doesNotMatch(script, /LegacyIAccessiblePattern/);
  assert.match(script, /ClassName -ne 'CCPushButton'/);
  // Do not compare the UIA provider's ClassName to the actual Win32 HWND class.
  assert.doesNotMatch(script, /className\.ToString\(\) == "CCPushButton"/);
  assert.match(script, /native HWND class unreadable/);
  assert.match(script, /Owned native confirmation HWND class \(diagnostic\)/);
  assert.match(script, /buttonPid == \(uint\)expectedPid/);
  assert.match(script, /dialogPid == \(uint\)expectedPid/);
  assert.match(script, /title\.ToString\(\) == "创建本地学习资料"/);
  assert.match(script, /GetForegroundWindow\(\) == dialog/);
  assert.match(script, /WindowFromPoint/);
  assert.match(script, /Fresh-profile native confirmation exercised/);
  assert.match(script, /Installed workspace and synthetic storage/);
  assert.match(script, /Restart retains profile identity/);
  assert.match(script, /Uninstall-Fixed/);
});

test("CDP page discovery failure preserves synthetic-only target diagnostics", () => {
  const probe = source("./install-acceptance-cdp.mjs");
  assert.match(probe, /phase: "workspace-page-discovery"/);
  assert.match(probe, /successfulDiscoveryPolls, failedDiscoveryPolls/);
  assert.match(probe, /lastTargets: seenTargetKinds/);
  assert.doesNotMatch(probe, /lastTargets: targets/);
});

test("native helper preflight is wired before immutable artifact download and inside Windows CI", () => {
  const harness = source("./preflight-install-acceptance.ps1");
  assert.match(harness, /Add-Type -TypeDefinition/);
  assert.match(harness, /Native button helper failed to compile/);
  assert.doesNotMatch(harness, /Start-Process|Invoke-OwnedNativeButton\s+\$/);
  const workflow = load(source("../.github/workflows/recall-install-acceptance.yml"));
  const steps = workflow.jobs["fixed-install"].steps;
  const preflightIndex = steps.findIndex(step => step.run?.includes("./scripts/preflight-install-acceptance.ps1"));
  const downloadIndex = steps.findIndex(step => step.run?.includes("./scripts/download-install-acceptance.ps1"));
  assert.ok(preflightIndex > 0 && preflightIndex < downloadIndex);
  const ci = source("../.github/workflows/ci.yml");
  assert.match(ci.slice(ci.indexOf("  windows-m3:"),ci.indexOf("  build:")), /Compile native install-acceptance helper before hosted installation/);
  assert.match(source("./windows-nsis-install-acceptance.ps1"), /RECT buttonRect = default\(RECT\), dialogRect = default\(RECT\);/);
});

test("hosted full installation acceptance exercises native runtime publication, cancel/recreate and uninstall distinctly", () => {
  const script = source("./windows-nsis-install-acceptance.ps1").replace(/\r\n/g, "\n");
  const detector = source("./observe-install-acceptance-runtime.mjs");
  assert.match(script, /observe-install-acceptance-runtime\.mjs/);
  assert.match(script, /Electron Local State verified during owned native prompt/);
  assert.match(script, /'fresh-launch' \$true 'create' \$true/);
  assert.match(script, /'cancel-native' \$true 'cancel' \$true/);
  assert.match(script, /'create-after-cancel' \$true/);
  assert.match(script, /'restart-after-cancel' \$false/);
  assert.match(script, /Cancel creates no Recall identity/);
  assert.match(script, /Cancel creates no Recall bootstrap/);
  assert.match(script, /Cancel retains one Electron runtime profile/);
  assert.match(script, /Uninstall-Fixed\n  Clean-Synthetic-Data/);
  assert.match(detector, /RUNNER_ENVIRONMENT/);
  assert.match(detector, /RUNNER_OS/);
  assert.match(detector, /APPDATA/);
  assert.match(detector, /encrypted_key/);
  assert.match(detector, /installation_date2/);
  assert.match(detector, /fileWasAbsentWhenPromptOpened/);
  assert.match(detector, /already_present_at_observation/);
  assert.match(detector, /appeared_during_observation/);
  assert.match(detector, /initiallyPresent\.filter\(Boolean\)\.length > 1/);
  assert.doesNotMatch(detector, /if \(!fileWasAbsentWhenPromptOpened\) throw/);
  assert.doesNotMatch(detector, /JSON\.stringify\(.*(?:encrypted_key|readFileSync)/);
});
