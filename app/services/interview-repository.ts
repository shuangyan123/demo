import { reviewDb } from "../db/review-db.ts";
import { normalizeInterviewTimer } from "./interview-timer.ts";
import type { InterviewEvaluation, InterviewLink, InterviewLinkSourceType, InterviewPracticePlan, InterviewQuestion, InterviewQuestionSet, InterviewSession, InterviewSnapshot, InterviewStage, InterviewTurn, InterviewType } from "../types/domains/interview.ts";

type NewQuestionInput = Omit<InterviewQuestion, "id" | "createdAt" | "updatedAt">;
type NewQuestionSetInput = Omit<InterviewQuestionSet, "id" | "createdAt" | "updatedAt">;
type NewPracticePlanInput = Omit<InterviewPracticePlan, "id" | "createdAt" | "updatedAt">;
type NewTurnInput = Omit<InterviewTurn, "id" | "createdAt">;
type EvaluationInput = Omit<InterviewEvaluation, "id" | "createdAt" | "updatedAt">;
type LinkInput = Omit<InterviewLink, "id" | "createdAt" | "updatedAt">;

// 生成带时间的 ISO 字符串；面试会话需要精确到秒，用于排序和计时复盘。
function nowISO() {
  return new Date().toISOString();
}

// 去掉重复和空值，题组与计划都依赖这个工具保存题目 ID 列表。
function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

// 计算下一次训练日期；计划完成一场后默认隔一天提醒，避免过度频繁。
function nextPracticeISO() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}

// 根据面试类型确定首个真实流程阶段，避免 UI 和数据层各自硬编码。
function initialStageForType(type: InterviewType): InterviewStage {
  if (type === "leaderless_group") return "preparation";
  return "briefing";
}

export const interviewRepository = {
  // 一次性读取面试模块完整快照，供工作台刷新时集中同步。
  async loadSnapshot(): Promise<InterviewSnapshot> {
    const [questions, questionSets, practicePlans, sessions, turns, evaluations, links] = await Promise.all([
      reviewDb.interviewQuestions.orderBy("updatedAt").reverse().toArray(),
      reviewDb.interviewQuestionSets.orderBy("updatedAt").reverse().toArray(),
      reviewDb.interviewPracticePlans.orderBy("updatedAt").reverse().toArray(),
      reviewDb.interviewSessions.orderBy("updatedAt").reverse().toArray(),
      reviewDb.interviewTurns.orderBy("createdAt").toArray(),
      reviewDb.interviewEvaluations.orderBy("updatedAt").reverse().toArray(),
      reviewDb.interviewLinks.orderBy("updatedAt").reverse().toArray(),
    ]);
    return { questions, questionSets, practicePlans, sessions: sessions.map((session) => normalizeInterviewTimer(session)), turns, evaluations, links };
  },

  // 新增一道面试题，只保存题目、材料和标签，不自动创建练习记录。
  async addQuestion(input: NewQuestionInput): Promise<InterviewQuestion> {
    const now = nowISO();
    const question: InterviewQuestion = {
      ...input,
      favorite: input.favorite ?? false,
      practiceCount: input.practiceCount ?? 0,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.interviewQuestions.add(question);
    return question;
  },

  // 批量写入 AI 生成或草稿确认后的面试题，所有题目默认不创建会话。
  async bulkAddQuestions(inputs: NewQuestionInput[]): Promise<InterviewQuestion[]> {
    if (!inputs.length) return [];
    const baseTime = Date.now();
    // Dexie 对相同索引键不保证跨平台顺序；微小时间差使批量输入顺序在 updatedAt 倒序读取时保持稳定。
    const questions = inputs.map((input, index) => {
      const timestamp = new Date(baseTime - index).toISOString();
      return {
        ...input,
        favorite: input.favorite ?? false,
        practiceCount: input.practiceCount ?? 0,
        id: crypto.randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });
    await reviewDb.interviewQuestions.bulkAdd(questions);
    return questions;
  },

  // 更新面试题基础信息，保留已有历史会话中的题目快照不变。
  async updateQuestion(id: string, patch: Partial<NewQuestionInput>): Promise<void> {
    await reviewDb.interviewQuestions.update(id, { ...patch, updatedAt: nowISO() });
  },

  // 切换题目收藏状态，收藏只影响题库筛选，不改变历史会话。
  async toggleQuestionFavorite(question: InterviewQuestion): Promise<void> {
    await reviewDb.interviewQuestions.update(question.id, {
      favorite: !question.favorite,
      updatedAt: nowISO(),
    });
  },

  // 删除面试题并清理以题目为来源的关联，同时从题组和训练计划中移除引用。
  async removeQuestion(id: string): Promise<void> {
    await reviewDb.transaction("rw", reviewDb.interviewQuestions, reviewDb.interviewQuestionSets, reviewDb.interviewPracticePlans, reviewDb.interviewLinks, async () => {
      const [sets, plans] = await Promise.all([
        reviewDb.interviewQuestionSets.filter((set) => set.questionIds.includes(id)).toArray(),
        reviewDb.interviewPracticePlans.filter((plan) => plan.questionIds.includes(id)).toArray(),
      ]);
      await reviewDb.interviewQuestions.delete(id);
      await reviewDb.interviewLinks.where("sourceType").equals("question").and((link) => link.sourceId === id).delete();
      if (sets.length) {
        await reviewDb.interviewQuestionSets.bulkPut(sets.map((set) => ({ ...set, questionIds: set.questionIds.filter((questionId) => questionId !== id), updatedAt: nowISO() })));
      }
      if (plans.length) {
        await reviewDb.interviewPracticePlans.bulkPut(plans.map((plan) => ({ ...plan, questionIds: plan.questionIds.filter((questionId) => questionId !== id), updatedAt: nowISO() })));
      }
    });
  },

  // 新建题组，题组只保存题目 ID 快照，题目详情仍以题库为准。
  async addQuestionSet(input: NewQuestionSetInput): Promise<InterviewQuestionSet> {
    const now = nowISO();
    const set: InterviewQuestionSet = {
      ...input,
      questionIds: uniqueIds(input.questionIds),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.interviewQuestionSets.add(set);
    return set;
  },

  // 更新题组标题、说明、标签或题目列表，用于后续训练计划复用。
  async updateQuestionSet(id: string, patch: Partial<NewQuestionSetInput>): Promise<void> {
    await reviewDb.interviewQuestionSets.update(id, {
      ...patch,
      questionIds: patch.questionIds ? uniqueIds(patch.questionIds) : undefined,
      updatedAt: nowISO(),
    });
  },

  // 删除题组并把引用它的训练计划降级为普通计划，保留计划中的题目 ID。
  async removeQuestionSet(id: string): Promise<void> {
    await reviewDb.transaction("rw", reviewDb.interviewQuestionSets, reviewDb.interviewPracticePlans, async () => {
      const plans = await reviewDb.interviewPracticePlans.where("sourceSetId").equals(id).toArray();
      await reviewDb.interviewQuestionSets.delete(id);
      if (plans.length) {
        await reviewDb.interviewPracticePlans.bulkPut(plans.map((plan) => ({ ...plan, sourceSetId: undefined, updatedAt: nowISO() })));
      }
    });
  },

  // 新建训练计划，计划只记录题目 ID 和完成进度，不复制题目正文。
  async addPracticePlan(input: NewPracticePlanInput): Promise<InterviewPracticePlan> {
    const now = nowISO();
    const plan: InterviewPracticePlan = {
      ...input,
      questionIds: uniqueIds(input.questionIds),
      completedSessionCount: input.completedSessionCount ?? 0,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.interviewPracticePlans.add(plan);
    return plan;
  },

  // 更新训练计划进度、状态、题目列表或下次训练日期。
  async updatePracticePlan(id: string, patch: Partial<NewPracticePlanInput>): Promise<void> {
    await reviewDb.interviewPracticePlans.update(id, {
      ...patch,
      questionIds: patch.questionIds ? uniqueIds(patch.questionIds) : undefined,
      updatedAt: nowISO(),
    });
  },

  // 删除训练计划，历史会话保留但解除 planId，避免复盘记录丢失。
  async removePracticePlan(id: string): Promise<void> {
    await reviewDb.transaction("rw", reviewDb.interviewPracticePlans, reviewDb.interviewSessions, async () => {
      const sessions = await reviewDb.interviewSessions.where("planId").equals(id).toArray();
      await reviewDb.interviewPracticePlans.delete(id);
      if (sessions.length) {
        await reviewDb.interviewSessions.bulkPut(sessions.map((session) => ({ ...session, planId: undefined, updatedAt: nowISO() })));
      }
    });
  },

  // 基于题目创建一场面试会话，会话中保留题目快照，后续题库编辑不会影响历史记录。
  async createSession(question: InterviewQuestion, planId?: string): Promise<InterviewSession> {
    const now = nowISO();
    const session: InterviewSession = {
      id: crypto.randomUUID(),
      questionId: question.id,
      planId,
      type: question.type,
      title: question.title,
      questionPrompt: question.prompt,
      questionMaterial: question.material,
      status: "active",
      stage: initialStageForType(question.type),
      startedAt: now,
      totalDurationSec: 0,
      timerStatus: "running",
      currentTurnElapsedSec: 0,
      currentTurnStartedAt: now,
      transcriptText: "",
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.transaction("rw", reviewDb.interviewSessions, reviewDb.interviewQuestions, async () => {
      await reviewDb.interviewSessions.add(session);
      await reviewDb.interviewQuestions.update(question.id, {
        lastPracticedAt: now,
        practiceCount: (question.practiceCount ?? 0) + 1,
        updatedAt: now,
      });
    });
    return session;
  },

  // 更新会话阶段、状态、文字稿或耗时；不接收音频数据，保持隐私边界清晰。
  async updateSession(id: string, patch: Partial<Omit<InterviewSession, "id" | "createdAt">>): Promise<void> {
    await reviewDb.interviewSessions.update(id, { ...patch, updatedAt: nowISO() });
  },

  // 写入一轮面试对话，包括 AI 面试官、AI 同组考生和用户作答文本。
  async addTurn(input: NewTurnInput): Promise<InterviewTurn> {
    const turn: InterviewTurn = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: nowISO(),
    };
    await reviewDb.interviewTurns.add(turn);
    return turn;
  },

  // 保存最终评分并把会话标记为已完成；同一会话重新评分时覆盖旧评分。
  async saveEvaluation(input: EvaluationInput): Promise<InterviewEvaluation> {
    const now = nowISO();
    const evaluation: InterviewEvaluation = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.transaction("rw", reviewDb.interviewSessions, reviewDb.interviewEvaluations, reviewDb.interviewPracticePlans, async () => {
      const session = await reviewDb.interviewSessions.get(input.sessionId);
      await reviewDb.interviewEvaluations.where("sessionId").equals(input.sessionId).delete();
      await reviewDb.interviewEvaluations.add(evaluation);
      await reviewDb.interviewSessions.update(input.sessionId, {
        status: "evaluated",
        stage: "evaluated",
        completedAt: now,
        timerStatus: "finished",
        currentTurnStartedAt: undefined,
        updatedAt: now,
      });
      if (session?.planId) {
        const plan = await reviewDb.interviewPracticePlans.get(session.planId);
        if (plan) {
          const completedSessionCount = Math.min(plan.targetSessionCount, plan.completedSessionCount + 1);
          await reviewDb.interviewPracticePlans.update(plan.id, {
            completedSessionCount,
            nextPracticeAt: nextPracticeISO(),
            status: completedSessionCount >= plan.targetSessionCount ? "completed" : plan.status,
            updatedAt: now,
          });
        }
      }
    });
    return evaluation;
  },

  // 删除一场会话，同时清理对话轮次、评分结果和以会话为来源的关联。
  async removeSession(id: string): Promise<void> {
    await reviewDb.transaction("rw", reviewDb.interviewSessions, reviewDb.interviewTurns, reviewDb.interviewEvaluations, reviewDb.interviewLinks, async () => {
      await reviewDb.interviewSessions.delete(id);
      await reviewDb.interviewTurns.where("sessionId").equals(id).delete();
      await reviewDb.interviewEvaluations.where("sessionId").equals(id).delete();
      await reviewDb.interviewLinks.where("sourceType").equals("session").and((link) => link.sourceId === id).delete();
    });
  },

  // 保存用户确认后的面试双向关联，目标只能是已有知识资料或错题。
  async addLink(input: LinkInput): Promise<InterviewLink> {
    const now = nowISO();
    const link: InterviewLink = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await reviewDb.interviewLinks.add(link);
    return link;
  },

  // 删除单条面试关联；调用方决定刷新哪一个详情面板。
  async removeLink(id: string): Promise<void> {
    await reviewDb.interviewLinks.delete(id);
  },

  // 根据来源清理面试关联，供批量删除题目或会话时复用。
  async removeLinksForSource(sourceType: InterviewLinkSourceType, sourceIds: string[]): Promise<void> {
    if (!sourceIds.length) return;
    await reviewDb.interviewLinks.filter((link) => link.sourceType === sourceType && sourceIds.includes(link.sourceId)).delete();
  },
};
