"use client";

import { useCallback, useEffect, useState } from "react";
import { associationRepository } from "../../services/association-repository";
import { knowledgeRepository } from "../../services/knowledge-repository";
import { reviewRepository } from "../../services/review-repository";
import type { Attempt, ImportJob, KnowledgeEntry, KnowledgeMistakeLink, Mistake } from "../../types/review";

type ReviewWorkspaceDataNotice = {
  onReadFailed: (error: unknown) => void;
  onSynced: () => void;
};

// 集中读取错题、知识库、导入任务和关联快照；AI 连接由独立 hook 管理。
export function useReviewWorkspaceData(today: Date, notice: ReviewWorkspaceDataNotice) {
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

  // 从 repository 读取最新快照，并同步页面上所有派生计数的基础数据。
  const refreshData = useCallback(async () => {
    try {
      const [snapshot, knowledgeTraining, links] = await Promise.all([
        reviewRepository.loadSnapshot(today),
        knowledgeRepository.loadTrainingSnapshot(today),
        associationRepository.listAll(),
      ]);
      setMistakes(snapshot.mistakes);
      setKnowledgeEntries(knowledgeTraining.entries);
      setAssociationLinks(links);
      setImportJobs(snapshot.importJobs);
      setAttempts(snapshot.attempts);
      setAttemptsCount(snapshot.attempts.length);
      setCorrectCount(snapshot.attempts.filter((item) => item.result === "correct").length);
      setKnowledgeAttemptsCount(knowledgeTraining.attempts.length);
      setKnowledgeCorrectCount(knowledgeTraining.attempts.filter((item) => item.result === "correct").length);
      setReadError("");
      notice.onSynced();
      setLoading(false);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "本地数据读取失败");
      throw error;
    }
  }, [notice, today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshData().catch((error) => {
      notice.onReadFailed(error);
      setLoading(false);
    });
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
    loading,
    mistakes,
    readError,
    refreshData,
  };
}
