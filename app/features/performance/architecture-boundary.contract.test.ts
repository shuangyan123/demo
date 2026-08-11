import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import "../review/learning-insight-model.contract.test.ts";
import "../../server/http/route-security.contract.test.ts";
import "../../services/local-runtime-diagnostics.contract.test.ts";
import "./neutral-interaction.contract.test.ts";
import "../../platform/host.contract.test.ts";
import "../../application/interview/interview-application.contract.test.ts";
import "../../application/automation/automation-application.contract.test.ts";
import "../../application/import/import-application.contract.test.ts";

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

test("业务源码直接引用领域类型且核心 facade 保持预算", async () => {
  const files = await sourceFiles(APP_ROOT);
  const compatibilityImports: string[] = [];
  for (const file of files) {
    if (file.endsWith(path.join("types", "review.ts"))) continue;
    const source = await readFile(file, "utf8");
    if (staticImports(source).some((specifier) => /(?:^|\/)types\/review(?:\.ts)?$/.test(specifier))) {
      compatibilityImports.push(path.relative(APP_ROOT, file));
    }
  }
  assert.deepEqual(compatibilityImports, []);

  const budgets = new Map([
    ["types/review.ts", 300],
    ["server/ai/provider-adapter.ts", 500],
    ["server/ai/provider-speech-adapter.ts", 500],
    ["services/obsidian-knowledge-repository.ts", 500],
    ["services/obsidian-repository-helpers.ts", 500],
  ]);
  for (const [relativePath, budget] of budgets) {
    const lines = (await readFile(path.join(APP_ROOT, relativePath), "utf8")).split(/\r?\n/).length;
    assert.ok(lines <= budget, `${relativePath} 为 ${lines} 行，超过 ${budget} 行预算`);
  }
});

test("业务层只能通过 Host Capability 访问 Electron preload", async () => {
  const files = await sourceFiles(APP_ROOT);
  const directBridgeReferences: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(APP_ROOT, file).replace(/\\/g, "/");
    if (relativePath === "types/review-desktop.d.ts" || relativePath.startsWith("platform/desktop/")) continue;
    const source = await readFile(file, "utf8");
    if (/reviewDesktop(?:Vault|Window)/.test(source)) directBridgeReferences.push(relativePath);
  }
  assert.deepEqual(directBridgeReferences, []);

  const platformFiles = files.filter((file) => file.includes(path.join("app", "platform")));
  for (const file of platformFiles) {
    const source = await readFile(file, "utf8");
    const imports = staticImports(source);
    assert.equal(imports.some((target) => /(?:^|\/)(?:application|features|services|db|server)(?:\/|$)/.test(target)), false);
    assert.equal(imports.some((target) => target === "react" || target.startsWith("react/")), false);
  }
});

test("Application Layer 保持纯 TypeScript 且不反向依赖 UI 或宿主全局", async () => {
  const applicationRoot = path.join(APP_ROOT, "application");
  const files = await sourceFiles(applicationRoot);
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const imports = staticImports(source);
    const forbiddenImport = imports.find((target) => (
      target === "react"
      || target.startsWith("react/")
      || target === "react-dom"
      || target.startsWith("react-dom/")
      || target.startsWith("next/")
      || /(?:^|\/)features(?:\/|$)/.test(target)
      || /\.css$/i.test(target)
    ));
    if (forbiddenImport || /reviewDesktop(?:Vault|Window)|\bwindow\b|\bdocument\b/.test(source)) {
      violations.push(path.relative(APP_ROOT, file).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(violations, []);
});

test("AI capability core 保持纯 TypeScript 且不反向依赖协议实现", async () => {
  const capabilityFiles = [
    "types/domains/ai-capability.ts",
    "services/ai-capability-resolution.ts",
    "services/provider-protocol-capabilities.ts",
    "services/model-runtime-descriptors.ts",
  ];
  for (const relativePath of capabilityFiles) {
    const source = await readFile(path.join(APP_ROOT, relativePath), "utf8");
    const imports = staticImports(source);
    assert.equal(imports.some((target) => target === "react" || target.startsWith("react/") || target.startsWith("next/") || target.includes("/features/") || target.includes("/server/ai/")), false, relativePath);
    assert.doesNotMatch(source, /\bfetch\s*\(|reviewDb|reviewDesktop(?:Vault|Window)|apiKey|Authorization|\.tsx["']/i, relativePath);
    if (relativePath === "services/ai-capability-resolution.ts") assert.doesNotMatch(source, /provider-model-cache/, relativePath);
  }
  const adapterRegistry = await readFile(path.join(APP_ROOT, "server/ai/provider-adapter-registry.ts"), "utf8");
  assert.match(adapterRegistry, /provider-protocol-capabilities/);
});

test("AI provider normalization keeps failure data safe and vendor fields behind the adapter", async () => {
  const failureCore = await readFile(path.join(APP_ROOT, "services/ai-provider-failure.ts"), "utf8");
  const providerFailure = await readFile(path.join(APP_ROOT, "server/ai/provider-failure.ts"), "utf8");
  const registry = await readFile(path.join(APP_ROOT, "server/ai/provider-adapter-registry.ts"), "utf8");
  const route = await readFile(path.join(APP_ROOT, "api/ai/generate/route.ts"), "utf8");
  const client = await readFile(path.join(APP_ROOT, "services/api-client.ts"), "utf8");
  const clientFailure = await readFile(path.join(APP_ROOT, "services/ai-provider-failure-client.ts"), "utf8");
  const conversation = await readFile(path.join(APP_ROOT, "features/conversation/conversation-workspace.tsx"), "utf8");

  assert.doesNotMatch(failureCore, /apiKey|Authorization|prompt|raw response|hidden reasoning/i);
  assert.doesNotMatch(providerFailure, /apiKey|Authorization|prompt|raw response|hidden reasoning/i);
  assert.match(failureCore, /malformed_response/);
  assert.match(failureCore, /stream_interrupted/);
  assert.match(registry, /parseFailure/);
  assert.match(registry, /streamCompletion/);
  assert.match(route, /adapter\.parseFailure/);
  assert.match(route, /classifyProviderStreamFailure/);
  assert.match(client, /providerFailureClientModule/);
  assert.match(clientFailure, /AiProviderFailureError/);
  assert.doesNotMatch(conversation, /(?:choices|candidates|output_text|content_block_delta|usageMetadata|prompt_tokens|completion_tokens)/);
  const conversationMessageUtils = await readFile(path.join(APP_ROOT, "features/conversation/conversation-message-utils.ts"), "utf8");
  assert.match(conversationMessageUtils, /AiProviderFailureError/);
  assert.match(conversationMessageUtils, /aiProviderFailureMessage/);
  assert.doesNotMatch(conversationMessageUtils, /at capacity|overload|resource exhausted|429|503/);
  assert.doesNotMatch(conversation, /模型没有返回文本/);
  assert.match(conversation, /requireConversationAssistantContent\(finalContent\)/);
  assert.doesNotMatch(conversation, /throw new Error\(event\.message\)/);
});

test("AI consumers remain behind the unified generation and normalization boundary", async () => {
  const consumerPaths = [
    "features/conversation/conversation-workspace.tsx",
    "services/tutoring-ai-service.ts",
    "services/interview-ai-service.ts",
    "services/automation-executor.ts",
    "services/knowledge-evolution-service.ts",
    "services/acquisition-proposal-service.ts",
    "services/fenbi-import-service.ts",
  ];
  const forbiddenVendorBoundary = /parseGenerateProvider|parseProviderFailure|getProviderAdapter|response\.json\(\)|output_text|content_block_delta|usageMetadata|prompt_tokens|completion_tokens|response\.completed|message_stop|step\.delta|generationConfig|reasoning_effort|thinkingConfig|anthropic-version/;
  for (const relativePath of consumerPaths) {
    const source = await readFile(path.join(APP_ROOT, relativePath), "utf8");
    const imports = staticImports(source);
    assert.equal(imports.some((target) => target.includes("/server/ai/")), false, relativePath);
    assert.match(source, /generateWithConnection/, relativePath);
    assert.doesNotMatch(source, forbiddenVendorBoundary, relativePath);
  }
  const automationFailure = await readFile(path.join(APP_ROOT, "services/automation-failure.ts"), "utf8");
  assert.match(automationFailure, /recoveryDiagnosis/);
  assert.match(automationFailure, /"recoveryDiagnosis"\s+in\s+error/);
  assert.match(automationFailure, /message: providerFailure\.message/);
  assert.doesNotMatch(automationFailure, /throw new Error\(event\.message\)/);
});

test("Connection-scoped capability resolver 独占缓存编排且 UI 不直接读取模型缓存", async () => {
  const resolverSource = await readFile(path.join(APP_ROOT, "services/ai-connection-client.ts"), "utf8");
  const conversationSource = await readFile(path.join(APP_ROOT, "features/conversation/conversation-workspace.tsx"), "utf8");
  assert.match(resolverSource, /providerModelCache/);
  assert.match(resolverSource, /resolveModelCapabilityProfile/);
  assert.match(resolverSource, /resolveConnectionModelCapabilityProfile\(connection: ApiConnectionProfile, modelId: string\)[\s\S]*?providerModelCache\.load\(connection\.id, connection\.provider, connection\.baseUrl\)[\s\S]*?resolveModelCapabilityProfile\(connection\.provider, modelId, discovered\)/);
  assert.match(conversationSource, /resolveConnectionModelCapabilityProfile/);
  assert.doesNotMatch(conversationSource, /provider-model-cache/);
});

test("学习行动队列保持只读纯派生边界", async () => {
  const source = await readFile(path.join(APP_ROOT, "services/learner-state-service.ts"), "utf8");
  const types = await readFile(path.join(APP_ROOT, "types/domains/learner-state.ts"), "utf8");
  const controller = await readFile(path.join(APP_ROOT, "features/review/use-review-workspace-controller.ts"), "utf8");
  const imports = staticImports(source);
  assert.equal(imports.some((target) => target === "react" || target.startsWith("react/") || target.includes("/features/") || target.includes("/server/ai/")), false);
  assert.doesNotMatch(source, /reviewDb\.(?:transaction|\w+\.(?:add|put|update|delete|bulkAdd|bulkPut|bulkDelete))\(/);
  assert.doesNotMatch(source, /fetch\(|generateAi|automationRepository|obsidianKnowledgeRepository|reviewDesktop(?:Vault|Window)/);
  assert.match(source, /reviewRepository\.loadSnapshot\(today\)/);
  assert.match(source, /knowledgeRepository\.loadTrainingSnapshot\(today\)/);
  assert.doesNotMatch(source, /reviewDb\.(?:mistakes|attempts|knowledgeEntries|knowledgeAttempts)\.toArray\(\)/);
  assert.match(source, /reviewDb\.interviewPracticePlans\.toArray\(\)/);
  assert.match(source, /deriveLearnerStateSnapshot/);
  assert.match(types, /semanticKey: string/);
  assert.match(types, /completionHint: string/);
  assert.doesNotMatch(types, /(?:isCompleted|completedAt|completionEvent|completionHistory):/);
  assert.match(controller, /nextView === "dashboard"[\s\S]{0,160}data\.refreshData\(\)/);
});

test("大型 workspace 保持受控预算并使用专用 controller", async () => {
  const budgets = new Map([
    ["features/review/review-workspace.tsx", 150],
    ["features/review/use-review-workspace-controller.ts", 300],
    ["features/review/use-review-learning-controller.ts", 500],
    ["features/review/use-review-knowledge-controller.ts", 500],
    ["features/review/review-workspace-view-router.tsx", 300],
    ["features/review/review-workspace-core-views.tsx", 300],
    ["features/review/review-workspace-secondary-views.tsx", 300],
    ["features/review/review-workspace-lazy-views.tsx", 120],
    ["features/review/review-workspace-shell.tsx", 500],
    ["features/review/review-dashboard-view.tsx", 320],
    ["features/knowledge/knowledge-workspace.tsx", 825],
    ["features/tutoring/tutoring-workspace.tsx", 230],
    ["features/conversation/conversation-workspace.tsx", 500],
    ["features/conversation/conversation-composer.tsx", 300],
    ["features/conversation/conversation-tutoring-experience.tsx", 300],
    ["features/interview/interview-workspace.tsx", 300],
    ["features/interview/interview-session-panel.tsx", 200],
    ["features/automation/automation-view.tsx", 220],
    ["features/automation/automation-overlays.tsx", 240],
    ["features/automation/automation-task-list.tsx", 190],
    ["features/automation/automation-inbox.tsx", 190],
    ["features/import/review-import-view.tsx", 500],
    ["features/knowledge/knowledge-training-view.tsx", 180],
    ["features/review/learning-insight-view.tsx", 180],
    ["features/settings/plugins/settings-plugins-view.tsx", 340],
    ["features/conversation/command-search-palette.tsx", 220],
    ["features/shared/learning-session-layout.tsx", 200],
    ["features/shared/workspace-shell.tsx", 240],
  ]);
  for (const [relativePath, budget] of budgets) {
    const source = await readFile(path.join(APP_ROOT, relativePath), "utf8");
    assert.ok(source.split(/\r?\n/).length <= budget, `${relativePath} 超过 ${budget} 行架构预算`);
  }
  const reviewSource = await readFile(path.join(APP_ROOT, "features/review/review-workspace.tsx"), "utf8");
  const controllerSource = await readFile(path.join(APP_ROOT, "features/review/use-review-workspace-controller.ts"), "utf8");
  const lazyViewsSource = await readFile(path.join(APP_ROOT, "features/review/review-workspace-lazy-views.tsx"), "utf8");
  const routeSources = await Promise.all([
    "features/review/review-workspace-view-router.tsx",
    "features/review/review-workspace-core-views.tsx",
    "features/review/review-workspace-secondary-views.tsx",
  ].map((relativePath) => readFile(path.join(APP_ROOT, relativePath), "utf8")));

  assert.match(reviewSource, /useReviewWorkspaceController/);
  assert.match(reviewSource, /ReviewWorkspaceViewRouter/);
  assert.doesNotMatch(reviewSource, /useState|repository|services\//);
  assert.match(controllerSource, /useReviewConversationController/);
  assert.match(controllerSource, /useReviewLearningController/);
  assert.match(controllerSource, /useReviewKnowledgeController/);
  assert.match(lazyViewsSource, /dynamic\(\s*\(\) => import\("\.\.\/knowledge\/knowledge-training-view"\)/);
  assert.match(lazyViewsSource, /dynamic\(\s*\(\) => import\("\.\.\/conversation\/conversation-workspace"\)/);
  routeSources.forEach((source) => {
    assert.equal(staticImports(source).some((target) => target.includes("/services/") || target.includes("repository")), false);
  });
  assert.match(routeSources[1], /view === "stats"/);
});

test("所有 React 组件均不超过五百行", async () => {
  const files = (await sourceFiles(APP_ROOT)).filter((file) => file.endsWith(".tsx"));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const inspect = (node: ts.Node) => {
      let name = "";
      if (ts.isFunctionDeclaration(node)) name = node.name?.text ?? "";
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        name = node.name.text;
      }
      if (/^[A-Z]/.test(name)) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
        assert.ok(end - start + 1 <= 500, `${path.relative(APP_ROOT, file)} 中组件 ${name} 超过 500 行`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
});

test("P3 低频表面使用本地样式与真实派生模型", async () => {
  const importSource = await readFile(path.join(APP_ROOT, "features/import/review-import-view.tsx"), "utf8");
  const insightSource = await readFile(path.join(APP_ROOT, "features/review/learning-insight-model.ts"), "utf8");
  const pluginSource = await readFile(path.join(APP_ROOT, "features/settings/plugins/settings-plugins-view.tsx"), "utf8");
  const searchSource = await readFile(path.join(APP_ROOT, "features/conversation/command-search-palette.tsx"), "utf8");

  assert.match(importSource, /review-import-view\.module\.css/);
  assert.match(importSource, /type ImportMobileStep = "source" \| "draft" \| "confirm"/);
  assert.match(insightSource, /MIN_RELIABLE_ATTEMPTS = 5/);
  assert.match(insightSource, /mistakeById\.has\(attempt\.mistakeId\)/);
  assert.match(pluginSource, /buildPluginDirectory\(settingsPluginDefinitions/);
  assert.doesNotMatch(pluginSource, /download|rating|推荐插件/);
  assert.match(searchSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(searchSource, /restoreFocusRef\.current\?\.focus\(\)/);
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
  assert.match(shellSource, /data-sidebar=\{sidebarCollapsed \? "collapsed" : "expanded"\}/);
  assert.doesNotMatch(shellSource, /integrationMode|data-integration-mode/);
  assert.doesNotMatch(shellSource, /chrome-topbar[^"]*border-b/);
  assert.doesNotMatch(shellSource, /chrome-sidebar[^"]*border-r/);
  assert.doesNotMatch(reviewShellSource, /contentSurface=\{view === "conversation"/);
  assert.doesNotMatch(settingsShellSource, /contentSurface="plain"/);
  assert.match(shellStyles, /\.chrome-content-frame\[data-content-surface="raised-surface"\]/);
  assert.match(shellStyles, /--chrome-workspace-top-inset:\s*12px/);
  assert.match(shellStyles, /\.chrome-shell \.chrome-content-frame\s*\{[\s\S]*?height: 100%;[\s\S]*?margin-top: 0;/);
  assert.match(shellStyles, /\.chrome-topbar\s*\{[\s\S]*?app-region: drag;/);
  assert.match(shellStyles, /\.chrome-topbar button,[\s\S]*?app-region: no-drag;/);
  assert.match(shellStyles, /\.chrome-shell::before\s*\{[\s\S]*?background-color: var\(--chrome-sidebar-bg\);[\s\S]*?background-image: var\(--chrome-sidebar-diffuse\);/);
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

test("新对话导航不会把 React 点击事件误传为启动上下文", async () => {
  const source = await readFile(path.join(APP_ROOT, "features/review/review-workspace-app-sidebar.tsx"), "utf8");
  assert.match(source, /onClick:\s*\(\)\s*=>\s*onStartNewConversation\(\)/);
  assert.doesNotMatch(source, /onClick:\s*onStartNewConversation/);
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
