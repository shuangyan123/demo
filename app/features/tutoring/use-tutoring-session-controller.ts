"use client";

import { useEffect, useState } from "react";
import { useFrameSampler } from "./use-frame-sampler";
import type { useTutoringFlow } from "./use-tutoring-flow";
import { useTutoringMedia } from "./use-tutoring-media";
import { useTutoringSpeech } from "./use-tutoring-speech";
import { resolvePersonaVoice } from "../../services/personalization-settings-repository";
import type { ApiConnectionProfile, PersonalizationSettings } from "../../types/review";

type TutoringFlowController = ReturnType<typeof useTutoringFlow>;

/** 实时辅导会话控制器：集中本地输入、媒体采样、语音转写与当前轮次提交。 */
export function useTutoringSessionController({
  onNotice,
  personalizationSettings,
  speechConnection,
  tutoring,
}: {
  onNotice: (message: string) => void;
  personalizationSettings: PersonalizationSettings;
  speechConnection?: ApiConnectionProfile;
  tutoring: TutoringFlowController;
}) {
  const [draftText, setDraftText] = useState("");
  const [frameDescription, setFrameDescription] = useState("");
  const [sessionGoal, setSessionGoal] = useState("像老师现场辅导一样，先看我当前卡点，再一步一步讲清楚。");
  const [sessionTopic, setSessionTopic] = useState("实时学习辅导");
  const media = useTutoringMedia();
  const sampler = useFrameSampler(media.captureFrame);
  const speech = useTutoringSpeech(resolvePersonaVoice(personalizationSettings, "tutoring"), speechConnection);
  const clearSampler = sampler.clear;

  useEffect(() => {
    if (media.status !== "ready") clearSampler();
  }, [clearSampler, media.status]);

  async function createSession() {
    const session = await tutoring.startSession({
      goal: sessionGoal,
      mode: media.mode,
      topic: sessionTopic,
    });
    tutoring.setActiveSessionId(session.id);
  }

  function captureCurrentFrame() {
    try {
      sampler.captureNow();
      onNotice("已截取当前关键帧，发送时会随本轮问题一起分析");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "关键帧截取失败");
    }
  }

  async function submitTutorTurn() {
    if (!tutoring.activeSession) {
      onNotice("请先创建一场实时辅导会话");
      return;
    }
    let frameDataUrl = sampler.lastFrameDataUrl;
    if (!frameDataUrl && media.hasFrame) {
      try {
        frameDataUrl = sampler.captureNow();
      } catch {
        frameDataUrl = "";
      }
    }
    const reply = await tutoring.submitStudentMessage({
      frameDataUrl,
      frameDescription,
      session: tutoring.activeSession,
      studentText: draftText || speech.transcript,
    });
    if (reply) {
      setDraftText("");
      speech.reset();
      speech.speak(reply.teacherMessage);
    }
  }

  return {
    captureCurrentFrame,
    createSession,
    draftText,
    frameDescription,
    media,
    sampler,
    sessionGoal,
    sessionTopic,
    setDraftText,
    setFrameDescription,
    setSessionGoal,
    setSessionTopic,
    speech,
    submitTutorTurn,
  };
}

export type TutoringMediaController = ReturnType<typeof useTutoringMedia>;
export type TutoringSamplerController = ReturnType<typeof useFrameSampler>;
export type TutoringSpeechController = ReturnType<typeof useTutoringSpeech>;
