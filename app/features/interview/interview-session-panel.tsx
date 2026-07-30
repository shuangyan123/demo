"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { interviewTypeLabels } from "../../services/interview-rubric";
import { interviewTurnElapsedSec, normalizeInterviewTimer } from "../../services/interview-timer";
import type { InterviewEvaluation, InterviewSession, InterviewSpeaker, InterviewStage, InterviewTurn } from "../../types/domains/interview.ts";
import { LearningSessionLayout } from "../shared/learning-session-layout";
import { Button, EmptyState, SessionStageRail } from "../shared/ui-primitives";
import { InterviewFinishDialog } from "./interview-finish-dialog";
import { InterviewSessionInsights } from "./interview-session-insights";
import type { useInterviewSpeech } from "./use-interview-speech.ts";
import { useInterviewFinishDialog } from "./use-interview-finish-dialog";
import styles from "./interview-session-panel.module.css";

const stageLabels: Record<InterviewStage, string> = {
  answering: "作答",
  briefing: "审题",
  discussion: "讨论",
  evaluated: "复盘",
  follow_up: "追问",
  peer_review: "点评",
  preparation: "准备",
  response: "回应",
  summary: "总结",
};

const speakerLabels: Record<InterviewSpeaker, string> = {
  ai_interviewer: "面试官",
  ai_peer: "同组考生",
  candidate: "我",
  system: "系统",
};

const stageOrderByType: Record<InterviewSession["type"], InterviewStage[]> = {
  leaderless_group: ["preparation", "answering", "discussion", "summary", "evaluated"],
  structured: ["briefing", "answering", "follow_up", "summary", "evaluated"],
  structured_group: ["briefing", "answering", "peer_review", "response", "evaluated"],
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 面试模拟现场以当前阶段为主轴，评分只读取完成后的真实 evaluation。 */
export function InterviewSessionPanel({
  busy, evaluation, expectedDurationSec, session, speech, turns,
  onFinishSession, onFinishWithCurrentAnswer, onCancelSession,
  onPauseTimer, onResumeTimer, onSubmitAnswer,
}: {
  busy: boolean;
  evaluation?: InterviewEvaluation;
  expectedDurationSec?: number;
  session: InterviewSession | null;
  speech: ReturnType<typeof useInterviewSpeech>;
  turns: InterviewTurn[];
  onFinishSession: (sessionId: string) => void;
  onFinishWithCurrentAnswer: (session: InterviewSession, content: string, durationSec: number) => Promise<unknown>;
  onCancelSession: (sessionId: string) => Promise<void>;
  onPauseTimer: (session: InterviewSession) => Promise<void>;
  onResumeTimer: (session: InterviewSession) => Promise<void>;
  onSubmitAnswer: (session: InterviewSession, content: string, durationSec: number) => Promise<void>;
}) {
  const normalizedSession = useMemo(() => session ? normalizeInterviewTimer(session) : null, [session]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);
  const closeFinishConfirm = useCallback(() => setFinishConfirmOpen(false), []);
  const finishDialogRef = useInterviewFinishDialog(finishConfirmOpen, closeFinishConfirm);
  const elapsedSec = normalizedSession ? interviewTurnElapsedSec(normalizedSession, nowMs) : 0;
  const { error, listening, reset, setTranscript, speak, start, stop, stopSpeaking, supported, transcript } = speech;
  const latestAiTurn = useMemo(() => [...turns].reverse().find((turn) => turn.speaker !== "candidate"), [turns]);
  useEffect(() => {
    if (!normalizedSession || normalizedSession.timerStatus !== "running") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [normalizedSession]);
  useEffect(() => {
    if (latestAiTurn?.content) speak(latestAiTurn.content);
  }, [latestAiTurn?.content, latestAiTurn?.id, speak]);
  useEffect(() => {
    if (normalizedSession?.timerStatus !== "finished") return;
    stop();
    stopSpeaking();
  }, [normalizedSession?.timerStatus, stop, stopSpeaking]);
  if (!session) {
    return (
      <section className={styles.empty}>
        <EmptyState>请先在题库中选择一道题开始模拟。完成作答后会直接进入复盘。</EmptyState>
      </section>
    );
  }
  const stages = stageOrderByType[session.type].map((stage) => ({ id: stage, label: stageLabels[stage] }));
  const insights = <InterviewSessionInsights evaluation={evaluation} session={session} />;
  async function submitAnswer() {
    const durationSec = Math.max(1, interviewTurnElapsedSec(normalizedSession!));
    await onSubmitAnswer(session!, transcript, durationSec);
    setNowMs((current) => current + 1);
    reset();
  }
  function stopAllSpeech() {
    stop();
    stopSpeaking();
    reset();
  }
  async function cancelSession() {
    stopAllSpeech();
    setFinishConfirmOpen(false);
    await onCancelSession(session!.id);
  }

  async function finishPartialReview() {
    stopAllSpeech();
    setFinishConfirmOpen(false);
    if (transcript.trim()) {
      await onFinishWithCurrentAnswer(session!, transcript, Math.max(1, interviewTurnElapsedSec(normalizedSession!)));
      return;
    }
    onFinishSession(session!.id);
  }

  return (
    <LearningSessionLayout insightLabel="本题要点 · 当前表现" insights={insights}>
      <section className={styles.live}>
        <header className={styles.liveHeader}>
          <div>
            <h2>{session.title}</h2>
            <p>{interviewTypeLabels[session.type]}</p>
          </div>
          <div className={styles.timer} aria-label={`本轮计时 ${formatDuration(elapsedSec)}`}>
            <strong>{formatDuration(elapsedSec)}</strong>
            {expectedDurationSec ? <span>/ {formatDuration(expectedDurationSec)}</span> : null}
            {normalizedSession?.timerStatus !== "finished" ? (
              <Button
                disabled={busy}
                variant="ghost"
                onClick={() => void (normalizedSession?.timerStatus === "paused" ? onResumeTimer(session) : onPauseTimer(session))}
              >
                {normalizedSession?.timerStatus === "paused" ? "继续" : "暂停"}
              </Button>
            ) : <span>已冻结</span>}
          </div>
          <Button disabled={busy || normalizedSession?.timerStatus === "finished"} variant="danger" onClick={() => setFinishConfirmOpen(true)}>
            结束
          </Button>
        </header>
        <SessionStageRail activeId={session.stage} stages={stages} />
        <section className={styles.question}>
          <strong>题目材料</strong>
          {session.questionMaterial ? <p>{session.questionMaterial}</p> : null}
          <p>{session.questionPrompt}</p>
        </section>
        <section className={styles.transcript} aria-label="实时转写">
          <header><h3>对话记录</h3><span>{listening ? "实时转写中" : "文字稿"}</span></header>
          {turns.map((turn) => (
            <article key={turn.id} data-candidate={turn.speaker === "candidate"}>
              <strong>{speakerLabels[turn.speaker]}</strong>
              <small>{stageLabels[turn.stage]}</small>
              <p>{turn.content}</p>
            </article>
          ))}
        </section>
        <section className={styles.answer}>
          {error ? <p className="text-sm text-red">{error}</p> : null}
          <textarea aria-label="本轮文字稿" placeholder={supported ? "按住作答，或直接使用键盘输入" : "当前浏览器不支持语音识别，请使用键盘输入"} value={transcript} onChange={(event) => setTranscript(event.currentTarget.value)} />
          <div>
            <Button disabled={!supported || busy || normalizedSession?.timerStatus !== "running"} variant={listening ? "primary" : "soft"} onClick={listening ? stop : start}>
              {listening ? "松开结束" : "按住作答"}
            </Button>
            <Button disabled={busy || normalizedSession?.timerStatus !== "running" || !transcript.trim()} variant="primary" onClick={() => void submitAnswer()}>提交并继续</Button>
            <Button disabled={busy} variant="ghost" onClick={reset}>清空</Button>
            <Button
              className={styles.mobileFinish}
              disabled={busy || normalizedSession?.timerStatus === "finished"}
              variant="danger"
              onClick={() => setFinishConfirmOpen(true)}
            >
              结束
            </Button>
          </div>
        </section>
        {evaluation ? (
          <section className={styles.review} aria-label="面试复盘">
            <h3>复盘结果 · {evaluation.totalScore}/100</h3>
            <p>{evaluation.suggestions.join("；")}</p>
          </section>
        ) : null}
        {finishConfirmOpen ? <InterviewFinishDialog
          busy={busy}
          dialogRef={finishDialogRef}
          hasAnswers={turns.some((turn) => turn.speaker === "candidate")}
          hasTranscript={Boolean(transcript.trim())}
          onCancel={() => void cancelSession()}
          onClose={closeFinishConfirm}
          onPartialReview={() => void finishPartialReview()}
        /> : null}
      </section>
    </LearningSessionLayout>
  );
}
