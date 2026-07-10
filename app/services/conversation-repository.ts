import { reviewDb } from "../db/review-db.ts";
import { toISODate } from "../lib/review-utils.ts";
import type {
  AiConversation,
  AiConversationAttachment,
  AiConversationFolder,
  AiConversationKind,
  AiConversationMessage,
  AiConversationRole,
  AiConversationRunStep,
  AiConversationSourceType,
  AiProject,
  AiUsageRecord,
  StudyDomainId,
} from "../types/review.ts";

export const DEFAULT_AI_PROJECT_ID = "civil-service";

/** 对话快照只包含持久化摘要，不包含附件字节或转写原始音频。 */
export type ConversationSnapshot = {
  projects: AiProject[];
  folders: AiConversationFolder[];
  conversations: AiConversation[];
  attachments: AiConversationAttachment[];
  messages: AiConversationMessage[];
  runSteps: AiConversationRunStep[];
};

export type CreateConversationInput = {
  projectId?: string;
  studyDomainId?: StudyDomainId;
  title?: string;
  kind?: AiConversationKind;
  sourceType?: AiConversationSourceType;
  sourceId?: string;
  folderId?: string;
  selectedConnectionId?: string;
  today?: Date;
};

export type AppendConversationMessageInput = {
  conversationId: string;
  role: AiConversationRole;
  content: string;
  attachmentIds?: string[];
  usage?: AiUsageRecord;
  today?: Date;
};

export type AppendConversationRunStepInput = {
  conversationId: string;
  runId: string;
  label: string;
  state: AiConversationRunStep["state"];
  text?: string;
  usage?: AiConversationRunStep["usage"];
  today?: Date;
};

export type CreateConversationAttachmentInput = Omit<AiConversationAttachment, "id" | "createdAt"> & {
  today?: Date;
};

function nowIso(today = new Date()): string {
  return toISODate(today);
}

function previewText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function folderLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 48);
}

async function ensureDefaultProject(today = new Date()): Promise<AiProject> {
  const existing = await reviewDb.aiProjects.get(DEFAULT_AI_PROJECT_ID);
  if (existing) return existing;
  const timestamp = nowIso(today);
  const project: AiProject = {
    id: DEFAULT_AI_PROJECT_ID,
    label: "公考",
    description: "公考专项学习与通用 AI 对话项目",
    studyDomainId: "civil-service",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await reviewDb.aiProjects.put(project);
  return project;
}

async function assertFolderProject(folderId: string | undefined, projectId: string): Promise<void> {
  if (!folderId) return;
  const folder = await reviewDb.aiConversationFolders.get(folderId);
  if (!folder || folder.projectId !== projectId) throw new Error("目标文件夹不存在或不属于当前项目");
}

async function assertFolderMove(folderId: string, parentId: string | undefined): Promise<void> {
  if (!parentId) return;
  if (parentId === folderId) throw new Error("文件夹不能移动到自身");
  let cursor = await reviewDb.aiConversationFolders.get(parentId);
  while (cursor) {
    if (cursor.parentId === folderId) throw new Error("文件夹不能移动到自己的子文件夹");
    cursor = cursor.parentId ? await reviewDb.aiConversationFolders.get(cursor.parentId) : undefined;
  }
}

export const conversationRepository = {
  async ensureDefaultProject(today = new Date()): Promise<AiProject> {
    return ensureDefaultProject(today);
  },

  async loadSnapshot(today = new Date()): Promise<ConversationSnapshot> {
    await ensureDefaultProject(today);
    const [projects, folders, conversations, attachments, messages, runSteps] = await Promise.all([
      reviewDb.aiProjects.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversationFolders.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversations.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversationAttachments.orderBy("createdAt").toArray(),
      reviewDb.aiConversationMessages.orderBy("createdAt").toArray(),
      reviewDb.aiConversationRunSteps.orderBy("updatedAt").toArray(),
    ]);
    return { projects, folders, conversations, attachments, messages, runSteps };
  },

  async createFolder(input: { projectId?: string; parentId?: string; label: string; today?: Date }): Promise<AiConversationFolder> {
    const project = input.projectId ? await reviewDb.aiProjects.get(input.projectId) : await ensureDefaultProject(input.today);
    const projectId = project?.id ?? DEFAULT_AI_PROJECT_ID;
    const label = folderLabel(input.label);
    if (!label) throw new Error("请输入文件夹名称");
    await assertFolderProject(input.parentId, projectId);
    const timestamp = nowIso(input.today);
    const siblings = await reviewDb.aiConversationFolders.filter((folder) => folder.projectId === projectId && (folder.parentId ?? "") === (input.parentId ?? "")).toArray();
    const folder: AiConversationFolder = {
      id: crypto.randomUUID(),
      projectId,
      parentId: input.parentId,
      label,
      sortOrder: siblings.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.aiConversationFolders.add(folder);
    return folder;
  },

  async renameFolder(id: string, label: string, today = new Date()): Promise<void> {
    const nextLabel = folderLabel(label);
    if (!nextLabel) throw new Error("请输入文件夹名称");
    await reviewDb.aiConversationFolders.update(id, { label: nextLabel, updatedAt: nowIso(today) });
  },

  async moveFolder(id: string, parentId: string | undefined, today = new Date()): Promise<void> {
    const folder = await reviewDb.aiConversationFolders.get(id);
    if (!folder) throw new Error("文件夹不存在");
    await assertFolderProject(parentId, folder.projectId);
    await assertFolderMove(id, parentId);
    await reviewDb.aiConversationFolders.update(id, { parentId, updatedAt: nowIso(today) });
  },

  async deleteFolder(id: string, today = new Date()): Promise<void> {
    const folder = await reviewDb.aiConversationFolders.get(id);
    if (!folder) return;
    const timestamp = nowIso(today);
    await reviewDb.transaction("rw", reviewDb.aiConversationFolders, reviewDb.aiConversations, async () => {
      const children = await reviewDb.aiConversationFolders.filter((item) => item.parentId === id).toArray();
      await Promise.all(children.map((child) => reviewDb.aiConversationFolders.update(child.id, { parentId: folder.parentId, updatedAt: timestamp })));
      const conversations = await reviewDb.aiConversations.filter((item) => item.folderId === id).toArray();
      await Promise.all(conversations.map((conversation) => reviewDb.aiConversations.update(conversation.id, { folderId: folder.parentId, updatedAt: timestamp })));
      await reviewDb.aiConversationFolders.delete(id);
    });
  },

  async createConversation(input: CreateConversationInput = {}): Promise<AiConversation> {
    const timestamp = nowIso(input.today);
    const project = input.projectId ? await reviewDb.aiProjects.get(input.projectId) : await ensureDefaultProject(input.today);
    const projectId = project?.id ?? DEFAULT_AI_PROJECT_ID;
    if (!project) await ensureDefaultProject(input.today);
    await assertFolderProject(input.folderId, projectId);
    const conversation: AiConversation = {
      id: crypto.randomUUID(),
      projectId,
      studyDomainId: input.studyDomainId ?? project?.studyDomainId ?? "civil-service",
      title: input.title?.trim() || "未命名对话",
      kind: input.kind ?? "general",
      status: "active",
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId,
      folderId: input.folderId,
      selectedConnectionId: input.selectedConnectionId,
      messageCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.aiConversations.put(conversation);
    return conversation;
  },

  async renameConversation(id: string, title: string, today = new Date()): Promise<void> {
    const nextTitle = folderLabel(title);
    if (!nextTitle) return;
    await reviewDb.aiConversations.update(id, { title: nextTitle, updatedAt: nowIso(today) });
  },

  async moveConversation(id: string, folderId: string | undefined, today = new Date()): Promise<void> {
    const conversation = await reviewDb.aiConversations.get(id);
    if (!conversation) throw new Error("对话不存在");
    await assertFolderProject(folderId, conversation.projectId);
    await reviewDb.aiConversations.update(id, { folderId, updatedAt: nowIso(today) });
  },

  async setConversationConnection(id: string, selectedConnectionId: string | undefined, today = new Date()): Promise<void> {
    await reviewDb.aiConversations.update(id, { selectedConnectionId, updatedAt: nowIso(today) });
  },

  async archiveConversation(id: string, today = new Date()): Promise<void> {
    await reviewDb.aiConversations.update(id, { status: "archived", updatedAt: nowIso(today) });
  },

  async createAttachment(input: CreateConversationAttachmentInput): Promise<AiConversationAttachment> {
    const attachment: AiConversationAttachment = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      messageId: input.messageId,
      kind: input.kind,
      label: input.label.slice(0, 120),
      summary: input.summary.slice(0, 600),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      createdAt: nowIso(input.today),
    };
    await reviewDb.aiConversationAttachments.put(attachment);
    return attachment;
  },

  async appendMessage(input: AppendConversationMessageInput): Promise<AiConversationMessage> {
    const timestamp = nowIso(input.today);
    const message: AiConversationMessage = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      attachmentIds: input.attachmentIds ?? [],
      usage: input.usage,
      createdAt: timestamp,
    };
    const conversation = await reviewDb.aiConversations.get(input.conversationId);
    const nextTitle = conversation?.messageCount === 0 && input.role === "user" ? previewText(input.content) || "未命名对话" : conversation?.title;
    await reviewDb.transaction("rw", reviewDb.aiConversationMessages, reviewDb.aiConversationAttachments, reviewDb.aiConversations, async () => {
      await reviewDb.aiConversationMessages.add(message);
      if (message.attachmentIds.length) {
        await Promise.all(message.attachmentIds.map((id) => reviewDb.aiConversationAttachments.update(id, { messageId: message.id })));
      }
      await reviewDb.aiConversations.update(input.conversationId, {
        ...(nextTitle ? { title: nextTitle } : {}),
        lastMessagePreview: previewText(input.content),
        messageCount: (conversation?.messageCount ?? 0) + 1,
        updatedAt: timestamp,
      });
    });
    return message;
  },

  async appendRunStep(input: AppendConversationRunStepInput): Promise<AiConversationRunStep> {
    const timestamp = nowIso(input.today);
    const step: AiConversationRunStep = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      runId: input.runId,
      label: input.label,
      state: input.state,
      text: input.text,
      usage: input.usage,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.transaction("rw", reviewDb.aiConversationRunSteps, reviewDb.aiConversations, async () => {
      await reviewDb.aiConversationRunSteps.add(step);
      await reviewDb.aiConversations.update(input.conversationId, { updatedAt: timestamp });
    });
    return step;
  },
};
