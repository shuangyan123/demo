/** 公考首页推荐操作的稳定标识，用于把状态计算与展示组件解耦。 */
export type DashboardNextActionId =
  | "confirm-import"
  | "import"
  | "review"
  | "training"
  | "proposal"
  | "scheduled"
  | "tutoring";

/** 只包含推荐决策需要的聚合数字，不传入题目或知识正文。 */
export type DashboardNextActionInput = {
  automationUnreadCount: number;
  dueKnowledgeCount: number;
  dueMistakeCount: number;
  importDraftCount: number;
  importJobCount: number;
  knowledgeTotal: number;
  mistakeTotal: number;
  pendingProposalCount: number;
};

/** 推荐条同时提供短说明和按钮文本，确保首屏始终只有一个主操作。 */
export type DashboardNextAction = {
  description: string;
  id: DashboardNextActionId;
  label: string;
  title: string;
};

/**
 * 按已确认的学习闭环优先级选择唯一下一步；相同输入始终得到相同结果。
 */
export function resolveDashboardNextAction(input: DashboardNextActionInput): DashboardNextAction {
  if (input.importDraftCount > 0) {
    return { id: "confirm-import", title: "下一步", label: "确认导入草稿", description: `先确认 ${input.importDraftCount} 条导入草稿，再进入学习队列。` };
  }
  if (input.importJobCount === 0 && input.mistakeTotal === 0 && input.knowledgeTotal === 0) {
    return { id: "import", title: "下一步", label: "粉笔导入", description: "先导入第一批粉笔错题，建立学习队列。" };
  }
  if (input.dueMistakeCount > 0) {
    return { id: "review", title: "下一步", label: "开始错题复盘", description: `今天有 ${input.dueMistakeCount} 道错题到期。` };
  }
  if (input.dueKnowledgeCount > 0) {
    return { id: "training", title: "下一步", label: "开始知识训练", description: `今天有 ${input.dueKnowledgeCount} 条知识待训练。` };
  }
  if (input.pendingProposalCount > 0) {
    return { id: "proposal", title: "下一步", label: "确认知识提案", description: `有 ${input.pendingProposalCount} 条 Obsidian 提案待确认。` };
  }
  if (input.automationUnreadCount > 0) {
    return { id: "scheduled", title: "下一步", label: "查看已安排结果", description: `有 ${input.automationUnreadCount} 条运行结果尚未查看。` };
  }
  return { id: "tutoring", title: "下一步", label: "开始对话辅导", description: "当前没有到期任务，可以开始一轮针对性辅导。" };
}
