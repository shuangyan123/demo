import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(path: string) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("ReviewWorkspace 首屏不再静态引入低频视图和重型服务", async () => {
  const source = await readSource("../review/review-workspace.tsx");
  const forbiddenStaticImports = [
    "../import/review-import-view",
    "../import/use-import-drafts",
    "../automation/automation-view",
    "../interview/interview-workspace",
    "../tutoring/tutoring-workspace",
    "../settings/settings-workspace",
    "../../services/ai-association-service",
    "../../services/obsidian-knowledge-repository",
  ];

  for (const specifier of forbiddenStaticImports) {
    assert.doesNotMatch(source, new RegExp(`import\\s+(?:type\\s+)?[\\s\\S]*?from\\s+["']${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  }

  assert.match(source, /dynamic\(\(\) => import\("\.\.\/import\/import-workspace"\)/);
  assert.match(source, /await import\("\.\.\/\.\.\/services\/ai-association-service"\)/);
  assert.match(source, /await import\("\.\.\/\.\.\/services\/obsidian-knowledge-repository"\)/);
});

test("ReviewWorkspace 把健康检查、诊断输入和恢复导航交给专用 hook", async () => {
  const source = await readSource("../review/review-workspace.tsx");

  assert.match(source, /useReviewWorkspaceHealth/);
  assert.match(source, /useReviewWorkspaceRecoveryNavigation/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/onboarding\/use-configuration-health["']/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/diagnostics\/use-local-diagnostics["']/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/\.\.\/\.\.\/package\.json["']/);
  assert.doesNotMatch(source, /setSettingsInitialSection/);
});

test("KnowledgeWorkspace 把列表控制和 Obsidian 重服务留在专用边界", async () => {
  const workspaceSource = await readSource("../knowledge/knowledge-workspace.tsx");
  const obsidianSource = await readSource("../knowledge/use-obsidian-knowledge-bridge.ts");

  assert.match(workspaceSource, /useKnowledgeListController/);
  assert.doesNotMatch(workspaceSource, /from\s+["']\.\.\/shared\/use-visible-limit["']/);
  assert.doesNotMatch(workspaceSource, /from\s+["']\.\.\/shared\/use-bulk-selection["']/);
  assert.doesNotMatch(obsidianSource, /from\s+["']\.\.\/\.\.\/services\/obsidian-knowledge-repository["']/);
  assert.doesNotMatch(obsidianSource, /from\s+["']\.\.\/\.\.\/services\/knowledge-evolution-service["']/);
  assert.match(obsidianSource, /await import\("\.\.\/\.\.\/services\/obsidian-knowledge-repository"\)/);
  assert.match(obsidianSource, /await import\("\.\.\/\.\.\/services\/knowledge-evolution-service"\)/);
});

test("TutoringWorkspace 只保留记录、计划和资料关联，实时辅导按对话动态加载", async () => {
  const source = await readSource("../tutoring/tutoring-workspace.tsx");
  const conversationSource = await readSource("../conversation/conversation-workspace.tsx");

  assert.doesNotMatch(source, /useTutoringSessionController/);
  assert.doesNotMatch(source, /from\s+["']\.\/use-tutoring-media["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/use-frame-sampler["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/use-tutoring-speech["']/);
  assert.doesNotMatch(source, /resolvePersonaVoice/);
  assert.match(conversationSource, /dynamic\([\s\S]*?conversation-tutoring-experience/);
  assert.match(conversationSource, /await import\("\.\/conversation-tutoring-runtime"\)/);
  assert.doesNotMatch(conversationSource, /from\s+["']\.\/conversation-tutoring-runtime["']/);
});

test("辅导模型请求显式传递对话模型与运行参数", async () => {
  const source = await readSource("../../services/tutoring-ai-service.ts");

  assert.match(source, /modelId\?: string/);
  assert.match(source, /selectedRuntimeValues\?: AiSelectedRuntimeValues/);
  assert.match(source, /modelId: input\.modelId/);
  assert.match(source, /selectedRuntimeValues: input\.selectedRuntimeValues/);
});

test("模块上下文和视觉工具统一进入新对话", async () => {
  const conversationSource = await readSource("../conversation/conversation-workspace.tsx");
  const composerSource = await readSource("../conversation/conversation-composer.tsx");
  const controllerSource = await readSource("../review/use-review-conversation-controller.ts");
  const shellSource = await readSource("../review/review-workspace-shell.tsx");
  const explorerSource = await readSource("../review/learning-data-explorer.tsx");

  assert.match(conversationSource, /useConversationVisionTools/);
  assert.match(conversationSource, /ConversationComposer/);
  assert.match(composerSource, />摄像头</);
  assert.match(composerSource, />屏幕共享</);
  assert.match(controllerSource, /launchContext/);
  assert.match(controllerSource, /kind:\s*"context"/);
  assert.match(explorerSource, /在新对话中继续/);
  assert.doesNotMatch(shellSource, /板块筛选/);
});

test("Dexie v16 只执行对话文件夹建模后的旧空草稿清理", async () => {
  const source = await readSource("../../db/review-db.ts");
  const migrationSource = await readSource("../../db/review-db-migrations.ts");

  assert.match(source, /this\.version\(14\)\.stores/);
  assert.match(source, /this\.version\(15\)\.stores/);
  assert.match(source, /this\.version\(16\)\.stores/);
  assert.match(source, /aiProjects:\s*"&id, studyDomainId, updatedAt, createdAt"/);
  assert.match(source, /aiConversationFolders:\s*"&id, projectId, parentId, updatedAt, \[projectId\+parentId\+sortOrder\]"/);
  assert.match(source, /upgrade\(migrateToV16\)/);
  assert.match(migrationSource, /conversation\.title === "新对话" && conversation\.messageCount === 0/);
  assert.match(source, /aiConversationMessages:\s*"&id, conversationId, role, createdAt"/);
  assert.match(source, /aiConversationRunSteps:\s*"&id, conversationId, runId, state, updatedAt"/);
  assert.doesNotMatch(source, /\[(?:board|category|mastery)\+(?:updatedAt|createdAt|nextReviewAt)\]/);
});

test("PDF 和 DOCX 解析依赖只在文件解析时动态加载", async () => {
  const source = await readSource("../../services/fenbi-import-service.ts");

  assert.doesNotMatch(source, /import\s+[\s\S]*?from\s+["']pdfjs-dist/);
  assert.doesNotMatch(source, /import\s+[\s\S]*?from\s+["']mammoth["']/);
  assert.match(source, /await import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  assert.match(source, /await import\("mammoth"\)/);
});
