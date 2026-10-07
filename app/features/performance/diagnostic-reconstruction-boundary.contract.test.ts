import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.join(process.cwd(), "app/server/diagnostic");
test("F4 readonly composition uses fixed production authority; no storage writes, UI, network or target shortcut", async () => {
  for (const name of ["learning-history.ts", "state-reconstruction.ts", "reconstruction-types.ts"]) {
    const source = await readFile(path.join(root, name), "utf8");
    assert.doesNotMatch(source, /node:|\b(?:window|document|localStorage|indexedDB|fetch|process)\b|initializeDiagnosticRuntime\(|\.initialize\(|appendCapturedAttempt|writeFile|mkdir|unlink|\.payload\b|verifiedCorrectOption|int-add-2-3|["']use client["']/);
    if (name === "reconstruction-types.ts") {
      const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
      assert.ok(ast.statements.every(node => ts.isTypeAliasDeclaration(node) || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)));
    }
  }
  const loader = await readFile(path.join(root, "learning-history.ts"), "utf8");
  const state = await readFile(path.join(root, "state-reconstruction.ts"), "utf8");
  assert.match(loader, /read: readDiagnosticSourceHistory/);
  assert.match(loader, /admit: admitVerifiedAssessment/);
  assert.match(loader, /adapt: adaptVerifiedAssessment, derive: deriveEvidence/);
  assert.match(state, /derive: deriveLearnerTargetStates, decide: decideNextVerification/);
  assert.match(loader, /resolved\.spec\.learningTarget/); assert.match(state, /resolved\.spec\.learningTarget/);
  assert.ok(loader.indexOf("const derived = deps.derive(events)") < loader.indexOf("events.filter("));
  const ast = ts.createSourceFile("loader.ts", loader, ts.ScriptTarget.Latest, true);
  const entry = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "loadCompleteDiagnosticLearningHistory");
  assert.equal(entry?.parameters.length, 0, "no caller target/records/dependencies in production loader");
  const runtime = await readFile(path.join(root, "runtime.ts"), "utf8");
  const runtimeAst = ts.createSourceFile("runtime.ts", runtime, ts.ScriptTarget.Latest, true);
  const read = runtimeAst.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "readDiagnosticSourceHistory");
  assert.ok(read?.body); assert.doesNotMatch(read.body.getText(runtimeAst), /initialize|compose|parseDiagnosticStorageConfig/);
  const core = await readFile(path.join(root, "runtime-core.ts"), "utf8");
  const readHistory = core.slice(core.indexOf("readHistory()"), core.indexOf("issue()"));
  assert.doesNotMatch(readHistory, /\.initialize\(|appendCapturedAttempt|writeFile|\b(?:reset|repair)\s*\(/);
});

test("real API types reject caller records/dependencies; failure cannot be consumed as empty Event history/state", () => {
  const file = path.join(root, "type-contract-fixture.ts");
  const source = 'import { loadCompleteDiagnosticLearningHistory } from "./learning-history.ts";\n'
    + 'import { reconstructDiagnosticLearnerState } from "./state-reconstruction.ts";\n'
    + 'const history = loadCompleteDiagnosticLearningHistory();\n'
    + 'if (history.kind === "complete") { history.events; history.evidence; history.scope; }\n'
    + 'else { history.events; history.evidence; }\n'
    + 'loadCompleteDiagnosticLearningHistory([]);\n'
    + 'reconstructDiagnosticLearnerState({specId:"locator",specRevision:"r1",asOf:"time"}, {load:()=>[]});\n'
    + 'const result = reconstructDiagnosticLearnerState({}); if (result.kind !== "complete") result.state;';
  const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext,
    types: ["node"], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true };
  const host = ts.createCompilerHost(options); const original = host.getSourceFile; const fileExists = host.fileExists;
  const matches = (target: string) => path.resolve(target).toLowerCase() === file.toLowerCase();
  host.fileExists = target => matches(target) || fileExists(target);
  host.getSourceFile = (target, ...args) => matches(target) ? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true) : original(target, ...args);
  const diagnostics = ts.createProgram([file], options, host).getSemanticDiagnostics();
  assert.equal(diagnostics.length, 5, diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("\n"));
  assert.deepEqual(diagnostics.map(item => item.code).toSorted(), [2339, 2339, 2339, 2554, 2554]);
});
