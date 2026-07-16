"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TutoringMode } from "../../types/review";
import { browserVisionSourceAdapter, type VisionFrame, type VisionSourceSession } from "./vision-source-adapter";

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

// 管理浏览器摄像头、屏幕共享和上传图片三种输入源；不持久化原始媒体。
export function useTutoringMedia() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<TutoringMode>("camera");
  const [status, setStatus] = useState<MediaStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const sessionRef = useRef<VisionSourceSession | undefined>(undefined);
  const [sourceLabel, setSourceLabel] = useState("");
  const [uploadedFrameDataUrl, setUploadedFrameDataUrl] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");

  // 组件卸载时释放媒体轨道，避免摄像头或屏幕共享继续占用。
  useEffect(() => {
    return () => {
      browserVisionSourceAdapter.stop(sessionRef.current);
    };
  }, []);

  // 用户可从浏览器共享条直接停止；轨道结束时必须同步清理应用状态和陈旧关键帧入口。
  useEffect(() => {
    if (!stream || mode !== "screen") return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    function handleEnded() {
      sessionRef.current = undefined;
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
    browserVisionSourceAdapter.stop(sessionRef.current);
    sessionRef.current = undefined;
    setStream(null);
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
      const session = await browserVisionSourceAdapter.start("camera");
      sessionRef.current = session;
      setUploadedFrameDataUrl("");
      setUploadedFileName("");
      setStream(session.stream);
      setSourceLabel(session.label);
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
      const session = await browserVisionSourceAdapter.start("screen");
      sessionRef.current = session;
      setUploadedFrameDataUrl("");
      setUploadedFileName("");
      setStream(session.stream);
      setSourceLabel(session.label);
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
        const dataUrl = await browserVisionSourceAdapter.readUpload(file);
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
  const captureFrame = useCallback((): VisionFrame => {
    const liveTrack = stream?.getVideoTracks().find((track) => track.readyState === "live");
    if (mode !== "upload" && (!videoRef.current || !liveTrack)) {
      throw new Error("请先启动摄像头或屏幕共享");
    }
    return browserVisionSourceAdapter.capture({ mode, video: videoRef.current, uploadedDataUrl: uploadedFrameDataUrl });
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
