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
    ["features/tutoring/tutoring-workspace.tsx", 230],
    ["features/conversation/conversation-workspace.tsx", 500],
    ["features/conversation/conversation-composer.tsx", 300],
    ["features/conversation/conversation-tutoring-experience.tsx", 300],
    ["features/interview/interview-workspace.tsx", 300],
    ["features/interview/interview-session-panel.tsx", 200],
    ["features/shared/learning-session-layout.tsx", 200],
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
  const baseStyles = await readFile(path.join(APP_ROOT, "styles/base.css"), "utf8");
  const uiStyles = await readFile(path.join(APP_ROOT, "styles/ui.css"), "utf8");
  const tokensStyles = await readFile(path.join(APP_ROOT, "styles/tokens.css"), "utf8");
  const appearanceSource = await readFile(path.join(APP_ROOT, "services/appearance-settings-repository.ts"), "utf8");
  const layoutSource = await readFile(path.join(APP_ROOT, "layout.tsx"), "utf8");
  const fenbiStyles = await readFile(path.join(APP_ROOT, "features/import/fenbi-quick-import-panel.module.css"), "utf8");

  assert.match(shellSource, /contentSurface = "raised-surface"/);
  assert.match(shellSource, /contentSurface\?: "plain" \| "raised-surface"/);
  assert.match(shellSource, /className="chrome-content-frame"/);
  assert.match(shellSource, /data-content-surface=\{contentSurface\}/);
  assert.doesNotMatch(shellSource, /chrome-topbar[^"]*border-b/);
  assert.doesNotMatch(shellSource, /chrome-sidebar[^"]*border-r/);
  assert.doesNotMatch(reviewShellSource, /contentSurface=\{view === "conversation"/);
  assert.doesNotMatch(settingsShellSource, /contentSurface="plain"/);
  assert.match(shellStyles, /\.chrome-content-frame\[data-content-surface="raised-surface"\]/);
  assert.match(shellStyles, /padding-left: 0;\s+overflow: visible;/);
  assert.doesNotMatch(shellStyles, /content-frame\[data-content-surface="raised-surface"\]::after/);
  assert.match(shellStyles, /\.chrome-topbar\s*\{[\s\S]*?background-image: var\(--chrome-topbar-diffuse\);/);
  assert.match(shellStyles, /body\[data-diffuse-gradient="true"\] \.chrome-topbar\s*\{[\s\S]*?transparent calc\(100% - 12px\),[\s\S]*?var\(--chrome-topbar-bg\) 100%[\s\S]*?var\(--chrome-topbar-diffuse\);/);
  assert.match(shellStyles, /\.diffuse-sidebar::before\s*\{[\s\S]*?mask-image: linear-gradient\(180deg, transparent 0, #000 12px\);/);
  assert.doesNotMatch(shellStyles, /content-frame\[data-content-surface="raised-surface"\]::before/);
  assert.match(shellStyles, /\.chrome-topbar\s*\{[\s\S]*?border-bottom: 0;/);
  assert.match(shellStyles, /\.chrome-sidebar\s*\{[\s\S]*?border-right: 0;/);
  assert.match(shellStyles, /data-content-surface="raised-surface"\] > \.chrome-content\s*\{\s+border: 0;[\s\S]*?border-top: 1px solid var\(--chrome-sidebar-border\);[\s\S]*?border-left: 1px solid var\(--chrome-sidebar-border\);[\s\S]*?border-top-left-radius: 18px;[\s\S]*?background-image: none;[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(shellStyles, /-1px -1px 3px -1px/);
  assert.doesNotMatch(shellStyles, /left 0 top 18px|left 18px top 0/);
  assert.match(shellStyles, /\.chrome-content\s*\{[\s\S]*?-ms-overflow-style: none;[\s\S]*?scrollbar-width: none;/);
  assert.match(shellStyles, /\.chrome-content::\-webkit-scrollbar\s*\{[\s\S]*?display: none;/);
  assert.match(shellStyles, /\.chrome-layout\s*\{[\s\S]*?background-color: var\(--chrome-window-bg\);[\s\S]*?background-image: none;/);
  assert.match(shellStyles, /\.chrome-content-frame\s*\{[\s\S]*?background: var\(--chrome-workspace-surface\);/);
  assert.match(shellStyles, /\.chrome-layout\.is-sidebar-expanded \.chrome-content-frame\[data-content-surface="raised-surface"\]\s*\{[\s\S]*?border-top-left-radius: 18px;/);
  assert.match(shellStyles, /body\[data-diffuse-gradient="true"\] \.chrome-content-frame\[data-content-surface\]\s*\{[\s\S]*?background-image: var\(--chrome-window-diffuse\);/);
  assert.match(shellStyles, /body\[data-diffuse-gradient="true"\] \.chrome-layout \.chrome-content-frame\[data-content-surface\] > \.chrome-content\s*\{[\s\S]*?background-color: transparent;/);
  assert.match(tokensStyles, /--chrome-topbar-diffuse: none;/);
  assert.match(appearanceSource, /setProperty\("--chrome-topbar-diffuse", topbarDiffuseBackground\)/);
  assert.match(layoutSource, /import \{ GeistMono \} from "geist\/font\/mono"/);
  assert.match(layoutSource, /\$\{GeistMono\.variable\}/);
  assert.match(fenbiStyles, /font-family: var\(--app-code-font\)/);
  assert.doesNotMatch(fenbiStyles, /font[^;]*ui-monospace/);
  assert.match(baseStyles, /input\.font-mono,[\s\S]*?font-family: var\(--app-code-font\);/);
  assert.match(shellStyles, /@media \(min-width: 1025px\)[\s\S]*?\.chrome-layout\.is-sidebar-expanded \.chrome-sidebar[\s\S]*?border-right-width: 0;/);
  assert.match(shellStyles, /\.chrome-layout\[data-mobile-sidebar\][\s\S]*?> \.chrome-content[\s\S]*?box-shadow: none !important;/);
  assert.doesNotMatch(shellStyles, /padding-left: 18px;/);
  assert.match(uiStyles, /\.conversation-workspace\s*\{[\s\S]*?height: 100%;/);
  assert.doesNotMatch(uiStyles, /\.conversation-workspace\s*\{[\s\S]*?height: calc\(100dvh - var\(--chrome-topbar-height\)\)/);
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
