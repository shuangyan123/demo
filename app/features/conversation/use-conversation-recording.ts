"use client";

import { useEffect, useRef, useState } from "react";
import { transcribeWithConnection } from "../../services/ai-connection-client";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import { conversationProviderErrorMessage, readBlobAsDataUrl } from "./conversation-message-utils.ts";

/** 录音、MediaRecorder 生命周期与转写集中管理，原始音频永远不离开当前内存。 */
export function useConversationRecording({
  disabled,
  transcriptionConnection,
  onNotice,
  onOpenConnections,
  onTranscript,
}: {
  disabled: boolean;
  transcriptionConnection?: ApiConnectionProfile;
  onNotice: (message: string) => void;
  onOpenConnections: () => void;
  onTranscript: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  async function transcribe(blob: Blob) {
    if (!transcriptionConnection) {
      onNotice("请先在 AI 连接中配置录音转写连接");
      onOpenConnections();
      return;
    }
    setTranscribing(true);
    try {
      const dataUrl = await readBlobAsDataUrl(blob);
      const result = await transcribeWithConnection(transcriptionConnection, {
        audioBase64: dataUrl.split(",")[1] ?? "",
        mimeType: blob.type || "audio/webm",
      });
      onTranscript(result.text);
      onNotice("录音已转写到输入框，请确认后发送");
    } catch (error) {
      onNotice(conversationProviderErrorMessage(error));
    } finally {
      setTranscribing(false);
    }
  }

  async function start() {
    if (recording || disabled || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        void transcribe(blob);
      };
      recorder.start();
      setRecording(true);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "无法打开麦克风");
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }

  return { busy: transcribing, recording, start, stop };
}
