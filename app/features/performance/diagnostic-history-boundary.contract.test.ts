import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const history = path.join(root, "app/server/diagnostic/history");
function imports(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) result.push(node.argument.literal.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) result.push(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}
function violations(file: string, source: string): string[] {
  const result: string[] = [];
  for (const specifier of imports(source, file)) {
    const target = specifier.startsWith("@/") ? path.resolve(root, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : "";
    const historyDependency = target.startsWith(history + path.sep)
      || target.replace(/\.(?:ts|js)$/, "") === path.join(root, "app/types/domains/diagnostic-history");
    if (historyDependency && !file.startsWith(history + path.sep)) result.push("repository_outside_boundary");
    if (file.startsWith(history + path.sep) && (target.startsWith(path.join(root, "desktop") + path.sep)
      || /(?:derive-evidence|evidence-policy|derive-learner-state|learner-state-policy|verification-policy|verified-assessment-adapter|verification-source-admission)/.test(specifier))) result.push("repository_authority_expansion");
  }
  if (file.startsWith(history + path.sep) && /app\.getPath|process\.cwd|resourcesPath|process\.env|["']use client["']/.test(source)) result.push("arbitrary_root_or_renderer");
  return result;
}
async function sources(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  }))).flat();
}

test("diagnostic history stays internal server-only, independent from Desktop implementation and derived authority", async () => {
  for (const file of [...await sources(path.join(root, "app")), ...await sources(path.join(root, "desktop"))]) {
    assert.deepEqual(violations(file, await readFile(file, "utf8")), [], file);
  }
  for (const file of await sources(history)) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /verifiedCorrectOptionId|learningTarget|deriveEvidence|deriveLearnerTargetStates|decideNextVerification|admitVerifiedAssessment|reviewDb|indexedDB|localStorage|fetch\(/);
  }
  for (const name of ["capture-authority-core.ts", "capture-authority.ts", "spec-authority-core.ts", "spec-authority.ts", "spec-catalog.ts"]) {
    const file = path.join(root, "app/services/first-party-diagnostic", name);
    assert.ok(imports(await readFile(file, "utf8"), file).every((target) => !target.includes("history") && !target.includes("storage") && !target.startsWith("node:fs")));
  }
});

test("history guard rejects alias/type/re-export/dynamic/require and authority expansion fixtures", () => {
  const outside = path.join(root, "app/services/learning-kernel/bypass.ts");
  for (const source of [
    'import { openDiagnosticHistoryRepository as open } from "@/app/server/diagnostic/history/repository";',
    'export * from "../../server/diagnostic/history/repository.ts";',
    'type Snapshot = typeof import("../../types/domains/diagnostic-history.ts");',
    'const repo = await import("../../server/diagnostic/history/repository.ts");',
    'const repo = require("../../server/diagnostic/history/repository.ts");',
    'import repo = require("../../server/diagnostic/history/repository.ts");',
  ]) assert.ok(violations(outside, source).includes("repository_outside_boundary"));
  const inside = path.join(history, "bypass.ts");
  assert.ok(violations(inside, 'import bootstrap from "../../../../desktop/storage-bootstrap.ts";').includes("repository_authority_expansion"));
  assert.ok(violations(inside, 'import { deriveEvidence } from "../../../services/learning-kernel/derive-evidence.ts";').includes("repository_authority_expansion"));
  assert.ok(violations(inside, 'const root = process.cwd();').includes("arbitrary_root_or_renderer"));
});

test("real repository signatures reject arbitrary Host path and serialized/base captured facts", () => {
  const file = path.join(history, "type-contract-fixture.ts");
  const source = 'import { openDiagnosticHistoryRepository } from "./repository.ts";\n'
    + 'import type { ManagedStorageHostConfig } from "../../../platform/managed-storage.js";\n'
    + 'import type { DiagnosticHistoryRepository } from "../../../types/domains/diagnostic-history.ts";\n'
    + 'import type { DiagnosticCapturedAttemptV1, IssuedDiagnosticCapturedAttemptV1 } from "../../../types/domains/first-party-diagnostic-capture.ts";\n'
    + 'declare const config: ManagedStorageHostConfig; declare const repo: DiagnosticHistoryRepository;\n'
    + 'declare const raw: DiagnosticCapturedAttemptV1; declare const issued: IssuedDiagnosticCapturedAttemptV1;\n'
    + 'openDiagnosticHistoryRepository(config); repo.appendCapturedAttempt(issued);\n'
    + 'openDiagnosticHistoryRepository("E:\\\\arbitrary"); repo.appendCapturedAttempt(raw);';
  const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext,
    types: ["node"], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  const matches = (target: string) => path.resolve(target).toLowerCase() === file.toLowerCase();
  const fileExists = host.fileExists;
  host.fileExists = (target) => matches(target) || fileExists(target);
  host.getSourceFile = (target, ...args) => matches(target) ? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true) : original(target, ...args);
  const program = ts.createProgram([file], options, host);
  assert.ok(program.getSourceFile(file));
  const diagnostics = program.getSemanticDiagnostics();
  assert.equal(diagnostics.length, 2, diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("\n"));
  assert.ok(diagnostics.every((diagnostic) => diagnostic.code === 2345));
});
