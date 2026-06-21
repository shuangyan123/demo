"use client";

import { useSpeechSession } from "../shared/use-speech-session";
import type { ApiConnectionProfile, VoiceProfile } from "../../types/review";

// 面试模块保留原 hook 名称作为兼容入口，内部复用 shared 语音转写能力。
export function useInterviewSpeech(voice?: VoiceProfile, speechConnection?: ApiConnectionProfile) {
  return useSpeechSession({
    unsupportedMessage: "当前浏览器不支持实时语音识别，请使用文字输入完成作答。",
    voice,
    speechConnection,
  });
}
