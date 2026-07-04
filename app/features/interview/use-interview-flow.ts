"use client";

import { useInterviewData } from "./use-interview-data";

// 面试流程 hook 的语义入口；当前复用数据协调实现，后续拆分 AI、题组、计划时保持调用方稳定。
export const useInterviewFlow = useInterviewData;
