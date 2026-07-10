import type {
  AiConversation,
  AiProject,
  AutomationSnapshot,
  CommandSearchResult,
  KnowledgeEntry,
  Mistake,
} from "../types/review.ts";
import { settingsPluginDefinitions } from "../features/settings/plugins/settings-plugin-registry.ts";
import { scheduledWorkspaceDefinition, studyDomainDefinitions } from "../features/study/study-registry.ts";

export type BuildCommandSearchInput = {
  projects: AiProject[];
  conversations: AiConversation[];
  mistakes: Mistake[];
  knowledgeEntries: KnowledgeEntry[];
  automationSnapshot: AutomationSnapshot;
};

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function matches(result: CommandSearchResult, keyword: string): boolean {
  if (!keyword) return true;
  return normalize(`${result.label} ${result.description} ${result.group}`).includes(keyword);
}

export function buildCommandSearchResults(input: BuildCommandSearchInput, query = ""): CommandSearchResult[] {
  const keyword = normalize(query);
  const studyDomain = studyDomainDefinitions[0];
  const results: CommandSearchResult[] = [
    {
      id: "new-chat",
      group: "chat",
      label: "新对话",
      description: "打开空白公考 AI 对话",
      shortcut: "Ctrl+N",
      view: "conversation",
      projectId: "civil-service",
    },
    ...input.conversations
      .filter((conversation) => conversation.status === "active")
      .slice(0, 30)
      .map((conversation, index): CommandSearchResult => ({
        id: `conversation:${conversation.id}`,
        group: "chat",
        label: conversation.title,
        description: conversation.lastMessagePreview || "AI 对话",
        shortcut: index < 9 ? `Ctrl+${index + 1}` : undefined,
        view: "conversation",
        projectId: conversation.projectId,
        conversationId: conversation.id,
      })),
    ...input.projects.map((project): CommandSearchResult => ({
      id: `project:${project.id}`,
      group: "project",
      label: project.label,
      description: project.description,
      view: "dashboard",
      projectId: project.id,
    })),
    ...studyDomain.modules.map((module): CommandSearchResult => ({
      id: `study:${module.id}`,
      group: "study",
      label: `${studyDomain.label} / ${module.label}`,
      description: module.description,
      view: module.id,
      projectId: studyDomain.id,
    })),
    ...input.mistakes.slice(0, 80).map((mistake): CommandSearchResult => ({
      id: `mistake:${mistake.id}`,
      group: "mistake",
      label: mistake.stem,
      description: `${mistake.board} / ${mistake.source}`,
      view: "library",
      projectId: studyDomain.id,
    })),
    ...input.knowledgeEntries.slice(0, 80).map((entry): CommandSearchResult => ({
      id: `knowledge:${entry.id}`,
      group: "knowledge",
      label: entry.title,
      description: `${entry.category} / ${entry.summary}`,
      view: "knowledge",
      projectId: studyDomain.id,
    })),
    ...input.automationSnapshot.definitions.slice(0, 20).map((definition): CommandSearchResult => ({
      id: `scheduled:${definition.id}`,
      group: "scheduled",
      label: definition.name,
      description: definition.enabled ? "已安排任务" : "已暂停任务",
      view: scheduledWorkspaceDefinition.viewKey,
      projectId: studyDomain.id,
    })),
    ...settingsPluginDefinitions.map((plugin): CommandSearchResult => ({
      id: `plugin:${plugin.id}`,
      group: "plugin",
      label: plugin.label,
      description: plugin.shortDescription,
      view: "settings",
      pluginId: plugin.id,
      settingsSection: "plugins",
    })),
    { id: "settings:ai", group: "settings", label: "AI 连接", description: "配置模型厂商、能力和默认连接", view: "settings", settingsSection: "configuration" },
    { id: "settings:mcp", group: "settings", label: "MCP", description: "配置 MCP server 并测试 tools/resources/prompts", view: "settings", settingsSection: "mcp" },
    { id: "settings:plugins", group: "settings", label: "插件", description: "打开插件目录", view: "settings", settingsSection: "plugins" },
  ];
  return results.filter((result) => matches(result, keyword)).slice(0, 60);
}
