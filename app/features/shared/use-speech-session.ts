"use client";

import { useCallback } from "react";
import type { ApiConnectionProfile, VoiceProfile } from "../../types/review";
import { useConnectionSpeechPlayback } from "./use-connection-speech-playback";
import { useSpeechRecognitionText } from "./use-speech-recognition";

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
  const reset = useCallback(() => {
    recognition.reset();
    playback.clearError();
  }, [playback, recognition]);

  return {
    ...recognition,
    ...playback,
    error: playback.error || recognition.error,
    reset,
  };
}
