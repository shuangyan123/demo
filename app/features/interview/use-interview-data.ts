"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { requestInterviewEvaluation, requestInterviewPracticePlan, requestInterviewQuestions, requestInterviewReply } from "../../services/interview-ai-service";
import { interviewRepository } from "../../services/interview-repository";
import { finishInterviewTimer, pauseInterviewTimer, resetInterviewTurnTimer, resumeInterviewTimer } from "../../services/interview-timer";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { InterviewEvaluation, InterviewLink, InterviewPracticePlan, InterviewQuestion, InterviewQuestionDraft, InterviewQuestionSet, InterviewSession, InterviewSnapshot, InterviewSpeaker, InterviewStage, InterviewTurn, InterviewType } from "../../types/domains/interview.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { filterWorkspaceRecords, type WorkspaceDataScope } from "../../services/workspace-data-scope";

const emptySnapshot: InterviewSnapshot = {
  evaluations: [],
  links: [],
  practicePlans: [],
  questionSets: [],
  questions: [],
  sessions: [],
  turns: [],
};

type NewQuestionInput = Omit<InterviewQuestion, "id" | "createdAt" | "updatedAt">;
type NewQuestionSetInput = Omit<InterviewQuestionSet, "id" | "createdAt" | "updatedAt">;
type NewPracticePlanInput = Omit<InterviewPracticePlan, "id" | "createdAt" | "updatedAt">;

function scopeInterviewSnapshot(snapshot: InterviewSnapshot, scope: WorkspaceDataScope): InterviewSnapshot {
  return {
    evaluations: filterWorkspaceRecords(snapshot.evaluations, scope),
    links: filterWorkspaceRecords(snapshot.links, scope),
    practicePlans: filterWorkspaceRecords(snapshot.practicePlans, scope),
    questionSets: filterWorkspaceRecords(snapshot.questionSets, scope),
    questions: filterWorkspaceRecords(snapshot.questions, scope),
    sessions: filterWorkspaceRecords(snapshot.sessions, scope),
    turns: filterWorkspaceRecords(snapshot.turns, scope),
  };
}

// 根据当前阶段推断 AI 轮次角色；结构化小组和无领导会出现同组考生发言。
function resolveAiSpeaker(type: InterviewType, stage: InterviewStage): InterviewSpeaker {
  if (type === "structured_group" && (stage === "peer_review" || stage === "response")) return "ai_peer";
  if (type === "leaderless_group" && stage === "discussion") return "ai_peer";
  return "ai_interviewer";
}

// 面试模块的数据协调 hook，集中处理 Dexie 刷新、AI 推进和评分保存。
export function useInterviewData({
  textConnection,
  onNotice,
  personalizationSettings,
  scope,
}: {
  textConnection?: ApiConnectionProfile;
  onNotice: (message: string) => void;
  personalizationSettings: PersonalizationSettings;
  scope: WorkspaceDataScope;
}) {
  const [snapshot, setSnapshot] = useState<InterviewSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [questionDrafts, setQuestionDrafts] = useState<InterviewQuestionDraft[]>([]);

  const refresh = useCallback(async () => {
    const nextSnapshot = scopeInterviewSnapshot(await interviewRepository.loadSnapshot(), scope);
    setSnapshot(nextSnapshot);
  }, [scope]);

  useEffect(() => {
    let active = true;

    // 首次进入面试模块时异步读取 Dexie，避免在 effect 同步阶段触发状态级联更新。
    async function loadInitialSnapshot() {
      try {
        const nextSnapshot = scopeInterviewSnapshot(await interviewRepository.loadSnapshot(), scope);
        if (active) {
          setSnapshot(nextSnapshot);
        }
      } catch (error) {
        if (active) {
          onNotice(error instanceof Error ? error.message : "面试数据读取失败");
        }
      }
    }

    void loadInitialSnapshot();
    return () => {
      active = false;
    };
  }, [onNotice, scope]);

  const evaluationBySessionId = useMemo(() => new Map(snapshot.evaluations.map((item) => [item.sessionId, item])), [snapshot.evaluations]);
  const turnsBySessionId = useMemo(() => {
    const groups = new Map<string, InterviewTurn[]>();
    snapshot.turns.forEach((turn) => {
      groups.set(turn.sessionId, [...(groups.get(turn.sessionId) ?? []), turn]);
    });
    return groups;
  }, [snapshot.turns]);

  // 新增面试题并刷新题库列表。
  async function addQuestion(input: NewQuestionInput) {
    await interviewRepository.addQuestion(input);
    await refresh();
    onNotice("面试题已保存");
  }

  // 批量保存已经确认的 AI 草稿题；未勾选或缺少题干的草稿不会写入题库。
  async function confirmQuestionDrafts() {
    const selectedDrafts = questionDrafts.filter((draft) => draft.selected && draft.prompt.trim());
    if (!selectedDrafts.length) {
      onNotice("请先勾选可入库的 AI 面试题草稿");
      return;
    }
    await interviewRepository.bulkAddQuestions(
      selectedDrafts.map((draft) => ({
        difficulty: draft.difficulty,
        expectedDurationSec: draft.expectedDurationSec,
        favorite: false,
        material: draft.material,
        practiceCount: 0,
        prompt: draft.prompt,
        source: draft.source || "AI 生成",
        tags: draft.tags,
        title: draft.title,
        type: draft.type,
      })),
    );
    setQuestionDrafts((drafts) => drafts.filter((draft) => !draft.selected));
    await refresh();
    onNotice(`已保存 ${selectedDrafts.length} 道 AI 面试题`);
  }

  // 删除面试题并清理题目来源关联，历史会话保留。
  async function deleteQuestion(id: string) {
    await interviewRepository.removeQuestion(id);
    await refresh();
    onNotice("面试题已删除，相关题目关联已清理");
  }

  // 切换题目收藏状态；收藏用于题库筛选和后续计划选题。
  async function toggleQuestionFavorite(question: InterviewQuestion) {
    await interviewRepository.toggleQuestionFavorite(question);
    await refresh();
  }

  // 新建题组，题组只保存题目 ID，便于后续训练计划复用。
  async function addQuestionSet(input: NewQuestionSetInput) {
    await interviewRepository.addQuestionSet(input);
    await refresh();
    onNotice("面试题组已保存");
  }

  // 更新题组基本信息或题目列表，用于手动维护训练专题。
  async function updateQuestionSet(id: string, patch: Partial<NewQuestionSetInput>) {
    await interviewRepository.updateQuestionSet(id, patch);
    await refresh();
    onNotice("面试题组已更新");
  }

  // 删除题组并保留历史训练计划里的题目引用。
  async function deleteQuestionSet(id: string) {
    await interviewRepository.removeQuestionSet(id);
    await refresh();
    onNotice("面试题组已删除，相关计划已解除题组引用");
  }

  // 新建训练计划，计划会记录目标场次、完成场次和下次训练时间。
  async function addPracticePlan(input: NewPracticePlanInput) {
    await interviewRepository.addPracticePlan(input);
    await refresh();
    onNotice("训练计划已保存");
  }

  // 更新训练计划状态、题目或下次训练时间。
  async function updatePracticePlan(id: string, patch: Partial<NewPracticePlanInput>) {
    await interviewRepository.updatePracticePlan(id, patch);
    await refresh();
    onNotice("训练计划已更新");
  }

  // 删除训练计划但保留历史会话，避免复盘记录丢失。
  async function deletePracticePlan(id: string) {
    await interviewRepository.removePracticePlan(id);
    await refresh();
    onNotice("训练计划已删除，历史会话已保留");
  }

  // 手动触发 AI 出题，结果只进入草稿区，用户确认后才写入题库。
  async function generateQuestionDrafts(input: { type: InterviewType; topic: string; count: number; context: string }) {
    if (scope.kind === "sample") {
      onNotice("示例模式不会调用真实 AI。");
      return;
    }
    if (!textConnection) {
      onNotice("请先在 AI 连接中配置默认文本连接，再使用 AI 生成面试题");
      return;
    }
    setBusy(true);
    try {
      const drafts = await requestInterviewQuestions({ ...input, connection: textConnection, personalizationSettings });
      setQuestionDrafts(drafts);
      onNotice(`AI 已生成 ${drafts.length} 条面试题草稿，请确认后入库`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "AI 生成面试题失败");
    } finally {
      setBusy(false);
    }
  }

  // 切换 AI 草稿的勾选状态，未确认草稿不会持久化。
  function toggleQuestionDraft(id: string, selected: boolean) {
    setQuestionDrafts((drafts) => drafts.map((draft) => (draft.id === id ? { ...draft, selected } : draft)));
  }

  // 清空当前未确认的 AI 草稿，刷新后也不会保留这些临时建议。
  function clearQuestionDrafts() {
    setQuestionDrafts([]);
  }

  // 基于本地题目让 AI 生成计划草稿，并在校验通过后保存为本地训练计划。
  async function generatePracticePlan(input: { type: InterviewType | "mixed"; questions: InterviewQuestion[]; targetSessionCount: number; title?: string }) {
    if (scope.kind === "sample") {
      onNotice("示例模式不会调用真实 AI。");
      return;
    }
    if (!textConnection) {
      onNotice("请先在 AI 连接中配置默认文本连接，再使用 AI 生成训练计划");
      return;
    }
    setBusy(true);
    try {
      const plan = await requestInterviewPracticePlan({ ...input, connection: textConnection, personalizationSettings });
      await interviewRepository.addPracticePlan(plan);
      await refresh();
      onNotice("AI 训练计划已生成并保存");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "AI 生成训练计划失败");
    } finally {
      setBusy(false);
    }
  }

  // 创建会话后立即请求 AI 面试官开场，保证进入模拟时就是可作答状态。
  async function startSession(question: InterviewQuestion, planId?: string): Promise<InterviewSession | null> {
    if (scope.kind === "sample") {
      onNotice("示例模式不会调用真实 AI；请载入进行中场景查看现场界面。");
      return null;
    }
    if (!textConnection) {
      onNotice("请先在 AI 连接中配置默认文本连接，再开始 AI 模拟面试");
      return null;
    }
    setBusy(true);
    try {
      const session = await interviewRepository.createSession(question, planId);
      const aiReply = await requestInterviewReply({ question, session, connection: textConnection, turns: [], personalizationSettings });
      await interviewRepository.addTurn({
        content: aiReply.reply,
        sessionId: session.id,
        speaker: resolveAiSpeaker(session.type, aiReply.nextStage),
        stage: aiReply.nextStage,
      });
      await interviewRepository.updateSession(session.id, {
        stage: aiReply.nextStage,
        transcriptText: aiReply.reply,
      });
      await refresh();
      onNotice("面试模拟已开始");
      return session;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "AI 面试启动失败");
      await refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }

  // 保存用户作答后让 AI 继续追问或推进到下一阶段。
  async function submitCandidateTurn(session: InterviewSession, content: string, durationSec: number) {
    if (scope.kind === "sample") {
      onNotice("示例模式不会调用真实 AI。");
      return;
    }
    if (!textConnection) {
      onNotice("请先在 AI 连接中配置默认文本连接，再继续 AI 模拟面试");
      return;
    }
    const answer = content.trim();
    if (!answer) {
      onNotice("请先输入或语音转写本轮作答");
      return;
    }
    setBusy(true);
    try {
      const existingTurns = turnsBySessionId.get(session.id) ?? [];
      const candidateTurn = await interviewRepository.addTurn({
        content: answer,
        durationSec,
        sessionId: session.id,
        speaker: "candidate",
        stage: session.stage,
      });
      const nextTurns = [...existingTurns, candidateTurn];
      const aiReply = await requestInterviewReply({ question: session, session, connection: textConnection, turns: nextTurns, personalizationSettings });
      await interviewRepository.addTurn({
        content: aiReply.reply,
        sessionId: session.id,
        speaker: resolveAiSpeaker(session.type, aiReply.nextStage),
        stage: aiReply.nextStage,
      });
      await interviewRepository.updateSession(session.id, {
        stage: aiReply.nextStage,
        totalDurationSec: session.totalDurationSec + durationSec,
        ...resetInterviewTurnTimer(),
        transcriptText: [...nextTurns.map((turn) => turn.content), aiReply.reply].join("\n"),
      });
      if (aiReply.shouldEvaluate) {
        await finishSession(session.id);
      } else {
        await refresh();
        onNotice("AI 已生成下一轮追问或流程提示");
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "AI 面试推进失败");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // 对会话文字稿进行最终评分；AI 返回非法 JSON 时不会写入评分表。
  async function finishSession(sessionId: string): Promise<InterviewEvaluation | null> {
    if (scope.kind === "sample") {
      onNotice("示例模式不会调用真实 AI；可直接中止，或载入“已完成”场景查看复盘。");
      return null;
    }
    if (!textConnection) {
      onNotice("请先在 AI 连接中配置默认文本连接，再生成面试评分");
      return null;
    }
    const freshSnapshot = scopeInterviewSnapshot(await interviewRepository.loadSnapshot(), scope);
    const session = freshSnapshot.sessions.find((item) => item.id === sessionId);
    if (!session) {
      onNotice("未找到要评分的面试会话");
      return null;
    }
    setBusy(true);
    try {
      await interviewRepository.updateSession(session.id, finishInterviewTimer(session));
      const turns = freshSnapshot.turns.filter((turn) => turn.sessionId === sessionId);
      const evaluationInput = await requestInterviewEvaluation({ session, connection: textConnection, turns, personalizationSettings });
      const evaluation = await interviewRepository.saveEvaluation(evaluationInput);
      await refresh();
      onNotice(`面试评分已生成：${evaluation.totalScore} 分`);
      return evaluation;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "面试评分失败");
      await refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession(sessionId: string) {
    await interviewRepository.cancelSession(sessionId);
    await refresh();
    onNotice("本次面试已中止；已有轮次已保留，未评分且未计入训练计划。");
  }

  /** 未提交文字在用户确认后只落为候选人轮次，再进入一次部分复盘请求。 */
  async function finishWithCurrentAnswer(session: InterviewSession, content: string, durationSec: number) {
    const trimmed = content.trim();
    if (!trimmed) return finishSession(session.id);
    await interviewRepository.addTurn({
      content: trimmed,
      sessionId: session.id,
      speaker: "candidate",
      stage: session.stage,
      durationSec,
    });
    await interviewRepository.updateSession(session.id, {
      totalDurationSec: session.totalDurationSec + durationSec,
      transcriptText: [session.transcriptText, trimmed].filter(Boolean).join("\n"),
      ...finishInterviewTimer(session),
    });
    return finishSession(session.id);
  }

  // 删除历史会话并清理文字稿、评分和会话关联。
  async function deleteSession(id: string) {
    await interviewRepository.removeSession(id);
    await refresh();
    onNotice("面试记录已删除，相关会话关联已清理");
  }

  async function addQuestions(inputs: NewQuestionInput[]) {
    if (!inputs.length) return;
    await interviewRepository.bulkAddQuestions(inputs);
    await refresh();
  }

  async function pauseTimer(session: InterviewSession) {
    await interviewRepository.updateSession(session.id, pauseInterviewTimer(session));
    await refresh();
  }

  async function resumeTimer(session: InterviewSession) {
    await interviewRepository.updateSession(session.id, resumeInterviewTimer(session));
    await refresh();
  }

  // 保存面试题或会话与知识库/错题之间的确认式关联。
  async function addLink(input: Omit<InterviewLink, "id" | "createdAt" | "updatedAt">) {
    await interviewRepository.addLink(input);
    await refresh();
    onNotice("面试关联已保存");
  }

  // 删除一条面试关联。
  async function deleteLink(id: string) {
    await interviewRepository.removeLink(id);
    await refresh();
    onNotice("面试关联已删除");
  }

  return {
    addLink,
    addPracticePlan,
    addQuestion,
    addQuestions,
    addQuestionSet,
    busy,
    cancelSession,
    clearQuestionDrafts,
    deleteLink,
    deletePracticePlan,
    deleteQuestion,
    deleteQuestionSet,
    deleteSession,
    evaluationBySessionId,
    finishSession,
    finishWithCurrentAnswer,
    generatePracticePlan,
    generateQuestionDrafts,
    questionDrafts,
    refresh,
    pauseTimer,
    resumeTimer,
    snapshot,
    startSession,
    submitCandidateTurn,
    toggleQuestionDraft,
    toggleQuestionFavorite,
    turnsBySessionId,
    updatePracticePlan,
    updateQuestionSet,
    confirmQuestionDrafts,
  };
}
