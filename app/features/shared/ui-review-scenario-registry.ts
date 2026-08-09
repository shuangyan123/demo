import type { ViewKey } from "../../types/domains/workspace.ts";

export type UiReviewStateKind =
  | "first-use-empty"
  | "filtered-empty"
  | "selection-empty"
  | "populated"
  | "dense"
  | "long-content"
  | "loading"
  | "error"
  | "permission"
  | "conflict";

export type UiReviewPackId =
  | "learning"
  | "conversation"
  | "import"
  | "automation"
  | "interview"
  | "tutoring"
  | "settings"
  | "integrations";

export type UiReviewScenarioDefinition = {
  id: string;
  view: ViewKey;
  kind: UiReviewStateKind;
  packId?: UiReviewPackId;
  target: string;
  safety: "local-data" | "presentation-only" | "external-setup";
};

/** 全应用可审查状态清单。首次空白可载入真实本地数据，其余状态保留原业务动作。 */
export const uiReviewScenarioDefinitions = [
  { id: "dashboard.learning-actions.insufficient", view: "dashboard", kind: "first-use-empty", packId: "learning", target: "今日学习推荐", safety: "local-data" },
  { id: "dashboard.learning-actions.unsubmitted", view: "dashboard", kind: "first-use-empty", packId: "learning", target: "今日学习推荐", safety: "local-data" },
  { id: "dashboard.learning-actions.not-due", view: "dashboard", kind: "first-use-empty", packId: "learning", target: "今日学习推荐", safety: "local-data" },
  { id: "dashboard.due-mistakes.empty", view: "dashboard", kind: "first-use-empty", packId: "learning", target: "今日错题队列", safety: "local-data" },
  { id: "dashboard.weak-boards.empty", view: "dashboard", kind: "first-use-empty", packId: "learning", target: "薄弱板块", safety: "local-data" },
  { id: "dashboard.due-knowledge.empty", view: "dashboard", kind: "first-use-empty", packId: "learning", target: "今日知识队列", safety: "local-data" },
  { id: "library.results.empty", view: "library", kind: "filtered-empty", target: "错题筛选结果", safety: "local-data" },
  { id: "library.selection.empty", view: "library", kind: "selection-empty", target: "错题详情", safety: "local-data" },
  { id: "review.queue.empty", view: "review", kind: "first-use-empty", packId: "learning", target: "错题复盘队列", safety: "local-data" },
  { id: "learning-explorer.results.empty", view: "library", kind: "filtered-empty", target: "学习数据浏览器", safety: "local-data" },
  { id: "stats.timeline.empty", view: "stats", kind: "first-use-empty", packId: "learning", target: "复盘趋势", safety: "local-data" },
  { id: "stats.priorities.empty", view: "stats", kind: "first-use-empty", packId: "learning", target: "薄弱项排序", safety: "local-data" },
  { id: "library.insights.dense", view: "library", kind: "dense", packId: "learning", target: "薄弱分析完整控制台", safety: "local-data" },

  { id: "knowledge.workspace.results.empty", view: "knowledge", kind: "filtered-empty", target: "知识列表", safety: "local-data" },
  { id: "knowledge.workspace.queue.empty", view: "knowledge", kind: "first-use-empty", packId: "learning", target: "知识队列", safety: "local-data" },
  { id: "knowledge.library.results.empty", view: "knowledge", kind: "filtered-empty", target: "知识资料列表", safety: "local-data" },
  { id: "knowledge.editor.selection.empty", view: "knowledge", kind: "selection-empty", target: "知识编辑器", safety: "local-data" },
  { id: "knowledge.training.results.empty", view: "knowledgeTraining", kind: "filtered-empty", target: "知识训练筛选结果", safety: "local-data" },
  { id: "knowledge.training.queue.empty", view: "knowledgeTraining", kind: "first-use-empty", packId: "learning", target: "知识训练队列", safety: "local-data" },
  { id: "knowledge.internalization.sources.empty", view: "knowledge", kind: "first-use-empty", packId: "learning", target: "可内化错题", safety: "local-data" },
  { id: "knowledge.internalization.drafts.empty", view: "knowledge", kind: "first-use-empty", packId: "learning", target: "内化草稿", safety: "local-data" },
  { id: "knowledge.drafts.empty", view: "knowledge", kind: "first-use-empty", packId: "learning", target: "待确认知识草稿", safety: "local-data" },
  { id: "knowledge.obsidian.proposals.empty", view: "plugins", kind: "first-use-empty", packId: "integrations", target: "Obsidian 待确认提案", safety: "presentation-only" },
  { id: "knowledge.obsidian.proposal-filter.empty", view: "plugins", kind: "filtered-empty", target: "Obsidian 提案筛选", safety: "presentation-only" },
  { id: "association.local-mistakes.empty", view: "knowledge", kind: "filtered-empty", target: "本地错题推荐", safety: "local-data" },
  { id: "association.local-knowledge.empty", view: "knowledge", kind: "filtered-empty", target: "本地知识推荐", safety: "local-data" },
  { id: "association.confirmed.empty", view: "knowledge", kind: "first-use-empty", packId: "learning", target: "已确认关联", safety: "local-data" },

  { id: "import.jobs.empty", view: "import", kind: "first-use-empty", packId: "import", target: "导入任务", safety: "local-data" },
  { id: "import.preview.empty", view: "import", kind: "first-use-empty", packId: "import", target: "导入预览", safety: "local-data" },
  { id: "import.batches.empty", view: "import", kind: "first-use-empty", packId: "import", target: "导入批次", safety: "local-data" },
  { id: "import.drafts.empty", view: "import", kind: "first-use-empty", packId: "import", target: "导入草稿", safety: "local-data" },
  { id: "import.console.mixed", view: "import", kind: "dense", packId: "import", target: "导入资料混合控制台", safety: "local-data" },

  { id: "automation.tasks.empty", view: "automation", kind: "first-use-empty", packId: "automation", target: "已安排任务", safety: "local-data" },
  { id: "automation.inbox.empty", view: "automation", kind: "first-use-empty", packId: "automation", target: "运行收件箱", safety: "local-data" },
  { id: "automation.tasks.filtered-empty", view: "automation", kind: "filtered-empty", target: "任务筛选结果", safety: "local-data" },
  { id: "automation.inbox.filtered-empty", view: "automation", kind: "filtered-empty", target: "运行筛选结果", safety: "local-data" },

  { id: "interview.question-bank.empty", view: "interview", kind: "first-use-empty", packId: "interview", target: "面试题库", safety: "local-data" },
  { id: "interview.question-sets.empty", view: "interview", kind: "first-use-empty", packId: "interview", target: "面试题组", safety: "local-data" },
  { id: "interview.question-set-filter.empty", view: "interview", kind: "filtered-empty", target: "题组题目筛选", safety: "local-data" },
  { id: "interview.practice-plans.empty", view: "interview", kind: "first-use-empty", packId: "interview", target: "训练计划", safety: "local-data" },
  { id: "interview.practice-plan-filter.empty", view: "interview", kind: "filtered-empty", target: "训练计划题目筛选", safety: "local-data" },
  { id: "interview.records.empty", view: "interview", kind: "first-use-empty", packId: "interview", target: "面试复盘记录", safety: "local-data" },
  { id: "interview.session.selection.empty", view: "interview", kind: "selection-empty", target: "面试会话", safety: "local-data" },
  { id: "interview.links.empty", view: "interview", kind: "first-use-empty", packId: "interview", target: "面试关联", safety: "local-data" },

  { id: "tutoring.sessions.empty", view: "tutoring", kind: "first-use-empty", packId: "tutoring", target: "辅导记录", safety: "local-data" },
  { id: "tutoring.record.selection.empty", view: "tutoring", kind: "selection-empty", target: "辅导记录详情", safety: "local-data" },
  { id: "tutoring.plans.empty", view: "tutoring", kind: "first-use-empty", packId: "tutoring", target: "辅导计划", safety: "local-data" },
  { id: "tutoring.session.selection.empty", view: "tutoring", kind: "selection-empty", target: "辅导会话", safety: "local-data" },
  { id: "tutoring.links.empty", view: "tutoring", kind: "first-use-empty", packId: "tutoring", target: "辅导资料关联", safety: "local-data" },
  { id: "tutoring.assessment.empty", view: "tutoring", kind: "first-use-empty", packId: "tutoring", target: "辅导微测", safety: "local-data" },

  { id: "conversation.mcp-tools.empty", view: "conversation", kind: "first-use-empty", packId: "integrations", target: "对话 MCP 工具", safety: "external-setup" },
  { id: "settings.connections.empty", view: "settings", kind: "first-use-empty", packId: "settings", target: "AI 连接", safety: "external-setup" },
  { id: "settings.memory.empty", view: "settings", kind: "filtered-empty", target: "个性化记忆", safety: "local-data" },
  { id: "settings.mcp.servers.empty", view: "settings", kind: "first-use-empty", packId: "integrations", target: "MCP Server", safety: "external-setup" },
  { id: "settings.mcp.discovery.empty", view: "settings", kind: "selection-empty", target: "MCP 能力发现", safety: "external-setup" },
  { id: "settings.mcp.selection.empty", view: "settings", kind: "selection-empty", target: "MCP 详情", safety: "external-setup" },
  { id: "settings.mcp.failed", view: "settings", kind: "error", target: "MCP 连接失败", safety: "presentation-only" },
  { id: "settings.mcp.registry.loading", view: "settings", kind: "loading", target: "MCP 社区目录", safety: "presentation-only" },
  { id: "settings.mcp.registry.filtered-empty", view: "settings", kind: "filtered-empty", target: "MCP 社区目录", safety: "presentation-only" },
  { id: "settings.quota.empty", view: "settings", kind: "first-use-empty", packId: "settings", target: "额度配置", safety: "external-setup" },
  { id: "settings.extensions.empty", view: "plugins", kind: "first-use-empty", packId: "integrations", target: "声明式扩展", safety: "local-data" },
  { id: "settings.plugins.loading-obsidian", view: "plugins", kind: "loading", target: "Obsidian 扩展加载", safety: "presentation-only" },
  { id: "settings.plugins.loading-fenbi", view: "plugins", kind: "loading", target: "粉笔扩展加载", safety: "presentation-only" },
  { id: "settings.plugins.loading-marketplace", view: "plugins", kind: "loading", target: "扩展市场加载", safety: "presentation-only" },
  { id: "settings.plugins.filtered-empty", view: "plugins", kind: "filtered-empty", target: "扩展筛选结果", safety: "local-data" },
  { id: "settings.plugins.directory-dense", view: "plugins", kind: "dense", packId: "integrations", target: "插件目录主从检查器", safety: "presentation-only" },
  { id: "settings.plugins.fenbi-drafts.empty", view: "plugins", kind: "first-use-empty", packId: "import", target: "粉笔待确认草稿", safety: "presentation-only" },
  { id: "conversation.command-search.filtered-empty", view: "conversation", kind: "filtered-empty", target: "命令搜索结果", safety: "presentation-only" },
  { id: "conversation.slash-command.filtered-empty", view: "conversation", kind: "filtered-empty", target: "斜杠指令结果", safety: "presentation-only" },
  { id: "settings.model-catalog.filtered-empty", view: "settings", kind: "filtered-empty", target: "模型目录结果", safety: "presentation-only" },
  { id: "settings.connections.dense", view: "settings", kind: "dense", packId: "settings", target: "AI 连接完整表格", safety: "presentation-only" },
  { id: "settings.connections.credential-recovery", view: "settings", kind: "error", packId: "settings", target: "AI 连接凭据恢复", safety: "presentation-only" },
  { id: "automation.collection.sources.empty", view: "automation", kind: "first-use-empty", packId: "automation", target: "采集来源", safety: "local-data" },
  { id: "automation.editor.scope.empty", view: "automation", kind: "selection-empty", target: "任务数据范围", safety: "presentation-only" },
  { id: "knowledge.suggestions.filtered-empty", view: "knowledge", kind: "filtered-empty", target: "知识推荐结果", safety: "local-data" },
  { id: "learning-explorer.selection.empty", view: "library", kind: "selection-empty", target: "学习数据详情", safety: "presentation-only" },
] as const satisfies readonly UiReviewScenarioDefinition[];

export type UiReviewStateId = typeof uiReviewScenarioDefinitions[number]["id"];

const scenariosById = new Map<UiReviewStateId, UiReviewScenarioDefinition>(
  uiReviewScenarioDefinitions.map((scenario) => [scenario.id, scenario]),
);

export function getUiReviewScenario(stateId: UiReviewStateId): UiReviewScenarioDefinition {
  const scenario = scenariosById.get(stateId);
  if (!scenario) throw new Error(`未知 UI 审查状态：${stateId}`);
  return scenario;
}

export const uiReviewPopulatedViews = [
  "dashboard", "conversation", "library", "review", "knowledgeTraining", "stats", "knowledge",
  "automation", "interview", "tutoring", "import", "plugins", "settings",
] as const satisfies readonly ViewKey[];
