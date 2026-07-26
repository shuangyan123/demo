"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import {
  Button,
  CheckboxRow,
  DataList,
  EmptyState,
  Panel,
  ScoreBar,
  SelectField,
  TextAreaField,
  TextField,
  Toolbar,
} from "../shared/ui-primitives";
import { textValue } from "../../lib/form-utils";
import { interviewTypeLabels } from "../../services/interview-rubric";
import type { InterviewPracticePlan, InterviewQuestion, InterviewQuestionSet, InterviewType } from "../../types/domains/interview.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;
type PlanType = InterviewType | "mixed";

const planTypeOptions: Array<[PlanType, string]> = [
  ["mixed", "混合训练"],
  ["structured", interviewTypeLabels.structured],
  ["structured_group", interviewTypeLabels.structured_group],
  ["leaderless_group", interviewTypeLabels.leaderless_group],
];

// 训练计划页负责把题组或候选题变成可持续推进的场次目标。
export function InterviewPracticePlansView({
  apiReady,
  busy,
  plans,
  questionSets,
  questions,
  onAddPracticePlan,
  onDeletePracticePlan,
  onGeneratePracticePlan,
  onStartPlanQuestion,
  onUpdatePracticePlan,
}: {
  apiReady: boolean;
  busy: boolean;
  plans: InterviewPracticePlan[];
  questionSets: InterviewQuestionSet[];
  questions: InterviewQuestion[];
  onAddPracticePlan: (input: Omit<InterviewPracticePlan, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onDeletePracticePlan: (id: string) => Promise<void>;
  onGeneratePracticePlan: (input: { type: PlanType; questions: InterviewQuestion[]; targetSessionCount: number; title?: string }) => Promise<void>;
  onStartPlanQuestion: (question: InterviewQuestion, planId: string) => void;
  onUpdatePracticePlan: (id: string, patch: Partial<Omit<InterviewPracticePlan, "id" | "createdAt" | "updatedAt">>) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<PlanType>("mixed");
  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const filteredQuestions = useMemo(
    () => questions.filter((question) => typeFilter === "mixed" || question.type === typeFilter),
    [questions, typeFilter],
  );

  // 计划的下一题按完成场次推进，若场次超出题目数则循环取题。
  function resolveNextQuestion(plan: InterviewPracticePlan): InterviewQuestion | null {
    if (!plan.questionIds.length) return null;
    const index = plan.completedSessionCount % plan.questionIds.length;
    return questionById.get(plan.questionIds[index]) ?? plan.questionIds.map((id) => questionById.get(id)).find(Boolean) ?? null;
  }

  // 切换候选题勾选状态，用于手动建计划或 AI 计划候选集。
  function toggleQuestion(id: string, checked: boolean) {
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // 提交手动训练计划；如果选择了题组，则优先使用题组的题目列表。
  async function submitPlan(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const sourceSetId = textValue(formData.get("sourceSetId"));
    const sourceSet = questionSets.find((set) => set.id === sourceSetId);
    const questionIds = sourceSet?.questionIds.length ? sourceSet.questionIds : Array.from(selectedIds);
    if (!questionIds.length) return;
    await onAddPracticePlan({
      completedSessionCount: 0,
      nextPracticeAt: new Date().toISOString(),
      questionIds,
      reason: textValue(formData.get("reason")) || "手动创建训练计划",
      sourceSetId: sourceSet?.id,
      status: "active",
      targetSessionCount: Math.max(1, Number(textValue(formData.get("targetSessionCount"))) || questionIds.length),
      title: textValue(formData.get("title")) || sourceSet?.title || "面试训练计划",
      type: sourceSet?.type ?? (textValue(formData.get("type")) as PlanType),
    });
    setSelectedIds(new Set());
    form.reset();
  }

  // 触发 AI 计划生成；AI 只能在当前勾选题或筛选题中选择。
  async function generatePlanFromCandidates() {
    const candidates = (selectedIds.size ? Array.from(selectedIds).map((id) => questionById.get(id)).filter(Boolean) : filteredQuestions).filter(
      Boolean,
    ) as InterviewQuestion[];
    await onGeneratePracticePlan({
      questions: candidates,
      targetSessionCount: Math.max(1, Math.min(8, candidates.length || 1)),
      title: "AI 面试训练计划",
      type: typeFilter,
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <Panel eyebrow="PLANS" title="训练计划">
        <DataList>
          {plans.length ? (
            plans.map((plan) => {
              const nextQuestion = resolveNextQuestion(plan);
              return (
                <article key={plan.id} className="ui-card ui-card-muted">
                  <Toolbar>
                    <div>
                      <p className="text-sm font-bold text-foreground">{plan.type === "mixed" ? "混合训练" : interviewTypeLabels[plan.type]}</p>
                      <h3 className="mt-1 text-lg font-extrabold">{plan.title}</h3>
                    </div>
                    <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-muted">{plan.status}</span>
                  </Toolbar>
                  <p className="mt-2 text-sm leading-6 text-muted">{plan.reason}</p>
                  <div className="mt-4">
                    <ScoreBar label="完成进度" max={plan.targetSessionCount} value={plan.completedSessionCount} />
                  </div>
                  <p className="mt-3 text-xs font-bold text-muted">下次训练：{new Date(plan.nextPracticeAt).toLocaleString("zh-CN")}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button disabled={!nextQuestion || busy || plan.status !== "active"} size="sm" variant="primary" onClick={() => nextQuestion && onStartPlanQuestion(nextQuestion, plan.id)}>
                      开始下一场
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onUpdatePracticePlan(plan.id, { status: plan.status === "active" ? "paused" : "active" })}
                    >
                      {plan.status === "active" ? "暂停" : "继续"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void onDeletePracticePlan(plan.id)}>
                      删除
                    </Button>
                  </div>
                </article>
              );
            })
          ) : (
            <EmptyState>还没有训练计划。可以从题组或勾选题目创建。</EmptyState>
          )}
        </DataList>
      </Panel>

      <Panel eyebrow="CREATE PLAN" title="创建训练计划">
        <form className="grid gap-4" onSubmit={submitPlan}>
          <SelectField label="计划类型" name="type" options={planTypeOptions} value={typeFilter} onChange={(value) => setTypeFilter(value as PlanType)} />
          <SelectField
            label="来源题组"
            name="sourceSetId"
            options={[["", "不使用题组"], ...questionSets.map((set) => [set.id, set.title] as [string, string])]}
          />
          <TextField label="计划名称" name="title" placeholder="例如：结构化表达 5 场强化" />
          <TextField label="目标场次" name="targetSessionCount" placeholder="5" type="number" />
          <TextAreaField label="计划说明" name="reason" placeholder="说明本计划训练目标" />

          <div className="grid gap-2 rounded-lg border border-line bg-surface-muted p-3">
            <Toolbar>
              <strong className="text-sm">候选题目</strong>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set(filteredQuestions.map((question) => question.id)))}>
                全选当前
              </Button>
            </Toolbar>
            <div className="grid max-h-72 gap-2 overflow-auto pr-1">
              {filteredQuestions.length ? (
                filteredQuestions.map((question) => (
                  <CheckboxRow key={question.id} checked={selectedIds.has(question.id)} onCheckedChange={(checked) => toggleQuestion(question.id, checked)}>
                    <span className="block text-sm font-bold">{question.title}</span>
                    <span className="mt-1 block text-xs text-muted">{interviewTypeLabels[question.type]} · {question.difficulty ?? "medium"}</span>
                  </CheckboxRow>
                ))
              ) : (
                <EmptyState>当前筛选下没有题目。</EmptyState>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || (!selectedIds.size && !questionSets.length)} type="submit" variant="primary">
              保存计划
            </Button>
            <Button disabled={busy || !apiReady || !filteredQuestions.length} variant="soft" onClick={() => void generatePlanFromCandidates()}>
              AI 生成计划
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
