"use client";

import { useMemo, useState } from "react";
import { AutomationView } from "../automation/automation-view";
import type { AutomationCenter } from "../automation/use-automation-center.ts";
import { DashboardView } from "../review/review-dashboard-view";
import { ReviewView } from "../review/review-session-view";
import { StatsView } from "../review/review-stats-view";
import { KnowledgeTrainingView } from "../knowledge/knowledge-training-view";
import { InterviewSessionPanel } from "../interview/interview-session-panel";
import type { useInterviewSpeech } from "../interview/use-interview-speech.ts";
import type { AutomationDefinition, AutomationRun } from "../../types/domains/automation.ts";
import type { InterviewSession, InterviewTurn } from "../../types/domains/interview.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import { Button, Chip } from "./ui-primitives";
import { DevelopmentExampleSwitcher } from "./development-example-switcher";
import {
  developmentExamplesForValue,
  developmentExampleDefinition,
  type WorkspaceDevelopmentExampleId,
} from "./development-example-registry";
import styles from "./development-example-workspace.module.css";

type ExampleRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  tone: "neutral" | "green" | "yellow" | "red";
};

type ExampleDefinition = {
  title: string;
  description: string;
  metrics: Array<[string, string, string]>;
  listTitle: string;
  rows: ExampleRow[];
  detailTitle: string;
  detail: string;
  notice?: string;
  primaryAction: string;
};

const definitions: Record<string, ExampleDefinition> = {
  "dashboard-populated": {
    title: "总览",
    description: "真实总览组件中的今日队列与薄弱板块均由内存 fixture 填充。",
    metrics: [],
    listTitle: "今日队列",
    rows: [],
    detailTitle: "薄弱板块",
    detail: "",
    primaryAction: "开始复盘",
  },
  "conversation-populated": {
    title: "AI 对话",
    description: "展示已有用户消息、回答和折叠工具结果。",
    metrics: [["消息", "8", "本轮 3 条"], ["工具步骤", "2", "结果已脱敏"], ["关联知识", "4", "仅摘要"], ["上下文", "1,128", "字符"]],
    listTitle: "对话时间线",
    rows: [
      { id: "user", title: "我总是混淆必要条件和充分条件", description: "用户 · 10:18", status: "已发送", tone: "neutral" },
      { id: "tool", title: "已运行 2 条命令", description: "检索错题与关联知识摘要", status: "已折叠", tone: "green" },
      { id: "assistant", title: "先用“有它未必行，没它一定不行”判断必要条件", description: "AI · 10:19", status: "已完成", tone: "green" },
    ],
    detailTitle: "关联内容",
    detail: "已找到 3 道同类错题和 1 条判断推理知识。示例只保留标题与摘要，不包含真实上下文。",
    primaryAction: "继续追问",
  },
  "library-populated": {
    title: "错题库",
    description: "展示非空列表、筛选结果与选中题目详情。",
    metrics: [["错题", "128", "当前筛选 18"], ["待复盘", "12", "今日到期"], ["低掌握", "7", "优先处理"], ["已关联", "93%", "知识覆盖率"]],
    listTitle: "判断推理 · 当前筛选",
    rows: [
      { id: "logic-1", title: "必要条件假言推理", description: "错因：条件关系混淆 · 错 3 次", status: "掌握 2/5", tone: "yellow" },
      { id: "logic-2", title: "图形推理中的数量规律", description: "错因：观察维度遗漏 · 错 2 次", status: "掌握 3/5", tone: "neutral" },
      { id: "logic-3", title: "加强型论证题", description: "错因：未定位论证缺口 · 错 2 次", status: "待关联", tone: "red" },
    ],
    detailTitle: "必要条件假言推理",
    detail: "已关联“充分条件与必要条件”知识条目，并生成下次复盘提示：先写出逆否命题，再判断选项。",
    primaryAction: "进入复盘",
  },
  "review-populated": {
    title: "开始复盘",
    description: "展示到期错题队列、当前题目和暂停计时状态。",
    metrics: [["待复盘", "12", "今天到期"], ["当前序号", "3 / 12", "判断推理"], ["计时", "00:00", "默认暂停"], ["低掌握", "7", "优先处理"]],
    listTitle: "今日复盘队列",
    rows: [
      { id: "review-1", title: "必要条件假言推理", description: "判断推理 · 错 3 次", status: "当前题", tone: "yellow" },
      { id: "review-2", title: "增长率与增长量辨析", description: "资料分析 · 错 2 次", status: "待复盘", tone: "neutral" },
      { id: "review-3", title: "行政处罚的适用条件", description: "常识判断 · 错 2 次", status: "待复盘", tone: "neutral" },
    ],
    detailTitle: "必要条件假言推理",
    detail: "先写出题干的条件关系和逆否命题，再判断选项。手动进入或切题后计时保持暂停，不会自动开始。",
    primaryAction: "记录结果",
  },
  "knowledge-populated": {
    title: "知识库",
    description: "展示知识条目、来源和关联错题。",
    metrics: [["知识条目", "64", "本周新增 6"], ["待训练", "8", "今天到期"], ["关联错题", "119", "平均 1.9 条"], ["待确认提案", "3", "需人工确认"]],
    listTitle: "政治理论 · 知识条目",
    rows: [
      { id: "knowledge-1", title: "新发展理念", description: "来源 4 · 关联错题 6", status: "掌握 4/5", tone: "green" },
      { id: "knowledge-2", title: "全过程人民民主", description: "来源 3 · 关联错题 2", status: "待训练", tone: "yellow" },
      { id: "knowledge-3", title: "依法治国的基本要求", description: "来源 2 · 关联错题 5", status: "已同步", tone: "green" },
    ],
    detailTitle: "新发展理念",
    detail: "创新、协调、绿色、开放、共享。当前条目关联 6 道错题，并保留 4 个脱敏来源引用。",
    primaryAction: "开始训练",
  },
  "knowledge-training-populated": {
    title: "知识训练",
    description: "展示到期知识队列、当前训练卡片和掌握度操作。",
    metrics: [["到期知识", "8", "今天训练"], ["当前序号", "2 / 8", "政治理论"], ["平均掌握", "3.7 / 5", "近 30 天"], ["收藏", "6", "重点回看"]],
    listTitle: "到期训练队列",
    rows: [
      { id: "training-1", title: "新发展理念", description: "政治理论 · 关联错题 6", status: "掌握 4/5", tone: "green" },
      { id: "training-2", title: "全过程人民民主", description: "政治理论 · 关联错题 2", status: "当前卡片", tone: "yellow" },
      { id: "training-3", title: "行政复议受案范围", description: "常识判断 · 关联错题 4", status: "待训练", tone: "neutral" },
    ],
    detailTitle: "全过程人民民主",
    detail: "先回忆核心定义和制度载体，再展开答案。训练结果只在用户选择掌握度后记录。",
    primaryAction: "记录掌握度",
  },
  "import-populated": {
    title: "导入资料",
    description: "展示已解析草稿、识别结果和主要操作。",
    metrics: [["草稿", "18", "固定示例数据"], ["已识别", "16", "89%"], ["需检查", "2", "字段不完整"], ["重复项", "1", "不会自动写入"]],
    listTitle: "本次解析结果",
    rows: [
      { id: "import-1", title: "2026 行测模考卷 · 第 18 题", description: "判断推理 · 答案 B", status: "可导入", tone: "green" },
      { id: "import-2", title: "2026 行测模考卷 · 第 19 题", description: "资料分析 · 答案 D", status: "可导入", tone: "green" },
      { id: "import-3", title: "未命名题目 · 第 20 题", description: "缺少解析字段", status: "需检查", tone: "yellow" },
    ],
    detailTitle: "第 18 题解析草稿",
    detail: "题干、选项、答案与解析均已识别。确认前不会写入错题库，也不会访问文件系统或外部服务。",
    primaryAction: "确认选中项",
  },
  "import-needs-review": {
    title: "导入资料",
    description: "展示结构变化后的人工复核状态。",
    metrics: [["草稿", "12", "等待确认"], ["可导入", "7", "字段完整"], ["需检查", "5", "结构异常"], ["已写入", "0", "确认前保持草稿"]],
    listTitle: "需要人工确认",
    rows: [
      { id: "review-1", title: "题目 07 · 选项识别异常", description: "检测到 5 个选项", status: "需检查", tone: "yellow" },
      { id: "review-2", title: "题目 09 · 答案缺失", description: "解析中未找到标准答案", status: "阻止导入", tone: "red" },
      { id: "review-3", title: "题目 12 · 疑似重复", description: "与错题库已有内容相似", status: "需合并", tone: "yellow" },
    ],
    detailTitle: "题目 09 · 答案缺失",
    detail: "该条目不会自动写入。请补全答案或从本次草稿中移除，再重新执行确认。",
    notice: "检测到来源结构变化，5 条草稿必须人工复核。",
    primaryAction: "补全字段",
  },
  "automation-populated": {
    title: "已安排",
    description: "展示启用的本地任务、下次运行和收件箱。",
    metrics: [["任务", "4", "3 个已启用"], ["今日运行", "6", "全部完成"], ["收件箱", "2", "等待查看"], ["下次运行", "14:30", "应用打开时"]],
    listTitle: "本地任务",
    rows: [
      { id: "auto-1", title: "每日错题复盘建议", description: "每天 08:30 · 默认文本连接", status: "已启用", tone: "green" },
      { id: "auto-2", title: "知识演进候选", description: "每周一 09:00 · 仅生成待确认提案", status: "已启用", tone: "green" },
      { id: "auto-3", title: "学习周报摘要", description: "每周日 20:00", status: "已暂停", tone: "neutral" },
    ],
    detailTitle: "每日错题复盘建议",
    detail: "仅在应用打开时执行。最近一次运行读取 12 条本地摘要，生成 3 条建议，未自动修改知识库。",
    primaryAction: "查看最近运行",
  },
  "automation-run-failed": {
    title: "已安排",
    description: "展示失败分类、恢复动作和保留的上次状态。",
    metrics: [["任务", "4", "3 个已启用"], ["失败", "1", "需要处理"], ["收件箱", "3", "含失败详情"], ["下次运行", "明天 08:30", "已正常推进"]],
    listTitle: "运行收件箱",
    rows: [
      { id: "failed-1", title: "每日错题复盘建议", description: "今天 08:30 · 默认文本连接不可用", status: "运行失败", tone: "red" },
      { id: "failed-2", title: "知识演进候选", description: "昨天 09:00 · 生成 2 条待确认提案", status: "已完成", tone: "green" },
    ],
    detailTitle: "默认文本连接不可用",
    detail: "任务没有自动重试，也没有保存完整上下文。修复连接后可等待下一次计划运行，或显式执行试运行。",
    notice: "1 个任务运行失败；下一计划时间已推进。",
    primaryAction: "打开 AI 连接",
  },
  "interview-populated": {
    title: "面试训练",
    description: "展示训练计划、题目记录和反馈摘要。",
    metrics: [["训练", "9", "本周 3 次"], ["平均时长", "4:18", "单题"], ["结构评分", "82", "较上周 +6"], ["待复盘", "2", "今日完成"]],
    listTitle: "最近训练",
    rows: [
      { id: "interview-1", title: "基层治理中的群众沟通", description: "结构化面试 · 今天 10:12", status: "82 分", tone: "green" },
      { id: "interview-2", title: "突发舆情处置", description: "结构化面试 · 昨天 19:40", status: "76 分", tone: "yellow" },
      { id: "interview-3", title: "组织一次政策宣讲", description: "计划组织 · 7 月 25 日", status: "已复盘", tone: "neutral" },
    ],
    detailTitle: "基层治理中的群众沟通",
    detail: "反馈摘要：开头定位准确，措施层次清楚；建议补充冲突升级时的兜底与回访机制。",
    primaryAction: "查看完整复盘",
  },
  "tutoring-populated": {
    title: "AI 辅导",
    description: "展示学习计划、当前轮次和历史记录。",
    metrics: [["计划", "3", "进行中 1"], ["辅导轮次", "14", "本周 4 次"], ["已关联知识", "11", "仅摘要进入上下文"], ["待完成", "2", "本周任务"]],
    listTitle: "当前学习计划",
    rows: [
      { id: "tutor-1", title: "判断推理条件关系专项", description: "第 3 / 5 次 · 下次练习今天", status: "进行中", tone: "green" },
      { id: "tutor-2", title: "资料分析速算训练", description: "第 4 / 4 次 · 已完成", status: "已完成", tone: "neutral" },
      { id: "tutor-3", title: "申论归纳概括", description: "尚未开始 · 4 个任务", status: "待开始", tone: "yellow" },
    ],
    detailTitle: "判断推理条件关系专项",
    detail: "本轮目标：用三道递进题巩固充分与必要条件。媒体、截图和厂商原始事件均不在示例中持久化。",
    primaryAction: "继续辅导",
  },
  "stats-populated": {
    title: "学习统计",
    description: "展示已有趋势、板块对比与可解释指标。",
    metrics: [["30 天练习", "426", "较上期 +18%"], ["正确率", "76%", "较上期 +5%"], ["复盘完成率", "88%", "目标 85%"], ["知识掌握", "3.7/5", "64 条知识"]],
    listTitle: "板块表现",
    rows: [
      { id: "stats-1", title: "判断推理", description: "练习 128 · 正确率 81%", status: "上升 7%", tone: "green" },
      { id: "stats-2", title: "资料分析", description: "练习 96 · 正确率 74%", status: "上升 3%", tone: "green" },
      { id: "stats-3", title: "常识判断", description: "练习 82 · 正确率 62%", status: "需加强", tone: "yellow" },
    ],
    detailTitle: "判断推理",
    detail: "近 30 天正确率从 74% 提升至 81%。主要增量来自条件关系题，图形推理仍是当前短板。",
    primaryAction: "查看相关错题",
  },
};

const noop = () => undefined;
const noopAsync = async () => undefined;
const fixtureTimestamp = "2026-07-30T08:30:00.000Z";
const fixtureMistake: Mistake = {
  id: "fixture-mistake", board: "判断推理", source: "开发示例", stem: "若完成调研是制定方案的必要条件，可推出什么？",
  answer: "未完成调研则不能制定方案", explanation: "必要条件应使用逆否命题判断。",
  reasons: ["条件关系混淆"], tags: ["必要条件"], mastery: 1, nextReviewAt: fixtureTimestamp,
  createdAt: fixtureTimestamp, updatedAt: fixtureTimestamp,
};
const fixtureKnowledge: KnowledgeEntry = {
  id: "fixture-knowledge", category: "政治理论", title: "全过程人民民主", summary: "闭卷回忆核心定义、制度载体与实践要求。",
  content: "全过程人民民主把选举民主与协商民主结合起来，贯穿民主选举、民主协商、民主决策、民主管理、民主监督各环节。",
  tags: ["政治理论", "民主"], source: "开发示例", favorite: true, mastery: 2, nextReviewAt: fixtureTimestamp,
  reviewCount: 2, createdAt: fixtureTimestamp, updatedAt: fixtureTimestamp,
};

function DashboardExample() {
  return (
    <DashboardView
      avgMastery="2.8 / 5"
      automationActiveCount={2}
      automationUnreadCount={1}
      boardStats={[
        { board: "政治理论", total: 24, due: 3, weak: 2 },
        { board: "常识判断", total: 18, due: 2, weak: 4 },
        { board: "言语理解与表达", total: 21, due: 1, weak: 1 },
        { board: "判断推理", total: 32, due: 5, weak: 6 },
        { board: "数量关系", total: 15, due: 2, weak: 3 },
        { board: "资料分析", total: 19, due: 2, weak: 2 },
      ]}
      configurationHealth={{ status: "ready", summary: "开发示例配置完整", readyCount: 4, issueCount: 0, sections: [] }}
      correctRate={76}
      dateLabel="2026-07-30"
      dueKnowledgeEntries={[fixtureKnowledge]}
      dueMistakes={[fixtureMistake]}
      importDraftCount={2}
      importJobCount={1}
      knowledgeCategorySummaries={[{ category: "政治理论", total: 12, due: 2, weak: 3, favorites: 4 }]}
      knowledgeCorrectRate={81}
      lowMistakes={[fixtureMistake]}
      notice="fixture 只存在于内存"
      obsidianConnected
      pendingProposalCount={1}
      onConfigurationHealthAction={noop}
      onOpenAutomation={noop}
      onCreateKnowledgeStarterDrafts={noop}
      onOpenBoard={noop}
      onOpenImport={noop}
      onOpenKnowledge={noop}
      onOpenKnowledgeCategory={noop}
      onOpenKnowledgeTraining={noop}
      onOpenInterview={noop}
      onOpenReview={noop}
      onOpenReviewQueue={noop}
      onOpenTutoring={noop}
    />
  );
}

function AutomationExample({ failed }: { failed: boolean }) {
  const [definitionsState, setDefinitionsState] = useState<AutomationDefinition[]>([{
    id: "fixture-automation", name: "每日错题复盘建议", templateId: "daily_review", prompt: "总结今日到期错题",
    sourceScopes: ["mistakes"], enabled: true, timeZone: "Asia/Shanghai", schedule: { kind: "daily", time: "08:30" },
    nextRunAt: "2026-07-31T00:30:00.000Z", lastRunAt: fixtureTimestamp, createdAt: fixtureTimestamp, updatedAt: fixtureTimestamp,
  }]);
  const [runs, setRuns] = useState<AutomationRun[]>([{
    id: "fixture-run", automationId: "fixture-automation", automationName: "每日错题复盘建议",
    status: failed ? "failed" : "succeeded", trigger: "scheduled", scheduledAt: fixtureTimestamp,
    startedAt: fixtureTimestamp, finishedAt: fixtureTimestamp,
    result: failed ? undefined : "优先复盘判断推理中的必要条件题，并完成 2 条知识训练。",
    error: failed ? "默认文本连接暂不可用" : undefined, unread: true, missedCount: 0, proposalIds: [],
    failureCategory: failed ? "missing_connection" : undefined,
    failureRecoveryAction: failed ? "configure_ai_connection" : undefined,
    contextSummary: [{ scope: "mistakes", label: "错题", count: 3, sampleTitles: ["必要条件判断"] }],
    contextCharCount: 182, createdAt: fixtureTimestamp,
  }]);
  const center = useMemo(() => ({
    aiSnapshot: { profiles: [], defaults: { id: "default", updatedAt: fixtureTimestamp }, updatedAt: fixtureTimestamp },
    busyIds: [],
    snapshot: { definitions: definitionsState, runs, unreadCount: runs.filter((run) => run.unread).length },
    duplicate: noopAsync,
    markAllRead: async () => setRuns((items) => items.map((run) => ({ ...run, unread: false }))),
    markRead: async (id: string) => setRuns((items) => items.map((run) => run.id === id ? { ...run, unread: false } : run)),
    preview: async () => ({ summary: [], contextCharCount: 0 }),
    processDue: noopAsync,
    refresh: noopAsync,
    remove: async (id: string) => setDefinitionsState((items) => items.filter((item) => item.id !== id)),
    requestNotifications: noopAsync,
    runNow: async () => runs[0],
    save: noopAsync,
    toggle: async (id: string, enabled: boolean) => setDefinitionsState((items) => items.map((item) => item.id === id ? { ...item, enabled } : item)),
    trialRun: async () => ({ status: "succeeded" as const, proposalCount: 0, contextSummary: [], contextCharCount: 0 }),
  }), [definitionsState, runs]);
  return <AutomationView center={center as AutomationCenter} onOpenEntry={noop} onOpenImport={noop} onOpenKnowledge={noop} onOpenSettings={noop} onNotice={noop} />;
}

function ReviewExample() {
  const [answerOpen, setAnswerOpen] = useState(false);
  return (
    <ReviewView
      answerOpen={answerOpen}
      associatedKnowledge={[fixtureKnowledge]}
      currentReview={fixtureMistake}
      dueMistakes={[fixtureMistake]}
      relatedKnowledge={[]}
      reviewIndex={0}
      timer={{
        elapsedSec: 0, isRunning: false, isTimedOut: false, mode: "stopwatch", remainingSec: 0, targetSec: 90,
        pause: noop, reset: noop, resume: noop, setMode: noop, setTargetSec: noop,
      }}
      onCreateKnowledgeDraft={noop}
      onOpenKnowledgeEntry={noop}
      onRecordReview={noop}
      onToggleAnswer={() => setAnswerOpen((value) => !value)}
    />
  );
}

function KnowledgeTrainingExample() {
  const [answerOpen, setAnswerOpen] = useState(false);
  return (
    <KnowledgeTrainingView
      answerOpen={answerOpen}
      attemptsCount={12}
      correctRate={78}
      currentEntry={fixtureKnowledge}
      dueEntries={[fixtureKnowledge]}
      lowEntries={[fixtureKnowledge]}
      queueEntries={[fixtureKnowledge]}
      queueFilter="due"
      trainingIndex={0}
      onChangeQueueFilter={noop}
      onMove={noop}
      onOpenKnowledgeEntry={noop}
      onRecordReview={noop}
      onSkip={noop}
      onSelectEntry={noop}
      onToggleAnswer={() => setAnswerOpen((value) => !value)}
    />
  );
}

function StatsExample() {
  return (
    <StatsView
      attempts={[
        { id: "attempt-1", mistakeId: fixtureMistake.id, result: "correct", confidence: 4, durationSec: 52, reviewedAt: fixtureTimestamp },
        { id: "attempt-2", mistakeId: fixtureMistake.id, result: "wrong", confidence: 2, durationSec: 78, reviewedAt: "2026-07-29T08:30:00.000Z" },
      ]}
      knowledgeEntries={[fixtureKnowledge]}
      mistakes={[fixtureMistake]}
      onOpenKnowledgeTraining={noop}
      onOpenReview={noop}
    />
  );
}

function InterviewExample() {
  const [session, setSession] = useState<InterviewSession>({
    id: "fixture-interview", questionId: "fixture-question", type: "structured", title: "窗口服务中的群众情绪处理",
    questionPrompt: "基层窗口遇到群众因材料不全情绪激动，你会如何处理？", questionMaterial: "",
    status: "active", stage: "answering", startedAt: fixtureTimestamp, totalDurationSec: 96,
    timerStatus: "paused", currentTurnElapsedSec: 42, transcriptText: "请开始作答。",
    createdAt: fixtureTimestamp, updatedAt: fixtureTimestamp,
  });
  const turns: InterviewTurn[] = [{
    id: "fixture-turn", sessionId: session.id, speaker: "ai_interviewer", stage: "answering",
    content: "请结合依法依规、情绪安抚和问题解决三个层次作答。", createdAt: fixtureTimestamp,
  }];
  const speech = {
    error: "", listening: false, speaking: false, supported: false, transcript: "",
    clearError: noop, previewVoice: noopAsync, reset: noop, setTranscript: noop,
    speak: noopAsync, start: noop, stop: noop, stopSpeaking: noop,
  } as ReturnType<typeof useInterviewSpeech>;
  return (
    <InterviewSessionPanel
      busy={false}
      expectedDurationSec={180}
      session={session}
      speech={speech}
      turns={turns}
      onFinishSession={() => setSession((current) => ({ ...current, timerStatus: "finished", currentTurnStartedAt: undefined }))}
      onPauseTimer={async () => setSession((current) => ({ ...current, timerStatus: "paused", currentTurnStartedAt: undefined }))}
      onResumeTimer={async () => setSession((current) => ({ ...current, timerStatus: "running", currentTurnStartedAt: new Date().toISOString() }))}
      onSubmitAnswer={noopAsync}
    />
  );
}

function RealComponentExample({ example }: { example: WorkspaceDevelopmentExampleId }) {
  const selected = developmentExampleDefinition(example);
  if (selected.view === "dashboard") return <DashboardExample />;
  if (selected.view === "automation") return <AutomationExample failed={selected.fixture === "failed"} />;
  if (selected.view === "review") return <ReviewExample />;
  if (selected.view === "knowledgeTraining") return <KnowledgeTrainingExample />;
  if (selected.view === "stats") return <StatsExample />;
  if (selected.view === "interview") return <InterviewExample />;
  return null;
}

/** 完全由固定 fixture 驱动的开发预览；不挂载业务 controller，避免读写仓储或发出外部请求。 */
export function DevelopmentExampleWorkspace({ initialExample }: { initialExample: WorkspaceDevelopmentExampleId }) {
  const [example, setExample] = useState<WorkspaceDevelopmentExampleId>(initialExample);
  const definition = definitions[example];
  const [selectedId, setSelectedId] = useState(definition.rows[0]?.id);
  const [feedback, setFeedback] = useState<string>();
  const selected = useMemo(
    () => definition.rows.find((row) => row.id === selectedId) ?? definition.rows[0],
    [definition.rows, selectedId],
  );

  function selectExample(value: string | undefined): void {
    if (!value) {
      const url = new URL(window.location.href);
      url.searchParams.delete("example");
      window.location.assign(url);
      return;
    }
    const next = value as WorkspaceDevelopmentExampleId;
    setExample(next);
    setSelectedId(definitions[next].rows[0]?.id);
    setFeedback(undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("example", next);
    window.history.replaceState(window.history.state, "", url);
  }

  const directBusinessViews = new Set(["dashboard", "automation", "review", "knowledgeTraining", "stats", "interview"]);
  const usesDirectBusinessView = directBusinessViews.has(developmentExampleDefinition(example).view);

  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <DevelopmentExampleSwitcher options={developmentExamplesForValue(example)} value={example} onChange={selectExample} />
        {usesDirectBusinessView ? (
          <>
            <header className={styles.header}>
              <div><h1>{definition.title}</h1><p>真实业务组件 · fixture 操作仅更新当前页面内存</p></div>
              <Chip tone="neutral">开发示例 · 仅内存</Chip>
            </header>
            <RealComponentExample example={example} />
          </>
        ) : (
        <>
        <header className={styles.header}>
          <div>
            <h1>{definition.title}</h1>
            <p>{definition.description}</p>
          </div>
          <Chip tone="neutral">开发示例 · 仅内存</Chip>
        </header>
        {definition.notice ? <div className={styles.notice} role="status">{definition.notice}</div> : null}
        <section className={styles.metrics} aria-label="关键指标">
          {definition.metrics.map(([label, value, hint]) => (
            <article className={styles.metric} key={label}>
              <span>{label}</span><strong>{value}</strong><small>{hint}</small>
            </article>
          ))}
        </section>
        <div className={styles.layout}>
          <section className={styles.panel}>
            <header className={styles.panelHeader}><h2>{definition.listTitle}</h2><span className="text-xs text-muted">{definition.rows.length} 项</span></header>
            {definition.rows.map((row) => (
              <button className={styles.row} data-active={selected?.id === row.id} key={row.id} type="button" onClick={() => { setSelectedId(row.id); setFeedback(undefined); }}>
                <span><strong>{row.title}</strong><small>{row.description}</small></span>
                <Chip tone={row.tone}>{row.status}</Chip>
              </button>
            ))}
          </section>
          <aside className={styles.panel}>
            <header className={styles.panelHeader}><h2>{definition.detailTitle}</h2>{selected ? <Chip tone={selected.tone}>{selected.status}</Chip> : null}</header>
            <div className={styles.detail}>
              <strong>{selected?.title}</strong>
              <p>{definition.detail}</p>
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => setFeedback(`${definition.primaryAction}：示例操作已在内存中完成`)}>{definition.primaryAction}</Button>
                <Button variant="ghost" onClick={() => setFeedback("示例详情已切换，不会写入本地数据库")}>次要操作</Button>
              </div>
              {feedback ? <p role="status">{feedback}</p> : null}
            </div>
          </aside>
        </div>
        </>
        )}
      </div>
    </main>
  );
}
