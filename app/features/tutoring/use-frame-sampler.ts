"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasMeaningfulVisionChange, type VisionFrame } from "./vision-source-adapter";

// 管理低频关键帧采样；只在内存保存最近一帧，避免形成连续画面记录。
export function useFrameSampler(captureFrame: () => VisionFrame) {
  const captureRef = useRef(captureFrame);
  const lastFingerprintRef = useRef<string | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [intervalMs, setIntervalMs] = useState(3000);
  const [lastChanged, setLastChanged] = useState(false);
  const [lastCapturedAt, setLastCapturedAt] = useState("");
  const [lastFrameDataUrl, setLastFrameDataUrl] = useState("");

  useEffect(() => {
    captureRef.current = captureFrame;
  }, [captureFrame]);

  // 手动截取一帧，发送前可复用这张内存帧，降低重复截图成本。
  const captureNow = useCallback((force = true) => {
    try {
      const frame = captureRef.current();
      const changed = force || hasMeaningfulVisionChange(lastFingerprintRef.current ?? "", frame.fingerprint);
      setLastChanged(changed);
      if (!changed) {
        setError("");
        return lastFrameDataUrl || frame.dataUrl;
      }
      lastFingerprintRef.current = frame.fingerprint;
      setLastFrameDataUrl(frame.dataUrl);
      setLastCapturedAt(new Date().toISOString());
      setError("");
      return frame.dataUrl;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "关键帧采样失败";
      setError(message);
      throw new Error(message);
    }
  }, [lastFrameDataUrl]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      try {
        captureNow(false);
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
    setLastChanged(false);
    lastFingerprintRef.current = undefined;
    setError("");
  }, []);

  return useMemo(
    () => ({
      captureNow,
      clear,
      enabled,
      error,
      intervalMs,
      lastChanged,
      lastCapturedAt,
      lastFrameDataUrl,
      setEnabled,
      setIntervalMs,
    }),
    [captureNow, clear, enabled, error, intervalMs, lastCapturedAt, lastChanged, lastFrameDataUrl],
  );
}
