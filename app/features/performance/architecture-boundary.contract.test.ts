import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const APP_ROOT = path.resolve(process.cwd(), "app");

/** 递归读取应用源码，用于建立不依赖第三方工具的架构守卫。 */
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [target] : [];
  }));
  return nested.flat();
}

function staticImports(source: string): string[] {
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

test("大型 workspace 保持受控预算并使用专用 controller", async () => {
  const budgets = new Map([
    ["features/review/review-workspace.tsx", 1080],
    ["features/review/review-dashboard-view.tsx", 320],
    ["features/knowledge/knowledge-workspace.tsx", 825],
    ["features/tutoring/tutoring-workspace.tsx", 775],
    ["features/conversation/conversation-workspace.tsx", 500],
    ["features/conversation/conversation-composer.tsx", 300],
    ["features/shared/workspace-shell.tsx", 240],
  ]);
  for (const [relativePath, budget] of budgets) {
    const source = await readFile(path.join(APP_ROOT, relativePath), "utf8");
    assert.ok(source.split(/\r?\n/).length <= budget, `${relativePath} 超过 ${budget} 行架构预算`);
  }
  const reviewSource = await readFile(path.join(APP_ROOT, "features/review/review-workspace.tsx"), "utf8");
  assert.match(reviewSource, /useReviewConversationController/);
  assert.doesNotMatch(reviewSource, /services\/conversation-repository/);
  assert.doesNotMatch(reviewSource, /services\/command-search/);
});

test("WorkspaceShell 默认向所有宿主提供通用外层边界", async () => {
  const shellSource = await readFile(path.join(APP_ROOT, "features/shared/workspace-shell.tsx"), "utf8");
  const reviewShellSource = await readFile(path.join(APP_ROOT, "features/review/review-workspace-shell.tsx"), "utf8");
  const settingsShellSource = await readFile(path.join(APP_ROOT, "features/settings/settings-workspace.tsx"), "utf8");
  const shellStyles = await readFile(path.join(APP_ROOT, "styles/shell.css"), "utf8");

  assert.match(shellSource, /contentSurface = "raised-seam"/);
  assert.match(shellSource, /contentSurface\?: "plain" \| "raised-seam"/);
  assert.match(shellSource, /className="chrome-content-frame"/);
  assert.match(shellSource, /data-content-surface=\{contentSurface\}/);
  assert.doesNotMatch(reviewShellSource, /contentSurface=\{view === "conversation"/);
  assert.doesNotMatch(settingsShellSource, /contentSurface="plain"/);
  assert.match(shellStyles, /\.chrome-content-frame\[data-content-surface="raised-seam"\]/);
  assert.doesNotMatch(shellStyles, /\.conversation-shell-content\s*\{[\s\S]*?(?:margin-left|border-top-left-radius|box-shadow)/);
});

test("公考学习链路拆分为经过节点中心的四段桌面路径", async () => {
  const flowSource = await readFile(path.join(APP_ROOT, "features/review/dashboard-study-flow.tsx"), "utf8");

  assert.match(flowSource, /data-flow-segment="top" d="M125 40 H875"/);
  assert.match(flowSource, /data-flow-segment="bend" d="M875 40 C950 40 958 190 875 190"/);
  assert.match(flowSource, /data-flow-segment="return" d="M875 190 H125"/);
  assert.match(flowSource, /data-flow-segment="tail" d="M125 190 C70 190 70 250 110 250"/);
  assert.match(flowSource, /dashboard-flow-gradient-return/);
  assert.match(flowSource, /data-flow-node=\{index \+ 1\}/);
});

test("低频功能不通过静态依赖回到主工作台", async () => {
  const source = await readFile(path.join(APP_ROOT, "features/review/review-workspace.tsx"), "utf8");
  const imports = staticImports(source);
  for (const forbidden of ["../automation/automation-view", "../import/import-workspace", "../interview/interview-workspace", "../settings/settings-workspace", "../tutoring/tutoring-workspace"]) {
    assert.ok(!imports.includes(forbidden), `检测到低频模块静态依赖：${forbidden}`);
  }
});

test("应用源码不存在相对静态 import 循环", async () => {
  const files = await sourceFiles(APP_ROOT);
  const normalized = new Set(files.map(path.normalize));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const edges = staticImports(source).filter((specifier) => specifier.startsWith(".")).flatMap((specifier) => {
      const base = path.resolve(path.dirname(file), specifier);
      return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].filter((candidate) => normalized.has(path.normalize(candidate))).slice(0, 1);
    });
    graph.set(path.normalize(file), edges.map(path.normalize));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(file: string, trail: string[]) {
    if (visiting.has(file)) assert.fail(`检测到循环依赖：${[...trail, file].map((item) => path.relative(APP_ROOT, item)).join(" -> ")}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const edge of graph.get(file) ?? []) visit(edge, [...trail, file]);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
});
