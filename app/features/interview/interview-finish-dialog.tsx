import type { RefObject } from "react";
import { Button } from "../shared/ui-primitives";
import styles from "./interview-session-panel.module.css";

/** 活动面试的结束确认层，明确区分部分复盘与不评分中止。 */
export function InterviewFinishDialog({
  busy,
  dialogRef,
  hasAnswers,
  hasTranscript,
  onCancel,
  onClose,
  onPartialReview,
}: {
  busy: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  hasAnswers: boolean;
  hasTranscript: boolean;
  onCancel: () => void;
  onClose: () => void;
  onPartialReview: () => void;
}) {
  return (
    <div className={styles.finishBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className={styles.finishDialog} role="dialog" aria-modal="true" aria-labelledby="interview-finish-title">
        <h3 id="interview-finish-title">结束本次面试？</h3>
        <p>
          {hasTranscript
            ? "当前还有未提交文字。你可以将其作为最后一轮并生成部分复盘，或直接中止且不评分。"
            : hasAnswers
              ? "已提交的作答可以生成部分复盘；直接中止不会评分，也不会推进训练计划。"
              : "当前没有作答。确认后将记录为中止，不评分，也不会推进训练计划。"}
        </p>
        <div>
          <Button disabled={busy} variant="ghost" onClick={onClose}>继续训练</Button>
          {hasTranscript || hasAnswers ? (
            <Button disabled={busy} variant="primary" onClick={onPartialReview}>
              {hasTranscript ? "提交当前作答并生成部分复盘" : "生成部分复盘"}
            </Button>
          ) : null}
          <Button disabled={busy} variant="danger" onClick={onCancel}>
            {hasTranscript || hasAnswers ? "不评分并中止" : "确认中止"}
          </Button>
        </div>
      </section>
    </div>
  );
}
