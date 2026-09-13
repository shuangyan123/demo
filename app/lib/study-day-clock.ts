import { millisecondsUntilNextStudyDay, requireStudyDay } from "./study-day.ts";

type DayClock = {
  now: () => Date;
  schedule: (callback: () => void, delay: number) => () => void;
  onFocus: (callback: () => void) => () => void;
  onVisible: (callback: () => void) => () => void;
};

/** 单个午夜定时器，恢复焦点时校正睡眠及系统时钟变化；所有资源都有清理入口。 */
export function watchStudyDay(initial: Date, onChange: (now: Date) => void, clock: DayClock): () => void {
  let day = requireStudyDay(initial);
  let cancelTimer: (() => void) | undefined;
  const refresh = () => {
    const now = clock.now();
    const nextDay = requireStudyDay(now);
    if (day !== nextDay) {
      day = nextDay;
      onChange(now);
    }
    cancelTimer?.();
    cancelTimer = clock.schedule(refresh, millisecondsUntilNextStudyDay(now));
  };
  const removeFocus = clock.onFocus(refresh);
  const removeVisible = clock.onVisible(refresh);
  refresh();
  return () => { cancelTimer?.(); removeFocus(); removeVisible(); };
}
