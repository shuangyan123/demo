"use client";

import { useCallback, useEffect, useState } from "react";
import { associationRepository } from "../../services/association-repository";
import { knowledgeRepository } from "../../services/knowledge-repository";
import { reviewRepository } from "../../services/review-repository";
import { deriveLearnerStateSnapshot, loadLearnerStateSnapshot } from "../../services/learner-state-service.ts";
import type { Attempt, Mistake } from "../../types/domains/review.ts";
import type { ImportJob } from "../../types/domains/import.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { KnowledgeMistakeLink } from "../../types/domains/association.ts";
import { filterWorkspaceRecords, type WorkspaceDataScope } from "../../services/workspace-data-scope";

type ReviewWorkspaceDataNotice = {
  onReadFailed: (error: unknown) => void;
  onSynced: () => void;
};

// 集中读取错题、知识库、导入任务和关联快照；AI 连接由独立 hook 管理。
export function useReviewWorkspaceData(today: Date, notice: ReviewWorkspaceDataNotice, scope: WorkspaceDataScope) {
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [attemptsCount, setAttemptsCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [associationLinks, setAssociationLinks] = useState<KnowledgeMistakeLink[]>([]);
  const [knowledgeAttemptsCount, setKnowledgeAttemptsCount] = useState(0);
  const [knowledgeCorrectCount, setKnowledgeCorrectCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [learnerState, setLearnerState] = useState(() => deriveLearnerStateSnapshot({
    mistakes: [],
    attempts: [],
    knowledgeEntries: [],
    knowledgeAttempts: [],
    interviewEvaluations: [],
    interviewPracticePlans: [],
    interviewSessions: [],
    tutoringSessions: [],
    tutoringTurns: [],
    tutoringPlans: [],
  }, today));

  // 从 repository 读取最新快照，并同步页面上所有派生计数的基础数据。
  const refreshData = useCallback(async () => {
    try {
      const [snapshot, knowledgeTraining, links, nextLearnerState] = await Promise.all([
        reviewRepository.loadSnapshot(today),
        knowledgeRepository.loadTrainingSnapshot(today),
        associationRepository.listAll(),
        loadLearnerStateSnapshot(today, scope),
      ]);
      const scopedMistakes = filterWorkspaceRecords(snapshot.mistakes, scope);
      const scopedKnowledgeEntries = filterWorkspaceRecords(knowledgeTraining.entries, scope);
      const scopedLinks = filterWorkspaceRecords(links, scope);
      const scopedImportJobs = filterWorkspaceRecords(snapshot.importJobs, scope);
      const scopedAttempts = filterWorkspaceRecords(snapshot.attempts, scope);
      const scopedKnowledgeAttempts = filterWorkspaceRecords(knowledgeTraining.attempts, scope);
      setMistakes(scopedMistakes);
      setKnowledgeEntries(scopedKnowledgeEntries);
      setAssociationLinks(scopedLinks);
      setImportJobs(scopedImportJobs);
      setAttempts(scopedAttempts);
      setAttemptsCount(scopedAttempts.length);
      setCorrectCount(scopedAttempts.filter((item) => item.result === "correct").length);
      setKnowledgeAttemptsCount(scopedKnowledgeAttempts.length);
      setKnowledgeCorrectCount(scopedKnowledgeAttempts.filter((item) => item.result === "correct").length);
      setLearnerState(nextLearnerState);
      setReadError("");
      notice.onSynced();
      setLoading(false);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "本地数据读取失败");
      throw error;
    }
  }, [notice, scope, today]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      refreshData().catch((error) => {
        if (!active) return;
        notice.onReadFailed(error);
        setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [notice, refreshData]);

  return {
    associationLinks,
    attempts,
    attemptsCount,
    correctCount,
    importJobs,
    knowledgeAttemptsCount,
    knowledgeCorrectCount,
    knowledgeEntries,
    learnerState,
    loading,
    mistakes,
    readError,
    refreshData,
  };
}
