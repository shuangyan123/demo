"use client";

import { useState } from "react";
import type { KnowledgeInternalizationController } from "./use-knowledge-internalization.ts";
import { splitInput } from "../../lib/form-utils";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeEntry, type KnowledgeInternalizationMode } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import { Button, Chip, EmptyState, Panel, SelectField, SoftBlock, TextAreaField, TextField } from "../shared/ui-primitives";

// 提供“选择错题 -> AI 草稿 -> 编辑预览 -> 用户确认”的完整内化界面。
export function KnowledgeInternalizationPanel({
  controller,
  entries,
  mistakes,
  onOpenSettings,
}: {
  controller: KnowledgeInternalizationController;
  entries: KnowledgeEntry[];
  mistakes: Mistake[];
  onOpenSettings: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mergeTargets: Array<[string, string]> = entries.map((entry) => [entry.id, `${entry.category} · ${entry.title}`]);

  return (
    <Panel title="内化错题" eyebrow="Internalize">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm leading-6 text-muted">AI 只生成可恢复的本地草稿；确认前不会改动知识库。确认时会原子地保存资料、来源关联并删除草稿。</p>
        <Button type="button" variant="outline" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起错题选择" : "选择错题内化"}
        </Button>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-3">
          <div className="grid max-h-72 gap-2 overflow-auto pr-1">
            {mistakes.length ? mistakes.map((mistake) => {
              const duplicate = controller.duplicateMistakeIds.has(mistake.id);
              return (
                <label key={mistake.id} className="ui-list-row grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 text-sm">
                  <input className="ui-checkbox mt-1" type="checkbox" checked={controller.selectedMistakeIds.has(mistake.id)} onChange={(event) => controller.toggleMistake(mistake.id, event.target.checked)} />
                  <span><strong className="block">{mistake.stem}</strong><small className="mt-1 block text-muted">{mistake.board} · {mistake.reasons.join("、") || "未标注错因"}</small></span>
                  {duplicate ? <Chip tone="yellow">已有内化</Chip> : null}
                </label>
              );
            }) : <EmptyState>暂无可内化错题</EmptyState>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" disabled={controller.busy} onClick={() => void controller.generateDraft()}>{controller.busy ? "正在生成草稿" : `生成内化草稿（${controller.selectedMistakeIds.size}）`}</Button>
            <Button type="button" variant="ghost" onClick={onOpenSettings}>检查 AI 连接</Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4">
        {controller.drafts.length ? controller.drafts.map((draft) => (
          <SoftBlock key={draft.id} className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2"><Chip tone="blue">{draft.mode === "merge" ? "合并资料" : "新建资料"}</Chip><Chip tone={draft.confidence >= 0.75 ? "green" : "yellow"}>置信度 {Math.round(draft.confidence * 100)}%</Chip><Chip>{draft.sourceMistakeIds.length} 道来源错题</Chip></div>
              <span className="text-xs text-muted">草稿已自动保存</span>
            </div>
            <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
              <SelectField label="处理方式" value={draft.mode} options={[["create", "新建知识资料"], ["merge", "合并到已有资料"]]} onChange={(value) => void controller.updateDraft(draft.id, { mode: value as KnowledgeInternalizationMode, targetKnowledgeId: value === "create" ? undefined : draft.targetKnowledgeId || entries[0]?.id })} />
              {draft.mode === "merge" ? <SelectField label="合并目标" value={draft.targetKnowledgeId ?? ""} options={mergeTargets} onChange={(value) => void controller.updateDraft(draft.id, { targetKnowledgeId: value })} /> : <SelectField label="分类" value={draft.category} options={[...KNOWLEDGE_CATEGORIES]} onChange={(value) => void controller.updateDraft(draft.id, { category: value as KnowledgeCategory })} />}
            </div>
            <TextField label="标题" value={draft.title} onChange={(value) => void controller.updateDraft(draft.id, { title: value })} />
            <TextField label="摘要" value={draft.summary} onChange={(value) => void controller.updateDraft(draft.id, { summary: value })} />
            <TextField label="标签" value={draft.tags.join("、")} onChange={(value) => void controller.updateDraft(draft.id, { tags: splitInput(value) })} />
            <TextAreaField className="min-h-48" label="知识正文预览" value={draft.content} onChange={(value) => void controller.updateDraft(draft.id, { content: value })} />
            <div className="grid gap-2 text-sm text-muted"><p><strong className="text-foreground">核心原理：</strong>{draft.principle || "待补充"}</p><p><strong className="text-foreground">易错陷阱：</strong>{draft.pitfalls.join("；") || "待补充"}</p><p><strong className="text-foreground">迁移练习：</strong>{draft.transferPractice || "待补充"}</p><p><strong className="text-foreground">AI 判断：</strong>{draft.reason}</p></div>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="primary" disabled={!draft.title.trim() || !draft.content.trim() || (draft.mode === "merge" && !draft.targetKnowledgeId)} onClick={() => void controller.confirmDraft(draft.id)}>确认写入知识库</Button><Button type="button" variant="danger" onClick={() => void controller.removeDraft(draft.id)}>忽略草稿</Button></div>
          </SoftBlock>
        )) : <EmptyState>暂无待确认的内化草稿；生成后即使刷新页面也会保留在这里。</EmptyState>}
      </div>
    </Panel>
  );
}
