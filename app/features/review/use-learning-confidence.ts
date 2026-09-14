"use client";

import { useState } from "react";
import type { SelfConfidence } from "../../types/domains/learning-event.ts";

export type LearningConfidenceState = {
  selectedConfidence?: SelfConfidence;
  feedbackRevealed: boolean;
};

/** 自信度只属于当前 subject；切换、跳过或成功提交都会清空，避免跨题泄漏。 */
export function useLearningConfidence(subjectId: string | null) {
  const [capture, setCapture] = useState<{ subjectId: string | null } & LearningConfidenceState>({
    subjectId: null,
    feedbackRevealed: false,
  });

  const state: LearningConfidenceState = capture.subjectId === subjectId
    ? capture
    : { feedbackRevealed: false };

  function setConfidence(value: SelfConfidence) {
    setCapture((current) => {
      if (current.subjectId !== subjectId) return { subjectId, feedbackRevealed: false, selectedConfidence: value };
      return current.feedbackRevealed ? current : { ...current, selectedConfidence: value };
    });
  }

  function clearConfidence() {
    setCapture((current) => {
      if (current.subjectId !== subjectId) return { subjectId, feedbackRevealed: false };
      return current.feedbackRevealed ? current : { subjectId, feedbackRevealed: false };
    });
  }

  function revealFeedback() {
    setCapture((current) => current.subjectId === subjectId
      ? { ...current, feedbackRevealed: true }
      : { subjectId, feedbackRevealed: true });
  }

  function reset() {
    setCapture({ subjectId, feedbackRevealed: false });
  }

  return { ...state, clearConfidence, revealFeedback, reset, setConfidence };
}

export type LearningConfidenceController = ReturnType<typeof useLearningConfidence>;
