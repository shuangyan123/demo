import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const expectedNodeVersion = "24.20.0";
const expectedNodeArchiveSha256 = "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba";
const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(workspaceRoot, "package-lock.json"), "utf8"));
const runtimeSource = readFileSync(resolve(workspaceRoot, "scripts", "prepare-desktop-runtime.mjs"), "utf8");
const workflowPaths = [
  resolve(workspaceRoot, ".github", "workflows", "ci.yml"),
  resolve(workspaceRoot, ".github", "workflows", "trusted-desktop-release.yml"),
];

test("repository host and type contracts are pinned to Node 24", () => {
  assert.equal(packageJson.engines?.node, ">=24 <25");
  assert.equal(packageJson.devDependencies?.["@types/node"], "^24.13.3");
  assert.equal(packageLock.packages?.[""]?.engines?.node, ">=24 <25");
  assert.match(packageLock.packages?.["node_modules/@types/node"]?.version ?? "", /^24\./);
  assert.equal(readFileSync(resolve(workspaceRoot, ".nvmrc"), "utf8").trim(), expectedNodeVersion);
  assert.equal(readFileSync(resolve(workspaceRoot, ".node-version"), "utf8").trim(), expectedNodeVersion);
});

test("packaged desktop runtime source is exactly pinned and integrity checked", () => {
  assert.match(runtimeSource, /const nodeVersion = "24\.20\.0";/);
  assert.match(runtimeSource, /const nodeArchive = `node-v\$\{nodeVersion\}-win-x64\.zip`;/);
  assert.match(runtimeSource, new RegExp(`const nodeArchiveSha256 = "${expectedNodeArchiveSha256}";`));
  assert.match(runtimeSource, /https:\/\/nodejs\.org\/dist\/v\$\{nodeVersion\}\/\$\{nodeArchive\}/);
  assert.match(runtimeSource, /hashFile\(archivePath\) !== nodeArchiveSha256/);
});

test("active CI and trusted release workflows use the exact Node 24 acceptance pin", () => {
  for (const workflowPath of workflowPaths) {
    const workflow = readFileSync(workflowPath, "utf8");
    const versions = [...workflow.matchAll(/node-version:\s*([^\s#]+)/g)].map((match) => match[1]);
    assert.ok(versions.length > 0, `${workflowPath} has no setup-node version`);
    assert.deepEqual([...new Set(versions)], [expectedNodeVersion]);
    assert.doesNotMatch(workflow, /node-version:\s*22(?:\.\d+\.\d+)?/);
  }
});
