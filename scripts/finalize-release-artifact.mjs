import { finalizeReleaseArtifact } from "./release-artifact-provenance.mjs";

try {
  const result = await finalizeReleaseArtifact({
    expectedVersion: process.env.RELEASE_EXPECTED_PACKAGE_VERSION,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release artifact finalization failed");
  process.exitCode = 1;
}
