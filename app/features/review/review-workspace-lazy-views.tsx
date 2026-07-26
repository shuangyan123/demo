"use client";

import dynamic from "next/dynamic";
import { WorkspaceViewState } from "../shared/workspace-view-state";

/** 低频工作区的纯展示占位，不触发任何 repository 或业务读取。 */
function WorkspaceViewLoading() {
  return <WorkspaceViewState title="正在加载模块" description="界面代码加载完成后才会读取对应业务数据。" />;
}

export const SettingsWorkspace = dynamic(
  () => import("../settings/settings-workspace").then((module) => module.SettingsWorkspace),
  { loading: WorkspaceViewLoading },
);
export const AutomationView = dynamic(
  () => import("../automation/automation-view").then((module) => module.AutomationView),
  { loading: WorkspaceViewLoading },
);
export const InterviewWorkspace = dynamic(
  () => import("../interview/interview-workspace").then((module) => module.InterviewWorkspace),
  { loading: WorkspaceViewLoading },
);
export const TutoringWorkspace = dynamic(
  () => import("../tutoring/tutoring-workspace").then((module) => module.TutoringWorkspace),
  { loading: WorkspaceViewLoading },
);
export const ImportWorkspace = dynamic(
  () => import("../import/import-workspace").then((module) => module.ImportWorkspace),
  { loading: WorkspaceViewLoading },
);
export const ConversationWorkspace = dynamic(
  () => import("../conversation/conversation-workspace").then((module) => module.ConversationWorkspace),
  { loading: WorkspaceViewLoading },
);
export const SettingsPluginsView = dynamic(
  () => import("../settings/plugins/settings-plugins-view").then((module) => module.SettingsPluginsView),
  { loading: WorkspaceViewLoading },
);
export const KnowledgeTrainingView = dynamic(
  () => import("../knowledge/knowledge-training-view").then((module) => module.KnowledgeTrainingView),
  { loading: WorkspaceViewLoading },
);
