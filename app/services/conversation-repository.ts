import { reviewDb } from "../db/review-db.ts";
import { toISODate } from "../lib/review-utils.ts";
import type {
  AiConversation,
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

export type ConversationSnapshot = {
  projects: AiProject[];
  conversations: AiConversation[];
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
  today?: Date;
};

export type AppendConversationMessageInput = {
  conversationId: string;
  role: AiConversationRole;
  content: string;
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

function nowIso(today = new Date()): string {
  return toISODate(today);
}

function previewText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
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

export const conversationRepository = {
  async ensureDefaultProject(today = new Date()): Promise<AiProject> {
    return ensureDefaultProject(today);
  },

  async loadSnapshot(today = new Date()): Promise<ConversationSnapshot> {
    await ensureDefaultProject(today);
    const [projects, conversations, messages, runSteps] = await Promise.all([
      reviewDb.aiProjects.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversations.orderBy("updatedAt").reverse().toArray(),
      reviewDb.aiConversationMessages.orderBy("createdAt").toArray(),
      reviewDb.aiConversationRunSteps.orderBy("updatedAt").toArray(),
    ]);
    return { projects, conversations, messages, runSteps };
  },

  async createConversation(input: CreateConversationInput = {}): Promise<AiConversation> {
    const timestamp = nowIso(input.today);
    const project = input.projectId
      ? await reviewDb.aiProjects.get(input.projectId)
      : await ensureDefaultProject(input.today);
    const projectId = project?.id ?? DEFAULT_AI_PROJECT_ID;
    if (!project) await ensureDefaultProject(input.today);
    const conversation: AiConversation = {
      id: crypto.randomUUID(),
      projectId,
      studyDomainId: input.studyDomainId ?? project?.studyDomainId ?? "civil-service",
      title: input.title?.trim() || "新对话",
      kind: input.kind ?? "general",
      status: "active",
      sourceType: input.sourceType ?? "manual",
      sourceId: input.sourceId,
      messageCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await reviewDb.aiConversations.put(conversation);
    return conversation;
  },

  async renameConversation(id: string, title: string, today = new Date()): Promise<void> {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    await reviewDb.aiConversations.update(id, { title: nextTitle, updatedAt: nowIso(today) });
  },

  async archiveConversation(id: string, today = new Date()): Promise<void> {
    await reviewDb.aiConversations.update(id, { status: "archived", updatedAt: nowIso(today) });
  },

  async appendMessage(input: AppendConversationMessageInput): Promise<AiConversationMessage> {
    const timestamp = nowIso(input.today);
    const message: AiConversationMessage = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      attachmentIds: [],
      usage: input.usage,
      createdAt: timestamp,
    };
    const conversation = await reviewDb.aiConversations.get(input.conversationId);
    const nextTitle = conversation?.title === "新对话" && input.role === "user"
      ? previewText(input.content) || "新对话"
      : conversation?.title;
    await reviewDb.transaction("rw", reviewDb.aiConversationMessages, reviewDb.aiConversations, async () => {
      await reviewDb.aiConversationMessages.add(message);
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
