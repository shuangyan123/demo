"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { Button, CheckboxRow, DataList, EmptyState, Panel, SelectField, TagGroup, TextAreaField, TextField, Toolbar } from "../shared/ui-primitives";
import { splitInput, textValue } from "../../lib/form-utils";
import { interviewTypeLabels } from "../../services/interview-rubric";
import type { InterviewQuestion, InterviewQuestionSet, InterviewType } from "../../types/domains/interview.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;
type SetType = InterviewType | "mixed";

const setTypeOptions: Array<[SetType, string]> = [
  ["mixed", "混合训练"],
  ["structured", interviewTypeLabels.structured],
  ["structured_group", interviewTypeLabels.structured_group],
  ["leaderless_group", interviewTypeLabels.leaderless_group],
];

// 题组页负责把分散题目组织成专题训练包，便于后续生成训练计划。
export function InterviewQuestionSetsView({
  busy,
  questionSets,
  questions,
  onAddQuestionSet,
  onDeleteQuestionSet,
  onStartQuestion,
}: {
  busy: boolean;
  questionSets: InterviewQuestionSet[];
  questions: InterviewQuestion[];
  onAddQuestionSet: (input: Omit<InterviewQuestionSet, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onDeleteQuestionSet: (id: string) => Promise<void>;
  onStartQuestion: (question: InterviewQuestion) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<SetType>("mixed");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const candidateQuestions = useMemo(
    () => questions.filter((question) => typeFilter === "mixed" || question.type === typeFilter),
    [questions, typeFilter],
  );
  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);

  // 切换题组候选题勾选状态，使用 Set 副本避免直接修改 React 状态。
  function toggleQuestion(id: string, checked: boolean) {
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // 提交题组表单，只保存题目 ID 列表，题目正文仍由题库维护。
  async function submitQuestionSet(event: SubmitReactEvent) {
    event.preventDefault();
    if (!selectedIds.size) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    await onAddQuestionSet({
      description: textValue(formData.get("description")),
      questionIds: Array.from(selectedIds),
      tags: splitInput(formData.get("tags")),
      title: textValue(formData.get("title")) || "未命名题组",
      type: textValue(formData.get("type")) as SetType,
    });
    setSelectedIds(new Set());
    form.reset();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <Panel eyebrow="SETS" title="题组">
        <DataList>
          {questionSets.length ? (
            questionSets.map((set) => {
              const firstQuestion = set.questionIds.map((id) => questionById.get(id)).find(Boolean);
              return (
                <article key={set.id} className="ui-card ui-card-muted">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-blue">{set.type === "mixed" ? "混合训练" : interviewTypeLabels[set.type]}</p>
                      <h3 className="mt-1 text-lg font-extrabold">{set.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted">{set.description || "暂无说明"}</p>
                      <p className="mt-2 text-xs font-bold text-muted">包含 {set.questionIds.length} 道题</p>
                      <TagGroup items={set.tags} tone="blue" />
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button disabled={!firstQuestion || busy} size="sm" variant="primary" onClick={() => firstQuestion && onStartQuestion(firstQuestion)}>
                        开始第一题
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void onDeleteQuestionSet(set.id)}>
                        删除
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <EmptyState>还没有题组。先在右侧选择题目，创建一个专题训练包。</EmptyState>
          )}
        </DataList>
      </Panel>

      <Panel eyebrow="CREATE SET" title="创建题组">
        <form className="grid gap-4" onSubmit={submitQuestionSet}>
          <SelectField label="题组类型" name="type" options={setTypeOptions} value={typeFilter} onChange={(value) => setTypeFilter(value as SetType)} />
          <TextField label="题组名称" name="title" placeholder="例如：基层治理结构化专项" required />
          <TextAreaField label="题组说明" name="description" placeholder="说明本题组的训练目标、使用场景或薄弱点" />
          <TextField label="标签" name="tags" placeholder="综合分析、基层治理、应急应变" />

          <div className="grid gap-2 rounded-lg border border-line bg-surface-muted p-3">
            <Toolbar>
              <strong className="text-sm">候选题目</strong>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set(candidateQuestions.map((question) => question.id)))}>
                全选当前
              </Button>
            </Toolbar>
            <div className="grid max-h-80 gap-2 overflow-auto pr-1">
              {candidateQuestions.length ? (
                candidateQuestions.map((question) => (
                  <CheckboxRow key={question.id} checked={selectedIds.has(question.id)} onCheckedChange={(checked) => toggleQuestion(question.id, checked)}>
                    <span className="block text-sm font-bold">{question.title}</span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted">{question.prompt}</span>
                  </CheckboxRow>
                ))
              ) : (
                <EmptyState>当前筛选下没有题目。</EmptyState>
              )}
            </div>
          </div>

          <Button disabled={busy || !selectedIds.size} type="submit" variant="primary">
            保存题组（{selectedIds.size}）
          </Button>
        </form>
      </Panel>
    </div>
  );
}
