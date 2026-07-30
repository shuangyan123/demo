"use client";

import type { SyntheticEvent } from "react";
import { ImportView } from "./review-import-view";
import { useImportDrafts } from "./use-import-drafts.ts";
import { useFenbiQuickImport } from "./use-fenbi-quick-import.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { ImportJob } from "../../types/domains/import.ts";
import type { KnowledgeImportDraft } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import { PERSONAL_WORKSPACE_DATA_SCOPE, type WorkspaceDataScope } from "../../services/workspace-data-scope";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

type ImportWorkspaceProps = {
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  importJobs: ImportJob[];
  knowledgeDrafts: KnowledgeImportDraft[];
  mistakes: Mistake[];
  today: Date;
  onConfirmKnowledgeDrafts: () => void;
  onDeleteKnowledgeDraft: (id: string) => void;
  onImportKnowledgeText: (event: SubmitReactEvent) => void;
  onRefreshWorkspace: () => Promise<void>;
  onSwitchSettings: () => void;
  onUpdateKnowledgeDraft: (id: string, patch: Partial<KnowledgeImportDraft>) => void;
  onUpdateKnowledgeDraftList: (id: string, value: string) => void;
  setNotice: (message: string) => void;
  scope?: WorkspaceDataScope;
};

// 导入页控制器只在用户进入导入视图时加载，避免文件解析服务进入工作台首屏链路。
export function ImportWorkspace({
  textConnection,
  visionConnection,
  importJobs,
  knowledgeDrafts,
  mistakes,
  today,
  onConfirmKnowledgeDrafts,
  onDeleteKnowledgeDraft,
  onImportKnowledgeText,
  onRefreshWorkspace,
  onSwitchSettings,
  onUpdateKnowledgeDraft,
  onUpdateKnowledgeDraftList,
  setNotice,
  scope = PERSONAL_WORKSPACE_DATA_SCOPE,
}: ImportWorkspaceProps) {
  const importDraftFlow = useImportDrafts({
    textConnection,
    visionConnection,
    importJobs,
    mistakes,
    onRefreshWorkspace,
    setNotice,
    scope,
    today,
  });
  const fenbiQuickImport = useFenbiQuickImport({
    onDrafts: importDraftFlow.importAccountDrafts,
    setNotice,
    sampleMode: scope.kind === "sample",
  });

  return (
    <ImportView
      textConnection={textConnection}
      visionConnection={visionConnection}
      batches={importDraftFlow.batches}
      drafts={importDraftFlow.drafts}
      importBusy={importDraftFlow.importBusy}
      importJobs={importJobs}
      fenbiQuickImport={fenbiQuickImport}
      canUndoConfirmation={importDraftFlow.canUndoConfirmation}
      knowledgeDrafts={knowledgeDrafts}
      onBulkUpdateDrafts={importDraftFlow.updateDrafts}
      onConfirmDrafts={importDraftFlow.confirmDrafts}
      onConfirmKnowledgeDrafts={onConfirmKnowledgeDrafts}
      onDeleteDrafts={importDraftFlow.deleteDrafts}
      onDeleteKnowledgeDraft={onDeleteKnowledgeDraft}
      onImportKnowledgeText={onImportKnowledgeText}
      onParseFileImport={importDraftFlow.parseFileImport}
      onParseTextImport={importDraftFlow.parseTextImport}
      onSwitchSettings={onSwitchSettings}
      onUpdateDraft={importDraftFlow.updateDraft}
      onUpdateDraftList={importDraftFlow.updateDraftList}
      onUpdateKnowledgeDraft={onUpdateKnowledgeDraft}
      onUpdateKnowledgeDraftList={onUpdateKnowledgeDraftList}
      onUndoConfirmation={importDraftFlow.undoLastConfirmation}
    />
  );
}
