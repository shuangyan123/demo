"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// 管理低频关键帧采样；只在内存保存最近一帧，避免形成连续画面记录。
export function useFrameSampler(captureFrame: () => string) {
  const captureRef = useRef(captureFrame);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [intervalMs, setIntervalMs] = useState(3000);
  const [lastCapturedAt, setLastCapturedAt] = useState("");
  const [lastFrameDataUrl, setLastFrameDataUrl] = useState("");

  useEffect(() => {
    captureRef.current = captureFrame;
  }, [captureFrame]);

  // 手动截取一帧，发送前可复用这张内存帧，降低重复截图成本。
  const captureNow = useCallback(() => {
    try {
      const frame = captureRef.current();
      setLastFrameDataUrl(frame);
      setLastCapturedAt(new Date().toISOString());
      setError("");
      return frame;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "关键帧采样失败";
      setError(message);
      throw new Error(message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      try {
        captureNow();
      } catch {
        setEnabled(false);
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [captureNow, enabled, intervalMs]);

  // 停止实时观察并清空最近帧，保证不会在内存中长期保留画面。
  const clear = useCallback(() => {
    setEnabled(false);
    setLastFrameDataUrl("");
    setLastCapturedAt("");
    setError("");
  }, []);

  return useMemo(
    () => ({
      captureNow,
      clear,
      enabled,
      error,
      intervalMs,
      lastCapturedAt,
      lastFrameDataUrl,
      setEnabled,
      setIntervalMs,
    }),
    [captureNow, clear, enabled, error, intervalMs, lastCapturedAt, lastFrameDataUrl],
  );
}
