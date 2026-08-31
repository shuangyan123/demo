/** 顶栏摘要只接收已经存在的本地事实，不为展示新增持久化或请求。 */
export type WorkspaceSummary = {
  workspaceLabel: string;
  sectionLabel?: string;
  conversationTitle?: string;
  modelLabel?: string;
  projectLabel?: string;
  attachedContextCount?: number;
  statusLabel?: string;
};
