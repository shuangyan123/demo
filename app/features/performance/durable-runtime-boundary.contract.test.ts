import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const runtimeRoot = path.join(root, "app/server/diagnostic");
const testFiles = new Set(["assessment-runtime.contract.test.ts", "durable-submission.contract.test.ts", "state-reconstruction.contract.test.ts",
  "reconstruction-failure.contract.test.ts", "reconstruction-restart.contract.test.ts"].map(name => path.join(runtimeRoot, name)));
const internal = (file: string) => path.join(runtimeRoot, file);
const edges = new Map<string, Map<string, string[]>>([
  [internal("assessment-store.ts"), new Map([["runtime", ["initializeDiagnosticRuntime", "diagnosticOwnerAttempt"]]])],
  [internal("assessment-submission.ts"), new Map([["runtime", ["initializeDiagnosticRuntime"]], ["runtime-core", ["DiagnosticRuntime"]]])],
  [internal("runtime.ts"), new Map([["runtime-core", ["createDiagnosticRuntime", "DiagnosticRuntime"]], ["storage-config", ["parseDiagnosticStorageConfig"]]])],
  [internal("source-owner.ts"), new Map([["assessment-store", ["resolveDiagnosticAttempt"]]])],
  [internal("learning-history.ts"), new Map([["runtime", ["readDiagnosticSourceHistory"]],
    ["reconstruction-types", ["DiagnosticLearningHistory", "DiagnosticReconstructionFailure"]]])],
  [internal("state-reconstruction.ts"), new Map([["learning-history", ["loadCompleteDiagnosticLearningHistory"]],
    ["reconstruction-types", ["DiagnosticStateReconstruction"]]])],
  [path.join(root, "app/diagnostic/page.tsx"), new Map([["assessment-store", ["issueDiagnostic", "readDiagnostic"]]])],
  [path.join(root, "app/api/diagnostic/submit/route.ts"), new Map([["assessment-submission", ["commitDiagnosticSubmission"]]])],
]);

function violations(file: string, source: string) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];
  const visit = (node: ts.Node) => {
    let specifier: string | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) specifier = node.argument.literal.text;
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) specifier = node.moduleReference.expression.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specifier = node.arguments[0].text;
    if (specifier) {
      const target = (specifier.startsWith("@/") ? path.resolve(root, specifier.slice(2)) : path.resolve(path.dirname(file), specifier)).replace(/\.(?:ts|js)$/, "");
      const protectedModules = ["runtime", "runtime-core", "storage-config", "assessment-store", "assessment-submission",
        "learning-history", "state-reconstruction", "reconstruction-types"].map(name => path.join(runtimeRoot, name));
      if (protectedModules.includes(target) && !testFiles.has(file)) {
        const startup = file === path.join(root, "instrumentation.ts") && target === path.join(runtimeRoot, "runtime")
          && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const allowed = edges.get(file)?.get(path.basename(target));
        const named = ts.isImportDeclaration(node) && !node.importClause?.name && node.importClause?.namedBindings
          && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements : undefined;
        if (!startup && (!allowed || !named || !named.every(binding => allowed.includes((binding.propertyName ?? binding.name).text))))
          issues.push("durable_composition_capability_leak");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (source.includes("RECALL_MANAGED_STORAGE_BOOTSTRAP") && !testFiles.has(file)
    && ![path.join(root, "desktop/runtime.ts"), path.join(runtimeRoot, "runtime.ts"), path.join(root, "scripts/start-diagnostic-test-server.mts")].includes(file))
    issues.push("process_transport_outside_boundary");
  return issues;
}
async function sources(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(file) ? [file] : [];
  }))).flat();
}
test("durable runtime composition and continuation capabilities have exact named consumers", async () => {
  for (const file of [...await sources(path.join(root, "app")), ...await sources(path.join(root, "desktop")), ...await sources(path.join(root, "scripts")), path.join(root, "instrumentation.ts")]) {
    if (file.includes(".test.")) continue;
    assert.deepEqual(violations(file, await readFile(file, "utf8")), [], file);
  }
});
test("durable seam guard rejects renderer aliases, hidden imports and production dependency injection", () => {
  const outside = path.join(root, "app/features/review/bypass.ts");
  for (const source of ['import { composeDiagnosticRuntime as compose } from "../../server/diagnostic/runtime.ts";',
    'export * from "@/app/server/diagnostic/runtime-core";', 'type Runtime = typeof import("../../server/diagnostic/runtime.ts");',
    'const bootstrap = require("../../server/diagnostic/storage-config.ts");', 'const runtime = await import("../../server/diagnostic/runtime.ts");',
    'import runtime = require("../../server/diagnostic/runtime.ts");', 'import { continueDiagnosticSubmission } from "../../server/diagnostic/assessment-submission.ts";'])
    assert.ok(violations(outside, source).includes("durable_composition_capability_leak"));
  const route = path.join(root, "app/api/diagnostic/submit/route.ts");
  assert.ok(violations(route, 'import { continueDiagnosticSubmission as submit } from "../../../server/diagnostic/assessment-submission.ts";').length);
  assert.ok(violations(path.join(runtimeRoot, "assessment-store.ts"), 'import { composeDiagnosticRuntime } from "./runtime.ts";').length);
  assert.ok(violations(path.join(runtimeRoot, "state-reconstruction.ts"), 'import { loadDiagnosticLearningHistoryWith } from "./learning-history.ts";').length);
  assert.ok(violations(outside, 'import { reconstructDiagnosticLearnerState } from "../../server/diagnostic/state-reconstruction.ts";').length);
  assert.ok(violations(outside, 'const root = process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP;').includes("process_transport_outside_boundary"));
});
test("Main explicitly transports trusted config and startup owner resolution never reads filesystem", async () => {
  const main = await readFile(path.join(root, "desktop/main.ts"), "utf8");
  const desktop = await readFile(path.join(root, "desktop/runtime.ts"), "utf8");
  assert.match(main, /launchMainWindowWithRecovery\(storageState\.config\)/);
  assert.match(main, /startDesktopRuntime\(storageConfig\)/);
  assert.ok(desktop.indexOf("...process.env") < desktop.indexOf("RECALL_MANAGED_STORAGE_BOOTSTRAP: serializeStorageRuntimeConfig(storageConfig)"));
  const instrumentation = await readFile(path.join(root, "instrumentation.ts"), "utf8");
  assert.match(instrumentation, /NEXT_RUNTIME === "nodejs"/);
  assert.match(instrumentation, /initializeDiagnosticRuntime\(\)/);
  const runtime = await readFile(path.join(runtimeRoot, "runtime.ts"), "utf8");
  const owner = runtime.slice(runtime.indexOf("export function diagnosticOwnerAttempt"), runtime.indexOf("export function closeDiagnosticRuntime"));
  assert.doesNotMatch(owner, /initializeDiagnosticRuntime\(|readCompleteSnapshot|readFile|parseDiagnosticStorageConfig/);
});
