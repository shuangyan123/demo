import { reviewDb } from "../db/review-db.ts";
import type { AutomationDefinition, AutomationRun } from "../types/domains/automation.ts";
import type { AiConversation, AiConversationMessage, AiConversationRunStep, AiProject } from "../types/domains/conversation.ts";
import type { PersistedImportDraft, ImportBatch } from "../types/domains/import.ts";
import type { InterviewEvaluation, InterviewQuestion, InterviewSession, InterviewTurn } from "../types/domains/interview.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { Attempt, Mistake } from "../types/domains/review.ts";
import type { TutoringSession, TutoringTurn } from "../types/domains/tutoring.ts";
import {
  getSampleScenario,
  sampleScenarioDefinitions,
  type SampleScenarioId,
} from "../features/shared/sample-scenario-registry.ts";
import { isSampleRecordId, sampleRecordId } from "./workspace-data-scope.ts";

const SAMPLE_TABLES = [
  reviewDb.mistakes,
  reviewDb.attempts,
  reviewDb.importJobs,
  reviewDb.knowledgeEntries,
  reviewDb.knowledgeAttempts,
  reviewDb.knowledgeMistakeLinks,
  reviewDb.knowledgeInternalizationDrafts,
  reviewDb.importBatches,
  reviewDb.importDrafts,
  reviewDb.interviewQuestions,
  reviewDb.interviewQuestionSets,
  reviewDb.interviewPracticePlans,
  reviewDb.interviewSessions,
  reviewDb.interviewTurns,
  reviewDb.interviewEvaluations,
  reviewDb.interviewLinks,
  reviewDb.tutoringSessions,
  reviewDb.tutoringTurns,
  reviewDb.tutoringPlans,
  reviewDb.tutoringLinks,
  reviewDb.knowledgeEvolutionProposals,
  reviewDb.automationDefinitions,
  reviewDb.automationRuns,
  reviewDb.aiProjects,
  reviewDb.aiConversationFolders,
  reviewDb.aiConversations,
  reviewDb.aiConversationAttachments,
  reviewDb.aiConversationMessages,
  reviewDb.aiConversationRunSteps,
] as const;

const seedEpoch = new Date();
const timestamp = seedEpoch.toISOString();
const reviewDay = timestamp.slice(0, 10);

function relativeTimestamp({ days = 0, minutes = 0 }: { days?: number; minutes?: number } = {}): string {
  return new Date(seedEpoch.getTime() + days * 86_400_000 + minutes * 60_000).toISOString();
}

function id(scenarioId: SampleScenarioId, localId: string): string {
  return sampleRecordId(scenarioId, localId);
}

function coreFixtures(scenarioId: SampleScenarioId) {
  const mistakeId = id(scenarioId, "mistake-necessary-condition");
  const knowledgeId = id(scenarioId, "knowledge-democracy");
  const mistakes: Mistake[] = [
    {
      id: mistakeId,
      board: "判断推理",
      source: "内置 UI 审查数据",
      stem: "若完成调研是制定方案的必要条件，可推出什么？",
      answer: "未完成调研则不能制定方案",
      explanation: "必要条件应使用逆否命题判断。",
      reasons: ["条件关系混淆"],
      tags: ["必要条件"],
      mastery: 1,
      nextReviewAt: reviewDay,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: id(scenarioId, "mistake-growth-rate"),
      board: "资料分析",
      source: "内置 UI 审查数据",
      stem: "已知现期量与增长率，如何计算增长量？",
      answer: "现期量 × 增长率 ÷（1 + 增长率）",
      explanation: "先识别基期与现期，再选择公式。",
      reasons: ["公式选择错误"],
      tags: ["增长量"],
      mastery: 2,
      nextReviewAt: reviewDay,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  const attempts: Attempt[] = [
    { id: id(scenarioId, "attempt-1"), mistakeId, result: "wrong", confidence: 2, durationSec: 78, reviewedAt: relativeTimestamp({ days: -2 }) },
    { id: id(scenarioId, "attempt-2"), mistakeId, result: "correct", confidence: 4, durationSec: 52, reviewedAt: relativeTimestamp({ days: -1 }) },
  ];
  const knowledgeEntries: KnowledgeEntry[] = [{
    id: knowledgeId,
    category: "政治理论",
    title: "全过程人民民主",
    summary: "闭卷回忆核心定义、制度载体与实践要求。",
    content: "全过程人民民主贯穿民主选举、民主协商、民主决策、民主管理、民主监督各环节。",
    tags: ["政治理论", "民主"],
    source: "内置 UI 审查数据",
    favorite: true,
    mastery: 2,
    nextReviewAt: reviewDay,
    reviewCount: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const knowledgeAttempts: KnowledgeAttempt[] = [
    { id: id(scenarioId, "knowledge-attempt-1"), knowledgeId, result: "wrong", confidence: 2, reviewedAt: relativeTimestamp({ days: -1, minutes: 30 }) },
  ];
  return { attempts, knowledgeAttempts, knowledgeEntries, mistakes };
}

function conversationFixtures(scenarioId: SampleScenarioId) {
  const reviewProjectId = id(scenarioId, "project");
  const conversationId = id(scenarioId, "conversation");
  const projects: AiProject[] = [{
    id: reviewProjectId,
    label: "公考 UI 审查数据",
    description: "内置 UI 审查数据",
    studyDomainId: "civil-service",
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const conversations: AiConversation[] = [{
    id: conversationId,
    // 公考是领域注册表中的真实项目入口；审查记录本身仍以稳定前缀隔离和清理。
    projectId: "civil-service",
    studyDomainId: "civil-service",
    title: "必要条件与充分条件",
    kind: "general",
    status: "active",
    sourceType: "manual",
    lastMessagePreview: "用逆否命题快速判断必要条件。",
    messageCount: 12,
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const messages: AiConversationMessage[] = [
    { id: id(scenarioId, "message-1"), conversationId, turnId: id(scenarioId, "turn-1"), sequence: 0, role: "user", content: "如何区分必要条件和充分条件？", attachmentIds: [], createdAt: timestamp },
    { id: id(scenarioId, "message-2"), conversationId, turnId: id(scenarioId, "turn-1"), sequence: 2, role: "assistant", content: "先记住：有它未必行、没它一定不行的是必要条件。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 1 }) },
    { id: id(scenarioId, "message-3"), conversationId, turnId: id(scenarioId, "turn-2"), sequence: 0, role: "user", content: "给我一道可以练习逆否命题的题。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 2 }) },
    { id: id(scenarioId, "message-4"), conversationId, turnId: id(scenarioId, "turn-2"), sequence: 2, role: "assistant", content: "若通过资格审查是进入面试的必要条件，未通过资格审查可以推出什么？", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 3 }) },
    { id: id(scenarioId, "message-5"), conversationId, turnId: id(scenarioId, "turn-3"), sequence: 0, role: "user", content: "必要条件的常见题型陷阱有哪些？", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 4 }) },
    { id: id(scenarioId, "message-6"), conversationId, turnId: id(scenarioId, "turn-3"), sequence: 2, role: "assistant", content: "重点警惕把“只有 A 才 B”误写成 A 推出 B。它表达的是 B 推出 A，再结合逆否命题判断选项。练习时先圈出条件词，再统一改写为箭头关系。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 5 }) },
    { id: id(scenarioId, "message-7"), conversationId, turnId: id(scenarioId, "turn-4"), sequence: 0, role: "user", content: "怎样快速识别“除非”句式？", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 6 }) },
    { id: id(scenarioId, "message-8"), conversationId, turnId: id(scenarioId, "turn-4"), sequence: 2, role: "assistant", content: "“除非 A，否则不 B”可以先还原为“只有 A 才 B”，即 B 推出 A。不要直接按日常语序判断，先做标准化改写会更稳定。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 7 }) },
    { id: id(scenarioId, "message-9"), conversationId, turnId: id(scenarioId, "turn-5"), sequence: 0, role: "user", content: "请给出一套考场上的三步判断法。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 8 }) },
    { id: id(scenarioId, "message-10"), conversationId, turnId: id(scenarioId, "turn-5"), sequence: 2, role: "assistant", content: "第一步识别充分或必要条件词；第二步把自然语言统一写成 A→B；第三步只使用原命题和逆否命题验证选项。遇到否定词时先标记范围，避免否错对象。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 9 }) },
    { id: id(scenarioId, "message-11"), conversationId, turnId: id(scenarioId, "turn-6"), sequence: 0, role: "user", content: "最后帮我总结今天的薄弱点。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 10 }) },
    { id: id(scenarioId, "message-12"), conversationId, turnId: id(scenarioId, "turn-6"), sequence: 2, role: "assistant", content: "今天主要需要巩固两个薄弱点：一是“只有”引导必要条件时箭头方向容易写反；二是含“除非”的句式没有先标准化。下一次先做 5 道条件词改写，再进入选项判断。", attachmentIds: [], createdAt: relativeTimestamp({ minutes: 11 }) },
  ];
  const runSteps: AiConversationRunStep[] = [{
    id: id(scenarioId, "run-step"),
    conversationId,
    runId: id(scenarioId, "turn-1"),
    turnId: id(scenarioId, "turn-1"),
    ordinal: 0,
    visibility: "timeline",
    label: "检索关联错题",
    state: "done",
    text: "找到 2 道关联错题",
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  return { conversations, messages, projects, runSteps };
}

function importFixtures(scenarioId: SampleScenarioId, needsReview: boolean) {
  const batchId = id(scenarioId, "batch");
  const batches: ImportBatch[] = [{
    id: batchId,
    source: "file",
    fileNames: ["2026 行测模考卷.pdf"],
    fileCount: 1,
    status: "parsed",
    parsedCount: 2,
    savedCount: 0,
    message: needsReview ? "检测到 1 条需要人工复核" : "解析完成，等待确认",
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const drafts: PersistedImportDraft[] = [{
    id: id(scenarioId, "draft-1"),
    batchId,
    fileName: "2026 行测模考卷.pdf",
    fileType: "application/pdf",
    selected: true,
    needsReview,
    issues: needsReview ? ["missing_answer"] : [],
    board: "判断推理",
    source: "内置 UI 审查数据",
    stem: needsReview ? "某题目的答案字段未被识别" : "若 A 是 B 的必要条件，下列推理正确的是？",
    options: ["A. 有 A 必有 B", "B. 无 A 则无 B", "C. 有 B 必有 A", "D. 无 B 则无 A"],
    answer: needsReview ? "" : "B",
    myAnswer: "",
    explanation: needsReview ? "请补全答案后再确认。" : "必要条件可通过逆否命题判断。",
    reasons: [],
    tags: ["条件关系"],
    mastery: 0,
    confidence: needsReview ? 0.42 : 0.94,
    rawText: "示例仅保留用于本地 UI 验证的短文本。",
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  return { batches, drafts };
}

function automationFixtures(scenarioId: SampleScenarioId, failed: boolean) {
  const automationId = id(scenarioId, "automation");
  const definitions: AutomationDefinition[] = [{
    id: automationId,
    name: "每日错题复盘建议",
    templateId: "daily_review",
    prompt: "总结今日到期错题",
    sourceScopes: ["mistakes"],
    enabled: true,
    timeZone: "Asia/Shanghai",
    schedule: { kind: "daily", time: "08:30" },
    nextRunAt: relativeTimestamp({ days: 1 }),
    lastRunAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const runs: AutomationRun[] = [{
    id: id(scenarioId, "automation-run"),
    automationId,
    automationName: "每日错题复盘建议",
    status: failed ? "failed" : "succeeded",
    trigger: "scheduled",
    scheduledAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    result: failed ? undefined : "优先复盘判断推理中的必要条件题，并完成 2 条知识训练。",
    error: failed ? "默认文本连接暂不可用" : undefined,
    unread: true,
    missedCount: 0,
    proposalIds: [],
    failureCategory: failed ? "missing_connection" : undefined,
    failureRecoveryAction: failed ? "configure_ai_connection" : undefined,
    contextSummary: [{ scope: "mistakes", label: "错题", count: 2, sampleTitles: ["必要条件判断"] }],
    contextCharCount: 182,
    createdAt: timestamp,
  }];
  return { definitions, runs };
}

function interviewFixtures(scenarioId: SampleScenarioId, state: "active" | "completed" | "cancelled") {
  const questionId = id(scenarioId, "interview-question");
  const sessionId = id(scenarioId, "interview-session");
  const questions: InterviewQuestion[] = [{
    id: questionId,
    type: "structured",
    title: "窗口服务中的群众情绪处理",
    prompt: "基层窗口遇到群众因材料不全情绪激动，你会如何处理？",
    material: "",
    tags: ["应急应变"],
    source: "内置 UI 审查数据",
    difficulty: "medium",
    expectedDurationSec: 180,
    practiceCount: state === "completed" ? 1 : 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const sessions: InterviewSession[] = [{
    id: sessionId,
    questionId,
    type: "structured",
    title: "窗口服务中的群众情绪处理",
    questionPrompt: questions[0].prompt,
    questionMaterial: "",
    status: state === "completed" ? "evaluated" : state === "cancelled" ? "cancelled" : "active",
    stage: state === "completed" ? "evaluated" : "answering",
    startedAt: timestamp,
    completedAt: state === "active" ? undefined : relativeTimestamp({ minutes: 3 }),
    totalDurationSec: 96,
    timerStatus: state === "active" ? "paused" : "finished",
    currentTurnElapsedSec: 42,
    transcriptText: state === "cancelled" ? "" : "我会先稳定群众情绪，再核验材料并提供一次性告知。",
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const turns: InterviewTurn[] = state === "cancelled" ? [] : [{
    id: id(scenarioId, "interview-turn"),
    sessionId,
    speaker: "candidate",
    stage: "answering",
    content: "我会先稳定群众情绪，再核验材料并提供一次性告知。",
    durationSec: 42,
    createdAt: timestamp,
  }];
  const evaluations: InterviewEvaluation[] = state === "completed" ? [{
    id: id(scenarioId, "interview-evaluation"),
    sessionId,
    type: "structured",
    totalScore: 82,
    dimensions: [{ name: "结构", score: 17, maxScore: 20, comment: "层次清晰" }],
    strengths: ["依法依规意识明确"],
    problems: ["回访机制可进一步展开"],
    suggestions: ["补充兜底与回访机制"],
    evidence: ["先安抚情绪，再核验材料"],
    createdAt: timestamp,
    updatedAt: timestamp,
  }] : [];
  return { evaluations, questions, sessions, turns };
}

function tutoringFixtures(scenarioId: SampleScenarioId) {
  const sessionId = id(scenarioId, "tutoring-session");
  const sessions: TutoringSession[] = [{
    id: sessionId,
    mode: "screen",
    topic: "判断推理条件关系专项",
    goal: "用三道递进题巩固充分条件与必要条件",
    status: "active",
    startedAt: timestamp,
    transcriptText: "先把题干写成条件关系。",
    summary: "",
    nextActions: ["完成逆否命题练习"],
    frameCount: 1,
    turnCount: 2,
    estimatedCostNote: "UI 审查数据不调用真实 AI",
    createdAt: timestamp,
    updatedAt: timestamp,
  }];
  const turns: TutoringTurn[] = [{
    id: id(scenarioId, "tutoring-turn"),
    sessionId,
    speaker: "ai_tutor",
    content: "先判断题干中的必要条件，再写出逆否命题。",
    boardNotes: ["必要条件：没它一定不行"],
    nextQuestion: "未通过资格审查能否进入面试？",
    createdAt: timestamp,
  }];
  return { sessions, turns };
}

async function clearSamplesInCurrentTransaction(): Promise<void> {
  for (const table of SAMPLE_TABLES) {
    await table.filter((record: unknown) => {
      const candidate = record as { id?: string };
      return isSampleRecordId(candidate.id);
    }).delete();
  }
}

export const sampleScenarioRepository = {
  async clearAll(): Promise<void> {
    await reviewDb.transaction("rw", [...SAMPLE_TABLES], clearSamplesInCurrentTransaction);
  },

  async countAll(): Promise<number> {
    const counts = await Promise.all(SAMPLE_TABLES.map((table) => table.filter((record: unknown) => {
      const candidate = record as { id?: string };
      return isSampleRecordId(candidate.id);
    }).count()));
    return counts.reduce((total, count) => total + count, 0);
  },

  async seedAll(): Promise<void> {
    for (const scenario of sampleScenarioDefinitions) await this.seed(scenario.id);
  },

  async seed(scenarioId: SampleScenarioId): Promise<void> {
    const scenario = getSampleScenario(scenarioId);
    if (!scenario) throw new Error("未知示例场景");
    await reviewDb.transaction("rw", [...SAMPLE_TABLES], async () => {
      const core = coreFixtures(scenarioId);
      await reviewDb.mistakes.bulkPut(core.mistakes);
      await reviewDb.attempts.bulkPut(core.attempts);
      await reviewDb.knowledgeEntries.bulkPut(core.knowledgeEntries);
      await reviewDb.knowledgeAttempts.bulkPut(core.knowledgeAttempts);

      if (scenario.view === "conversation" || scenario.view === "tutoring") {
        const fixture = conversationFixtures(scenarioId);
        await reviewDb.aiProjects.bulkPut(fixture.projects);
        await reviewDb.aiConversations.bulkPut(fixture.conversations);
        await reviewDb.aiConversationMessages.bulkPut(fixture.messages);
        await reviewDb.aiConversationRunSteps.bulkPut(fixture.runSteps);
      }
      if (scenario.view === "import") {
        const fixture = importFixtures(scenarioId, scenario.variant === "needs-review");
        await reviewDb.importBatches.bulkPut(fixture.batches);
        await reviewDb.importDrafts.bulkPut(fixture.drafts);
      }
      if (scenario.view === "automation") {
        const fixture = automationFixtures(scenarioId, scenario.variant === "failed");
        await reviewDb.automationDefinitions.bulkPut(fixture.definitions);
        await reviewDb.automationRuns.bulkPut(fixture.runs);
      }
      if (scenario.view === "interview") {
        const fixture = interviewFixtures(scenarioId, scenario.variant as "active" | "completed" | "cancelled");
        await reviewDb.interviewQuestions.bulkPut(fixture.questions);
        await reviewDb.interviewSessions.bulkPut(fixture.sessions);
        await reviewDb.interviewTurns.bulkPut(fixture.turns);
        await reviewDb.interviewEvaluations.bulkPut(fixture.evaluations);
      }
      if (scenario.view === "tutoring") {
        const fixture = tutoringFixtures(scenarioId);
        await reviewDb.tutoringSessions.bulkPut(fixture.sessions);
        await reviewDb.tutoringTurns.bulkPut(fixture.turns);
      }
    });
  },
};
