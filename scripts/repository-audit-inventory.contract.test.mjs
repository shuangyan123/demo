import assert from "node:assert/strict";
import test from "node:test";
import { collectInventory, importEdges, resolveLocalImport, testEntrypoints } from "./repository-audit-inventory.mjs";
import { evaluateContractCoverage, readCheckoutContractCoverage } from "./contract-test-coverage.mjs";

function fixture(extra = new Map()) {
  const texts = new Map([
    [".github/workflows/ci.yml", "name: CI\njobs:\n  static:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run test:contracts\n"],
    ["scripts/root.contract.test.mjs", 'import "../app/child.contract.test.ts";'],
    ["app/child.contract.test.ts", 'import type { A } from "./type-only.contract.test.ts";'],
    ...extra,
  ]);
  return { paths: new Set(texts.keys()), texts, packageJson: { scripts: { "test:contracts": "npm run test:nested", "test:nested": "node --test scripts/root.contract.test.mjs" } }, policy: { schemaVersion: 1, exceptions: [] } };
}

test("contract discovery follows nested npm and transitive side-effect imports", () => {
  const result = evaluateContractCoverage(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.tests.length, 2);
  assert.equal(result.tests.find(item => item.file === "app/child.contract.test.ts").entrypoints[0].name, ".github/workflows/ci.yml:static");
});

test("new orphaned contract and type-only registration fail closed", () => {
  const input = fixture(new Map([["app/type-only.contract.test.ts", "export type A = string;"], ["app/orphan.contract.test.ts", ""]]));
  const result = evaluateContractCoverage(input);
  assert.deepEqual(result.errors.toSorted(), ["orphaned contract: app/orphan.contract.test.ts", "orphaned contract: app/type-only.contract.test.ts"]);
});

test("disabled CI jobs and disabled test steps cannot create eligible static coverage", () => {
  for (const placement of ["job", "step"]) {
    const input = fixture();
    input.texts.set(".github/workflows/ci.yml", `jobs:\n  static:\n    runs-on: ubuntu-latest\n${placement === "job" ? "    if: false\n" : ""}    steps:\n      - run: npm run test:contracts\n${placement === "step" ? "        if: false\n" : ""}`);
    assert.equal(evaluateContractCoverage(input).errors.filter(error => error.startsWith("orphaned contract")).length, 2);
  }
});

test("malformed, duplicate, wildcard and empty-reason exceptions fail closed", () => {
  const input = fixture();
  for (const policy of [null, {}, { schemaVersion: 1, exceptions: [null] }, { schemaVersion: 99, exceptions: [] }]) {
    assert.ok(evaluateContractCoverage({ ...input, policy }).errors.length > 0);
  }
  input.policy.exceptions = [
    { file: "app/*.contract.test.ts", kind: "manual", reason: "", command: "manual" },
    { file: "app/*.contract.test.ts", kind: "manual", reason: 1, command: "manual" },
  ];
  const result = evaluateContractCoverage(input);
  for (const category of ["duplicate exception", "stale exception", "unjustified exception"]) assert.ok(result.errors.some(error => error.startsWith(category)));
  assert.ok(result.limits.some(value => value.includes("not proof of execution")));
});

test("explicit optional contract requires justification and cannot hide a stale or newly reachable exception", () => {
  const input = fixture(new Map([["app/windows.contract.test.ts", ""]]));
  input.policy.exceptions = [{ file: "app/windows.contract.test.ts", kind: "Windows", command: "node --test app/windows.contract.test.ts", reason: "owned Windows-only acceptance" }];
  assert.deepEqual(evaluateContractCoverage(input).errors, []);
  input.policy.exceptions.push({ file: "app/removed.contract.test.ts" });
  assert.ok(evaluateContractCoverage(input).errors.some(error => error.startsWith("stale exception")));
  input.policy.exceptions = [{ file: "app/child.contract.test.ts", kind: "old", command: "old", reason: "old" }];
  assert.ok(evaluateContractCoverage(input).errors.some(error => error.startsWith("exception is now covered")));
});

test("resolver covers alias, declaration remap, dynamic imports and mixed type imports", () => {
  const paths = new Set(["app/types.d.ts", "app/child.contract.test.ts", "app/a.ts"]);
  assert.equal(resolveLocalImport("desktop/a.ts", "../app/types.js", paths), "app/types.d.ts");
  assert.equal(resolveLocalImport("app/a.ts", "@/app/child.contract.test.ts", paths), "app/child.contract.test.ts");
  const result = importEdges("app/a.ts", 'import { type A } from "./types.js"; import { type A, B } from "./types.js"; await import("./child.contract.test.ts");', paths);
  assert.deepEqual(result.edges.map(edge => edge.typeOnly), [true, false, false]);
  assert.deepEqual(result.edges.map(edge => edge.line), [1, 1, 1]);
});

test("test-support roots and recursive npm references stay finite", () => {
  const paths = new Set(["test-support/a.contract.test.ts"]);
  const { entrypoints } = testEntrypoints({ scripts: { a: "npm run b", b: "npm run a && node --test test-support/a.contract.test.ts" } }, new Map(), paths, []);
  assert.deepEqual(entrypoints.find(entry => entry.name === "a").tests, ["test-support/a.contract.test.ts"]);
});

test("Git-blob inventory records aggregator reachability in both directions", () => {
  // 使用checkout HEAD，避免浅克隆CI依赖某个历史审计commit是否可取。
  const result = collectInventory("HEAD");
  assert.ok(result.summary.trackedFiles > 0);
  assert.equal(new Set(result.inventory.map(item => item.path)).size, result.summary.trackedFiles);
  assert.deepEqual(result.summary.unclassified, []);
  assert.deepEqual(result.summary.unresolvedLocalImports, []);
  const registered = result.tests.find(item => item.file === "app/features/performance/architecture-boundary.contract.test.ts");
  assert.ok(registered.entrypoints.includes("test:contracts"));
  const indirect = result.tests.find(item => item.file === "app/services/learner-state-service.contract.test.ts");
  assert.ok(indirect.entrypoints.includes("test:contracts"));
  const root = result.entrypoints.find(item => item.name === "test:contracts").roots.find(file => file.includes(".contract.test."));
  assert.ok(result.tests.find(item => item.file === root).entrypoints.includes("test:contracts"));
});

test("all checkout contracts have an eligible normal-CI path or exact reviewed opt-in disposition", () => {
  const result = readCheckoutContractCoverage();
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
});
