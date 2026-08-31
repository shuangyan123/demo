import type { ViewKey } from "../../types/domains/workspace.ts";

const preloaders: Partial<Record<ViewKey, () => Promise<unknown>>> = {
  automation: () => import("../automation/automation-view"),
  conversation: () => import("../conversation/conversation-workspace"),
  fenbi: () => import("../fenbi/fenbi-workspace"),
  import: () => import("../import/import-workspace"),
  interview: () => import("../interview/interview-workspace"),
  plugins: () => import("../settings/plugins/settings-plugins-view"),
  settings: () => import("../settings/settings-workspace"),
  tutoring: () => import("../tutoring/tutoring-workspace"),
};

/** 仅在用户明确悬停或聚焦低频入口时预取代码，不触发 repository 或网络业务请求。 */
export function preloadReviewView(view?: ViewKey): void {
  if (!view) return;
  void preloaders[view]?.();
}
