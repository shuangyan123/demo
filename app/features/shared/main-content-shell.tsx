import type { ReactNode } from "react";
import { cx } from "./ui-primitives";

export type MainContentWidth = "narrow" | "medium" | "wide";

const widthClasses: Record<MainContentWidth, string> = {
  narrow: "content-width-narrow",
  medium: "content-width-medium",
  wide: "content-width-wide",
};

/** 统一右侧页面的视觉中心；业务页面只选择阅读宽度，不重复维护 gutter。 */
export function MainContentShell({ children, className, width = "wide" }: {
  children: ReactNode;
  className?: string;
  width?: MainContentWidth;
}) {
  return (
    <div
      className={cx("main-content-shell mx-auto min-h-full w-full px-7 max-lg:px-5 max-sm:px-4", widthClasses[width], className)}
      data-main-content-width={width}
    >
      {children}
    </div>
  );
}
