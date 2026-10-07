import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const allowed = new Set([
  "desktop/main.ts", "desktop/managed-storage.ts", "desktop/storage-bootstrap.ts", "desktop/storage-bootstrap-record.ts", "desktop/storage-bootstrap-io.ts",
  "app/server/diagnostic/history/repository.ts", "app/server/diagnostic/history/repository-core.ts",
]);
const isStorage = (target: string) => /(?:^|\/)(?:managed-storage|storage-bootstrap(?:-record|-io)?)(?:\.(?:d\.)?(?:ts|js))?$/.test(target);

/** AST 覆盖 type/alias/re-export/dynamic/require；路径 authority 不进入 Kernel 或 renderer。 */
function violations(file: string, source: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];
  const inspect = (node: ts.Node) => {
    let specifier: string | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) specifier = node.argument.literal.text;
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) specifier = node.moduleReference.expression.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specifier = node.arguments[0].text;
    if (specifier) {
      if (isStorage(specifier) && !allowed.has(file)) issues.push("host_storage_outside_boundary");
      if (file.startsWith("app/services/learning-kernel/") && (specifier.includes("storage") || specifier.startsWith("node:fs") || specifier === "fs")) issues.push("kernel_storage_dependency");
      const resolved = specifier.startsWith("@/") ? path.resolve(root, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(root, path.dirname(file), specifier) : "";
      if (file.startsWith("app/") && resolved.startsWith(path.join(root, "desktop") + path.sep)) issues.push("desktop_path_in_app");
    }
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && node.type.getText(ast).includes("ManagedStorageHostConfig")
      && file !== "desktop/storage-bootstrap-record.ts") issues.push("forged_host_configuration");
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  return issues;
}

async function sources(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  }))).flat();
}

test("managed storage authority stays in Host and internal repository boundary; no renderer/Kernel consumer", async () => {
  for (const file of [...await sources(path.join(root, "app")), ...await sources(path.join(root, "desktop"))]) {
    assert.deepEqual(violations(path.relative(root, file).replace(/\\/g, "/"), await readFile(file, "utf8")), [], file);
  }
  const preload = await readFile(path.join(root, "desktop/preload.cts"), "utf8");
  // 既有 Vault 的 managedRoot 是受限外部 Vault 相对目录，不能与 Recall profile authority 混淆。
  assert.doesNotMatch(preload, /profileRoot|managedFilesRoot|activeManagedRoot|storageBootstrap|setPath|chooseDataRoot|reviewDesktopManagedStorage/);
});

test("managed storage guard rejects Kernel/filesystem and renderer path authority bypass fixtures", () => {
  for (const source of [
    'import type { ManagedStorageHostConfig as Config } from "../../platform/managed-storage.js";',
    'import type { ManagedStorageHostConfig as Config } from "../../platform/managed-storage.d.ts";',
    'export * from "../../../desktop/storage-bootstrap.ts";',
    'type Config = typeof import("../../platform/managed-storage.js");',
    'const storage = require("../../../desktop/storage-bootstrap.ts");',
    'const storage = await import("../../../desktop/storage-bootstrap.ts");',
    'import storage = require("../../../desktop/storage-bootstrap.ts");',
    'const config = input as ManagedStorageHostConfig;',
  ]) assert.ok(violations("app/features/review/path-bypass.ts", source).length > 0);
  assert.ok(violations("app/services/learning-kernel/evidence.ts", 'import { readFile } from "node:fs";').includes("kernel_storage_dependency"));
});

test("startup gate resolves synchronously after single-instance lock and before ready/session/runtime", async () => {
  const main = await readFile(path.join(root, "desktop/main.ts"), "utf8");
  const seam = await readFile(path.join(root, "desktop/managed-storage.ts"), "utf8");
  const lifecycle = main.indexOf("if (isSquirrelLifecycleInvocation(process.argv))");
  const lock = main.indexOf("app.requestSingleInstanceLock()", lifecycle);
  const resolve = main.indexOf("const storageState = resolveDesktopManagedStorage()", lock);
  const ready = main.indexOf("app.whenReady()", resolve);
  assert.ok(lifecycle >= 0 && lock > lifecycle && resolve > lock && ready > resolve);
  assert.match(main.slice(resolve, ready), /storageState\.kind !== "ready" && storageState\.kind !== "legacy_existing_profile"[\s\S]*app\.exit\(1\)/);
  assert.doesNotMatch(seam, /\basync\b|whenReady|fromPartition|process\.env|process\.cwd|resourcesPath/);
  assert.doesNotMatch(main + seam, /app\.setPath\s*\(/);
  assert.match(seam, /app\.getPath\("appData"\)/);
  assert.match(seam, /app\.getPath\("userData"\)/);
  assert.match(seam, /app\.getPath\("sessionData"\)/);
});

test("future filesystem repository boundary accepts resolved Host config, rejects arbitrary root", () => {
  const file = path.join(root, "app/platform/storage-type-contract-fixture.ts");
  const source = 'import type { ManagedStorageHostConfig } from "./managed-storage.js";\n'
    + 'declare const trusted: ManagedStorageHostConfig;\n'
    + 'declare function repository(config: ManagedStorageHostConfig): void;\n'
    + 'repository(trusted);\nrepository("E:\\\\arbitrary-root");\n'
    + 'repository({ profileId: "id", epochId: "epoch", managedRoot: "root", profileRoot: "root", managedFilesRoot: "files" });';
  const options: ts.CompilerOptions = { noEmit: true, strict: true, types: [], lib: ["lib.es5.d.ts"], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  const matches = (target: string) => path.resolve(target).toLowerCase() === file.toLowerCase();
  const fileExists = host.fileExists;
  host.fileExists = (target) => matches(target) || fileExists(target);
  host.getSourceFile = (target, ...args) => matches(target) ? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true) : original(target, ...args);
  const program = ts.createProgram([file], options, host);
  assert.ok(program.getSourceFile(file), "type fixture must actually be loaded");
  const diagnostics = program.getSemanticDiagnostics();
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.code === 2345));
});
