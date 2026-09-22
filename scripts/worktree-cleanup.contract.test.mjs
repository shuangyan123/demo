import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  WORKTREE_CLASSIFICATIONS,
  classifyWorktree,
  executeCleanup,
  validateApplyBoundary,
} from "./worktree-cleanup.mjs";

const branch = "feature/finished-task";
const head = "1111111111111111111111111111111111111111";
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function fixture(overrides = {}) {
  const worktree = {
    path: "C:/repo/task-worktree",
    head,
    branch,
    detached: false,
    bare: false,
    ...overrides.worktree,
  };
  const git = {
    branch,
    head,
    detached: false,
    unresolved: false,
    error: null,
    ...overrides.git,
  };
  const github = {
    viewerLogin: "shuangyan123",
    error: null,
    openHead: [],
    openBase: [],
    mergedHistory: [
      {
        number: 200,
        state: "MERGED",
        mergedAt: "2026-09-16T00:00:00Z",
        headRefName: branch,
        headRefOid: head,
        baseRefName: "main",
        author: { login: "shuangyan123" },
      },
    ],
    ...overrides.github,
  };
  return {
    worktree,
    currentWorktreePath: overrides.currentWorktreePath ?? "C:/repo",
    defaultBranch: "main",
    status: { dirty: false, ...overrides.status },
    git,
    github,
  };
}

function classify(overrides = {}) {
  return classifyWorktree(fixture(overrides));
}

function applyBoundary(overrides = {}) {
  return validateApplyBoundary({
    git: {
      branch: "main",
      head,
      detached: false,
      unresolved: false,
      error: null,
      status: { dirty: false },
      ...overrides.git,
    },
    defaultBranch: "main",
    originMainHead: head,
    ...overrides,
  });
}

function assertApplyBlocked(boundary) {
  const calls = [];
  assert.throws(
    () => executeCleanup(
      [classify()],
      { apply: true, boundary, removeWorktree: (path) => calls.push(path) },
    ),
    /Apply mode blocked/,
  );
  assert.deepEqual(calls, []);
}

test("npm scripts keep audit read-only and cleanup explicitly in apply mode", () => {
  assert.equal(packageJson.scripts["worktree:audit"], "node scripts/worktree-cleanup.mjs");
  assert.equal(packageJson.scripts["worktree:cleanup"], "node scripts/worktree-cleanup.mjs --apply");
});

test("clean merged task worktree is a safe candidate", () => {
  const result = classify();
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.SAFE_TO_REMOVE);
  assert.equal(result.safe, true);
});

test("dirty worktree is blocked", () => {
  const result = classify({ status: { dirty: true } });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.DIRTY);
  assert.equal(result.safe, false);
});

test("open PR is blocked", () => {
  const result = classify({
    github: {
      openHead: [{ number: 201 }],
    },
  });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.OPEN_PR);
  assert.equal(result.safe, false);
});

test("dependent open PR is blocked", () => {
  const result = classify({
    github: {
      openBase: [{ number: 204 }],
    },
  });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.OPEN_PR);
  assert.equal(result.safe, false);
});

test("main/default worktree is blocked", () => {
  const result = classify({
    worktree: { branch: "main" },
    git: { branch: "main" },
    github: { mergedHistory: [] },
  });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.ACTIVE);
  assert.equal(result.safe, false);
});

test("detached HEAD is blocked", () => {
  const result = classify({
    worktree: { branch: null, detached: true },
    git: { branch: null, detached: true },
  });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.UNKNOWN);
  assert.equal(result.safe, false);
});

test("unknown ownership is blocked", () => {
  const result = classify({
    github: {
      mergedHistory: [
        {
          number: 202,
          state: "MERGED",
          mergedAt: "2026-09-16T00:00:00Z",
          headRefName: branch,
          headRefOid: head,
          baseRefName: "main",
          author: { login: "someone-else" },
        },
      ],
    },
  });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.UNKNOWN);
  assert.equal(result.safe, false);
});

test("unfinished Git operation is blocked", () => {
  const result = classify({ git: { unresolved: true } });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.UNKNOWN);
  assert.equal(result.safe, false);
});

test("current worktree is blocked even when otherwise safe", () => {
  const result = classify({ currentWorktreePath: "C:/repo/task-worktree" });
  assert.equal(result.classification, WORKTREE_CLASSIFICATIONS.ACTIVE);
  assert.equal(result.safe, false);
});

test("apply from a feature branch is blocked before any removal", () => {
  assertApplyBlocked(applyBoundary({ git: { branch: "feature/post-merge-worktree-cleanup" } }));
});

test("apply from a dirty main worktree is blocked before any removal", () => {
  assertApplyBlocked(applyBoundary({ git: { status: { dirty: true } } }));
});

test("apply from a detached HEAD is blocked before any removal", () => {
  assertApplyBlocked(applyBoundary({ git: { branch: null, detached: true } }));
});

test("apply from stale main is blocked before any removal", () => {
  assertApplyBlocked(applyBoundary({ git: { head: "2222222222222222222222222222222222222222" } }));
});

test("apply is blocked when GitHub default branch is not main", () => {
  assertApplyBlocked(applyBoundary({ defaultBranch: "trunk" }));
});

test("apply from clean exact latest main may remove safe candidates", () => {
  const calls = [];
  const result = executeCleanup(
    [classify()],
    {
      apply: true,
      boundary: applyBoundary(),
      removeWorktree: (path) => calls.push(path),
    },
  );
  assert.deepEqual(calls, ["C:/repo/task-worktree"]);
  assert.equal(result.removed.length, 1);
});

test("audit from a feature branch remains read-only", () => {
  const calls = [];
  const result = executeCleanup(
    [classify()],
    {
      apply: false,
      boundary: applyBoundary({ git: { branch: "feature/post-merge-worktree-cleanup" } }),
      removeWorktree: (path) => calls.push(path),
    },
  );
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(calls, []);
});

test("dry-run performs no mutation", () => {
  const calls = [];
  const result = executeCleanup(
    [classify()],
    { apply: false, removeWorktree: (path) => calls.push(path) },
  );
  assert.equal(result.removed.length, 0);
  assert.deepEqual(calls, []);
});

test("apply removes only safe candidates", () => {
  const calls = [];
  const records = [
    classify(),
    {
      ...classify({ status: { dirty: true } }),
      path: "C:/repo/dirty-worktree",
    },
    {
      ...classify({ github: { openHead: [{ number: 203 }] } }),
      path: "C:/repo/open-pr-worktree",
    },
  ];
  const result = executeCleanup(
    records,
    { apply: true, boundary: applyBoundary(), removeWorktree: (path) => calls.push(path) },
  );
  assert.deepEqual(calls, ["C:/repo/task-worktree"]);
  assert.deepEqual(result.removed.map((record) => record.path), ["C:/repo/task-worktree"]);
});
