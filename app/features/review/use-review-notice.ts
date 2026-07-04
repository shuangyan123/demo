"use client";

import { useCallback, useState } from "react";

/** 管理工作台顶部状态文案，避免数据刷新提示覆盖用户刚触发的动作反馈。 */
export function useReviewNotice() {
  const [notice, setNotice] = useState("正在读取本地题库");

  const markSynced = useCallback(() => {
    setNotice("本地题库已同步");
  }, []);

  const markReadFailed = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : "读取失败");
  }, []);

  return { markReadFailed, markSynced, notice, setNotice };
}
