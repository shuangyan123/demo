import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing required release input: ${name}`);
  }

  return value;
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveCommit(cwd, revision) {
  try {
    return git(cwd, ["rev-parse", "--verify", `${revision}^{commit}`]);
  } catch {
    throw new Error(`Release revision cannot be resolved to a commit: ${revision}`);
  }
}

function assertMainAncestor(cwd, releaseSha) {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", releaseSha, "refs/remotes/origin/main"],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (result.status === 1) {
    throw new Error(`Release commit ${releaseSha} is not an ancestor of origin/main`);
  }

  if (result.status !== 0) {
    const detail = result.stderr.trim() || `git exited with status ${result.status}`;
    throw new Error(`Unable to prove release commit provenance: ${detail}`);
  }
}

export function verifyDesktopReleaseProvenance({
  cwd = process.cwd(),
  eventName,
  ref,
  refName,
  sha,
}) {
  const releaseSha = resolveCommit(cwd, requireValue("RELEASE_SHA", sha));
  const packageJson = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));

  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json must contain a non-empty version");
  }

  if (eventName !== "push") {
    return { packageVersion: packageJson.version, publishAuthorized: false, releaseSha };
  }

  const tagName = requireValue("RELEASE_REF_NAME", refName);
  if (ref !== `refs/tags/${tagName}` || !tagName.startsWith("v")) {
    throw new Error(`Release push must identify an exact v* tag ref, received ${ref ?? "<missing>"}`);
  }

  const tagCommit = resolveCommit(cwd, `refs/tags/${tagName}`);
  if (tagCommit !== releaseSha) {
    throw new Error(`Tag ${tagName} target ${tagCommit} does not match event commit ${releaseSha}`);
  }

  const expectedTag = `v${packageJson.version}`;
  if (tagName !== expectedTag) {
    throw new Error(`Tag ${tagName} does not match package.json version ${expectedTag}`);
  }

  try {
    git(cwd, [
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
  } catch {
    throw new Error("Unable to fetch origin/main for release provenance verification");
  }

  assertMainAncestor(cwd, releaseSha);

  return { packageVersion: packageJson.version, publishAuthorized: true, releaseSha };
}

function writeOutput(name, value) {
  const outputPath = requireValue("GITHUB_OUTPUT", process.env.GITHUB_OUTPUT);
  appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyDesktopReleaseProvenance({
      eventName: process.env.RELEASE_EVENT_NAME,
      ref: process.env.RELEASE_REF,
      refName: process.env.RELEASE_REF_NAME,
      sha: process.env.RELEASE_SHA,
    });

    writeOutput("package_version", result.packageVersion);
    writeOutput("publish_authorized", String(result.publishAuthorized));
    writeOutput("release_sha", result.releaseSha);
    console.log(
      result.publishAuthorized
        ? `Release provenance verified for ${result.releaseSha}`
        : `Build-only event verified for ${result.releaseSha}; publication is not authorized`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release provenance verification failed");
    process.exitCode = 1;
  }
}
