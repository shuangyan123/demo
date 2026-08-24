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

function tryResolveCommit(cwd, revision) {
  const result = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (result.status === 0) {
    return result.stdout.trim();
  }

  if (result.status === 1) {
    return undefined;
  }

  const detail = result.stderr.trim() || `git exited with status ${result.status}`;
  throw new Error(`Unable to inspect release tag ${revision}: ${detail}`);
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
  defaultRef,
  defaultSha,
  eventName,
  sha,
  triggerConclusion,
  triggerEvent,
  triggerHeadBranch,
  triggerWorkflow,
  workflowRef,
  workflowSha,
}) {
  const releaseSha = resolveCommit(cwd, requireValue("RELEASE_SHA", sha));
  const trustedWorkflowSha = resolveCommit(
    cwd,
    requireValue("RELEASE_WORKFLOW_SHA", workflowSha),
  );
  const packageJson = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));

  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json must contain a non-empty version");
  }

  if (eventName !== "workflow_run") {
    throw new Error(`Production release requires workflow_run, received ${eventName ?? "<missing>"}`);
  }

  if (
    triggerWorkflow !== "CI" ||
    triggerConclusion !== "success" ||
    triggerEvent !== "push" ||
    triggerHeadBranch !== "main"
  ) {
    throw new Error("Production release requires a successful CI push run on main");
  }

  if (defaultRef !== "refs/heads/main") {
    throw new Error(`Trusted release workflow must run from refs/heads/main, received ${defaultRef}`);
  }

  const resolvedDefaultSha = resolveCommit(
    cwd,
    requireValue("RELEASE_DEFAULT_SHA", defaultSha),
  );
  if (trustedWorkflowSha !== resolvedDefaultSha) {
    throw new Error("Release workflow revision does not match the default-branch event SHA");
  }

  if (!workflowRef?.endsWith("/.github/workflows/trusted-desktop-release.yml@refs/heads/main")) {
    throw new Error(`Release authority is not anchored to the trusted main workflow: ${workflowRef}`);
  }

  assertMainAncestor(cwd, releaseSha);

  const releaseTag = `v${packageJson.version}`;
  const tagCommit = tryResolveCommit(cwd, `refs/tags/${releaseTag}`);
  if (!tagCommit || tagCommit !== releaseSha) {
    return {
      packageVersion: packageJson.version,
      publishAuthorized: false,
      releaseSha,
      releaseTag,
    };
  }

  return {
    packageVersion: packageJson.version,
    publishAuthorized: true,
    releaseSha,
    releaseTag,
  };
}

function writeOutput(name, value) {
  const outputPath = requireValue("GITHUB_OUTPUT", process.env.GITHUB_OUTPUT);
  appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyDesktopReleaseProvenance({
      defaultRef: process.env.RELEASE_DEFAULT_REF,
      defaultSha: process.env.RELEASE_DEFAULT_SHA,
      eventName: process.env.RELEASE_EVENT_NAME,
      sha: process.env.RELEASE_SHA,
      triggerConclusion: process.env.RELEASE_TRIGGER_CONCLUSION,
      triggerEvent: process.env.RELEASE_TRIGGER_EVENT,
      triggerHeadBranch: process.env.RELEASE_TRIGGER_HEAD_BRANCH,
      triggerWorkflow: process.env.RELEASE_TRIGGER_WORKFLOW,
      workflowRef: process.env.RELEASE_WORKFLOW_REF,
      workflowSha: process.env.RELEASE_WORKFLOW_SHA,
    });

    writeOutput("package_version", result.packageVersion);
    writeOutput("publish_authorized", String(result.publishAuthorized));
    writeOutput("release_sha", result.releaseSha);
    writeOutput("release_tag", result.releaseTag);
    console.log(
      result.publishAuthorized
        ? `Trusted-main release provenance verified for ${result.releaseSha}`
        : `No exact matching release tag for ${result.releaseSha}; publication is not authorized`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release provenance verification failed");
    process.exitCode = 1;
  }
}
