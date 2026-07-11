import { RelatedKnowledgeList } from "../knowledge/knowledge-workspace";
import { Button, CardButton, Chip, DataList, DetailCard, EmptyState, Panel, SoftBlock } from "../shared/ui-primitives";
import { formatTimerSeconds, type ReviewTimerMode, type ReviewTimerState } from "./use-review-timer";
import type { KnowledgeMatch } from "../../services/association-matcher";
import type { KnowledgeEntry, Mistake, ReviewResult } from "../../types/review";

type ReviewViewProps = {
  answerOpen: boolean;
  associatedKnowledge: KnowledgeEntry[];
  currentReview: Mistake | null;
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
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onRecordReview: (result: ReviewResult) => void;
  onToggleAnswer: () => void;
};

// 渲染复盘页，并把已确认知识关联和本地推荐一起放到复盘侧栏中。
export function ReviewView({
  answerOpen,
  associatedKnowledge,
  currentReview,
  dueMistakes,
  relatedKnowledge,
  reviewIndex,
  timer,
  onCreateKnowledgeDraft,
  onOpenKnowledgeEntry,
  onRecordReview,
  onToggleAnswer,
}: ReviewViewProps) {
  if (!currentReview) {
    return (
      <Panel title="今日队列已清空" eyebrow="Review Complete">
        <EmptyState>可以去错题库按板块挑选，或录入新的错题。</EmptyState>
      </Panel>
    );
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)_300px] gap-4 max-lg:grid-cols-1">
      <DetailCard className="min-h-[570px]">
        <p className="text-xs font-extrabold text-muted">
          {currentReview.board} · {currentReview.source}
        </p>
        <h3 className="mt-1 text-xl font-extrabold">
          第 {reviewIndex + 1} 题 / {dueMistakes.length}
        </h3>
        <ReviewTimerBar timer={timer} />
        <SoftBlock className="my-5 text-lg leading-loose">{currentReview.stem}</SoftBlock>
        <div className="flex flex-wrap gap-2">
          {currentReview.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
          <Chip tone="yellow">掌握度 {currentReview.mastery}</Chip>
        </div>
        <div className="mt-5 flex flex-wrap gap-3 border-b border-line pb-4">
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
        </div>
        {answerOpen && (
          <div className="mt-5 leading-relaxed">
            <strong className="block">答案</strong>
            <p>{currentReview.answer}</p>
            <strong className="mt-3 block">解析</strong>
            <p>{currentReview.explanation}</p>
          </div>
        )}
      </DetailCard>

      <aside className="space-y-4">
        <Panel title="本轮队列" eyebrow="Session">
          <div className="grid gap-3">
            {dueMistakes.map((item, index) => (
              <div key={item.id} className="grid grid-cols-[34px_1fr] gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-blue/10 text-sm font-extrabold text-blue">{index + 1}</span>
                <p className="min-w-0">
                  <strong className="block truncate">{item.board}</strong>
                  <span className="text-muted">{item.reasons.join(" / ")}</span>
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="推荐资料" eyebrow="Knowledge">
          <Button className="mb-3 w-full" size="sm" variant="soft" onClick={() => onCreateKnowledgeDraft(currentReview)}>
            沉淀当前错题
          </Button>
          {associatedKnowledge.length > 0 && (
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
          <RelatedKnowledgeList matches={relatedKnowledge} onOpenKnowledgeEntry={onOpenKnowledgeEntry} compact />
        </Panel>
      </aside>
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
        <p className="text-xs font-extrabold uppercase text-muted">{timer.mode === "countdown" ? "倒计时" : "手动计时"}</p>
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
