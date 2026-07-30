"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { requestTutorReply, requestTutorSummary } from "../../services/tutoring-ai-service";
import { loadLearnerStateSnapshot } from "../../services/learner-state-service.ts";
import { tutoringRepository } from "../../services/tutoring-repository";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import type { TutoringLink, TutoringMode, TutoringPlan, TutoringSession, TutoringSnapshot, TutoringTurn } from "../../types/domains/tutoring.ts";
import { filterWorkspaceRecords, type WorkspaceDataScope } from "../../services/workspace-data-scope";

const emptySnapshot: TutoringSnapshot = {
  links: [],
  plans: [],
  sessions: [],
  turns: [],
};

type NewTutoringPlanInput = Omit<TutoringPlan, "id" | "createdAt" | "updatedAt">;

function scopeTutoringSnapshot(snapshot: TutoringSnapshot, scope: WorkspaceDataScope): TutoringSnapshot {
  return {
    links: filterWorkspaceRecords(snapshot.links, scope),
    plans: filterWorkspaceRecords(snapshot.plans, scope),
    sessions: filterWorkspaceRecords(snapshot.sessions, scope),
    turns: filterWorkspaceRecords(snapshot.turns, scope),
  };
}

// 管理 AI 辅导模块的数据刷新、AI 调用和确认式保存边界，组件只消费状态和动作。
export function useTutoringFlow({
  textConnection,
  visionConnection,
  onNotice,
  personalizationSettings,
  scope,
}: {
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  onNotice: (message: string) => void;
  personalizationSettings: PersonalizationSettings;
  scope: WorkspaceDataScope;
}) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<TutoringSnapshot>(emptySnapshot);

  const refresh = useCallback(async () => {
    const nextSnapshot = scopeTutoringSnapshot(await tutoringRepository.loadSnapshot(), scope);
    setSnapshot(nextSnapshot);
  }, [scope]);

  useEffect(() => {
    let active = true;

    // 首次进入辅导模块时读取本地快照，避免 UI 直接依赖 Dexie 表。
    async function loadInitialSnapshot() {
      try {
        const nextSnapshot = scopeTutoringSnapshot(await tutoringRepository.loadSnapshot(), scope);
        if (active) {
          setSnapshot(nextSnapshot);
          setActiveSessionId((current) => current ?? nextSnapshot.sessions[0]?.id ?? null);
        }
      } catch (error) {
        if (active) onNotice(error instanceof Error ? error.message : "辅导数据读取失败");
      }
    }

    void loadInitialSnapshot();
    return () => {
      active = false;
    };
  }, [onNotice, scope]);

  const turnsBySessionId = useMemo(() => {
    const groups = new Map<string, TutoringTurn[]>();
    snapshot.turns.forEach((turn) => {
      groups.set(turn.sessionId, [...(groups.get(turn.sessionId) ?? []), turn]);
    });
    return groups;
  }, [snapshot.turns]);

  const activeSession = snapshot.sessions.find((session) => session.id === activeSessionId) ?? snapshot.sessions[0] ?? null;
  const activeTurns = activeSession ? turnsBySessionId.get(activeSession.id) ?? [] : [];

  // 创建一场辅导会话；没有 API 时仍可记录文字，但 AI 老师按钮会提示配置。
  async function startSession(input: { goal: string; mode: TutoringMode; topic: string }) {
    if (scope.kind === "sample") {
      onNotice("示例模式不会创建真实辅导会话。");
      return null;
    }
    const session = await tutoringRepository.createSession(input);
    setActiveSessionId(session.id);
    await refresh();
    onNotice("实时辅导会话已创建");
    return session;
  }

  // 暂停或恢复会话，只改变状态，不影响已有文字稿。
  async function updateSessionStatus(session: TutoringSession, status: TutoringSession["status"]) {
    await tutoringRepository.updateSession(session.id, { status });
    await refresh();
  }

  // 提交学生本轮输入并请求 AI 老师回复；关键帧只随请求发送，不写入本地库。
  async function submitStudentMessage(input: {
    frameDataUrl?: string;
    frameDescription?: string;
    session: TutoringSession;
    studentText: string;
  }) {
    if (scope.kind === "sample") {
      onNotice("示例模式不会调用真实 AI。");
      return;
    }
    const text = input.studentText.trim();
    if (!text && !input.frameDataUrl) {
      onNotice("请先输入问题、语音转写，或截取当前画面");
      return;
    }
    // 纯文本辅导使用默认文本连接，携带关键帧时严格使用默认多模态连接。
    const connection = input.frameDataUrl ? visionConnection : textConnection;
    if (!connection) {
      onNotice(input.frameDataUrl ? "请先在 AI 连接中配置默认多模态连接，再分析当前画面" : "请先在 AI 连接中配置默认文本连接，再使用 AI 辅导");
      return;
    }
    setBusy(true);
    try {
      const requestStartedAt = performance.now();
      const studentTurn = await tutoringRepository.addTurn({
        content: text || "请看当前画面，帮我判断应该怎么学。",
        frameDescription: input.frameDescription,
        observation: input.frameDataUrl ? {
          capturedAt: new Date().toISOString(),
          source: input.session.mode,
          summary: input.frameDescription?.trim().slice(0, 240) || undefined,
        } : undefined,
        sessionId: input.session.id,
        speaker: "student",
      });
      const nextTurns = [...activeTurns, studentTurn];
      const learnerState = await loadLearnerStateSnapshot();
      const aiReply = await requestTutorReply({
        frameDataUrl: input.frameDataUrl,
        frameDescription: input.frameDescription,
        learnerState,
        recentTurns: nextTurns,
        session: input.session,
        connection,
        studentText: text,
        personalizationSettings,
      });
      await tutoringRepository.addTurn({
        boardNotes: aiReply.boardNotes,
        confidence: aiReply.confidence,
        content: aiReply.teacherMessage,
        detectedProblem: aiReply.detectedProblem,
        frameDescription: aiReply.frameDescription,
        nextQuestion: aiReply.nextQuestion,
        microAssessment: aiReply.microAssessment,
        responseLatencyMs: Math.max(0, Math.round(performance.now() - requestStartedAt)),
        sessionId: input.session.id,
        speaker: "ai_tutor",
        studentAction: aiReply.studentAction,
      });
      await refresh();
      onNotice("AI 老师已给出本轮讲解");
      return aiReply;
    } catch (error) {
      await refresh();
      onNotice(error instanceof Error ? error.message : "AI 辅导请求失败");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** 保存单轮帮助反馈；反馈只留本地并立即刷新指标。 */
  async function setTurnHelpful(turnId: string, helpful: boolean) {
    await tutoringRepository.setTurnHelpful(turnId, helpful);
    await refresh();
    onNotice(helpful ? "已记录：本轮讲解有帮助" : "已记录：本轮讲解需要改进");
  }

  /** 保存整场帮助反馈，作为试点留存与质量指标的一部分。 */
  async function setSessionHelpful(sessionId: string, helpful: boolean) {
    await tutoringRepository.setSessionHelpful(sessionId, helpful);
    await refresh();
    onNotice(helpful ? "感谢反馈，本场辅导已标记为有帮助" : "反馈已记录，后续辅导会优先换一种讲法");
  }

  /** 提交微测并生成确定性的间隔复练任务。 */
  async function completeMicroAssessment(turnId: string, selections: number[]) {
    try {
      const result = await tutoringRepository.completeMicroAssessment(turnId, selections);
      await refresh();
      onNotice(`微测 ${result.correctCount}/${result.total}，下次复练已安排到 ${result.nextPracticeAt.slice(0, 10)}`);
      return result;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "微测提交失败");
      return null;
    }
  }

  // 结束会话时生成摘要；缺少默认文本连接时明确保存本地摘要，不跨能力调用其他连接。
  async function finishSession(session: TutoringSession) {
    if (scope.kind === "sample") {
      onNotice("示例模式不会调用真实 AI 生成总结。");
      return;
    }
    setBusy(true);
    try {
      const turns = turnsBySessionId.get(session.id) ?? [];
      const usesLocalSummary = !textConnection;
      const summary = textConnection
        ? await requestTutorSummary({ session, connection: textConnection, turns, personalizationSettings })
        : { nextActions: ["根据文字稿整理一个可执行练习任务"], summary: "本次辅导已手动结束，未配置默认文本连接，因此只保存文字稿和本地摘要。" };
      await tutoringRepository.completeSession(session.id, summary);
      await refresh();
      onNotice(usesLocalSummary ? "未配置默认文本连接；会话已结束，仅保存文字稿和本地摘要" : "辅导会话已结束，AI 摘要已保存");
    } catch (error) {
      await refresh();
      onNotice(error instanceof Error ? error.message : "辅导摘要生成失败");
    } finally {
      setBusy(false);
    }
  }

  // 删除辅导记录并清理轮次和关联。
  async function deleteSession(id: string) {
    await tutoringRepository.removeSession(id);
    setActiveSessionId((current) => (current === id ? null : current));
    await refresh();
    onNotice("辅导记录已删除，相关关联已清理");
  }

  // 新建辅导计划，计划可引用知识资料和错题，便于后续按目标训练。
  async function addPlan(input: NewTutoringPlanInput) {
    await tutoringRepository.addPlan(input);
    await refresh();
    onNotice("辅导计划已保存");
  }

  // 更新辅导计划状态或下次任务。
  async function updatePlan(id: string, patch: Partial<NewTutoringPlanInput>) {
    await tutoringRepository.updatePlan(id, patch);
    await refresh();
    onNotice("辅导计划已更新");
  }

  // 删除辅导计划并清理计划来源关联。
  async function deletePlan(id: string) {
    await tutoringRepository.removePlan(id);
    await refresh();
    onNotice("辅导计划已删除");
  }

  // 保存辅导会话、轮次或计划与知识/错题之间的确认式关联。
  async function addLink(input: Omit<TutoringLink, "id" | "createdAt" | "updatedAt">) {
    await tutoringRepository.addLink(input);
    await refresh();
    onNotice("辅导关联已保存");
  }

  // 删除一条辅导关联。
  async function deleteLink(id: string) {
    await tutoringRepository.removeLink(id);
    await refresh();
    onNotice("辅导关联已删除");
  }

  return {
    activeSession,
    activeSessionId,
    activeTurns,
    addLink,
    addPlan,
    busy,
    deleteLink,
    deletePlan,
    deleteSession,
    finishSession,
    completeMicroAssessment,
    refresh,
    setActiveSessionId,
    setSessionHelpful,
    setTurnHelpful,
    snapshot,
    startSession,
    submitStudentMessage,
    turnsBySessionId,
    updatePlan,
    updateSessionStatus,
  };
}
