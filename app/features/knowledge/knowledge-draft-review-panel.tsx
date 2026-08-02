"use client";

import { AppIcon } from "../shared/app-icon.tsx";
import { Button, EmptyState, SelectField, TextAreaField, TextField } from "../shared/ui-primitives.tsx";
import { toListText } from "../../lib/form-utils.ts";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeImportDraft } from "../../types/domains/knowledge.ts";

/** 知识草稿归知识库自行确认，避免粉笔导入页面重新混入通用资料入口。 */
export function KnowledgeDraftReviewPanel({
  drafts,
  onConfirm,
  onDelete,
  onUpdate,
  onUpdateTags,
}: {
  drafts: KnowledgeImportDraft[];
  onConfirm: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<KnowledgeImportDraft>) => void;
  onUpdateTags: (id: string, value: string) => void;
}) {
  const selectedCount = drafts.filter((draft) => draft.selected).length;

  return (
    <details className="ui-board-panel">
      <summary className="cursor-pointer px-4 py-3 font-bold">待确认知识草稿（{drafts.length}）</summary>
      <div className="grid gap-4 border-t border-line p-4">
        <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
          <p className="text-sm text-muted">模板和资料解析结果在此确认，保存前不会写入知识库。</p>
          <Button disabled={!selectedCount} variant="primary" onClick={onConfirm}><AppIcon name="check" size={16} />确认保存 {selectedCount || ""} 条</Button>
        </div>
        {drafts.length ? drafts.map((draft) => (
          <article key={draft.id} className="ui-card ui-card-muted grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-bold"><input checked={draft.selected} type="checkbox" onChange={(event) => onUpdate(draft.id, { selected: event.currentTarget.checked })} />选中保存</label>
              <Button size="sm" variant="danger" onClick={() => onDelete(draft.id)}><AppIcon name="trash" size={14} />删除</Button>
            </div>
            <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
              <SelectField label="知识分类" value={draft.category} options={[...KNOWLEDGE_CATEGORIES]} onChange={(value) => onUpdate(draft.id, { category: value as KnowledgeCategory })} />
              <TextField label="标题" value={draft.title} onChange={(value) => onUpdate(draft.id, { title: value })} />
              <TextField label="标签" value={toListText(draft.tags)} onChange={(value) => onUpdateTags(draft.id, value)} />
            </div>
            <TextAreaField label="摘要" value={draft.summary} onChange={(value) => onUpdate(draft.id, { summary: value })} />
            <TextAreaField label="正文" value={draft.content} onChange={(value) => onUpdate(draft.id, { content: value })} />
          </article>
        )) : <EmptyState stateId="knowledge.drafts.empty">暂无待确认知识草稿。</EmptyState>}
      </div>
    </details>
  );
}
