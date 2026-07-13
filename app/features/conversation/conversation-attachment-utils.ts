import { conversationRepository } from "../../services/conversation-repository";
import type { AiConversationAttachment } from "../../types/review";

/** 发送前附件只保留在浏览器内存；持久化阶段仅写入安全摘要。 */
export type DraftAttachment = {
  id: string;
  file: File;
  kind: AiConversationAttachment["kind"];
  summary: string;
};

/** 将内存附件转换为会话附件摘要，绝不把文件字节写入 IndexedDB。 */
export async function persistDraftAttachmentSummaries(conversationId: string, attachments: DraftAttachment[]) {
  return Promise.all(attachments.map((attachment) => conversationRepository.createAttachment({
    conversationId,
    kind: attachment.kind,
    label: attachment.file.name,
    summary: attachment.summary,
    mimeType: attachment.file.type || undefined,
    sizeBytes: attachment.file.size,
  })));
}
