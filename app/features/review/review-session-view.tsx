import { RelatedKnowledgeList } from "../knowledge/knowledge-workspace";
import { Button, CardButton, Chip, DataList, EmptyState, MasteryDots, Panel } from "../shared/ui-primitives";
import { LearningConfidenceControl } from "./learning-confidence-control";
import type { LearningConfidenceState } from "./use-learning-confidence.ts";
import type { SelfConfidence } from "../../types/domains/learning-event.ts";
import { formatTimerSeconds, type ReviewTimerMode, type ReviewTimerState } from "./use-review-timer.ts";
import type { KnowledgeMatch } from "../../services/association-matcher";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake, ReviewResult } from "../../types/domains/review.ts";

type ReviewViewProps = {
  disabled?: boolean;
  answerOpen: boolean;
  associatedKnowledge: KnowledgeEntry[];
  currentReview: Mistake | null;
  confidence: LearningConfidenceState;
  dueMistakes: Mistake[];
  relatedKnowledge: KnowledgeMatch[];
  reviewIndex: number;
  timer: ReviewTimerState & {
    pause: () => void;
    reset: () => void;
    resume: () => void;
    setMode: (mode: ReviewTimerMode) => void;
    setTargetSec: (seconds: number) => void;
  };
  onCreateKnowledgeDraft: (mistake: Mistake) => void;
  onClearConfidence: () => void;
  onSetConfidence: (value: SelfConfidence) => void;
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onRecordReview: (result: ReviewResult) => void;
  onToggleAnswer: () => void;
};

// 渲染复盘页，并把已确认知识关联和本地推荐一起放到复盘侧栏中。
export function ReviewView({
  disabled = false,
  answerOpen,
  associatedKnowledge,
  currentReview,
  confidence,
  dueMistakes,
  relatedKnowledge,
  reviewIndex,
  timer,
  onCreateKnowledgeDraft,
  onClearConfidence,
  onSetConfidence,
  onOpenKnowledgeEntry,
  onRecordReview,
  onToggleAnswer,
}: ReviewViewProps) {
  if (!currentReview) {
    return (
      <Panel title="今日队列已清空" eyebrow="复盘完成">
        <EmptyState reviewPack="learning" stateId="review.queue.empty">可以去错题库按板块挑选，或录入新的错题。</EmptyState>
      </Panel>
    );
  }

  return (
    <section className="learning-page">
      <header className="learning-page-header">
        <p className="text-sm text-muted">先独立作答，再核对答案；结果与把握程度都是本轮自评，不是独立评分。</p>
        <div className="learning-metrics" aria-label="复盘进度">
          <span><strong>{reviewIndex + 1}</strong>当前题</span>
          <span><strong>{dueMistakes.length}</strong>本轮队列</span>
          <span><strong>{currentReview.mastery}</strong>掌握度</span>
        </div>
      </header>
      <div className="review-session-layout">
      <article className="review-question-canvas">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold text-muted">{currentReview.board} · {currentReview.source}</p>
          <span className="text-sm text-muted">第 {reviewIndex + 1} / {dueMistakes.length} 题</span>
        </div>
        <h3 className="my-8 max-w-4xl text-xl font-bold leading-9 max-sm:my-6 max-sm:text-lg">{currentReview.stem}</h3>
        <div className="flex flex-wrap gap-2">
          {currentReview.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
          <Chip tone="yellow">掌握度 {currentReview.mastery}</Chip>
        </div>
        <LearningConfidenceControl
          disabled={disabled}
          feedbackRevealed={confidence.feedbackRevealed}
          selectedConfidence={confidence.selectedConfidence}
          subjectId={currentReview.id}
          onChange={(value) => onSetConfidence(value)}
          onClear={onClearConfidence}
        />
        {answerOpen && (
          <section className="mt-7 border-t border-line pt-5 leading-7" aria-live="polite">
            <strong className="block">答案</strong>
            <p>{currentReview.answer}</p>
            <strong className="mt-4 block">解析</strong>
            <p>{currentReview.explanation}</p>
          </section>
        )}
        <p className="mt-4 text-sm text-muted">以下结果为本轮自评：自评答对 / 自评不确定 / 自评答错。</p>
        <fieldset disabled={disabled} className="review-session-actions">
          <Button variant="outline" onClick={onToggleAnswer}>
            {answerOpen ? "收起答案" : "查看答案"}
          </Button>
          <Button className="border-emerald-200 text-green" variant="outline" onClick={() => onRecordReview("correct")}>
            会做
          </Button>
          <Button className="border-amber-200 text-yellow" variant="outline" onClick={() => onRecordReview("uncertain")}>
            犹豫
          </Button>
          <Button variant="danger" onClick={() => onRecordReview("wrong")}>
            不会
          </Button>
        </fieldset>
      </article>

      <aside className="review-session-rail" aria-label="当前轮次">
        <section>
          <h3 className="font-extrabold">当前轮次</h3>
          <dl className="mt-3 grid gap-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">当前错因</dt><dd>{confidence.feedbackRevealed ? currentReview.reasons.join(" / ") || "未标记" : "查看答案后显示"}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted">掌握情况</dt><dd><MasteryDots value={currentReview.mastery} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">剩余题目</dt><dd>{Math.max(0, dueMistakes.length - reviewIndex - 1)}</dd></div>
          </dl>
        </section>

        <ReviewTimerBar timer={timer} />

        <details className="border-t border-line pt-4">
          <summary className="cursor-pointer font-bold">查看本轮队列（{dueMistakes.length}）</summary>
          <ol className="mt-3 grid gap-2 text-sm">
            {dueMistakes.map((item, index) => <li key={item.id} className={index === reviewIndex ? "font-bold text-foreground" : "text-muted"}>{index + 1}. {item.board} · {confidence.feedbackRevealed ? item.reasons.join(" / ") : "反馈待查看"}</li>)}
          </ol>
        </details>

        <section className="border-t border-line pt-4">
          <h3 className="mb-3 font-extrabold">推荐资料</h3>
          <Button className="mb-3 w-full" disabled={!confidence.feedbackRevealed} size="sm" variant="soft" onClick={() => onCreateKnowledgeDraft(currentReview)}>
            {confidence.feedbackRevealed ? "沉淀当前错题" : "查看反馈后可沉淀"}
          </Button>
          {confidence.feedbackRevealed && associatedKnowledge.length > 0 && (
            <div className="mb-3">
              <strong className="mb-2 block text-sm">已确认关联资料</strong>
              <DataList>
                {associatedKnowledge.map((entry) => (
                  <CardButton key={entry.id} className="p-3" onClick={() => onOpenKnowledgeEntry(entry)}>
                    <strong className="line-clamp-2">{entry.title}</strong>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{entry.summary || entry.content}</p>
                  </CardButton>
                ))}
              </DataList>
            </div>
          )}
          {confidence.feedbackRevealed ? <RelatedKnowledgeList matches={relatedKnowledge} onOpenKnowledgeEntry={onOpenKnowledgeEntry} compact /> : <p className="text-sm leading-6 text-muted">查看答案后显示关联资料。</p>}
        </section>
      </aside>
      </div>
    </section>
  );
}

// 渲染复盘计时控制条，允许用户在正计时和倒计时训练之间切换。
function ReviewTimerBar({
  timer,
}: {
  timer: ReviewTimerState & {
    pause: () => void;
    reset: () => void;
    resume: () => void;
    setMode: (mode: ReviewTimerMode) => void;
    setTargetSec: (seconds: number) => void;
  };
}) {
  const primaryTime = timer.mode === "countdown" ? timer.remainingSec : timer.elapsedSec;
  const timeoutOverrun = Math.max(0, timer.elapsedSec - timer.targetSec);

  return (
    <section className={`ui-timer-panel ${timer.isTimedOut ? "ui-timer-panel-timeout" : ""}`} aria-label="手动复盘计时">
      <div>
        <p className="text-xs font-extrabold text-muted">{timer.mode === "countdown" ? "倒计时" : "手动计时"}</p>
        <strong className="ui-timer-display">
          {timer.isTimedOut ? `超时 ${formatTimerSeconds(timeoutOverrun)}` : formatTimerSeconds(primaryTime)}
        </strong>
        <span className="ui-timer-caption">
          {timer.isRunning ? "正在计时" : timer.elapsedSec ? "已暂停" : "点击开始后计时"}
          {timer.mode === "countdown" ? ` · 目标 ${formatTimerSeconds(timer.targetSec)}` : ""}
        </span>
      </div>
      <div className="ui-timer-controls">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={timer.isRunning ? timer.pause : timer.resume}>
            {timer.isRunning ? "暂停" : timer.elapsedSec ? "继续" : "开始"}
          </Button>
          <Button size="sm" variant="ghost" onClick={timer.reset}>
            重置
          </Button>
        </div>
        <details className="ui-timer-countdown-options">
          <summary>倒计时选项</summary>
          <div className="ui-timer-segment" role="group" aria-label="计时模式">
            <button className={timer.mode === "stopwatch" ? "active" : ""} type="button" onClick={() => timer.setMode("stopwatch")}>正计时</button>
            <button className={timer.mode === "countdown" ? "active" : ""} type="button" onClick={() => timer.setMode("countdown")}>倒计时</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[60, 90, 120].map((seconds) => <button key={seconds} className={`ui-timer-chip ${timer.targetSec === seconds ? "active" : ""}`} type="button" onClick={() => timer.setTargetSec(seconds)}>{seconds}s</button>)}
            <label className="ui-timer-custom">自定义<input min={15} max={3600} type="number" value={timer.targetSec} onChange={(event) => timer.setTargetSec(Number(event.target.value))} /></label>
          </div>
        </details>
      </div>
    </section>
  );
}
