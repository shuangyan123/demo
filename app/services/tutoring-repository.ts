import { reviewDb } from "../db/review-db.ts";
import type {
  TutoringLink,
  TutoringLinkSourceType,
  TutoringPlan,
  TutoringSession,
  TutoringSnapshot,
  TutoringTurn,
} from "../types/review.ts";

type NewTutoringSessionInput = Pick<TutoringSession, "goal" | "mode" | "topic">;
type NewTutoringTurnInput = Omit<TutoringTurn, "id" | "createdAt">;
type NewTutoringPlanInput = Omit<TutoringPlan, "id" | "createdAt" | "updatedAt">;
type NewTutoringLinkInput = Omit<TutoringLink, "id" | "createdAt" | "updatedAt">;

/** 仓储边界拒绝任何原始媒体引用，避免未来调用方误把帧写进现有表。 */
function assertNoMediaPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/data:(?:image|audio|video)\//i.test(serialized) || /blob:/i.test(serialized)) {
    throw new Error("辅导仓储禁止持久化原始音视频或关键帧");
  }
}

// 生成统一 ISO 时间戳，辅导会话、计划和关联都用它保持排序一致。
function nowISO() {
  return new Date().toISOString();
}

// 清洗 ID 列表，防止计划里出现空 ID 或重复 ID。
function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

// 追加文字稿时带上角色前缀，便于复盘记录直接阅读。
function formatTranscriptLine(turn: NewTutoringTurnInput) {
  const label = turn.speaker === "student" ? "学生" : turn.speaker === "ai_tutor" ? "AI 老师" : "系统";
  return `${label}：${turn.content}`;
}

// 辅导模块仓储只持久化文字、摘要和确认式关联，不接收或保存原始音视频。
export const tutoringRepository = {
  // 一次性读取辅导模块快照，供工作台刷新和记录页使用。
  async loadSnapshot(): Promise<TutoringSnapshot> {
    const [sessions, turns, plans, links] = await Promise.all([
      reviewDb.tutoringSessions.orderBy("updatedAt").reverse().toArray(),
      reviewDb.tutoringTurns.orderBy("createdAt").toArray(),
      reviewDb.tutoringPlans.orderBy("updatedAt").reverse().toArray(),
      reviewDb.tutoringLinks.orderBy("updatedAt").reverse().toArray(),
    ]);
    return { links, plans, sessions, turns };
  },

  // 创建一场实时辅导会话；默认状态为 active，媒体权限和采样状态由前端 hook 管理。
  async createSession(input: NewTutoringSessionInput): Promise<TutoringSession> {
    const now = nowISO();
    const session: TutoringSession = {
      ...input,
      completedAt: undefined,
      createdAt: now,
      estimatedCostNote: "低频采样，未保存原始音视频",
      frameCount: 0,
      id: crypto.randomUUID(),
      nextActions: [],
      startedAt: now,
      status: "active",
      summary: "",
      transcriptText: "",
      turnCount: 0,
      updatedAt: now,
    };
    await reviewDb.tutoringSessions.add(session);
    return session;
  },

  // 更新会话状态、摘要或目标；调用方不能通过这里写入媒体 Blob。
  async updateSession(id: string, patch: Partial<Omit<TutoringSession, "id" | "createdAt">>): Promise<void> {
    await reviewDb.tutoringSessions.update(id, { ...patch, updatedAt: nowISO() });
  },

  // 写入一轮辅导文本；如果包含画面描述，只计入 frameCount，不保存原始帧。
  async addTurn(input: NewTutoringTurnInput): Promise<TutoringTurn> {
    assertNoMediaPayload(input);
    const turn: TutoringTurn = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: nowISO(),
    };
    await reviewDb.transaction("rw", reviewDb.tutoringSessions, reviewDb.tutoringTurns, async () => {
      const session = await reviewDb.tutoringSessions.get(input.sessionId);
      await reviewDb.tutoringTurns.add(turn);
      if (session) {
        const transcriptText = [session.transcriptText, formatTranscriptLine(input)].filter(Boolean).join("\n");
        await reviewDb.tutoringSessions.update(input.sessionId, {
          frameCount: session.frameCount + (input.frameDescription ? 1 : 0),
          transcriptText,
          turnCount: session.turnCount + 1,
          updatedAt: nowISO(),
        });
      }
    });
    return turn;
  },

  /** 更新反馈、微测或观察摘要；仍通过同一媒体保护边界。 */
  async updateTurn(id: string, patch: Partial<Omit<TutoringTurn, "id" | "sessionId" | "createdAt">>): Promise<void> {
    assertNoMediaPayload(patch);
    await reviewDb.tutoringTurns.update(id, patch);
  },

  /** 保存单轮帮助反馈，供本地试点指标计算。 */
  async setTurnHelpful(id: string, helpful: boolean): Promise<void> {
    await reviewDb.tutoringTurns.update(id, { helpful });
  },

  /** 保存整场帮助反馈；不触发外部请求。 */
  async setSessionHelpful(id: string, helpful: boolean): Promise<void> {
    await reviewDb.tutoringSessions.update(id, { helpful, updatedAt: nowISO() });
  },

  /**
   * 提交确定性单选微测并创建间隔复习任务。
   * 掌握状态只来自用户选择与正确答案比较，不读取模型置信度。
   */
  async completeMicroAssessment(turnId: string, selections: number[], today = new Date()): Promise<{ correctCount: number; total: number; nextPracticeAt: string }> {
    const turn = await reviewDb.tutoringTurns.get(turnId);
    const assessment = turn?.microAssessment;
    if (!turn || !assessment?.questions.length) throw new Error("未找到可提交的本轮微测");
    if (selections.length !== assessment.questions.length) throw new Error("请完成全部微测题目后再提交");
    const normalized = selections.map((value, index) => {
      const optionCount = assessment.questions[index]?.options.length ?? 0;
      if (!Number.isInteger(value) || value < 0 || value >= optionCount) throw new Error("微测选项无效，请重新选择");
      return value;
    });
    const correctCount = assessment.questions.reduce((count, question, index) => count + (normalized[index] === question.correctOptionIndex ? 1 : 0), 0);
    const ratio = correctCount / assessment.questions.length;
    const nextPractice = new Date(today);
    nextPractice.setDate(nextPractice.getDate() + (ratio === 1 ? 7 : ratio >= 0.5 ? 3 : 1));
    const nextPracticeAt = nextPractice.toISOString();
    const session = await reviewDb.tutoringSessions.get(turn.sessionId);
    const existingPlan = await reviewDb.tutoringPlans.get(`auto:${turn.sessionId}`);
    const incorrect = assessment.questions.filter((question, index) => normalized[index] !== question.correctOptionIndex);
    const nextTask = incorrect.length
      ? `复习并重新回答：${incorrect.map((item) => item.prompt).join("；").slice(0, 220)}`
      : "使用一道新题再次检验本轮知识，确认不是短期记忆。";
    const completedAt = today.toISOString();
    await reviewDb.transaction("rw", reviewDb.tutoringTurns, reviewDb.tutoringPlans, async () => {
      await reviewDb.tutoringTurns.update(turnId, {
        microAssessment: { ...assessment, selections: normalized, correctCount, completedAt },
      });
      const plan: TutoringPlan = {
        id: `auto:${turn.sessionId}`,
        title: session?.topic ? `${session.topic} · 间隔复练` : "辅导微测间隔复练",
        objective: session?.goal || "通过可观察微测巩固本轮辅导内容。",
        linkedKnowledgeIds: existingPlan?.linkedKnowledgeIds ?? [],
        linkedMistakeIds: existingPlan?.linkedMistakeIds ?? [],
        nextTask,
        nextPracticeAt,
        status: "active",
        createdAt: existingPlan?.createdAt ?? completedAt,
        updatedAt: completedAt,
      };
      await reviewDb.tutoringPlans.put(plan);
    });
    return { correctCount, total: assessment.questions.length, nextPracticeAt };
  },

  // 完成会话时只保存摘要和下一步行动，不保存本次辅导的连续画面。
  async completeSession(id: string, input: { nextActions: string[]; summary: string }): Promise<void> {
    await reviewDb.tutoringSessions.update(id, {
      completedAt: nowISO(),
      nextActions: input.nextActions,
      status: "completed",
      summary: input.summary,
      updatedAt: nowISO(),
    });
  },

  // 删除会话并同步清理文字轮次和以会话为来源的关联。
  async removeSession(id: string): Promise<void> {
    await reviewDb.transaction("rw", reviewDb.tutoringSessions, reviewDb.tutoringTurns, reviewDb.tutoringLinks, async () => {
      await reviewDb.tutoringSessions.delete(id);
      await reviewDb.tutoringTurns.where("sessionId").equals(id).delete();
      await reviewDb.tutoringLinks.where("[sourceType+sourceId]").equals(["session", id]).delete();
    });
  },

  // 创建辅导计划，计划只引用本地知识和错题 ID，便于后续双向跳转。
  async addPlan(input: NewTutoringPlanInput): Promise<TutoringPlan> {
    const now = nowISO();
    const plan: TutoringPlan = {
      ...input,
      createdAt: now,
      id: crypto.randomUUID(),
      linkedKnowledgeIds: uniqueIds(input.linkedKnowledgeIds),
      linkedMistakeIds: uniqueIds(input.linkedMistakeIds),
      updatedAt: now,
    };
    await reviewDb.tutoringPlans.add(plan);
    return plan;
  },

  // 更新辅导计划状态或任务安排，保留已有创建时间。
  async updatePlan(id: string, patch: Partial<NewTutoringPlanInput>): Promise<void> {
    await reviewDb.tutoringPlans.update(id, {
      ...patch,
      linkedKnowledgeIds: patch.linkedKnowledgeIds ? uniqueIds(patch.linkedKnowledgeIds) : undefined,
      linkedMistakeIds: patch.linkedMistakeIds ? uniqueIds(patch.linkedMistakeIds) : undefined,
      updatedAt: nowISO(),
    });
  },

  // 删除计划并清理以计划为来源的关联。
  async removePlan(id: string): Promise<void> {
    await reviewDb.transaction("rw", reviewDb.tutoringPlans, reviewDb.tutoringLinks, async () => {
      await reviewDb.tutoringPlans.delete(id);
      await reviewDb.tutoringLinks.where("[sourceType+sourceId]").equals(["plan", id]).delete();
    });
  },

  // 保存用户确认后的辅导关联；目标只能是本地知识资料或错题。
  async addLink(input: NewTutoringLinkInput): Promise<TutoringLink> {
    const now = nowISO();
    const link: TutoringLink = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.tutoringLinks.add(link);
    return link;
  },

  // 删除单条辅导关联。
  async removeLink(id: string): Promise<void> {
    await reviewDb.tutoringLinks.delete(id);
  },

  // 批量清理某类来源关联，供删除会话、轮次或计划时复用。
  async removeLinksForSource(sourceType: TutoringLinkSourceType, sourceIds: string[]): Promise<void> {
    if (!sourceIds.length) return;
    await reviewDb.tutoringLinks.filter((link) => link.sourceType === sourceType && sourceIds.includes(link.sourceId)).delete();
  },
};
