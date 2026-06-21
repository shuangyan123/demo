"use client";

import { useCallback, useEffect, useState } from "react";
import { associationRepository } from "../../services/association-repository";
import { knowledgeRepository } from "../../services/knowledge-repository";
import { reviewRepository } from "../../services/review-repository";
import type { Attempt, ImportJob, KnowledgeEntry, KnowledgeMistakeLink, Mistake } from "../../types/review";

// 集中读取错题、知识库、导入任务和关联快照；AI 连接由独立 hook 管理。
export function useReviewWorkspaceData(today: Date) {
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
  const [notice, setNotice] = useState("正在读取本地题库");

  // 从 repository 读取最新快照，并同步页面上所有派生计数的基础数据。
  const refreshData = useCallback(async () => {
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
    setNotice("本地题库已同步");
    setLoading(false);
  }, [today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshData().catch((error) => {
      setNotice(error instanceof Error ? error.message : "读取失败");
      setLoading(false);
    });
  }, [refreshData]);

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
    notice,
    refreshData,
    setNotice,
  };
}
