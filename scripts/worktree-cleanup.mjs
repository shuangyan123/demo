import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const WORKTREE_CLASSIFICATIONS = Object.freeze({
  ACTIVE: "ACTIVE",
  OPEN_PR: "OPEN_PR",
  DIRTY: "DIRTY",
  SAFE_TO_REMOVE: "SAFE_TO_REMOVE",
  UNKNOWN: "UNKNOWN",
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gitMarkerNames = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
];

function commandError(command, args, error) {
  const stderr = error?.stderr?.toString().trim();
  const detail = stderr ? `: ${stderr}` : "";
  return new Error(`Command failed: ${command} ${args.join(" ")}${detail}`, { cause: error });
}

export function runCommand(command, args, options = {}) {
  const { allowFailure = false, ...execOptions } = options;
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...execOptions,
    }).trimEnd();
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    throw commandError(command, args, error);
  }
}

function normalizedPath(value) {
  return resolve(value).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function stripBranchRef(value) {
  return value?.replace(/^refs\/heads\//, "") ?? null;
}

export function parseWorktreePorcelain(output) {
  const worktrees = [];
  let current = null;
  const finish = () => {
    if (current) {
      worktrees.push(current);
      current = null;
    }
  };

  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      finish();
      continue;
    }

    const separator = line.indexOf(" ");
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);
    if (key === "worktree") {
      finish();
      current = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        bare: false,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === "HEAD") {
      current.head = value;
    } else if (key === "branch") {
      current.branch = stripBranchRef(value);
    } else if (key === "detached") {
      current.detached = true;
    } else if (key === "bare") {
      current.bare = true;
    }
  }
  finish();
  return worktrees;
}

export function parseStatus(output) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  return {
    dirty: lines.some((line) => !line.startsWith("##")),
    header: lines.find((line) => line.startsWith("##")) ?? null,
  };
}

function parseJsonOutput(output, description) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`Invalid JSON from ${description}.`, { cause: error });
  }
}

function parseGithubSlug(remoteUrl) {
  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const match = normalized.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  return match?.[1] ?? null;
}

function inspectGitState(worktreePath) {
  try {
    const statusOutput = runCommand("git", ["status", "--porcelain=v1", "--branch"], {
      cwd: worktreePath,
    });
    const branch = runCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: worktreePath,
      allowFailure: true,
    });
    const head = runCommand("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
    const markerPaths = gitMarkerNames.map((name) =>
      runCommand("git", ["rev-parse", "--git-path", name], { cwd: worktreePath }),
    );
    return {
      status: parseStatus(statusOutput),
      branch: branch ?? null,
      head,
      detached: branch === null,
      unresolved: markerPaths.some((markerPath) => existsSync(resolve(worktreePath, markerPath))),
      error: null,
    };
  } catch (error) {
    return {
      status: { dirty: false, header: null },
      branch: null,
      head: null,
      detached: false,
      unresolved: false,
      error: error instanceof Error ? error.message : "Unable to inspect Git state.",
    };
  }
}

function inspectGithubBranch({ repository, branch, viewerLogin }) {
  try {
    const fields = [
      "number",
      "title",
      "state",
      "isDraft",
      "headRefName",
      "headRefOid",
      "baseRefName",
      "mergedAt",
      "closedAt",
      "author",
      "url",
    ].join(",");
    const mergedHistory = parseJsonOutput(
      runCommand("gh", [
        "pr",
        "list",
        "--repo",
        repository,
        "--state",
        "all",
        "--head",
        branch,
        "--limit",
        "100",
        "--json",
        fields,
      ]),
      `GitHub PR history for ${branch}`,
    );
    const openHead = parseJsonOutput(
      runCommand("gh", [
        "pr",
        "list",
        "--repo",
        repository,
        "--state",
        "open",
        "--head",
        branch,
        "--limit",
        "100",
        "--json",
        fields,
      ]),
      `open GitHub PR heads for ${branch}`,
    );
    const openBase = parseJsonOutput(
      runCommand("gh", [
        "pr",
        "list",
        "--repo",
        repository,
        "--state",
        "open",
        "--base",
        branch,
        "--limit",
        "100",
        "--json",
        fields,
      ]),
      `open GitHub PR bases for ${branch}`,
    );
    return {
      viewerLogin,
      mergedHistory,
      openHead,
      openBase,
      error: null,
    };
  } catch (error) {
    return {
      viewerLogin,
      mergedHistory: [],
      openHead: [],
      openBase: [],
      error: error instanceof Error ? error.message : "Unable to inspect GitHub state.",
    };
  }
}

function inspectRepositoryContext(rootPath) {
  try {
    const remoteUrl = runCommand("git", ["remote", "get-url", "origin"], { cwd: rootPath });
    const repository = parseGithubSlug(remoteUrl);
    if (!repository) {
      throw new Error(`origin is not a GitHub repository: ${remoteUrl}`);
    }

    const repoView = parseJsonOutput(
      runCommand("gh", [
        "repo",
        "view",
        repository,
        "--json",
        "nameWithOwner,defaultBranchRef,owner",
      ], { cwd: rootPath }),
      "GitHub repository metadata",
    );
    const viewerLogin = runCommand("gh", ["api", "user", "--jq", ".login"], {
      cwd: rootPath,
    });
    const gitOriginHead = stripBranchRef(
      runCommand("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
        cwd: rootPath,
        allowFailure: true,
      })?.replace(/^refs\/remotes\/origin\//, "") ?? null,
    );
    const githubDefaultBranch = repoView.defaultBranchRef?.name ?? null;
    if (!githubDefaultBranch || (gitOriginHead && gitOriginHead !== githubDefaultBranch)) {
      throw new Error("Git and GitHub default-branch metadata is ambiguous.");
    }

    return {
      repository: repoView.nameWithOwner ?? repository,
      ownerLogin: repoView.owner?.login ?? null,
      viewerLogin,
      defaultBranch: githubDefaultBranch,
      error: null,
    };
  } catch (error) {
    return {
      repository: null,
      ownerLogin: null,
      viewerLogin: null,
      defaultBranch: null,
      error: error instanceof Error ? error.message : "Unable to inspect repository metadata.",
    };
  }
}

function reasonRecord(classification, reason, worktree, extra = {}) {
  return {
    classification,
    safe: classification === WORKTREE_CLASSIFICATIONS.SAFE_TO_REMOVE,
    reason,
    path: worktree.path,
    branch: worktree.branch,
    head: worktree.head,
    ...extra,
  };
}

export function classifyWorktree({
  worktree,
  currentWorktreePath,
  defaultBranch,
  status,
  git,
  github,
}) {
  if (normalizedPath(worktree.path) === normalizedPath(currentWorktreePath)) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.ACTIVE,
      "current worktree is never removable",
      worktree,
    );
  }
  if (git.error || !git.head) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      git.error ?? "Git state is incomplete",
      worktree,
    );
  }
  if (git.detached || worktree.detached || !worktree.branch) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      "detached HEAD is never removable",
      worktree,
    );
  }
  if (!git.branch) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      "attached branch state is incomplete",
      worktree,
    );
  }
  if (worktree.branch === defaultBranch) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.ACTIVE,
      "default branch worktree is never removable",
      worktree,
    );
  }
  if (status.dirty) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.DIRTY,
      "worktree has uncommitted changes",
      worktree,
    );
  }
  if (git.unresolved) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      "unfinished merge, rebase, cherry-pick, or revert state",
      worktree,
    );
  }
  if (git.branch !== worktree.branch || git.head !== worktree.head) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      "registered worktree metadata does not match live Git state",
      worktree,
    );
  }
  if (github.error) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      `GitHub state is unavailable or ambiguous: ${github.error}`,
      worktree,
    );
  }
  if (github.openHead.length > 0 || github.openBase.length > 0) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.OPEN_PR,
      "open or dependent PR references this branch",
      worktree,
      { openHead: github.openHead, openBase: github.openBase },
    );
  }

  const mergedHistory = github.mergedHistory;
  if (mergedHistory.length !== 1) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      mergedHistory.length === 0
        ? "no unique merged PR proves task ownership"
        : "multiple PR records make branch ownership ambiguous",
      worktree,
      { mergedHistory },
    );
  }

  const mergedPr = mergedHistory[0];
  if (
    mergedPr.state !== "MERGED" ||
    !mergedPr.mergedAt ||
    mergedPr.baseRefName !== defaultBranch ||
    mergedPr.headRefName !== worktree.branch ||
    mergedPr.headRefOid !== worktree.head
  ) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      "merged PR does not exactly prove this branch and HEAD",
      worktree,
      { mergedPr },
    );
  }
  if (!github.viewerLogin || mergedPr.author?.login !== github.viewerLogin) {
    return reasonRecord(
      WORKTREE_CLASSIFICATIONS.UNKNOWN,
      "branch ownership is not proven for the current GitHub user",
      worktree,
      { mergedPr },
    );
  }

  return reasonRecord(
    WORKTREE_CLASSIFICATIONS.SAFE_TO_REMOVE,
    `clean merged PR #${mergedPr.number} matches branch and HEAD; no open dependent PR`,
    worktree,
    { mergedPr },
  );
}

export function validateApplyBoundary({ git, defaultBranch, originMainHead }) {
  const blockers = [];
  if (git?.error) {
    blockers.push(`current Git state is unavailable: ${git.error}`);
  }
  if (git?.detached !== false || !git?.branch) {
    blockers.push("invoking worktree is detached or has no attached branch");
  }
  if (git?.status?.dirty !== false) {
    blockers.push("invoking worktree is not clean");
  }
  if (git?.unresolved !== false) {
    blockers.push("invoking worktree has unfinished merge, rebase, cherry-pick, or revert state");
  }
  if (git?.branch !== "main") {
    blockers.push("invoking worktree is not on local main");
  }
  if (defaultBranch !== "main") {
    blockers.push(`GitHub/default branch is not main: ${defaultBranch ?? "unknown"}`);
  }
  if (!originMainHead) {
    blockers.push("origin/main could not be resolved after fetch");
  } else if (git?.head !== originMainHead) {
    blockers.push(`current HEAD ${git?.head ?? "unknown"} is not exact origin/main ${originMainHead}`);
  }
  return {
    allowed: blockers.length === 0,
    blockers,
  };
}

function inspectAllWorktrees(rootPath) {
  const currentWorktreePath = runCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd: rootPath,
  });
  const worktrees = parseWorktreePorcelain(
    runCommand("git", ["worktree", "list", "--porcelain"], { cwd: rootPath }),
  );
  const repositoryContext = inspectRepositoryContext(rootPath);
  const defaultBranch = repositoryContext.defaultBranch;
  const records = worktrees.map((worktree) => {
    const git = inspectGitState(worktree.path);
    const github = worktree.branch && repositoryContext.repository
      ? inspectGithubBranch({
          repository: repositoryContext.repository,
          branch: worktree.branch,
          viewerLogin: repositoryContext.viewerLogin,
        })
      : {
          viewerLogin: repositoryContext.viewerLogin,
          mergedHistory: [],
          openHead: [],
          openBase: [],
          error: repositoryContext.error ?? "detached or bare worktree has no branch",
        };
    const record = defaultBranch
      ? classifyWorktree({
          worktree,
          currentWorktreePath,
          defaultBranch,
          status: git.status,
          git,
          github,
        })
      : reasonRecord(
          WORKTREE_CLASSIFICATIONS.UNKNOWN,
          repositoryContext.error ?? "default branch is unknown",
          worktree,
        );
    return { ...record, worktree, git, github };
  });

  return {
    rootPath,
    currentWorktreePath,
    defaultBranch,
    repository: repositoryContext.repository,
    records,
  };
}

export function executeCleanup(records, {
  apply = false,
  removeWorktree = null,
  boundary = null,
} = {}) {
  const candidates = records.filter(
    (record) => record.classification === WORKTREE_CLASSIFICATIONS.SAFE_TO_REMOVE,
  );
  if (!apply) {
    return { candidates, removed: [] };
  }
  if (boundary?.allowed !== true) {
    const reason = boundary?.blockers?.join("; ") ?? "final-main execution boundary was not verified";
    throw new Error(`Apply mode blocked: ${reason}`);
  }
  if (typeof removeWorktree !== "function") {
    throw new Error("Apply mode requires a worktree removal function.");
  }

  const removed = [];
  for (const candidate of candidates) {
    removeWorktree(candidate.path);
    removed.push(candidate);
  }
  return { candidates, removed };
}

function formatRecord(record) {
  const branch = record.branch ?? "(detached)";
  const head = record.head ?? "(unknown)";
  return `${record.classification} | ${record.reason} | path=${record.path} | branch=${branch} | HEAD=${head}`;
}

function printAudit(snapshot, mode) {
  console.log(`Worktree cleanup ${mode}; defaultBranch=${snapshot.defaultBranch ?? "(unknown)"}`);
  console.log(`Current worktree: ${snapshot.currentWorktreePath}`);
  for (const record of snapshot.records) {
    console.log(formatRecord(record));
  }
}

function removeRegisteredWorktree(rootPath, worktreePath) {
  runCommand("git", ["worktree", "remove", worktreePath], { cwd: rootPath });
}

function hasRegisteredPath(rootPath, worktreePath) {
  const registered = parseWorktreePorcelain(
    runCommand("git", ["worktree", "list", "--porcelain"], { cwd: rootPath }),
  );
  return registered.some((worktree) => normalizedPath(worktree.path) === normalizedPath(worktreePath));
}

function inspectApplyBoundary(rootPath) {
  try {
    runCommand("git", ["fetch", "origin"], { cwd: rootPath });
  } catch (error) {
    return {
      allowed: false,
      blockers: [`git fetch origin failed: ${error instanceof Error ? error.message : "unknown error"}`],
    };
  }

  const git = inspectGitState(rootPath);
  const repositoryContext = inspectRepositoryContext(rootPath);
  let originMainHead;
  try {
    originMainHead = runCommand("git", ["rev-parse", "origin/main"], { cwd: rootPath });
  } catch {
    originMainHead = null;
  }
  const boundary = validateApplyBoundary({
    git,
    defaultBranch: repositoryContext.defaultBranch,
    originMainHead,
  });
  if (repositoryContext.error) {
    boundary.allowed = false;
    boundary.blockers.unshift(`GitHub repository state is unavailable or ambiguous: ${repositoryContext.error}`);
  }
  return {
    ...boundary,
    git,
    defaultBranch: repositoryContext.defaultBranch,
    originMainHead,
  };
}

function assertSafeRefresh(snapshot, candidate) {
  const refreshed = snapshot.records.find(
    (record) => normalizedPath(record.path) === normalizedPath(candidate.path),
  );
  if (!refreshed || !refreshed.safe || refreshed.branch !== candidate.branch || refreshed.head !== candidate.head) {
    throw new Error(`Candidate changed or is no longer safe: ${candidate.path}`);
  }
  return refreshed;
}

export function parseArguments(argv) {
  const unexpected = argv.filter((argument) => argument !== "--apply");
  if (unexpected.length > 0) {
    throw new Error(`Unsupported argument: ${unexpected[0]}`);
  }
  return { apply: argv.includes("--apply") };
}

export function main(argv = process.argv.slice(2)) {
  const { apply } = parseArguments(argv);
  const boundary = apply ? inspectApplyBoundary(repositoryRoot) : null;
  if (apply && boundary?.allowed !== true) {
    throw new Error(`Apply mode blocked: ${boundary?.blockers?.join("; ") ?? "final-main execution boundary was not verified"}`);
  }
  const initialSnapshot = inspectAllWorktrees(repositoryRoot);
  printAudit(initialSnapshot, apply ? "APPLY" : "AUDIT (dry-run; no mutation)");

  if (!apply) {
    console.log("No worktree mutation performed.");
    return;
  }

  const candidates = initialSnapshot.records.filter((record) => record.safe);
  if (candidates.length === 0) {
    console.log("No SAFE_TO_REMOVE worktrees found; no mutation performed.");
    return;
  }

  const removed = [];
  executeCleanup(initialSnapshot.records, {
    apply: true,
    boundary,
    removeWorktree: (worktreePath) => {
      const candidate = candidates.find(
        (record) => normalizedPath(record.path) === normalizedPath(worktreePath),
      );
      if (!candidate) {
        throw new Error(`Candidate was not present in the initial safe set: ${worktreePath}`);
      }
      const refreshed = inspectAllWorktrees(repositoryRoot);
      const verified = assertSafeRefresh(refreshed, candidate);
      removeRegisteredWorktree(repositoryRoot, verified.path);
      if (hasRegisteredPath(repositoryRoot, verified.path)) {
        throw new Error(`Git still registers removed worktree: ${verified.path}`);
      }
      removed.push(verified);
      console.log(`REMOVED | path=${verified.path} | branch=${verified.branch} | HEAD=${verified.head}`);
    },
  });
  console.log(`Removed ${removed.length} SAFE_TO_REMOVE worktree(s). No branch deletion was attempted.`);
}

if (process.argv[1] && normalizedPath(process.argv[1]) === normalizedPath(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Worktree cleanup failed.");
    process.exitCode = 1;
  }
}
