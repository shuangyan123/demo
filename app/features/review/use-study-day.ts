"use client";

import { useEffect, useState } from "react";
import { makeToday } from "../../lib/review-utils.ts";
import { watchStudyDay } from "../../lib/study-day-clock.ts";

export function useStudyDay(): Date {
  const [today, setToday] = useState(makeToday);
  useEffect(() => watchStudyDay(today, (now) => {
    const anchor = new Date(now);
    anchor.setHours(8, 0, 0, 0);
    setToday(anchor);
  }, {
    now: () => new Date(),
    schedule: (callback, delay) => {
      const timer = window.setTimeout(callback, delay);
      return () => window.clearTimeout(timer);
    },
    onFocus: (callback) => {
      window.addEventListener("focus", callback);
      return () => window.removeEventListener("focus", callback);
    },
    onVisible: (callback) => {
      const listener = () => { if (document.visibilityState === "visible") callback(); };
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  }), [today]);
  return today;
}
