"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type ReviewTimerMode = "stopwatch" | "countdown";

export type ReviewTimerState = {
  elapsedSec: number;
  isRunning: boolean;
  isTimedOut: boolean;
  mode: ReviewTimerMode;
  remainingSec: number;
  targetSec: number;
};

type TimerSession = {
  elapsedSec: number;
  isRunning: boolean;
  itemId: string | null;
};

// 把任意秒数收敛到复盘计时允许的范围，避免输入异常值导致 UI 抖动或统计污染。
function clampTimerSeconds(value: number): number {
  if (!Number.isFinite(value)) return 90;
  return Math.max(15, Math.min(3600, Math.round(value)));
}

// 将秒数格式化成复盘卡片里使用的 mm:ss 文案。
export function formatTimerSeconds(totalSec: number): string {
  const safeTotal = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(safeTotal / 60);
  const seconds = safeTotal % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// 管理单题复盘计时；题目变化时自动重置并开始，提交时由调用方读取 elapsedSec 写入 attempts。
export function useReviewTimer(activeItemId: string | null) {
  const [mode, setModeState] = useState<ReviewTimerMode>("stopwatch");
  const [targetSec, setTargetSecState] = useState(90);
  const [session, setSession] = useState<TimerSession>(() => ({
    elapsedSec: 0,
    isRunning: false,
    itemId: activeItemId,
  }));

  if (session.itemId !== activeItemId) {
    setSession({
      elapsedSec: 0,
      isRunning: false,
      itemId: activeItemId,
    });
  }

  useEffect(() => {
    if (!session.itemId || !session.isRunning) return;
    const timerId = window.setInterval(() => {
      setSession((current) => (current.itemId === session.itemId ? { ...current, elapsedSec: current.elapsedSec + 1 } : current));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [session.isRunning, session.itemId]);

  const state = useMemo<ReviewTimerState>(() => {
    const remainingSec = Math.max(targetSec - session.elapsedSec, 0);
    return {
      elapsedSec: session.elapsedSec,
      isRunning: session.isRunning,
      isTimedOut: mode === "countdown" && session.elapsedSec >= targetSec,
      mode,
      remainingSec,
      targetSec,
    };
  }, [mode, session.elapsedSec, session.isRunning, targetSec]);

  const setMode = useCallback((nextMode: ReviewTimerMode) => {
    setModeState(nextMode);
    setSession((current) => ({ ...current, elapsedSec: 0, isRunning: false }));
  }, []);

  const setTargetSec = useCallback((nextTargetSec: number) => {
    setTargetSecState(clampTimerSeconds(nextTargetSec));
    setSession((current) => ({ ...current, elapsedSec: 0, isRunning: false }));
  }, []);

  const pause = useCallback(() => setSession((current) => ({ ...current, isRunning: false })), []);
  const resume = useCallback(() => setSession((current) => ({ ...current, isRunning: Boolean(current.itemId) })), []);
  const reset = useCallback(() => {
    setSession((current) => ({ ...current, elapsedSec: 0, isRunning: false }));
  }, []);

  return {
    ...state,
    pause,
    reset,
    resume,
    setMode,
    setTargetSec,
  };
}
