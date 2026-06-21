"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TutoringMode } from "../../types/review";

type MediaStatus = "idle" | "starting" | "ready" | "error";

// 把上传文件读取成 data URL；仅保存在当前内存状态，不写入 IndexedDB。
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择文件"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

// 把视频当前帧压缩成适合多模态识别的 JPEG，控制宽度以降低请求成本。
function captureVideoFrame(video: HTMLVideoElement, maxWidth = 960): string {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error("画面尚未就绪，请稍后再发送");
  }
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法截取画面");
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

// 管理浏览器摄像头、屏幕共享和上传图片三种输入源；不持久化原始媒体。
export function useTutoringMedia() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<TutoringMode>("camera");
  const [status, setStatus] = useState<MediaStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [uploadedFrameDataUrl, setUploadedFrameDataUrl] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");

  // 组件卸载时释放媒体轨道，避免摄像头或屏幕共享继续占用。
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  // 将新媒体流绑定到预览 video；播放失败只影响预览，不保存任何媒体内容。
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
    if (stream) {
      void videoRef.current.play().catch(() => setError("画面预览启动失败，请检查浏览器权限"));
    }
  }, [stream]);

  // 停止当前媒体输入源并清理上传图片内存态。
  const stop = useCallback(() => {
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
    setStatus("idle");
  }, []);

  // 启动电脑或手机摄像头，作为第一阶段模拟眼镜视角的默认输入。
  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持摄像头采集，请使用截图上传或屏幕共享。");
      setStatus("error");
      return;
    }
    stop();
    setMode("camera");
    setError("");
    setStatus("starting");
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } });
      setUploadedFrameDataUrl("");
      setUploadedFileName("");
      setStream(nextStream);
      setStatus("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "摄像头启动失败，请检查权限");
      setStatus("error");
    }
  }, [stop]);

  // 启动屏幕共享，适合演示题目网页、PDF 或电子讲义。
  const startScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("当前浏览器不支持屏幕共享，请使用截图上传。");
      setStatus("error");
      return;
    }
    stop();
    setMode("screen");
    setError("");
    setStatus("starting");
    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
      setUploadedFrameDataUrl("");
      setUploadedFileName("");
      setStream(nextStream);
      setStatus("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "屏幕共享启动失败，请检查权限");
      setStatus("error");
    }
  }, [stop]);

  // 使用上传图片作为单帧视角，便于在没有摄像头权限时继续验证辅导流程。
  const uploadFrame = useCallback(
    async (file: File) => {
      stop();
      setMode("upload");
      setStatus("starting");
      setError("");
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setUploadedFrameDataUrl(dataUrl);
        setUploadedFileName(file.name);
        setStatus("ready");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "图片读取失败");
        setStatus("error");
      }
    },
    [stop],
  );

  // 截取当前关键帧；返回值只供本次 AI 请求使用，不会被仓储层保存。
  const captureFrame = useCallback(() => {
    if (mode === "upload") {
      if (!uploadedFrameDataUrl) throw new Error("请先上传一张截图或图片");
      return uploadedFrameDataUrl;
    }
    if (!videoRef.current || !stream) {
      throw new Error("请先启动摄像头或屏幕共享");
    }
    return captureVideoFrame(videoRef.current);
  }, [mode, stream, uploadedFrameDataUrl]);

  return useMemo(
    () => ({
      captureFrame,
      error,
      hasFrame: Boolean(uploadedFrameDataUrl || stream),
      mode,
      startCamera,
      startScreen,
      status,
      stop,
      stream,
      uploadFrame,
      uploadedFileName,
      videoRef,
    }),
    [captureFrame, error, mode, startCamera, startScreen, status, stop, stream, uploadFrame, uploadedFileName, uploadedFrameDataUrl],
  );
}
