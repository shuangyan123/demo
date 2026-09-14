"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { splitInput, textValue } from "../../lib/form-utils";
import {
  buildBoardStats,
  buildLowMistakes,
  buildMistakeFilterOptions,
  buildReviewQueue,
  calculateAverageMastery,
  calculateCorrectRate,
  filterMistakes,
  resolveActiveMistakeId,
  type BoardStat,
} from "../../lib/review-selectors";
import { toISODate } from "../../lib/review-utils";
import { downloadExportFile, exportMistakes } from "../../services/export-service";
import { reviewRepository } from "../../services/review-repository";
import type { Attempt, Board, ExportFormat, ExportScope, Filters, Mistake } from "../../types/domains/review.ts";
import type { SelfConfidence } from "../../types/domains/learning-event.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { useReviewTimer } from "./use-review-timer.ts";
import { useLearningSubmission } from "./use-learning-submission.ts";
import { useLearningConfidence } from "./use-learning-confidence.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

type UseReviewLearningControllerInput = {
  attempts: Attempt[];
  attemptsCount: number;
  correctCount: number;
  mistakes: Mistake[];
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
  onSelectView: (view: ViewKey) => void;
  today: Date;
};

const INITIAL_FILTERS: Filters = { board: "全部", mastery: "all", search: "" };

/** 管理错题筛选、复盘队列和错题仓储动作，不承担知识库或跨模块装配。 */
export function useReviewLearningController(input: UseReviewLearningControllerInput) {
  const { attempts, attemptsCount, correctCount, mistakes, onNotice, onRefresh, onSelectView, today } = input;
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [reasonFilter, setReasonFilter] = useState("全部");
  const [tagFilter, setTagFilter] = useState("全部");
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [explicitReviewId, setExplicitReviewId] = useState<string | null>(null);
  const submission = useLearningSubmission(onRefresh, onNotice);

  const dueMistakes = useMemo(() => buildReviewQueue(mistakes, today), [mistakes, today]);
  const lowMistakes = useMemo(() => buildLowMistakes(mistakes), [mistakes]);
  const boardStats = useMemo<BoardStat[]>(() => buildBoardStats(mistakes, today), [mistakes, today]);
  const { reasonOptions, tagOptions } = useMemo(() => buildMistakeFilterOptions(mistakes), [mistakes]);
  const avgMastery = useMemo(() => calculateAverageMastery(mistakes), [mistakes]);
  const correctRate = useMemo(() => calculateCorrectRate(attemptsCount, correctCount), [attemptsCount, correctCount]);
  const filteredMistakes = useMemo(
    () => filterMistakes(mistakes, filters, selectedBoard, reasonFilter, tagFilter),
    [filters, mistakes, reasonFilter, selectedBoard, tagFilter],
  );
  const activeSelectedId = resolveActiveMistakeId(selectedId, filteredMistakes);
  const selectedMistake = mistakes.find((item) => item.id === activeSelectedId) ?? null;
  const reviewQueue = (explicitReviewId ? mistakes.filter((item) => item.id === explicitReviewId) : dueMistakes)
    .filter((item) => !submission.committedIds.includes(item.id));
  const currentReview = reviewQueue[reviewIndex] ?? reviewQueue[0] ?? null;
  const timer = useReviewTimer(currentReview?.id ?? null);
  const confidence = useLearningConfidence(currentReview?.id ?? null);

  function resetReview() {
    submission.reset();
    setExplicitReviewId(null);
    setReviewIndex(0);
    setAnswerOpen(false);
    confidence.reset();
  }

  function openBoard(board: Board) {
    setSelectedBoard((current) => (current === board ? null : board));
    setFilters((current) => ({ ...current, board }));
    onSelectView("library");
  }

  function openMistake(mistake: Mistake) {
    setSelectedBoard(mistake.board);
    setFilters((current) => ({ ...current, board: mistake.board }));
    setSelectedId(mistake.id);
    onSelectView("library");
  }

  function openReview(id?: string) {
    if (submission.busy || submission.refreshFailed) return;
    if (id && !mistakes.some((item) => item.id === id)) return onNotice("这道错题已不可用，请刷新学习数据。");
    resetReview();
    // 明确点选未到期目标时仅复盘该题，不能回退到不相关的第一题。
    if (id && !dueMistakes.some((item) => item.id === id)) setExplicitReviewId(id);
    setReviewIndex(id ? Math.max(0, dueMistakes.findIndex((item) => item.id === id)) : 0);
    setAnswerOpen(false);
    onSelectView("review");
  }

  async function recordReview(result: "correct" | "uncertain" | "wrong") {
    if (!currentReview) return;
    const evidence = confidence.selectedConfidence === undefined ? undefined : { selfConfidence: confidence.selectedConfidence };
    await submission.record(currentReview.id, async () => {
      await reviewRepository.recordReview(currentReview, result, today, timer.elapsedSec, evidence);
      setReviewIndex(0);
      setAnswerOpen(false);
      timer.reset();
      confidence.reset();
    }, "复盘记录已保存");
  }

  function toggleAnswer() {
    if (answerOpen) {
      setAnswerOpen(false);
      return;
    }
    confidence.revealFeedback();
    setAnswerOpen(true);
  }

  async function deleteMistake(mistake: Mistake) {
    if (!window.confirm("确定删除这道错题及其复盘记录吗？")) return;
    await reviewRepository.removeMistake(mistake.id);
    const nextMistake = mistakes.find((item) => item.id !== mistake.id && item.board === mistake.board) ?? null;
    setSelectedId(nextMistake?.id ?? null);
    if (currentReview?.id === mistake.id) resetReview();
    await onRefresh();
    onNotice("错题已删除，关联复盘记录已清理");
  }

  async function deleteMistakes(ids: string[]) {
    if (!ids.length) {
      onNotice("请先选择要删除的错题");
      return;
    }
    const idSet = new Set(ids);
    await reviewRepository.removeMistakes(ids);
    const nextMistake = mistakes.find((item) => !idSet.has(item.id) && (!selectedBoard || item.board === selectedBoard)) ?? null;
    if (selectedId && idSet.has(selectedId)) setSelectedId(nextMistake?.id ?? null);
    if (currentReview && idSet.has(currentReview.id)) resetReview();
    await onRefresh();
    onNotice(`已删除 ${ids.length} 道错题，并清理复盘记录和关联`);
  }

  function exportItems(items: Mistake[], format: ExportFormat, scope: ExportScope) {
    if (!items.length) {
      onNotice("当前没有可导出的错题");
      return;
    }
    const file = exportMistakes(items, format, scope);
    downloadExportFile(file);
    onNotice(`已导出 ${items.length} 道错题：${file.filename}`);
  }

  async function addMistake(event: SubmitReactEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const board = textValue(formData.get("board")) as Board;
    await reviewRepository.addMistake(
      {
        board,
        source: textValue(formData.get("source")) || "手动录入",
        stem: textValue(formData.get("stem")),
        answer: textValue(formData.get("answer")),
        explanation: textValue(formData.get("explanation")) || "待补充解析",
        reasons: splitInput(formData.get("reason")),
        tags: splitInput(formData.get("tags")),
        mastery: Number(formData.get("mastery")),
        nextReviewAt: toISODate(today),
      },
      today,
    );
    form.reset();
    await onRefresh();
    setSelectedBoard(board);
    setFilters((current) => ({ ...current, board }));
    onSelectView("library");
    onNotice("错题已保存到 IndexedDB");
  }

  return {
    actions: {
      addMistake,
      deleteMistake,
      deleteMistakes,
      exportItems,
      openBoard,
      openMistake,
      openReview,
      recordReview,
      resetReview,
      clearConfidence: confidence.clearConfidence,
      setConfidence: (value: SelfConfidence) => confidence.setConfidence(value),
      setAnswerOpen,
      toggleAnswer,
      setFilters,
      setReasonFilter,
      setSelectedBoard,
      setSelectedId,
      setTagFilter,
    },
    snapshot: {
      activeSelectedId,
      answerOpen,
      confidence,
      attempts,
      avgMastery,
      boardStats,
      correctRate,
      currentReview,
      reviewQueue,
      submission,
      dueMistakes,
      filteredMistakes,
      filters,
      lowMistakes,
      reasonFilter,
      reasonOptions,
      reviewIndex,
      selectedBoard,
      selectedMistake,
      tagFilter,
      tagOptions,
      timer,
    },
  };
}

export type ReviewLearningController = ReturnType<typeof useReviewLearningController>;
