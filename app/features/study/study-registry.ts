import type { ScheduledWorkspaceState, StudyDomainDefinition, StudyModuleDefinition, ViewKey } from "../../types/domains/workspace.ts";

/** 公考专项复用现有错题、知识、面试和辅导视图；这里只声明导航和能力边界。 */
export const civilServiceStudyModuleCatalog = [
  {
    id: "dashboard",
    label: "总览",
    description: "查看今日复盘、知识训练和配置健康状态。",
    icon: "dashboard",
    capabilities: ["概览", "健康检查", "快捷入口"],
    healthSignals: ["review", "knowledge", "ai", "schedule", "obsidian", "import"],
    recommendedActionLabel: "查看今日学习链路",
  },
  {
    id: "fenbi",
    label: "粉笔练习",
    description: "在 Recall 中打开粉笔练习网站，保留独立浏览会话。",
    icon: "fenbi",
    capabilities: ["在线练习", "独立会话", "本地控制"],
    healthSignals: ["import"],
    recommendedActionLabel: "进入粉笔练习",
  },
  {
    id: "import",
    label: "粉笔导入",
    description: "同步粉笔账户错题，或解析粉笔导出文件、截图与文本。",
    icon: "import",
    capabilities: ["账户同步", "文件与截图", "文本解析"],
    healthSignals: ["import", "ai"],
    recommendedActionLabel: "导入粉笔错题",
  },
  {
    id: "library",
    label: "错题库",
    description: "统一浏览错题、知识和薄弱分析，并把上下文交给新对话。",
    icon: "library",
    capabilities: ["错题与知识", "薄弱分析", "对话交接"],
    healthSignals: ["review", "knowledge"],
    recommendedActionLabel: "处理薄弱错题",
  },
  {
    id: "review",
    label: "错题复盘",
    description: "按间隔复习队列进行错题复盘。",
    icon: "review",
    capabilities: ["复盘队列", "计时", "结果记录"],
    healthSignals: ["review"],
    recommendedActionLabel: "开始到期复盘",
  },
  {
    id: "knowledge",
    label: "知识库",
    description: "沉淀政治理论、常识判断和申论资料。",
    icon: "knowledge",
    capabilities: ["资料管理", "Obsidian 同步", "AI 提案"],
    healthSignals: ["knowledge", "obsidian", "ai"],
    recommendedActionLabel: "沉淀知识资料",
  },
  {
    id: "knowledgeTraining",
    label: "知识训练",
    description: "把知识资料转为间隔训练卡片。",
    icon: "knowledgeTraining",
    capabilities: ["训练队列", "掌握度", "收藏"],
    healthSignals: ["knowledge"],
    recommendedActionLabel: "训练到期知识",
  },
  {
    id: "interview",
    label: "面试训练",
    description: "结构化、小组和无领导面试专项训练。",
    icon: "interview",
    capabilities: ["题库", "模拟面试", "评价"],
    healthSignals: ["ai"],
    recommendedActionLabel: "开始面试训练",
  },
  {
    id: "tutoring",
    label: "AI 辅导",
    description: "文本、截图、摄像头和屏幕帧多模态辅导。",
    icon: "tutoring",
    capabilities: ["多模态", "语音", "知识关联"],
    healthSignals: ["ai", "knowledge"],
    recommendedActionLabel: "进入 AI 辅导",
  },
  {
    id: "stats",
    label: "薄弱分析",
    description: "查看公考错题和知识掌握薄弱项。",
    icon: "stats",
    capabilities: ["统计", "薄弱项", "训练入口"],
    healthSignals: ["review", "knowledge"],
    recommendedActionLabel: "查看薄弱计划",
  },
] satisfies StudyModuleDefinition[];

const CIVIL_SERVICE_DEFAULT_ENABLED_MODULE_IDS: Array<StudyModuleDefinition["id"]> = [
  "dashboard",
  "fenbi",
  "library",
  "review",
  "knowledgeTraining",
  "interview",
];

const CIVIL_SERVICE_REQUIRED_MODULE_IDS: Array<StudyModuleDefinition["id"]> = ["dashboard"];

/** 专项学习项目注册表；后续新增专项只需要注册新的 domain。 */
export const studyDomainDefinitions: StudyDomainDefinition[] = [
  {
    id: "civil-service",
    label: "公考",
    description: "公务员考试错题、知识、面试和 AI 辅导工作区。",
    moduleCatalog: civilServiceStudyModuleCatalog,
    defaultEnabledModuleIds: CIVIL_SERVICE_DEFAULT_ENABLED_MODULE_IDS,
    requiredModuleIds: CIVIL_SERVICE_REQUIRED_MODULE_IDS,
    dashboard: {
      headline: "把导入、错题、知识、训练、辅导、已安排和 Obsidian 输出连成一条日常学习链路。",
      flow: [
        { id: "import", label: "粉笔导入", description: "粉笔账户、导出文件、截图或文本先进入可确认草稿。", moduleId: "import" },
        { id: "mistake", label: "错题复盘", description: "到期错题按薄弱度进入今日队列。", moduleId: "review" },
        { id: "knowledge", label: "知识沉淀", description: "错题和资料沉淀为政治理论、常识判断和申论知识。", moduleId: "library" },
        { id: "training", label: "知识训练", description: "知识条目按掌握度进入间隔训练。", moduleId: "knowledgeTraining" },
        { id: "tutoring", label: "对话辅导", description: "在新对话中按需调用摄像头、屏幕共享或截图工具。", moduleId: "conversation" },
        { id: "scheduled", label: "已安排复盘", description: "定时任务只读范围并把结果写入收件箱。", moduleId: "automation" },
        { id: "obsidian", label: "Obsidian 输出", description: "用户确认提案后才写入 Vault 托管知识库。", moduleId: "knowledge" },
      ],
      defaultNextActions: ["导入粉笔资料", "完成今日复盘", "确认知识演进提案", "创建已安排任务"],
    },
  },
];

export type StudyModuleId = StudyModuleDefinition["id"];

export function getStudyDomainDefinition(domainId: string): StudyDomainDefinition | undefined {
  return studyDomainDefinitions.find((domain) => domain.id === domainId);
}

/** 返回专项完整目录；调用方不得把它直接当作当前项目的可见集合。 */
export function getStudyModuleCatalog(domainId: string): StudyModuleDefinition[] {
  return getStudyDomainDefinition(domainId)?.moduleCatalog ?? [];
}

export function getDefaultEnabledStudyModuleIds(domainId: string): StudyModuleId[] {
  return [...(getStudyDomainDefinition(domainId)?.defaultEnabledModuleIds ?? [])];
}

/**
 * 用 registry 顺序解析项目偏好，过滤未知 ID、去重并补齐必选入口。
 * 未提供偏好表示首次进入项目，应使用稳定默认集合；显式空数组仍允许隐藏所有可选模块。
 */
export function resolveEnabledStudyModuleIds(domainId: string, storedIds?: readonly string[]): StudyModuleId[] {
  const domain = getStudyDomainDefinition(domainId);
  if (!domain) return [];

  const knownIds = new Set<StudyModuleId>(domain.moduleCatalog.map((module) => module.id));
  const selectedIds = new Set<StudyModuleId>();
  for (const id of storedIds ?? domain.defaultEnabledModuleIds) {
    const normalizedId = id as StudyModuleId;
    if (knownIds.has(normalizedId)) selectedIds.add(normalizedId);
  }
  for (const id of domain.requiredModuleIds) selectedIds.add(id);

  return domain.moduleCatalog.filter((module) => selectedIds.has(module.id)).map((module) => module.id);
}

export function resolveEnabledStudyModules(domainId: string, storedIds?: readonly string[]): StudyModuleDefinition[] {
  const enabledIds = new Set(resolveEnabledStudyModuleIds(domainId, storedIds));
  return getStudyModuleCatalog(domainId).filter((module) => enabledIds.has(module.id));
}

/** 兼容旧调用方：表示公考的默认可见集合，而不是完整 registry 目录。 */
export const civilServiceStudyModules = resolveEnabledStudyModules("civil-service");

export const scheduledWorkspaceDefinition = {
  viewKey: "automation",
  label: "已安排",
  description: "计划任务、定时执行和运行收件箱。",
} satisfies Omit<ScheduledWorkspaceState, "unreadCount">;

const moduleViewKeySet = new Set<ViewKey>(civilServiceStudyModuleCatalog.map((module) => module.id));

/** 判断当前视图是否属于专项学习项目，供 Codex 式侧栏高亮使用。 */
export function isStudyModuleView(view: ViewKey): boolean {
  return moduleViewKeySet.has(view);
}
