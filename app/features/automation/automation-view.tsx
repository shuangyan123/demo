"use client";

import { useState } from "react";
import type { AutomationDefinition, AutomationRecoveryAction, AutomationTemplateId } from "../../types/review";
import { automationRecoveryLabel } from "../../services/automation-failure";
import { AutomationEditor } from "./automation-editor";
import { AutomationInbox } from "./automation-inbox";
import { AutomationTaskList } from "./automation-task-list";
import { useAutomationCenter } from "./use-automation-center";

type EditorState = {
  definition?: AutomationDefinition;
  templateId: AutomationTemplateId;
  revision: number;
};

const INITIAL_EDITOR_STATE: EditorState = { templateId: "daily_review", revision: 0 };

/** 自动化中心组合视图：只负责编辑器选择和三块业务面板布局。 */
export function AutomationView({
  center,
  onOpenEntry,
  onOpenImport,
  onOpenKnowledge,
  onOpenSettings,
  onNotice,
}: {
  center: ReturnType<typeof useAutomationCenter>;
  onOpenEntry: () => void;
  onOpenImport: () => void;
  onOpenKnowledge: () => void;
  onOpenSettings: () => void;
  onNotice: (message: string) => void;
}) {
  const [editor, setEditor] = useState<EditorState>(INITIAL_EDITOR_STATE);

  /** 打开指定模板的新建表单，并通过 revision 强制清理旧草稿。 */
  function startCreate(templateId: AutomationTemplateId): void {
    setEditor((current) => ({ templateId, revision: current.revision + 1 }));
  }

  /** 将任务快照复制到编辑器，原始定义保持不可变。 */
  function startEdit(definition: AutomationDefinition): void {
    setEditor((current) => ({ definition, templateId: definition.templateId, revision: current.revision + 1 }));
  }

  /** 保存或取消后返回默认新建表单。 */
  function resetEditor(): void {
    startCreate("daily_review");
  }

  /** 恢复动作只做导航或提示，不直接重试运行或触发外部能力。 */
  function handleRecoveryAction(action: AutomationRecoveryAction): void {
    if (action === "configure_ai_connection") {
      onOpenSettings();
      return;
    }
    if (action === "configure_mcp") {
      onOpenSettings();
      onNotice("请在设置 → MCP 中启用 Server，并将目标工具权限设为“允许已安排任务”");
      return;
    }
    if (action === "open_knowledge") {
      onOpenKnowledge();
      return;
    }
    if (action === "open_import") {
      onOpenImport();
      return;
    }
    if (action === "open_entry") {
      onOpenEntry();
      return;
    }
    onNotice(automationRecoveryLabel(action));
  }

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-[minmax(280px,.72fr)_minmax(520px,1.28fr)] gap-6 max-[1399px]:grid-cols-1">
        <AutomationTaskList center={center} onCreateTemplate={startCreate} onEdit={startEdit} onNotice={onNotice} />
        <AutomationEditor
          key={`${editor.definition?.id ?? editor.templateId}:${editor.revision}`}
          center={center}
          definition={editor.definition}
          initialTemplateId={editor.templateId}
          onRecoveryAction={handleRecoveryAction}
          onFinished={resetEditor}
          onNotice={onNotice}
        />
      </section>
      <AutomationInbox center={center} onNotice={onNotice} onRecoveryAction={handleRecoveryAction} />
    </div>
  );
}
