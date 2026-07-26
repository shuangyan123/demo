"use client";

import { useCallback } from "react";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { VoiceProfile } from "../../types/domains/personalization.ts";
import { useConnectionSpeechPlayback } from "./use-connection-speech-playback.ts";
import { useSpeechRecognitionText } from "./use-speech-recognition.ts";

// 面试和辅导共享的语音会话：输入转写仍由浏览器完成，输出朗读严格走默认语音连接。
export function useSpeechSession({
  speechConnection,
  unsupportedMessage,
  voice,
}: {
  speechConnection?: ApiConnectionProfile;
  unsupportedMessage: string;
  voice?: VoiceProfile;
}) {
  const recognition = useSpeechRecognitionText({ unsupportedMessage });
  const playback = useConnectionSpeechPlayback({ connection: speechConnection, voice });
  const start = useCallback(() => {
    playback.stopSpeaking();
    recognition.start();
  }, [playback, recognition]);
  const reset = useCallback(() => {
    playback.stopSpeaking();
    recognition.reset();
    playback.clearError();
  }, [playback, recognition]);

  return {
    ...recognition,
    ...playback,
    error: playback.error || recognition.error,
    reset,
    start,
  };
}
