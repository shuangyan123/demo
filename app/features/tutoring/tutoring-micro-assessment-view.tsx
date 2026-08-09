"use client";

import { useState } from "react";
import type { TutoringTurn } from "../../types/domains/tutoring.ts";
import { Button, Chip, DataList, EmptyState, Toolbar } from "../shared/ui-primitives.tsx";

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** 辅导消息流集中展示可观察反馈、延迟和本轮微测。 */
export function TutoringConversationList({
  turns,
  onCompleteMicroAssessment,
  onSetTurnHelpful,
}: {
  turns: TutoringTurn[];
  onCompleteMicroAssessment: (turnId: string, selections: number[]) => void;
  onSetTurnHelpful: (turnId: string, helpful: boolean) => void;
}) {
  if (!turns.length) return <EmptyState reviewPack="tutoring" stateId="tutoring.assessment.empty">暂无对话。创建会话后，可以发送文字、语音转写或当前关键帧。</EmptyState>;
  return (
    <DataList className="mt-4 max-h-[24rem] overflow-y-auto pr-1">
      {turns.map((turn) => (
        <article key={turn.id} className={`rounded-2xl border border-line p-3 ${turn.speaker === "ai_tutor" ? "bg-[var(--interactive-selected-bg)]" : "bg-surface"}`}>
          <div className="flex items-center justify-between gap-3">
            <strong>{turn.speaker === "student" ? "学生" : turn.speaker === "ai_tutor" ? "AI 老师" : "系统"}</strong>
            <span className="text-xs text-muted">{formatDateTime(turn.createdAt)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{turn.content}</p>
          {turn.detectedProblem ? <p className="mt-2 text-sm text-yellow">发现：{turn.detectedProblem}</p> : null}
          {turn.nextQuestion ? <p className="mt-2 text-sm text-foreground">追问：{turn.nextQuestion}</p> : null}
          {turn.responseLatencyMs !== undefined ? <p className="mt-2 text-xs text-muted">本轮反馈 {(turn.responseLatencyMs / 1000).toFixed(1)} 秒</p> : null}
          {turn.speaker === "ai_tutor" ? (
            <Toolbar className="mt-3">
              <Button size="sm" variant={turn.helpful === true ? "soft" : "ghost"} onClick={() => onSetTurnHelpful(turn.id, true)}>有帮助</Button>
              <Button size="sm" variant={turn.helpful === false ? "soft" : "ghost"} onClick={() => onSetTurnHelpful(turn.id, false)}>换种讲法</Button>
            </Toolbar>
          ) : null}
          {turn.microAssessment?.questions.length ? <TutoringMicroAssessmentView turn={turn} onComplete={onCompleteMicroAssessment} /> : null}
        </article>
      ))}
    </DataList>
  );
}

/** 微测使用原生 radio 语义，提交后展示确定性得分和解析。 */
export function TutoringMicroAssessmentView({
  turn,
  onComplete,
}: {
  turn: TutoringTurn;
  onComplete: (turnId: string, selections: number[]) => Promise<void> | void;
}) {
  const assessment = turn.microAssessment!;
  const [selections, setSelections] = useState<number[]>(() => assessment.selections ?? assessment.questions.map(() => -1));
  const [retrying, setRetrying] = useState(false);
  const completed = Boolean(assessment.completedAt) && !retrying;

  async function submitAssessment() {
    await onComplete(turn.id, selections);
    setRetrying(false);
  }

  function retryAssessment() {
    setSelections(assessment.questions.map(() => -1));
    setRetrying(true);
  }
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface-muted/55 p-3" aria-label="本轮微测">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm">本轮微测</strong>
        {completed ? <Chip tone={assessment.correctCount === assessment.questions.length ? "green" : "yellow"}>{assessment.correctCount}/{assessment.questions.length}</Chip> : <Chip tone="blue">完成后更新复练</Chip>}
      </div>
      <div className="mt-3 grid gap-4">
        {assessment.questions.map((question, questionIndex) => (
          <fieldset key={question.id} disabled={completed} className="grid gap-2">
            <legend className="text-sm font-medium">{questionIndex + 1}. {question.prompt}</legend>
            {question.options.map((option, optionIndex) => {
              const isCorrect = completed && optionIndex === question.correctOptionIndex;
              const isWrongSelection = completed && selections[questionIndex] === optionIndex && !isCorrect;
              return (
                <label key={`${question.id}:${optionIndex}`} className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isCorrect ? "border-green/50 bg-green/10" : isWrongSelection ? "border-red/50 bg-red/10" : "border-line bg-surface"}`}>
                  <input
                    checked={selections[questionIndex] === optionIndex}
                    name={`micro-${turn.id}-${question.id}`}
                    type="radio"
                    value={optionIndex}
                    onChange={() => setSelections((current) => current.map((value, index) => index === questionIndex ? optionIndex : value))}
                  />
                  <span>{option}</span>
                </label>
              );
            })}
            {completed ? <p className="text-xs leading-5 text-muted">{question.explanation}</p> : null}
          </fieldset>
        ))}
      </div>
      {!completed ? (
        <Button className="mt-3" disabled={selections.some((value) => value < 0)} size="sm" variant="primary" onClick={() => void submitAssessment()}>
          提交微测并安排复练
        </Button>
      ) : assessment.correctCount !== assessment.questions.length ? (
        <Button className="mt-3" size="sm" variant="soft" onClick={retryAssessment}>重新微测</Button>
      ) : null}
    </section>
  );
}
