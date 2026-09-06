import { verifyReleaseArtifact } from "./release-artifact-provenance.mjs";

try {
  const result = await verifyReleaseArtifact({
    expectedVersion: process.env.RELEASE_EXPECTED_PACKAGE_VERSION,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Downloaded release artifact verification failed");
  process.exitCode = 1;
}
