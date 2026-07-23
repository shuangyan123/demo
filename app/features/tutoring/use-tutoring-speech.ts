"use client";

import { useSpeechSession } from "../shared/use-speech-session";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { VoiceProfile } from "../../types/domains/personalization.ts";

// 辅导模块的语音转写入口；只保留文字，不接触或保存原始录音。
export function useTutoringSpeech(voice?: VoiceProfile, speechConnection?: ApiConnectionProfile) {
  return useSpeechSession({
    unsupportedMessage: "当前浏览器不支持实时语音识别，请直接输入你想问的问题或当前卡点。",
    voice,
    speechConnection,
  });
}
