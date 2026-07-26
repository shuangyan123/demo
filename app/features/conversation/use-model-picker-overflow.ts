"use client";

import { useLayoutEffect, type RefObject } from "react";

type UseModelPickerOverflowOptions = {
  pickerRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewKey: string;
};

/**
 * 根据当前钻取层的真实内容高度启用滚动。
 * 换层时先同步清零滚动位置，再由 ResizeObserver 更新溢出状态，避免浏览器短暂绘制滚动条。
 */
export function useModelPickerOverflow({ pickerRef, viewportRef, viewKey }: UseModelPickerOverflowOptions) {
  useLayoutEffect(() => {
    const picker = pickerRef.current;
    const viewport = viewportRef.current;
    if (!picker || !viewport) return;

    viewport.scrollTop = 0;
    viewport.dataset.scrollable = "false";
    picker.dataset.pickerScrollable = "false";

    const updateOverflow = () => {
      const scrollable = viewport.scrollHeight > viewport.clientHeight + 1;
      viewport.dataset.scrollable = String(scrollable);
      picker.dataset.pickerScrollable = String(scrollable);
    };

    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    const content = viewport.firstElementChild;
    if (content instanceof HTMLElement) observer.observe(content);

    return () => observer.disconnect();
  }, [pickerRef, viewportRef, viewKey]);
}
