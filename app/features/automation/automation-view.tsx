"use client";

import { useState } from "react";
import type { AutomationDefinition, AutomationTemplateId } from "../../types/review";
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
  onNotice,
}: {
  center: ReturnType<typeof useAutomationCenter>;
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

  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)] gap-6 max-xl:grid-cols-1">
        <AutomationTaskList center={center} onCreateTemplate={startCreate} onEdit={startEdit} onNotice={onNotice} />
        <AutomationEditor
          key={`${editor.definition?.id ?? editor.templateId}:${editor.revision}`}
          center={center}
          definition={editor.definition}
          initialTemplateId={editor.templateId}
          onFinished={resetEditor}
          onNotice={onNotice}
        />
      </section>
      <AutomationInbox center={center} onNotice={onNotice} />
    </div>
  );
}
