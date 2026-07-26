"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import {
  Button,
  CheckboxRow,
  DataList,
  EmptyState,
  FilterBar,
  Panel,
  SelectField,
  TagGroup,
  TextAreaField,
  TextField,
  Toolbar,
} from "../shared/ui-primitives";
import { splitInput, textValue } from "../../lib/form-utils";
import { interviewTypeLabels } from "../../services/interview-rubric";
import type { InterviewDifficulty, InterviewQuestion, InterviewQuestionDraft, InterviewType } from "../../types/domains/interview.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

const interviewTypeOptions: Array<[InterviewType, string]> = [
  ["structured", interviewTypeLabels.structured],
  ["structured_group", interviewTypeLabels.structured_group],
  ["leaderless_group", interviewTypeLabels.leaderless_group],
];

const difficultyOptions: Array<[InterviewDifficulty, string]> = [
  ["easy", "基础"],
  ["medium", "中等"],
  ["hard", "较难"],
];

// 面试题库视图负责题目新增、筛选、收藏和 AI 草稿确认，不直接访问 Dexie。
export function InterviewQuestionBank({
  apiReady,
  busy,
  questionDrafts,
  questions,
  selectedQuestionId,
  selectedType,
  onAddQuestion,
  onAddStarterQuestions,
  onChangeType,
  onClearQuestionDrafts,
  onConfirmQuestionDrafts,
  onDeleteQuestion,
  onGenerateQuestionDrafts,
  onSelectQuestion,
  onStartSession,
  onToggleFavorite,
  onToggleQuestionDraft,
}: {
  apiReady: boolean;
  busy: boolean;
  questionDrafts: InterviewQuestionDraft[];
  questions: InterviewQuestion[];
  selectedQuestionId: string | null;
  selectedType: InterviewType | "all";
  onAddQuestion: (input: Omit<InterviewQuestion, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onAddStarterQuestions: () => Promise<void>;
  onChangeType: (type: InterviewType | "all") => void;
  onClearQuestionDrafts: () => void;
  onConfirmQuestionDrafts: () => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onGenerateQuestionDrafts: (input: { type: InterviewType; topic: string; count: number; context: string }) => Promise<void>;
  onSelectQuestion: (id: string) => void;
  onStartSession: (question: InterviewQuestion) => void;
  onToggleFavorite: (question: InterviewQuestion) => Promise<void>;
  onToggleQuestionDraft: (id: string, selected: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<InterviewDifficulty | "all">("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);

  const visibleQuestions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return questions.filter((question) => {
      const matchSearch = !keyword || [question.title, question.prompt, question.material, question.tags.join(" ")].join(" ").toLowerCase().includes(keyword);
      const matchDifficulty = difficulty === "all" || question.difficulty === difficulty;
      const matchFavorite = !favoriteOnly || question.favorite;
      return matchSearch && matchDifficulty && matchFavorite;
    });
  }, [difficulty, favoriteOnly, questions, search]);

  // 提交手动面试题表单，并把标签从逗号/换行文本规范化为数组。
  async function submitQuestion(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    await onAddQuestion({
      difficulty: textValue(formData.get("difficulty")) as InterviewDifficulty,
      expectedDurationSec: Number(textValue(formData.get("expectedDurationSec"))) || 180,
      favorite: false,
      material: textValue(formData.get("material")),
      practiceCount: 0,
      prompt: textValue(formData.get("prompt")),
      source: textValue(formData.get("source")) || "手动录入",
      tags: splitInput(formData.get("tags")),
      title: textValue(formData.get("title")),
      type: textValue(formData.get("type")) as InterviewType,
    });
    form.reset();
  }

  // 手动触发 AI 出题；生成结果只进入草稿预览。
  async function submitAiGeneration(event: SubmitReactEvent) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await onGenerateQuestionDrafts({
      context: textValue(formData.get("context")),
      count: Number(textValue(formData.get("count"))) || 5,
      topic: textValue(formData.get("topic")),
      type: textValue(formData.get("aiType")) as InterviewType,
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <Panel eyebrow="QUESTION BANK" title="面试题库">
        <FilterBar>
          <SelectField
            label="面试类型"
            options={[["all", "全部类型"], ...interviewTypeOptions]}
            value={selectedType}
            onChange={(value) => onChangeType(value as InterviewType | "all")}
          />
          <TextField label="搜索" value={search} onChange={setSearch} placeholder="标题、题干、材料、标签" />
          <SelectField
            label="难度"
            options={[["all", "全部难度"], ...difficultyOptions]}
            value={difficulty}
            onChange={(value) => setDifficulty(value as InterviewDifficulty | "all")}
          />
          <Button variant={favoriteOnly ? "primary" : "outline"} onClick={() => setFavoriteOnly((value) => !value)}>
            只看收藏
          </Button>
        </FilterBar>

        <Toolbar className="mt-4">
          <span className="text-sm font-bold text-muted">当前 {visibleQuestions.length} 道题</span>
          <Button disabled={busy} variant="soft" onClick={onAddStarterQuestions}>
            载入三类示例题
          </Button>
        </Toolbar>

        <DataList className="mt-4">
          {visibleQuestions.length ? (
            visibleQuestions.map((question) => (
              <article key={question.id} className={`ui-card ui-card-muted text-left transition hover:border-foreground/40 hover:bg-[var(--interactive-hover-bg)] ${selectedQuestionId === question.id ? "border-foreground/50 bg-[var(--interactive-selected-bg)]" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button className="min-w-0 text-left" type="button" onClick={() => onSelectQuestion(question.id)}>
                    <p className="text-sm font-bold text-foreground">{interviewTypeLabels[question.type]}</p>
                    <h3 className="mt-1 text-lg font-extrabold text-foreground">{question.title}</h3>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{question.prompt}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-bold text-muted">{question.difficulty ?? "medium"}</span>
                      <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-bold text-muted">练习 {question.practiceCount ?? 0} 次</span>
                    </div>
                    <TagGroup items={question.tags} tone="blue" />
                  </button>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button size="sm" variant={question.favorite ? "soft" : "outline"} onClick={() => void onToggleFavorite(question)}>
                      {question.favorite ? "已收藏" : "收藏"}
                    </Button>
                    <Button disabled={busy || !apiReady} size="sm" variant="primary" onClick={() => onStartSession(question)}>
                      开始模拟
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void onDeleteQuestion(question.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <EmptyState>当前筛选下没有面试题，可以手动新增、载入示例题或使用 AI 生成草稿。</EmptyState>
          )}
        </DataList>
      </Panel>

      <div className="grid gap-5">
        <Panel eyebrow="CREATE" title="新增面试题">
          <form className="grid gap-4" onSubmit={submitQuestion}>
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="类型" name="type" options={interviewTypeOptions} />
              <SelectField label="难度" name="difficulty" options={difficultyOptions} defaultValue="medium" />
            </div>
            <TextField label="标题" name="title" placeholder="例如：基层治理中的群众诉求处理" required />
            <TextAreaField label="题干" name="prompt" placeholder="请输入面试题干" required />
            <TextAreaField label="材料" name="material" placeholder="无领导小组或材料题可填写背景材料" />
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="预计时长（秒）" name="expectedDurationSec" placeholder="180" type="number" />
              <TextField label="来源" name="source" placeholder="手动录入 / 资料整理" />
            </div>
            <TextField label="标签" name="tags" placeholder="综合分析、基层治理" />
            <Button disabled={busy} type="submit" variant="primary">
              保存面试题
            </Button>
          </form>
        </Panel>

        <Panel eyebrow="AI DRAFTS" title="AI 生成面试题">
          <form className="grid gap-4" onSubmit={submitAiGeneration}>
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="类型" name="aiType" options={interviewTypeOptions} />
              <TextField label="题量" name="count" placeholder="5" type="number" />
            </div>
            <TextField label="主题来源" name="topic" placeholder="例如：基层治理、应急应变、公共服务" />
            <TextAreaField label="补充上下文" name="context" placeholder="可粘贴知识库摘要、薄弱标签或训练目标" />
            <Button disabled={busy || !apiReady} type="submit" variant="soft">
              生成草稿
            </Button>
          </form>

          {questionDrafts.length > 0 && (
            <div className="mt-5 grid gap-3">
              <Toolbar>
                <strong className="text-sm">待确认草稿</strong>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void onConfirmQuestionDrafts()}>
                    确认入库
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onClearQuestionDrafts}>
                    清空
                  </Button>
                </div>
              </Toolbar>
              {questionDrafts.map((draft) => (
                <CheckboxRow key={draft.id} checked={draft.selected} onCheckedChange={(checked) => onToggleQuestionDraft(draft.id, checked)}>
                  <span className="block text-sm font-bold">{draft.title}</span>
                  <span className="mt-1 block line-clamp-3 text-xs leading-5 text-muted">{draft.prompt}</span>
                  <span className="mt-2 block text-xs font-bold text-muted">
                    {interviewTypeLabels[draft.type]} · {draft.difficulty} · 置信度 {Math.round(draft.confidence * 100)}%
                  </span>
                </CheckboxRow>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
