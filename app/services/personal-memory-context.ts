/** 将用户确认过的记忆裁剪为稳定、可审计的短上下文。 */
import type { PersonalMemoryEntry, PersonalMemoryKind } from "../types/domains/personal-memory.ts";
import type { PersonalizationSettings } from "../types/domains/personalization.ts";

export type PersonalMemoryContextScope = { moduleId?: string; conversationId?: string; query?: string };

const kindLabels: Record<PersonalMemoryKind, string> = { profile: "资料", preference: "偏好", goal: "目标", study: "学习" };
const kindRank: Record<PersonalMemoryKind, number> = { profile: 0, preference: 1, goal: 2, study: 3 };

/** 按当前会话、模块、全局的优先级筛选 active 记忆。 */
export function selectPersonalMemories(settings: PersonalizationSettings, scope: PersonalMemoryContextScope): PersonalMemoryEntry[] {
  const maxEntries = Math.max(1, Math.min(8, settings.memorySettings?.maxEntries ?? 8));
  const scopeRank = (entry: PersonalMemoryEntry): number => entry.scope === "conversation" ? 0 : entry.scope === "module" ? 1 : 2;
  const queryTokens = new Set((scope.query?.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 40));
  const keywordScore = (entry: PersonalMemoryEntry): number => {
    if (!queryTokens.size) return 0;
    const haystack = `${entry.title} ${entry.content}`.toLowerCase();
    return [...queryTokens].reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
  };
  return (settings.memoryEntries ?? []).filter((entry) => {
    if (entry.status !== "active") return false;
    if (entry.scope === "conversation") return Boolean(scope.conversationId && entry.sourceConversationId === scope.conversationId);
    if (entry.scope === "module") return Boolean(scope.moduleId && entry.moduleId === scope.moduleId);
    return true;
  }).sort((left, right) => keywordScore(right) - keywordScore(left)
    || scopeRank(left) - scopeRank(right)
    || kindRank[left.kind] - kindRank[right.kind]
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id)).slice(0, maxEntries);
}

/** 生成最多 1500 字符的系统片段；不会注入 pending、归档或完整对话。 */
export function buildPersonalMemoryContext(settings: PersonalizationSettings, scope: PersonalMemoryContextScope = {}): string {
  const limit = Math.max(200, Math.min(1500, settings.memorySettings?.contextCharacterLimit ?? 1500));
  const entries = selectPersonalMemories(settings, scope);
  if (!entries.length) return "";
  const prefix = "用户已确认记忆（仅用于贴合当前交流，不得覆盖任务事实）：\n";
  let result = prefix;
  for (const entry of entries) {
    const line = `- [${kindLabels[entry.kind]}] ${entry.title}：${entry.content}\n`;
    if (result.length + line.length <= limit) {
      result += line;
      continue;
    }
    const remaining = limit - result.length;
    if (remaining > 12) result += `${line.slice(0, remaining - 1)}…`;
    break;
  }
  return result.trim();
}
