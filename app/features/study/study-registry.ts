import type { ScheduledWorkspaceState, StudyDomainDefinition, StudyModuleDefinition, ViewKey } from "../../types/review";

/** 公考专项复用现有错题、知识、面试和辅导视图；这里只声明导航和能力边界。 */
export const civilServiceStudyModules: StudyModuleDefinition[] = [
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
    id: "library",
    label: "错题库",
    description: "按公考板块筛选、关联和批量管理错题。",
    icon: "library",
    capabilities: ["错题筛选", "批量管理", "知识关联"],
    healthSignals: ["review", "knowledge"],
    recommendedActionLabel: "处理薄弱错题",
  },
  {
    id: "review",
    label: "开始复盘",
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
];

/** 专项学习项目注册表；后续新增专项只需要注册新的 domain。 */
export const studyDomainDefinitions: StudyDomainDefinition[] = [
  {
    id: "civil-service",
    label: "公考",
    description: "公务员考试错题、知识、面试和 AI 辅导工作区。",
    modules: civilServiceStudyModules,
    dashboard: {
      headline: "把导入、错题、知识、训练、辅导、已安排和 Obsidian 输出连成一条日常学习链路。",
      flow: [
        { id: "import", label: "导入资料", description: "粉笔文本、文件或截图先进入可确认草稿。", moduleId: "import" },
        { id: "mistake", label: "错题复盘", description: "到期错题按薄弱度进入今日队列。", moduleId: "review" },
        { id: "knowledge", label: "知识沉淀", description: "错题和资料沉淀为政治理论、常识判断和申论知识。", moduleId: "knowledge" },
        { id: "training", label: "知识训练", description: "知识条目按掌握度进入间隔训练。", moduleId: "knowledgeTraining" },
        { id: "tutoring", label: "AI 辅导", description: "文本、截图、摄像头或屏幕帧进入多模态辅导。", moduleId: "tutoring" },
        { id: "scheduled", label: "已安排复盘", description: "定时任务只读范围并把结果写入收件箱。", moduleId: "automation" },
        { id: "obsidian", label: "Obsidian 输出", description: "用户确认提案后才写入 Vault 托管知识库。", moduleId: "knowledge" },
      ],
      defaultNextActions: ["导入粉笔资料", "完成今日复盘", "确认知识演进提案", "创建已安排任务"],
    },
  },
];

export const scheduledWorkspaceDefinition = {
  viewKey: "automation",
  label: "已安排",
  description: "计划任务、定时执行和运行收件箱。",
} satisfies Omit<ScheduledWorkspaceState, "unreadCount">;

const moduleViewKeySet = new Set<ViewKey>(civilServiceStudyModules.map((module) => module.id));

/** 判断当前视图是否属于专项学习项目，供 Codex 式侧栏高亮使用。 */
export function isStudyModuleView(view: ViewKey): boolean {
  return moduleViewKeySet.has(view);
}
