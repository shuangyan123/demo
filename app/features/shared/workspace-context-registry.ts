import type { ReactNode } from "react";

/** 当前 shell 暴露给 ContextPanel 的最小上下文，不携带业务仓储或宿主能力。 */
export type WorkspaceContextDescriptor = {
  view: string;
  conversationId?: string | null;
};

/** Feature 只注册匹配规则和内容；ContextPanel 本身不认识 Fenbi、Obsidian 等业务。 */
export type WorkspaceContextPanelRegistration = {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  matches: (context: WorkspaceContextDescriptor) => boolean;
};

/** 采用首个匹配项，保证同一 active context 下只有一个明确的 panel owner。 */
export function resolveWorkspaceContextPanel(
  registrations: readonly WorkspaceContextPanelRegistration[],
  context: WorkspaceContextDescriptor,
): WorkspaceContextPanelRegistration | undefined {
  return registrations.find((registration) => registration.matches(context));
}
