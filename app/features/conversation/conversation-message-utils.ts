import type { AiConversationMessage } from "../../types/domains/conversation.ts";

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

/** 把常见模型拥塞错误转换为可执行的用户提示。 */
export function conversationProviderErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "AI 对话失败";
  if (/at capacity|overload|resource exhausted|429|503/i.test(raw)) return "模型暂时满载，请切换模型或稍后再试";
  return raw;
}
