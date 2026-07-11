"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ConversationVisionMode = "camera" | "screen";

/** 管理对话内摄像头和屏幕流；原始 MediaStream 与帧只保存在内存。 */
export function useConversationVisionTools(onNotice: (message: string) => void) {
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<ConversationVisionMode | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setMode(null);
  }, []);

  const start = useCallback(async (nextMode: ConversationVisionMode) => {
    stop();
    try {
      const stream = nextMode === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
      setMode(nextMode);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "无法打开画面来源");
    }
  }, [onNotice, stop]);

  const capture = useCallback(async (): Promise<File | null> => {
    const video = videoRef.current;
    if (!video || !streamRef.current || !video.videoWidth || !video.videoHeight) {
      onNotice("请先打开摄像头或屏幕共享");
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(video.videoWidth, 1600);
    canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ? new File([blob], `对话截图-${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
  }, [onNotice]);

  useEffect(() => stop, [stop]);

  return { capture, mode, start, stop, videoRef };
}
