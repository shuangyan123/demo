import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { load as loadYaml } from "js-yaml";

const sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
const testPattern = /\.(?:contract\.test|test|spec)\.(?:[cm]?[jt]sx?)$/;
const posix = path.posix;

export function resolveLocalImport(from, specifier, paths) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const base = specifier.startsWith("@/") ? specifier.slice(2) : posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = [base];
  if (/\.[cm]?js$/.test(base)) candidates.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".d.ts"), base.replace(/\.mjs$/, ".mts"), base.replace(/\.cjs$/, ".cts"));
  for (const extension of [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json", ".css"]) {
    candidates.push(base + extension, posix.join(base, "index" + extension));
  }
  return candidates.find(candidate => paths.has(candidate)) ?? null;
}

export function importEdges(file, source, paths) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edges = [];
  const nonliteralLoads = [];
  const lineAt = node => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  const add = (node, specifier, kind, typeOnly = false) => edges.push({ from: file, specifier, to: resolveLocalImport(file, specifier, paths), kind, typeOnly, line: lineAt(node) });
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      let typeOnly = Boolean(ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly);
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && !node.importClause.name) {
        const elements = node.importClause.namedBindings.elements;
        typeOnly ||= elements.length > 0 && elements.every(element => element.isTypeOnly);
      }
      add(node, node.moduleSpecifier.text, ts.isImportDeclaration(node) ? "import" : "export", typeOnly);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) add(node, argument.text, "dynamic");
      else nonliteralLoads.push({ file, line: lineAt(node), kind: "nonliteral-module-load" });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return { edges, nonliteralLoads };
}

export function importClosure(roots, edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!edge.to || edge.typeOnly) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const reached = new Set();
  const pending = [...roots];
  while (pending.length) {
    const file = pending.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    pending.push(...(adjacency.get(file) ?? []));
  }
  return reached;
}

export function testEntrypoints(packageJson, texts, paths, edges) {
  const rootsFromCommand = command => [...command.matchAll(/(?:^|[\s"'])((?:app|desktop|scripts|e2e|test-support)\/[^\s"']+\.(?:[cm]?[jt]sx?))/g)].map(match => match[1]).filter(file => paths.has(file));
  const namesFromCommand = command => [...command.matchAll(/npm run ([\w:.-]+)/g)].map(match => match[1]);
  const scriptRoots = (name, visited = new Set()) => {
    if (visited.has(name)) return [];
    visited.add(name);
    const command = packageJson.scripts[name] ?? "";
    return [...new Set([...rootsFromCommand(command), ...namesFromCommand(command).flatMap(child => scriptRoots(child, visited))])];
  };
  const entrypoints = Object.entries(packageJson.scripts).map(([name, command]) => ({ kind: "npm", name, command, roots: scriptRoots(name) }));
  const workflows = [];
  for (const [file, source] of texts) if (file.startsWith(".github/workflows/") && /\.ya?ml$/.test(file)) {
    const workflow = loadYaml(source);
    for (const [job, definition] of Object.entries(workflow.jobs ?? {})) {
      const disabled = condition => condition === false || ["false", "${{ false }}"].includes(String(condition).trim());
      const commands = disabled(definition.if) ? [] : (definition.steps ?? []).filter(step => step.run && !disabled(step.if)).map(step => step.run);
      const names = commands.flatMap(namesFromCommand);
      const roots = [...new Set([...commands.flatMap(rootsFromCommand), ...names.flatMap(name => scriptRoots(name))])];
      const record = { kind: "workflow", name: `${file}:${job}`, roots, npmScripts: [...new Set(names)], runsOn: definition["runs-on"], condition: definition.if ?? null, timeoutMinutes: definition["timeout-minutes"] ?? null };
      entrypoints.push(record); workflows.push(record);
    }
  }
  return { entrypoints: entrypoints.map(entry => ({ ...entry, tests: [...importClosure(entry.roots, edges)].filter(file => testPattern.test(file)).sort() })), workflows };
}

function classify(file) {
  if (testPattern.test(file) || file.startsWith("e2e/") || file.startsWith("test-support/")) return ["test", "test owners", "test-dependent"];
  if (file.startsWith("docs/") || /\.md$/.test(file)) return ["documentation", "document author / domain owner", "none"];
  if (file.startsWith(".agents/") || file.startsWith(".codex/")) return ["agent-governance", "repository maintainers", "agent"];
  if (file.startsWith(".github/")) return ["ci", "release / CI maintainers", "hosted-runner"];
  if (file.startsWith("desktop/")) return ["host", "Electron Main / Preload", "Electron"];
  if (file.startsWith("scripts/")) return ["tooling", "build / validation maintainers", "Node"];
  if (file.startsWith("app/api/") || file.startsWith("app/server/")) return ["server", "Next server / domain adapter", "Next server"];
  if (file.startsWith("app/application/")) return ["application", "application use-case owner", "shared TypeScript"];
  if (file.startsWith("app/platform/")) return ["platform", "Host capability owner", "Web / Electron renderer"];
  if (file.startsWith("app/db/")) return ["persistence", "Dexie repository owner", "Web / Electron renderer"];
  if (file.startsWith("app/services/")) return ["service", "domain service / repository owner", "per-module; inspect imports"];
  if (file.startsWith("app/features/")) return ["feature", "feature controller / view owner", "Web / Electron renderer"];
  if (file.startsWith("app/types/")) return ["types", "domain contract owner", "type-only"];
  if (file.startsWith("app/lib/") || file.startsWith("app/config/") || file.startsWith("app/data/")) return ["shared", "shared utility / configuration owner", "per-module; inspect imports"];
  if (file.startsWith("app/")) return ["entry", "Next route / layout owner", "per-module; server or client"];
  if (/\.(?:png|jpe?g|gif|ico|svg|webp|woff2?|ttf)$/.test(file) || file.startsWith("assets/") || file.startsWith("public/")) return ["asset", "asset / brand owner", "static"];
  if (!file.includes("/") || file.startsWith("build/")) return ["configuration", "repository / build maintainers", "configuration-dependent"];
  return ["unclassified", "unassigned", "unknown"];
}

function git(args, options = {}) {
  return execFileSync("git", args, { maxBuffer: 96 * 1024 * 1024, ...options });
}

function readTextBlobs(entries) {
  const selected = entries.filter(entry => !/\.(?:png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|zip|exe)$/.test(entry.path));
  // 从精确 Git blob 读取，避免把后来本地补丁混进审计基线。
  const buffer = git(["cat-file", "--batch"], { input: selected.map(entry => entry.blob).join("\n") + "\n" });
  const texts = new Map();
  let offset = 0;
  for (const entry of selected) {
    const end = buffer.indexOf(10, offset);
    const size = Number(buffer.subarray(offset, end).toString().split(" ")[2]);
    const data = buffer.subarray(end + 1, end + 1 + size);
    if (!data.includes(0)) texts.set(entry.path, data.toString("utf8"));
    offset = end + 1 + size + 1;
  }
  return texts;
}

export function collectInventory(ref) {
  const commit = git(["rev-parse", ref]).toString().trim();
  const entries = git(["ls-tree", "-r", "-l", "-z", commit]).toString().split("\0").filter(Boolean).map(row => {
    const [metadata, file] = row.split("\t");
    const [mode, objectType, blob, bytes] = metadata.trim().split(/\s+/);
    return { path: file, mode, objectType, blob, bytes: Number(bytes) };
  });
  const paths = new Set(entries.map(entry => entry.path));
  const texts = readTextBlobs(entries);
  const edges = [], nonliteralLoads = [], signals = [], links = [], documents = [];
  const riskPatterns = {
    "html-sink": /dangerouslySetInnerHTML|\binnerHTML\s*=/,
    "code-execution": /\beval\s*\(|new Function\s*\(/,
    "suppression": /@ts-ignore|@ts-nocheck|eslint-disable/,
    "untyped-any": /\bas any\b|:\s*any\b/,
    "console": /\bconsole\.(?:log|warn|error|debug)/,
    "external-io": /\bfetch\s*\(|\bWebSocket\b|ipcMain\.(?:handle|on)|writeFile|renameSync/,
    "runtime-global": /\b(?:window|document|localStorage|indexedDB|globalThis)\b|process\.env|reviewDesktop|reviewFenbi/,
  };
  const inventory = entries.map(entry => {
    const [layer, owner, environment] = classify(entry.path);
    const source = texts.get(entry.path);
    const risks = new Set();
    if (source !== undefined && sourcePattern.test(entry.path)) {
      const result = importEdges(entry.path, source, paths);
      edges.push(...result.edges); nonliteralLoads.push(...result.nonliteralLoads);
      source.split(/\r?\n/).forEach((line, index) => {
        for (const [kind, pattern] of Object.entries(riskPatterns)) if (pattern.test(line)) {
          risks.add(kind); signals.push({ file: entry.path, line: index + 1, kind });
        }
      });
    }
    if (source !== undefined && /\.md$/.test(entry.path)) {
      const headings = source.split(/\r?\n/).map((text, index) => ({ text, line: index + 1 })).filter(row => /^#{1,6} /.test(row.text));
      const status = /历史记录|historical/i.test(source.slice(0, 800)) ? "Historical or mixed; inspect context" : /RFC|提议|proposed/i.test(source.slice(0, 800)) ? "Proposed / implemented mix; inspect phase status" : "Current candidate; verify against code";
      documents.push({ file: entry.path, status, headings });
      for (const match of source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1];
        if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
        const clean = decodeURI(target.split("#")[0]);
        const resolved = posix.normalize(posix.join(posix.dirname(entry.path), clean));
        links.push({ file: entry.path, line: source.slice(0, match.index).split("\n").length, target, resolved, exists: paths.has(resolved) || [...paths].some(file => file.startsWith(resolved + "/")) });
      }
    }
    return { ...entry, layer, owner, ownerBasis: "logical responsibility inferred from path; no named CODEOWNER asserted", environment, lines: source?.split(/\r?\n/).length ?? null, risks: [...risks], review: source === undefined ? "metadata-indexed; no visual review" : "static-indexed; semantic review tracked separately" };
  });
  const packageJson = JSON.parse(texts.get("package.json"));
  const { entrypoints: closures, workflows } = testEntrypoints(packageJson, texts, paths, edges);
  const tests = inventory.filter(entry => testPattern.test(entry.path)).map(entry => ({ file: entry.path, kind: /\.spec\./.test(entry.path) ? "Playwright" : /-live\.test\./.test(entry.path) ? "live" : "Node", entrypoints: closures.filter(point => point.tests.includes(entry.path)).map(point => point.name), osOrOptInSignals: (texts.get(entry.path) ?? "").split(/\r?\n/).map((text, index) => ({ text: text.trim(), line: index + 1 })).filter(row => /process\.platform|\.skip\(|skip:|process\.env/.test(row.text)) }));
  const counts = field => Object.fromEntries([...new Set(inventory.map(entry => entry[field]))].sort().map(value => [value, inventory.filter(entry => entry[field] === value).length]));
  return { schemaVersion: 1, baseline: commit, generatedAt: new Date().toISOString(), limits: ["Static import closure is not proof of test execution or behavioral coverage", "Nonliteral module loads require manual review", "Workflow conditions and artifact requirements require contextual review", "All file owners are logical inferred responsibilities", "Binary assets are metadata-only; not visually inspected", "Playwright discovery is separately verified using --list", "No statement that all code was manually reviewed"], summary: { trackedFiles: inventory.length, textFiles: texts.size, sourceFiles: inventory.filter(entry => sourcePattern.test(entry.path)).length, testFiles: tests.length, byLayer: counts("layer"), unclassified: inventory.filter(entry => entry.layer === "unclassified").map(entry => entry.path), unresolvedLocalImports: edges.filter(edge => !edge.to && (edge.specifier.startsWith(".") || edge.specifier.startsWith("@/"))), oversized: inventory.filter(entry => entry.lines > 500 && sourcePattern.test(entry.path)).map(({ path, lines, layer }) => ({ path, lines, layer })), brokenLinks: links.filter(link => !link.exists) }, inventory, edges, nonliteralLoads, signals, documents, links, tests, entrypoints: closures, workflows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ref = process.argv[2] ?? "HEAD";
  const output = process.argv[3] ?? ".cache/repository-audit/inventory.json";
  const result = collectInventory(ref);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.summary, null, 2));
}
