"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConversationTurnTimeline } from "../../services/conversation-turns";
import { tutoringRepository } from "../../services/tutoring-repository";
import type { AiConversationRunStep } from "../../types/domains/conversation.ts";
import type { TutoringSession, TutoringTurn } from "../../types/domains/tutoring.ts";
import { LearningSessionInsightSection, LearningSessionLayout } from "../shared/learning-session-layout";
import { TutoringMicroAssessmentView } from "../tutoring/tutoring-micro-assessment-view";
import { ConversationTurnList } from "./conversation-turn-list";
import styles from "./conversation-tutoring-experience.module.css";

type ConversationTutoringExperienceProps = {
  activeTurnId?: string;
  assistantDraft: string;
  conversationId?: string;
  diagnostics: Map<string, AiConversationRunStep[]>;
  finishing: boolean;
  launchSummary?: string;
  launchTitle?: string;
  timeline: ConversationTurnTimeline;
  onFinish: () => Promise<void>;
  onOpenHistory: () => void;
};

/** 对话内辅导只消费关联后的结构化辅导快照；普通对话不会加载此客户端子树。 */
export function ConversationTutoringExperience({
  activeTurnId,
  assistantDraft,
  conversationId,
  diagnostics,
  finishing,
  launchSummary,
  launchTitle,
  timeline,
  onFinish,
  onOpenHistory,
}: ConversationTutoringExperienceProps) {
  const [session, setSession] = useState<TutoringSession | null>(null);
  const [turns, setTurns] = useState<TutoringTurn[]>([]);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setSession(null);
      setTurns([]);
      return;
    }
    const next = await tutoringRepository.loadConversationSession(conversationId);
    setSession(next.session);
    setTurns(next.turns);
  }, [conversationId]);

  useEffect(() => {
    let active = true;
    if (!conversationId) return;
    void tutoringRepository.loadConversationSession(conversationId).then((next) => {
      if (!active) return;
      setSession(next.session);
      setTurns(next.turns);
    });
    return () => {
      active = false;
    };
  }, [conversationId, timeline.turns.length]);

  const turnByMessageId = useMemo(
    () => new Map(turns.flatMap((turn) => turn.conversationMessageId ? [[turn.conversationMessageId, turn] as const] : [])),
    [turns],
  );
  const aiTurns = turns.filter((turn) => turn.speaker === "ai_tutor");
  const latestAiTurn = aiTurns.at(-1);
  const latestAssessment = [...aiTurns].reverse().find((turn) => turn.microAssessment?.questions.length)?.microAssessment;
  const microComplete = Boolean(latestAssessment?.completedAt);
  const progress = [
    { label: "知识点讲解", complete: aiTurns.length > 0 },
    { label: "随堂小测", complete: microComplete },
    { label: "安排复练", complete: microComplete },
  ];
  const completeCount = progress.filter((item) => item.complete).length;

  const insights = (
    <>
      <LearningSessionInsightSection title="本轮目标">
        <p>{session?.goal || launchSummary || "先说明当前学习目标和卡点，AI 会据此安排讲解与微测。"}</p>
      </LearningSessionInsightSection>
      <LearningSessionInsightSection title="当前卡点">
        <p>{latestAiTurn?.detectedProblem || "完成第一轮提问后生成可观察的卡点摘要。"}</p>
      </LearningSessionInsightSection>
      <LearningSessionInsightSection title="下一步">
        <p>{latestAiTurn?.studentAction || latestAiTurn?.nextQuestion || "完成讲解后进入随堂小测，并据结果安排复练。"}</p>
      </LearningSessionInsightSection>
      <LearningSessionInsightSection title={`本轮进度 ${completeCount}/3`}>
        <ol className={styles.progress}>
          {progress.map((item, index) => (
            <li key={item.label} data-complete={item.complete}>
              <span>{item.complete ? "✓" : index + 1}</span>
              <span>{item.label}</span>
              <span>{item.complete ? "已完成" : "待完成"}</span>
            </li>
          ))}
        </ol>
        <details className={styles.privacy}>
          <summary>设备与隐私</summary>
          摄像头、屏幕和录音只保留在当前浏览器内存；历史记录仅保存文字、摘要与确认后的练习结果。
        </details>
      </LearningSessionInsightSection>
    </>
  );

  return (
    <LearningSessionLayout insightLabel={`本轮进度 ${completeCount}/3`} insights={insights}>
      <header className={styles.sessionHeader}>
        <div className={styles.sessionMeta}>
          <p><strong>本轮</strong> · {session?.topic || launchTitle || "AI 辅导"} · {session?.status === "completed" ? "已完成" : "进行中"}</p>
          {session && session.status !== "completed" ? (
            <button className={styles.finish} disabled={finishing} type="button" onClick={() => void onFinish().then(refresh)}>
              {finishing ? "正在总结…" : "结束本轮"}
            </button>
          ) : null}
        </div>
        <nav className={styles.nav} aria-label="辅导视图">
          <button type="button" aria-current="page">实时辅导</button>
          <button type="button" onClick={onOpenHistory}>记录</button>
          <button type="button" onClick={onOpenHistory}>计划</button>
          <button type="button" onClick={onOpenHistory}>资料关联</button>
        </nav>
      </header>
      <ConversationTurnList
        activeTurnId={activeTurnId}
        assistantDraft={assistantDraft}
        diagnostics={diagnostics}
        timeline={timeline}
        renderAfterAssistant={(messageId) => {
          const tutoringTurn = turnByMessageId.get(messageId);
          return tutoringTurn?.microAssessment?.questions.length ? (
            <div className={styles.assessment}>
              <TutoringMicroAssessmentView
                turn={tutoringTurn}
                onComplete={async (turnId, selections) => {
                  await tutoringRepository.completeMicroAssessment(turnId, selections);
                  await refresh();
                }}
              />
            </div>
          ) : null;
        }}
      />
    </LearningSessionLayout>
  );
}
