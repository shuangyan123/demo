import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertNsisProductionEvidence,
  collectNsisProductionEvidence,
  getNsisProductionPaths,
} from "./electron-builder-nsis-evidence.mjs";

const artifactRequired = process.env.DESKTOP_BUILDER_NSIS_ARTIFACT_REQUIRED === "1";
const { outputRoot } = getNsisProductionPaths();

test("production NSIS artifact evidence is a fresh readback of the exact Windows artifact", async (t) => {
  if (!artifactRequired) {
    t.skip("set DESKTOP_BUILDER_NSIS_ARTIFACT_REQUIRED=1 after building the production NSIS artifact");
    return;
  }

  assert.equal(process.platform, "win32", "production NSIS artifact readback requires Windows");
  const recorded = JSON.parse(readFileSync(join(outputRoot, "production-evidence.json"), "utf8"));
  const actual = await collectNsisProductionEvidence();
  assertNsisProductionEvidence(actual);
  assert.deepEqual(actual, recorded, "production-evidence.json does not match a fresh artifact readback");
});
