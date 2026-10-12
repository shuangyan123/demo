import ts from "typescript";
import path from "node:path";

/** 仅检查传入的 repo-owned production source；用 AST/symbol 追踪 key，未知动态 key fail closed。 */
export function auditLocalStoragePolicies(sources, policies) {
  const files = new Map([...sources].map(([file, source]) => [path.resolve(file), source]));
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true, types: [] };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (file, languageVersion, ...rest) => files.has(path.resolve(file))
    ? ts.createSourceFile(file, files.get(path.resolve(file)), languageVersion, true) : original(file, languageVersion, ...rest);
  // key symbols 只依赖本仓库；不加载 React/Next/第三方依赖的 source 或声明图。
  host.resolveModuleNames = (names, containingFile) => names.map((name) => {
    const base = name.startsWith("@/") ? path.resolve("app", "..", name.slice(2))
      : name.startsWith(".") ? path.resolve(path.dirname(containingFile), name) : undefined;
    if (!base) return undefined;
    const file = [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.js$/, ".ts")].find((candidate) => files.has(candidate));
    return file ? { resolvedFileName: file, extension: file.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts } : undefined;
  });
  const program = ts.createProgram([...files.keys()], options, host);
  const checker = program.getTypeChecker();
  const astFiles = [...files.keys()].map((file) => program.getSourceFile(file));
  const calls = [];
  const visit = (node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); };
  astFiles.forEach(visit);
  const symbol = (node) => {
    const found = checker.getSymbolAtLocation(node);
    return found && (found.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(found) : found;
  };
  function values(node, seen = new Set()) {
    if (!node || seen.has(node)) return ["*"];
    const next = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return values(node.expression, next);
    if (ts.isConditionalExpression(node)) return [...values(node.whenTrue, next), ...values(node.whenFalse, next)];
    if (ts.isTemplateExpression(node)) {
      let result = [node.head.text];
      for (const span of node.templateSpans) result = result.flatMap((prefix) => values(span.expression, next).map((value) => prefix + value + span.literal.text));
      return result;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return values(node.left, next).flatMap((left) => values(node.right, next).map((right) => left + right));
    if (ts.isCallExpression(node)) {
      const fn = symbol(node.expression)?.declarations?.find(ts.isFunctionDeclaration);
      const returns = [];
      const collect = (child) => {
        if (ts.isReturnStatement(child) && child.expression) returns.push(child.expression);
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, collect);
      };
      if (fn?.body) {
        ts.forEachChild(fn.body, collect);
        const resolved = returns.flatMap((expression) => values(expression, next));
        return resolved.length ? resolved : ["*"];
      }
      return ["*"];
    }
    const declarations = symbol(ts.isPropertyAccessExpression(node) ? node.name : node)?.declarations ?? [];
    const resolved = declarations.flatMap((declaration) => {
      if ((ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) return values(declaration.initializer, next);
      if (ts.isParameter(declaration) && ts.isFunctionDeclaration(declaration.parent) && declaration.parent.name) {
        const fnSymbol = symbol(declaration.parent.name);
        const index = declaration.parent.parameters.indexOf(declaration);
        return calls.filter((call) => symbol(call.expression) === fnSymbol).flatMap((call) => values(call.arguments[index], next));
      }
      return [];
    });
    return resolved.length ? resolved : ["*"];
  }
  function isLocalStorage(node, seen = new Set()) {
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return isLocalStorage(node.expression, next);
    if (ts.isConditionalExpression(node)) return isLocalStorage(node.whenTrue, next) || isLocalStorage(node.whenFalse, next);
    if (ts.isIdentifier(node) && node.text === "localStorage") return true;
    if (ts.isPropertyAccessExpression(node) && node.name.text === "localStorage") return true;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "localStorage") return true;
    if (ts.isCallExpression(node)) {
      const fn = symbol(node.expression)?.declarations?.find(ts.isFunctionDeclaration);
      let found = false;
      const inspect = (child) => {
        if (ts.isReturnStatement(child) && child.expression) found ||= isLocalStorage(child.expression, next);
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, inspect);
      };
      if (fn?.body) ts.forEachChild(fn.body, inspect);
      return found;
    }
    return (symbol(node)?.declarations ?? []).some((declaration) => {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) return isLocalStorage(declaration.initializer, next);
      if (ts.isParameter(declaration) && ts.isFunctionDeclaration(declaration.parent) && declaration.parent.name) {
        const fnSymbol = symbol(declaration.parent.name);
        const index = declaration.parent.parameters.indexOf(declaration);
        return calls.some((call) => symbol(call.expression) === fnSymbol && isLocalStorage(call.arguments[index], next));
      }
      return false;
    });
  }
  const patterns = policies.flatMap(({ pattern }) => {
    if (!pattern.includes("|")) return [pattern];
    const colon = pattern.lastIndexOf(":");
    return pattern.slice(colon + 1).split("|").map((version) => pattern.slice(0, colon + 1) + version);
  });
  const issues = [];
  for (const call of calls) {
    const target = call.expression;
    const method = ts.isPropertyAccessExpression(target) ? target.name.text
      : ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression) ? target.argumentExpression.text : undefined;
    if (method !== "setItem" || !isLocalStorage(target.expression)) continue;
    for (const key of new Set(values(call.arguments[0]))) {
      const classified = patterns.some((pattern) => pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern);
      if (!classified) issues.push({ file: call.getSourceFile().fileName, key, line: call.getSourceFile().getLineAndCharacterOfPosition(call.getStart()).line + 1 });
    }
  }
  return issues;
}
