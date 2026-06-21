"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TutoringMode } from "../../types/review";

type MediaStatus = "idle" | "starting" | "ready" | "error";

/** 把浏览器媒体异常转换为可行动提示，避免直接暴露晦涩的 DOMException。 */
function describeMediaError(reason: unknown, source: "camera" | "screen") {
  const name = reason instanceof DOMException ? reason.name : "";
  const label = source === "screen" ? "屏幕共享" : "摄像头";
  if (name === "NotAllowedError") return `${label}已取消或未获得授权，请重新选择并允许访问。`;
  if (name === "NotFoundError") return `没有找到可用的${source === "screen" ? "共享画面" : "摄像头"}。`;
  if (name === "NotReadableError") return `${label}暂时不可用，可能正被其他应用占用。`;
  if (name === "AbortError") return `${label}启动被浏览器中断，请重试。`;
  return reason instanceof Error && reason.message ? `${label}启动失败：${reason.message}` : `${label}启动失败，请检查浏览器权限。`;
}

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
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<TutoringMode>("camera");
  const [status, setStatus] = useState<MediaStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [uploadedFrameDataUrl, setUploadedFrameDataUrl] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");

  // 组件卸载时释放媒体轨道，避免摄像头或屏幕共享继续占用。
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  // 用户可从浏览器共享条直接停止；轨道结束时必须同步清理应用状态和陈旧关键帧入口。
  useEffect(() => {
    if (!stream || mode !== "screen") return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    function handleEnded() {
      setStream(null);
      setSourceLabel("");
      setStatus("idle");
      setError("");
      setNotice("屏幕共享已由浏览器停止，最近关键帧已清除。");
    }
    track.addEventListener("ended", handleEnded);
    return () => track.removeEventListener("ended", handleEnded);
  }, [mode, stream]);

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
    setUploadedFrameDataUrl("");
    setUploadedFileName("");
    setSourceLabel("");
    setError("");
    setNotice("设备已停止，内存中的画面已清除。");
    setStatus("idle");
  }, []);

  // 启动电脑或手机摄像头，作为第一阶段模拟眼镜视角的默认输入。
  const startCamera = useCallback(async () => {
    stop();
    setMode("camera");
    setError("");
    setNotice("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持摄像头采集，请使用截图上传或屏幕共享。");
      setStatus("error");
      return;
    }
    setStatus("starting");
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } });
      setUploadedFrameDataUrl("");
      setUploadedFileName("");
      setStream(nextStream);
      setSourceLabel(nextStream.getVideoTracks()[0]?.label || "摄像头");
      setStatus("ready");
    } catch (reason) {
      setError(describeMediaError(reason, "camera"));
      setStatus("error");
    }
  }, [stop]);

  // 启动屏幕共享，适合演示题目网页、PDF 或电子讲义。
  const startScreen = useCallback(async () => {
    stop();
    setMode("screen");
    setError("");
    setNotice("");
    if (!window.isSecureContext) {
      setError("屏幕共享需要 HTTPS 或 localhost 安全环境，请检查当前访问地址。");
      setStatus("error");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("当前浏览器不支持屏幕共享，请使用截图上传。");
      setStatus("error");
      return;
    }
    setStatus("starting");
    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
      setUploadedFrameDataUrl("");
      setUploadedFileName("");
      setStream(nextStream);
      const track = nextStream.getVideoTracks()[0];
      const displaySurface = track?.getSettings().displaySurface;
      const surfaceLabel = displaySurface === "browser" ? "浏览器标签页" : displaySurface === "window" ? "应用窗口" : displaySurface === "monitor" ? "整个屏幕" : "共享画面";
      setSourceLabel(track?.label ? `${surfaceLabel} · ${track.label}` : surfaceLabel);
      setNotice("共享中：只会在手动截取或低频观察时发送当前关键帧，不会上传连续视频。");
      setStatus("ready");
    } catch (reason) {
      setError(describeMediaError(reason, "screen"));
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
      setNotice("");
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
    const liveTrack = stream?.getVideoTracks().find((track) => track.readyState === "live");
    if (!videoRef.current || !liveTrack) {
      throw new Error("请先启动摄像头或屏幕共享");
    }
    return captureVideoFrame(videoRef.current);
  }, [mode, stream, uploadedFrameDataUrl]);

  return useMemo(
    () => ({
      captureFrame,
      error,
      hasFrame: Boolean(uploadedFrameDataUrl || stream?.getVideoTracks().some((track) => track.readyState === "live")),
      mode,
      notice,
      startCamera,
      startScreen,
      status,
      stop,
      stream,
      sourceLabel,
      uploadFrame,
      uploadedFileName,
      videoRef,
    }),
    [captureFrame, error, mode, notice, sourceLabel, startCamera, startScreen, status, stop, stream, uploadFrame, uploadedFileName, uploadedFrameDataUrl],
  );
}
