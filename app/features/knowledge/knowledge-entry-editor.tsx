"use client";

// 文件说明：提供知识条目的独立编辑与关联分析面板。

import { AssociationPanel } from "../shared/association-panel";
import { Button, Chip, EmptyState, MasteryDots, SelectField, SoftBlock, TextAreaField, TextField } from "../shared/ui-primitives";
import { splitInput, textValue, toListText } from "../../lib/form-utils";
import { masteryLabel } from "../../lib/review-utils";
import type { RelatedMistakeMatch } from "../../services/association-matcher";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { AssociationSuggestion, KnowledgeMistakeLink } from "../../types/domains/association.ts";
import type { Mistake } from "../../types/domains/review.ts";

type KnowledgeEntryEditorProps = {
  aiAssociationBusy: boolean;
  apiReady: boolean;
  associationLinks: KnowledgeMistakeLink[];
  associationSuggestions: AssociationSuggestion[];
  entry: KnowledgeEntry | null;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  relatedMistakes: RelatedMistakeMatch[];
  onAnalyzeKnowledgeAssociations: (entry: KnowledgeEntry) => void;
  onClearAssociationSuggestions: (targetId: string) => void;
  onConfirmAssociationSuggestions: () => void;
  onDeleteAssociationSuggestion: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onOpenRelatedMistake: (mistake: Mistake) => void;
  onOpenSettings: () => void;
  onRemoveAssociationLink: (id: string) => void;
  onStartTraining: (entryId?: string) => void;
  onToggleAssociationSuggestion: (id: string, selected: boolean) => void;
  onToggleFavorite: (entry: KnowledgeEntry) => void;
  onUpdateEntry: (id: string, patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">>) => void;
  obsidianUri?: string;
};

/** 渲染选中知识条目的编辑区，并把关联分析放在正文表单之后。 */
export function KnowledgeEntryEditor({
  aiAssociationBusy,
  apiReady,
  associationLinks,
  associationSuggestions,
  entry,
  knowledgeEntries,
  mistakes,
  relatedMistakes,
  onAnalyzeKnowledgeAssociations,
  onClearAssociationSuggestions,
  onConfirmAssociationSuggestions,
  onDeleteAssociationSuggestion,
  onDeleteEntry,
  onOpenRelatedMistake,
  onOpenSettings,
  onRemoveAssociationLink,
  onStartTraining,
  onToggleAssociationSuggestion,
  onToggleFavorite,
  onUpdateEntry,
  obsidianUri,
}: KnowledgeEntryEditorProps) {
  if (!entry) return <EmptyState>选择一条资料后在这里编辑；也可以直接新增资料。</EmptyState>;

  return (
    <section aria-label="知识详情编辑">
      <form
        key={entry.id}
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          onUpdateEntry(entry.id, {
            category: textValue(formData.get("category")) as KnowledgeCategory,
            title: textValue(formData.get("title")),
            summary: textValue(formData.get("summary")),
            content: textValue(formData.get("content")),
            tags: splitInput(formData.get("tags")),
            source: textValue(formData.get("source")),
            favorite: entry.favorite,
          });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Chip tone="blue">{entry.category}</Chip>
          <div className="flex flex-wrap gap-2">
            {obsidianUri ? <a className="ui-button ui-button-outline ui-button-sm" href={obsidianUri}>在 Obsidian 打开</a> : null}
            <Button size="sm" type="button" variant="soft" onClick={() => onStartTraining(entry.id)}>训练</Button>
            <Button size="sm" type="button" variant="outline" onClick={() => onToggleFavorite(entry)}>{entry.favorite ? "取消收藏" : "收藏"}</Button>
            <Button size="sm" type="button" variant="danger" onClick={() => onDeleteEntry(entry.id)}>删除</Button>
          </div>
        </div>
        <SelectField label="分类" name="category" defaultValue={entry.category} options={[...KNOWLEDGE_CATEGORIES]} />
        <TextField label="标题" name="title" defaultValue={entry.title} required />
        <TextField label="摘要" name="summary" defaultValue={entry.summary} placeholder="列表中显示的短摘要" />
        <TextField label="标签" name="tags" defaultValue={toListText(entry.tags)} placeholder="用逗号或顿号分隔" />
        <TextField label="来源" name="source" defaultValue={entry.source} placeholder="手动整理 / 课程 / 资料导入" />
        <TextAreaField className="min-h-64" label="正文" name="content" defaultValue={entry.content} required />
        <Button type="submit" variant="primary">保存修改</Button>
        <SoftBlock className="grid gap-2 text-sm text-muted">
          <div className="flex flex-wrap items-center gap-3"><span>掌握度：{masteryLabel(entry.mastery)}</span><MasteryDots value={entry.mastery} /></div>
          <span>下次训练：{entry.nextReviewAt} · 已训练 {entry.reviewCount} 次{entry.lastReviewedAt ? ` · 最近训练 ${entry.lastReviewedAt}` : ""}</span>
        </SoftBlock>
      </form>
      <div className="mt-4">
        <AssociationPanel
          aiBusy={aiAssociationBusy}
          apiReady={apiReady}
          knowledgeEntries={knowledgeEntries}
          links={associationLinks}
          localMistakeMatches={relatedMistakes}
          mistakes={mistakes}
          mode="knowledge"
          suggestions={associationSuggestions}
          onAnalyze={() => onAnalyzeKnowledgeAssociations(entry)}
          onClearSuggestions={() => onClearAssociationSuggestions(entry.id)}
          onConfirmSuggestions={onConfirmAssociationSuggestions}
          onDeleteSuggestion={onDeleteAssociationSuggestion}
          onOpenKnowledgeEntry={() => undefined}
          onOpenMistake={onOpenRelatedMistake}
          onOpenSettings={onOpenSettings}
          onRemoveLink={onRemoveAssociationLink}
          onToggleSuggestion={onToggleAssociationSuggestion}
        />
      </div>
    </section>
  );
}
