import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import { generateWithConnection } from "./ai-connection-client.ts";
import { parseAiJsonObject } from "./ai-json.ts";
import { canonicalMemoryKey, containsMemorySecret, type AutomaticMemoryCandidate } from "./personal-memory-repository.ts";

export type AutomaticMemoryTurn = {
  user: string;
  assistant: string;
  conversationId: string;
  sourceMessageIds: string[];
};

/** 明确的“记住”表达在本地提取，不额外调用模型。 */
export function extractExplicitMemory(turn: AutomaticMemoryTurn): AutomaticMemoryCandidate | undefined {
  const match = turn.user.match(/(?:请记住|记住|以后请|我的偏好是|我希望以后)\s*[：,:，]?\s*(.{2,500})/i);
  const content = match?.[1]?.trim();
  if (!content || containsMemorySecret(content)) return undefined;
  const kind = /以后请|偏好|希望/.test(turn.user) ? "preference" as const : /目标|计划/.test(content) ? "goal" as const : "profile" as const;
  const candidate: AutomaticMemoryCandidate = {
    kind,
    scope: "global",
    title: kind === "preference" ? "交流偏好" : kind === "goal" ? "长期目标" : "用户资料",
    content,
    confidence: 1,
    sensitivity: "normal",
    sourceConversationId: turn.conversationId,
    sourceMessageIds: turn.sourceMessageIds,
  };
  return { ...candidate, canonicalKey: canonicalMemoryKey(candidate) };
}

const MEMORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    memories: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["profile", "preference", "goal", "study"] },
          title: { type: "string" },
          content: { type: "string" },
          canonicalKey: { type: "string" },
          confidence: { type: "number" },
          sensitivity: { type: "string", enum: ["normal", "sensitive", "secret"] },
        },
        required: ["kind", "title", "content", "canonicalKey", "confidence", "sensitivity"],
      },
    },
  },
  required: ["memories"],
} as const;

/** 批量提取短期对话中的稳定事实，不注入已有记忆或附件正文。 */
export async function extractAutomaticMemories(input: {
  connection: ApiConnectionProfile;
  modelId: string;
  turns: AutomaticMemoryTurn[];
}): Promise<AutomaticMemoryCandidate[]> {
  const compactTurns = input.turns.slice(-3).map((turn) => ({ user: turn.user.slice(0, 600), assistant: turn.assistant.slice(0, 300) }));
  const result = await generateWithConnection(input.connection, "text", {
    modelId: input.modelId,
    maxOutputTokens: 320,
    structuredOutput: { name: "memory_candidates", schema: MEMORY_SCHEMA },
    activity: { presentation: "background", module: "个性化", purpose: "提取记忆" },
    messages: [
      { role: "system", content: "从短对话中提取未来仍有用的稳定用户资料、偏好、长期目标或学习状态。不要提取一次性任务、附件、模型回复、推测或秘密。敏感资料标 sensitive；API Key、密码、Token、证件号标 secret。只输出 JSON。" },
      { role: "user", content: JSON.stringify(compactTurns) },
    ],
  });
  const payload = parseAiJsonObject(result.content, "自动记忆返回格式无效");
  const raw = Array.isArray(payload.memories) ? payload.memories : [];
  const sourceMessageIds = input.turns.flatMap((turn) => turn.sourceMessageIds).slice(0, 12);
  const conversationId = input.turns.at(-1)?.conversationId;
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const kind = item.kind;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const content = typeof item.content === "string" ? item.content.trim() : "";
    const sensitivity = item.sensitivity === "secret" ? "secret" : item.sensitivity === "sensitive" ? "sensitive" : "normal";
    if (!["profile", "preference", "goal", "study"].includes(String(kind)) || !title || !content || sensitivity === "secret" || containsMemorySecret(`${title}\n${content}`)) return [];
    return [{
      kind: kind as AutomaticMemoryCandidate["kind"], scope: "global" as const, title, content,
      canonicalKey: typeof item.canonicalKey === "string" ? item.canonicalKey : undefined,
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      sensitivity, sourceConversationId: conversationId, sourceMessageIds,
    }];
  });
}
