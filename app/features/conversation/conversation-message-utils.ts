import type { AiConversationMessage } from "../../types/domains/conversation.ts";
import { AiProviderFailureError, aiProviderFailureMessage } from "../../services/ai-provider-failure.ts";

/** 将消息时间格式化为当前中文区域的短时间。 */
export function formatConversationTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

/** 仅向模型传递最近的用户与助手消息，排除工具和系统事件。 */
export function toConversationChatHistory(messages: AiConversationMessage[]) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
}

/** 在发送当轮请求时读取内存附件，不把原始媒体写入 IndexedDB。 */
export function readBlobAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取本地文件"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

/** Provider failure 只按稳定 code 展示；普通本地/业务错误仍保留已有安全 message。 */
export function conversationProviderErrorMessage(error: unknown): string {
  if (error instanceof AiProviderFailureError) return aiProviderFailureMessage(error.failure.code, error.failure.providerCode);
  return error instanceof Error ? error.message : "AI 对话失败";
}

/** 只有真实可见内容才能写入成功的 assistant message，避免把空响应伪装成完成。 */
export function requireConversationAssistantContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) throw new Error("AI 生成结果缺少可见内容，未写入助手消息");
  return normalized;
}
