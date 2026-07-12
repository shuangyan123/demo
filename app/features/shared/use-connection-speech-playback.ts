"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { synthesizeWithConnection } from "../../services/ai-connection-client";
import type { ApiConnectionProfile, VoiceProfile } from "../../types/review";

// 只负责默认语音连接的音频播放；不读取浏览器系统音色，也不提供静默回退。
export function useConnectionSpeechPlayback({
  connection,
  voice,
}: {
  connection?: ApiConnectionProfile;
  voice?: VoiceProfile;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setSpeaking(false);
  }, []);

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  const clearError = useCallback(() => setError(""), []);

  const speak = useCallback(async (text: string) => {
    if (typeof window === "undefined" || !text.trim()) return;
    stopSpeaking();
    setError("");
    if (!connection) {
      setError("请先配置默认语音连接；未配置时不会使用浏览器系统语音。");
      return;
    }
    if (!voice?.voiceId.trim()) {
      setError("请先为当前角色配置音色和 Voice ID；未配置时保持静音。");
      return;
    }
    try {
      setSpeaking(true);
      const blob = await synthesizeWithConnection(connection, {
        model: voice.model,
        voiceId: voice.voiceId,
        text,
        style: voice.style,
        speed: voice.rate,
        volume: voice.volume,
        pitch: voice.pitch,
        emotion: voice.emotion,
        languageBoost: voice.languageBoost,
      });
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.volume = voice.volume;
      audio.onended = stopSpeaking;
      audio.onerror = () => {
        setError("语音音频播放失败，请检查默认语音连接。");
        stopSpeaking();
      };
      await audio.play();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "语音 API 播放失败");
      stopSpeaking();
    }
  }, [connection, stopSpeaking, voice]);

  const previewVoice = useCallback(() => speak("你好，我会按照你的学习节奏进行讲解和追问。"), [speak]);

  return { clearError, error, previewVoice, speak, speaking, stopSpeaking };
}
