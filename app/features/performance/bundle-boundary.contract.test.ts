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

test("TutoringWorkspace 把实时会话媒体和语音控制交给专用 controller", async () => {
  const source = await readSource("../tutoring/tutoring-workspace.tsx");

  assert.match(source, /useTutoringSessionController/);
  assert.doesNotMatch(source, /from\s+["']\.\/use-tutoring-media["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/use-frame-sampler["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/use-tutoring-speech["']/);
  assert.doesNotMatch(source, /resolvePersonaVoice/);
});

test("Dexie v14 只用于通用 AI 会话持久化", async () => {
  const source = await readSource("../../db/review-db.ts");

  assert.match(source, /this\.version\(13\)\.stores/);
  assert.match(source, /this\.version\(14\)\.stores/);
  assert.match(source, /aiProjects:\s*"&id, studyDomainId, updatedAt, createdAt"/);
  assert.match(source, /aiConversations:\s*"&id, projectId, studyDomainId, kind, status, updatedAt, createdAt, \[projectId\+updatedAt\]"/);
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
