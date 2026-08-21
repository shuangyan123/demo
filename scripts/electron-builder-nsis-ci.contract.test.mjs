import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

test("M1 Windows CI independently rebuilds and reads back the exact PR-head candidate", () => {
  const job = workflow.match(/  windows-nsis-m1:[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:|$)/)?.[0];
  assert.ok(job, "Windows NSIS M1 job is missing");
  assert.match(job, /name: Windows NSIS Candidate/);
  assert.match(job, /if: github\.event_name == 'pull_request'/);
  assert.match(job, /runs-on: windows-latest/);
  assert.match(job, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(job, /M1_SOURCE_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(job, /git rev-parse HEAD/);
  assert.match(job, /node-version: 22\.23\.1/);
  assert.match(job, /npm ci/);
  assert.match(job, /npm run audit:prod/);
  assert.match(job, /npm run desktop:prepare/);
  assert.match(job, /npm run desktop:builder:nsis:unpacked/);
  assert.match(job, /npm run desktop:builder:nsis:bundle/);
  assert.match(job, /npm run test:desktop:builder:nsis:source/);
  assert.match(job, /npm run generate:desktop:builder:nsis:evidence/);
  assert.match(job, /npm run test:desktop:builder:nsis:artifact/);
  assert.match(job, /review-workspace-nsis-m1-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(job, /retention-days: 7/);
  assert.match(job, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.doesNotMatch(job, /release create|workflow_dispatch|tags:/);
});
