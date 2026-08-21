import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertNsisCandidateEvidence,
  collectNsisCandidateEvidence,
  getNsisCandidatePaths,
} from "./electron-builder-nsis-evidence.mjs";

const artifactRequired = process.env.DESKTOP_BUILDER_NSIS_ARTIFACT_REQUIRED === "1";
const { outputRoot } = getNsisCandidatePaths();

test("M1 artifact evidence is a fresh readback of the exact Windows candidate", async (t) => {
  if (!artifactRequired) {
    t.skip("set DESKTOP_BUILDER_NSIS_ARTIFACT_REQUIRED=1 after building the M1 candidate");
    return;
  }

  assert.equal(process.platform, "win32", "M1 artifact readback requires Windows");
  const recorded = JSON.parse(readFileSync(join(outputRoot, "candidate-evidence.json"), "utf8"));
  const actual = await collectNsisCandidateEvidence();
  assertNsisCandidateEvidence(actual);
  assert.deepEqual(actual, recorded, "candidate-evidence.json does not match a fresh artifact readback");
});
