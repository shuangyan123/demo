"use client";

// 文件说明：提供知识库模板引导和手动新增表单。

import type { SyntheticEvent } from "react";
import { useState } from "react";
import { Button, Panel, SelectField, TextAreaField, TextField } from "../shared/ui-primitives";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeCategorySummary } from "../../types/review";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

const knowledgeTemplateCopy: Record<KnowledgeCategory, { title: string; summary: string; tags: string; source: string; content: string }> = {
  政治理论: { title: "例如：新发展理念核心要点", summary: "概念、关键词、易混点和对应题型", tags: "理论关键词、时政、易混概念", source: "教材 / 课程 / 时政整理", content: "整理概念定义、关键词、常见问法和易混表述。" },
  常识判断: { title: "例如：行政法高频概念", summary: "定义、适用条件、例外和易错点", tags: "法律、科技、人文、地理", source: "题库 / 课程 / 手动整理", content: "整理知识点、判断标准、典型例子和容易混淆的选项。" },
  申论: { title: "例如：基层治理写作框架", summary: "适用主题、表达框架和可迁移素材", tags: "写作框架、素材、治理", source: "范文 / 材料 / 手动整理", content: "整理问题表现、原因分析、对策表达和可复用句式。" },
};

/** 渲染空分类搭建引导，模板始终先生成可编辑草稿。 */
export function KnowledgeStarterGuide({ onCreateStarterDrafts, summaries }: { onCreateStarterDrafts: (category?: KnowledgeCategory) => void; summaries: KnowledgeCategorySummary[] }) {
  const emptyCategories = summaries.filter((item) => item.total === 0);
  return (
    <Panel title="资料搭建助手" eyebrow="快速开始">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 max-lg:grid-cols-1">
        <div className="text-sm leading-6 text-muted">
          <strong className="mb-1 block text-base text-foreground">先搭框架，再填内容。</strong>
          三类资料会生成不同的整理模板，进入草稿区后可逐条编辑、删除或确认入库。
          {emptyCategories.length ? <span className="mt-1 block">当前空分类：{emptyCategories.map((item) => item.category).join("、")}。</span> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-lg:justify-start">
          {summaries.map((item) => <Button key={item.category} type="button" size="sm" variant="outline" onClick={() => onCreateStarterDrafts(item.category)}>{item.category}</Button>)}
          <Button size="sm" type="button" variant="primary" onClick={() => onCreateStarterDrafts()}>全部模板</Button>
        </div>
      </div>
    </Panel>
  );
}

/** 渲染新增知识资料表单，分类变化仅更新占位模板。 */
export function KnowledgeCreateForm({ defaultCategory, onAddEntry }: { defaultCategory: KnowledgeCategory; onAddEntry: (event: SubmitReactEvent) => void }) {
  const [category, setCategory] = useState<KnowledgeCategory>(defaultCategory);
  const template = knowledgeTemplateCopy[category];
  return (
    <Panel title="新增资料" eyebrow="手动新增">
      <form className="grid gap-3" onSubmit={onAddEntry}>
        <SelectField label="分类" name="category" value={category} onChange={(value) => setCategory(value as KnowledgeCategory)} options={[...KNOWLEDGE_CATEGORIES]} />
        <TextField label="标题" name="title" placeholder={template.title} required />
        <TextField label="摘要" name="summary" placeholder={template.summary} />
        <TextField label="标签" name="tags" placeholder={template.tags} />
        <TextField label="来源" name="source" placeholder={template.source} />
        <TextAreaField label="正文" name="content" placeholder={template.content} required />
        <Button type="submit" variant="primary">保存到知识库</Button>
      </form>
    </Panel>
  );
}
