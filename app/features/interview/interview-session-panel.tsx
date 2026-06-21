"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, DetailBlock, EmptyState, Panel, ScoreBar, SessionStageRail, SoftBlock, TextAreaField, Toolbar } from "../shared/ui-primitives";
import { interviewTypeLabels } from "../../services/interview-rubric";
import type { InterviewEvaluation, InterviewSession, InterviewSpeaker, InterviewStage, InterviewTurn } from "../../types/review";
import type { useInterviewSpeech } from "./use-interview-speech";

const stageLabels: Record<InterviewStage, string> = {
  answering: "正式作答",
  briefing: "考官导入",
  discussion: "自由讨论",
  evaluated: "已评分",
  follow_up: "追问",
  peer_review: "相互点评",
  preparation: "准备",
  response: "回应点评",
  summary: "总结陈词",
};

const speakerLabels: Record<InterviewSpeaker, string> = {
  ai_interviewer: "AI 面试官",
  ai_peer: "AI 同组考生",
  candidate: "我的作答",
  system: "系统",
};

const stageOrderByType: Record<InterviewSession["type"], InterviewStage[]> = {
  leaderless_group: ["preparation", "answering", "discussion", "summary", "evaluated"],
  structured: ["briefing", "answering", "follow_up", "summary", "evaluated"],
  structured_group: ["briefing", "answering", "peer_review", "response", "evaluated"],
};

// 把秒数格式化成 mm:ss，供面试计时和复盘记录共用。
function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

// 面试模拟会话面板，负责语音/文字作答和 AI 追问流程的可视化。
export function InterviewSessionPanel({
  busy,
  evaluation,
  expectedDurationSec,
  session,
  speech,
  turns,
  onFinishSession,
  onSubmitAnswer,
}: {
  busy: boolean;
  evaluation?: InterviewEvaluation;
  expectedDurationSec?: number;
  session: InterviewSession | null;
  speech: ReturnType<typeof useInterviewSpeech>;
  turns: InterviewTurn[];
  onFinishSession: (sessionId: string) => void;
  onSubmitAnswer: (session: InterviewSession, content: string, durationSec: number) => Promise<void>;
}) {
  const [answerStartedAt, setAnswerStartedAt] = useState(() => Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);
  const { error, listening, reset, setTranscript, speak, start, stop, supported, transcript } = speech;
  const latestAiTurn = useMemo(() => [...turns].reverse().find((turn) => turn.speaker !== "candidate"), [turns]);
  const stageRail = session ? stageOrderByType[session.type].map((stage) => ({ id: stage, label: stageLabels[stage] })) : [];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setAnswerStartedAt(Date.now());
      setElapsedSec(0);
      reset();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reset, session?.id, turns.length]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - answerStartedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [answerStartedAt]);

  useEffect(() => {
    if (latestAiTurn?.content) {
      speak(latestAiTurn.content);
    }
  }, [latestAiTurn?.content, latestAiTurn?.id, speak]);

  // 提交当前文本稿，不保存音频，只把本轮耗时写入会话统计。
  async function submitAnswer() {
    if (!session) return;
    const durationSec = Math.max(1, Math.floor((Date.now() - answerStartedAt) / 1000));
    await onSubmitAnswer(session, transcript, durationSec);
    setAnswerStartedAt(Date.now());
    setElapsedSec(0);
    reset();
  }

  if (!session) {
    return (
      <Panel eyebrow="SIMULATION" title="开始模拟">
        <EmptyState>请先在题库中选择一道题并点击“开始模拟”。</EmptyState>
      </Panel>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
      <Panel eyebrow="LIVE INTERVIEW" title={session.title}>
        <Toolbar>
          <span className="rounded-full bg-blue/10 px-3 py-1 text-sm font-bold text-blue">{interviewTypeLabels[session.type]}</span>
          <span className="rounded-full bg-surface-muted px-3 py-1 text-sm text-muted">{stageLabels[session.stage]}</span>
          {expectedDurationSec && <span className="rounded-full bg-surface-muted px-3 py-1 text-sm text-muted">预计 {formatDuration(expectedDurationSec)}</span>}
          <span className="rounded-full bg-surface-muted px-3 py-1 text-sm text-muted">本轮 {formatDuration(elapsedSec)}</span>
          <span className="rounded-full bg-surface-muted px-3 py-1 text-sm text-muted">累计 {formatDuration(session.totalDurationSec)}</span>
        </Toolbar>

        <div className="mt-4">
          <SessionStageRail activeId={session.stage} stages={stageRail} />
        </div>

        <SoftBlock className="mt-4">
          <p className="text-sm font-bold text-muted">题干</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{session.questionPrompt}</p>
          {session.questionMaterial && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{session.questionMaterial}</p>}
        </SoftBlock>

        <div className="mt-5 grid gap-3">
          {turns.map((turn) => (
            <article key={turn.id} className={`ui-list-row ${turn.speaker === "candidate" ? "border-blue/30 bg-blue/5" : ""}`}>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">
                  {speakerLabels[turn.speaker]} · {stageLabels[turn.stage]}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{turn.content}</p>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <Panel eyebrow="ANSWER" title="实时作答">
        <div className="mb-3 rounded-lg bg-surface-muted p-3 text-sm leading-6 text-muted">
          {supported ? "可使用浏览器语音识别实时转写，也可以直接编辑文字稿。" : "当前浏览器不支持实时语音识别，请使用文字输入完成作答。"}
          {error && <p className="mt-1 text-red">{error}</p>}
        </div>
        <TextAreaField label="本轮文字稿" value={transcript} onChange={setTranscript} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!supported || listening || busy} variant="soft" onClick={start}>
            开始语音
          </Button>
          <Button disabled={!listening} variant="outline" onClick={stop}>
            停止语音
          </Button>
          <Button disabled={busy} variant="ghost" onClick={reset}>
            清空
          </Button>
          <Button disabled={busy || !transcript.trim()} variant="primary" onClick={() => void submitAnswer()}>
            提交并继续
          </Button>
          <Button disabled={busy || !turns.some((turn) => turn.speaker === "candidate")} variant="outline" onClick={() => onFinishSession(session.id)}>
            结束并评分
          </Button>
        </div>

        {evaluation && (
          <div className="mt-5 grid gap-3">
            <DetailBlock title={`最终得分：${evaluation.totalScore} / 100`}>
              <div className="grid gap-2">
                {evaluation.dimensions.map((dimension) => (
                  <div key={dimension.name} className="grid gap-1">
                    <ScoreBar label={dimension.name} max={dimension.maxScore} value={dimension.score} />
                    <p className="text-sm leading-6 text-muted">{dimension.comment}</p>
                  </div>
                ))}
              </div>
            </DetailBlock>
            <DetailBlock title="改进建议">
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
                {evaluation.suggestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </DetailBlock>
          </div>
        )}
      </Panel>
    </div>
  );
}
