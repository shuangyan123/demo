import { reviewDb } from "../db/review-db.ts";
import type { AiSelectedRuntimeValues } from "../types/domains/ai-model.ts";
import { legacyRuntimeValues } from "./model-runtime-descriptors.ts";
import type { AiConversation, AiConversationAttachment, AiConversationFolder, AiConversationKind, AiConversationMessage, AiConversationRole, AiConversationRunStep, AiConversationSourceType, AiProject, AiProjectPartition, ConversationContextCompaction } from "../types/domains/conversation.ts";
import type { AiUsageRecord } from "../types/domains/ai-connection.ts";
import type { StudyDomainId } from "../types/domains/workspace.ts";

export const DEFAULT_AI_PROJECT_ID = "civil-service";

/** 对话快照只包含持久化摘要，不包含附件字节或转写原始音频。 */
export type ConversationSnapshot = {
  projects: AiProject[];
  /** 新业务边界；底层仍读取 v16 的 aiConversationFolders 表。 */
  partitions: AiProjectPartition[];
  /** @deprecated 运行时兼容旧快照消费者；新功能只读取 partitions。 */
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
  partitionId?: string;
  /** @deprecated 只兼容调用方传入的 v16 字段；新代码使用 partitionId。 */
  folderId?: string;
  selectedConnectionId?: string;
  selectedModelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  today?: Date;
};

export type AppendConversationMessageInput = {
  conversationId: string;
  turnId?: string;
  sequence?: number;
  role: AiConversationRole;
  content: string;
  attachmentIds?: string[];
  usage?: AiUsageRecord;
  today?: Date;
};

export type AppendConversationRunStepInput = {
  conversationId: string;
  runId: string;
  turnId?: string;
  ordinal?: number;
  visibility?: AiConversationRunStep["visibility"];
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
  return today.toISOString();
}

const roleOrder: Record<AiConversationRole, number> = { system: -1, user: 0, assistant: 2, tool: 1 };

/** IndexedDB 的相同索引值会按 UUID 回退；读取边界必须显式恢复业务顺序。 */
export function compareConversationMessages(left: AiConversationMessage, right: AiConversationMessage): number {
  return left.conversationId.localeCompare(right.conversationId)
    || left.createdAt.localeCompare(right.createdAt)
    || (left.sequence ?? roleOrder[left.role]) - (right.sequence ?? roleOrder[right.role])
    || left.id.localeCompare(right.id);
}

/** 工具步骤优先使用显式 ordinal，旧记录再按时间和 ID 稳定排序。 */
export function compareConversationRunSteps(left: AiConversationRunStep, right: AiConversationRunStep): number {
  return left.conversationId.localeCompare(right.conversationId)
    || left.createdAt.localeCompare(right.createdAt)
    || (left.ordinal ?? 0) - (right.ordinal ?? 0)
    || left.id.localeCompare(right.id);
}

function previewText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function partitionLabel(value: string): string {
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

async function assertPartitionProject(partitionId: string | undefined, projectId: string): Promise<void> {
  if (!partitionId) return;
  const partition = await reviewDb.aiConversationFolders.get(partitionId);
  if (!partition || partition.projectId !== projectId) throw new Error("目标分区不存在或不属于当前项目");
}

async function assertPartitionMove(partitionId: string, parentId: string | undefined): Promise<void> {
  if (!parentId) return;
  if (parentId === partitionId) throw new Error("分区不能移动到自身");
  let cursor = await reviewDb.aiConversationFolders.get(parentId);
  while (cursor) {
    if (cursor.parentId === partitionId) throw new Error("分区不能移动到自己的子分区");
    cursor = cursor.parentId ? await reviewDb.aiConversationFolders.get(cursor.parentId) : undefined;
  }
}

export const conversationRepository = {
  async ensureDefaultProject(today = new Date()): Promise<AiProject> {
    return ensureDefaultProject(today);
  },

  async loadSnapshot(today = new Date()): Promise<ConversationSnapshot> {
    await ensureDefaultProject(today);
    const [projects, partitions, conversations, attachments, messages, runSteps] = await Promise.all([
      reviewDb.aiProjects.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversationFolders.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversations.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversationAttachments.orderBy("createdAt").toArray(),
      reviewDb.aiConversationMessages.orderBy("createdAt").toArray(),
      reviewDb.aiConversationRunSteps.orderBy("updatedAt").toArray(),
    ]);
    const normalizedConversations = conversations.map((conversation) => {
      const partitionId = conversation.partitionId ?? conversation.folderId;
      return {
        ...conversation,
        partitionId,
        selectedRuntimeValues: conversation.selectedRuntimeValues ?? legacyRuntimeValues(conversation.selectedReasoningEffort, conversation.selectedSpeedMode),
      };
    });
    return {
      projects,
      partitions,
      folders: partitions,
      conversations: normalizedConversations,
      attachments,
      messages: messages.toSorted(compareConversationMessages),
      runSteps: runSteps.toSorted(compareConversationRunSteps),
    };
  },

  async createPartition(input: { projectId?: string; parentId?: string; label: string; today?: Date }): Promise<AiProjectPartition> {
    const project = input.projectId ? await reviewDb.aiProjects.get(input.projectId) : await ensureDefaultProject(input.today);
    if (input.projectId && !project) throw new Error("项目不存在");
    const projectId = project?.id ?? DEFAULT_AI_PROJECT_ID;
    const label = partitionLabel(input.label);
    if (!label) throw new Error("请输入分区名称");
    await assertPartitionProject(input.parentId, projectId);
    const timestamp = nowIso(input.today);
    const siblings = await reviewDb.aiConversationFolders.filter((partition) => partition.projectId === projectId && (partition.parentId ?? "") === (input.parentId ?? "")).toArray();
    const partition: AiProjectPartition = {
      id: crypto.randomUUID(),
      projectId,
      parentId: input.parentId,
      label,
      sortOrder: siblings.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.aiConversationFolders.add(partition);
    return partition;
  },

  async renamePartition(id: string, label: string, today = new Date()): Promise<void> {
    const nextLabel = partitionLabel(label);
    if (!nextLabel) throw new Error("请输入分区名称");
    if (!await reviewDb.aiConversationFolders.get(id)) throw new Error("分区不存在");
    await reviewDb.aiConversationFolders.update(id, { label: nextLabel, updatedAt: nowIso(today) });
  },

  async movePartition(id: string, parentId: string | undefined, today = new Date()): Promise<void> {
    const partition = await reviewDb.aiConversationFolders.get(id);
    if (!partition) throw new Error("分区不存在");
    await assertPartitionProject(parentId, partition.projectId);
    await assertPartitionMove(id, parentId);
    await reviewDb.aiConversationFolders.update(id, { parentId, updatedAt: nowIso(today) });
  },

  async deletePartition(id: string, today = new Date()): Promise<void> {
    const partition = await reviewDb.aiConversationFolders.get(id);
    if (!partition) return;
    const timestamp = nowIso(today);
    await reviewDb.transaction("rw", reviewDb.aiConversationFolders, reviewDb.aiConversations, async () => {
      const children = await reviewDb.aiConversationFolders.filter((item) => item.parentId === id).toArray();
      await Promise.all(children.map((child) => reviewDb.aiConversationFolders.update(child.id, { parentId: partition.parentId, updatedAt: timestamp })));
      const conversations = await reviewDb.aiConversations.filter((item) => item.partitionId === id || item.folderId === id).toArray();
      await Promise.all(conversations.map((conversation) => reviewDb.aiConversations.update(conversation.id, { partitionId: partition.parentId, folderId: partition.parentId, updatedAt: timestamp })));
      await reviewDb.aiConversationFolders.delete(id);
    });
  },

  /** @deprecated v16 compatibility adapter; new feature code must use createPartition. */
  async createFolder(input: { projectId?: string; parentId?: string; label: string; today?: Date }): Promise<AiProjectPartition> {
    return this.createPartition(input);
  },

  /** @deprecated v16 compatibility adapter; new feature code must use renamePartition. */
  async renameFolder(id: string, label: string, today = new Date()): Promise<void> {
    return this.renamePartition(id, label, today);
  },

  /** @deprecated v16 compatibility adapter; new feature code must use movePartition. */
  async moveFolder(id: string, parentId: string | undefined, today = new Date()): Promise<void> {
    return this.movePartition(id, parentId, today);
  },

  /** @deprecated v16 compatibility adapter; new feature code must use deletePartition. */
  async deleteFolder(id: string, today = new Date()): Promise<void> {
    return this.deletePartition(id, today);
  },

  async createConversation(input: CreateConversationInput = {}): Promise<AiConversation> {
    const timestamp = nowIso(input.today);
    const project = input.projectId ? await reviewDb.aiProjects.get(input.projectId) : await ensureDefaultProject(input.today);
    if (input.projectId && !project) throw new Error("项目不存在");
    const projectId = project?.id ?? DEFAULT_AI_PROJECT_ID;
    if (!project) await ensureDefaultProject(input.today);
    const partitionId = input.partitionId ?? input.folderId;
    await assertPartitionProject(partitionId, projectId);
    const conversation: AiConversation = {
      id: crypto.randomUUID(),
      projectId,
      studyDomainId: input.studyDomainId ?? project?.studyDomainId ?? "civil-service",
      title: input.title?.trim() || "未命名对话",
      kind: input.kind ?? "general",
      status: "active",
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId,
      partitionId,
      folderId: partitionId,
      selectedConnectionId: input.selectedConnectionId,
      selectedModelId: input.selectedModelId,
      selectedRuntimeValues: input.selectedRuntimeValues,
      messageCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.aiConversations.put(conversation);
    return conversation;
  },

  async renameConversation(id: string, title: string, today = new Date()): Promise<void> {
    const nextTitle = partitionLabel(title);
    if (!nextTitle) return;
    await reviewDb.aiConversations.update(id, { title: nextTitle, updatedAt: nowIso(today) });
  },

  async moveConversationToPartition(id: string, partitionId: string | undefined, today = new Date()): Promise<void> {
    const conversation = await reviewDb.aiConversations.get(id);
    if (!conversation) throw new Error("对话不存在");
    await assertPartitionProject(partitionId, conversation.projectId);
    await reviewDb.aiConversations.update(id, { partitionId, folderId: partitionId, updatedAt: nowIso(today) });
  },

  /** @deprecated v16 compatibility adapter; new feature code must use moveConversationToPartition. */
  async moveConversation(id: string, folderId: string | undefined, today = new Date()): Promise<void> {
    return this.moveConversationToPartition(id, folderId, today);
  },

  async setConversationConnection(id: string, selectedConnectionId: string | undefined, today = new Date()): Promise<void> {
    await reviewDb.aiConversations.update(id, { selectedConnectionId, updatedAt: nowIso(today) });
  },

  /** 同时保存连接、模型与归一化运行值；历史字段在新写入时清空。 */
  async setConversationModelSelection(id: string, selectedConnectionId: string, selectedModelId: string, selectedRuntimeValues?: AiSelectedRuntimeValues, today = new Date()): Promise<void> {
    await reviewDb.aiConversations.update(id, {
      selectedConnectionId,
      selectedModelId,
      selectedRuntimeValues,
      selectedReasoningEffort: undefined,
      selectedSpeedMode: undefined,
      updatedAt: nowIso(today),
    });
  },

  /** 原子保存规范化压缩摘要和边界；历史消息与附件记录保持不变。 */
  async setConversationContextCompaction(id: string, contextCompaction: ConversationContextCompaction, today = new Date()): Promise<void> {
    await reviewDb.aiConversations.update(id, {
      contextCompaction,
      summary: contextCompaction.summary,
      updatedAt: nowIso(today),
    });
  },

  async archiveConversation(id: string, today = new Date()): Promise<void> {
    await reviewDb.aiConversations.update(id, { status: "archived", updatedAt: nowIso(today) });
  },

  /** 永久删除单条对话及其附件摘要、消息和工具步骤。 */
  async deleteConversation(id: string): Promise<void> {
    await reviewDb.transaction(
      "rw",
      reviewDb.aiConversations,
      reviewDb.aiConversationAttachments,
      reviewDb.aiConversationMessages,
      reviewDb.aiConversationRunSteps,
      async () => {
        await Promise.all([
          reviewDb.aiConversationAttachments.where("conversationId").equals(id).delete(),
          reviewDb.aiConversationMessages.where("conversationId").equals(id).delete(),
          reviewDb.aiConversationRunSteps.where("conversationId").equals(id).delete(),
        ]);
        await reviewDb.aiConversations.delete(id);
      },
    );
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
      turnId: input.turnId,
      sequence: input.sequence,
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
      turnId: input.turnId ?? input.runId,
      ordinal: input.ordinal,
      visibility: input.visibility,
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
