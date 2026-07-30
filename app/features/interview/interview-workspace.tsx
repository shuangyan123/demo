"use client";

import { useMemo, useState } from "react";
import { Button, Panel, SegmentedTabs, Toolbar } from "../shared/ui-primitives";
import { interviewTypeLabels } from "../../services/interview-rubric";
import { resolvePersonaVoice } from "../../services/personalization-settings-repository";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { InterviewQuestion, InterviewType } from "../../types/domains/interview.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { InterviewLinkPanel } from "./interview-link-panel";
import { InterviewPracticePlansView } from "./interview-practice-plans-view";
import { InterviewQuestionBank } from "./interview-question-bank";
import { InterviewQuestionSetsView } from "./interview-question-sets-view";
import { InterviewRecordsView } from "./interview-records-view";
import { InterviewRubricView } from "./interview-rubric-view";
import { InterviewSessionPanel } from "./interview-session-panel";
import { useInterviewFlow } from "./use-interview-flow.ts";
import { useInterviewSpeech } from "./use-interview-speech.ts";

type InterviewTab = "questions" | "plans" | "session" | "records";

const starterQuestions: Array<Omit<InterviewQuestion, "id" | "createdAt" | "updatedAt">> = [
  {
    difficulty: "medium",
    expectedDurationSec: 180,
    favorite: false,
    material: "",
    practiceCount: 0,
    prompt: "基层窗口单位遇到群众因材料不全情绪激动，认为工作人员故意刁难。如果你在现场，你会如何处理？",
    source: "面试训练示例",
    tags: ["应急应变", "群众工作"],
    title: "窗口服务中的群众情绪处理",
    type: "structured",
  },
  {
    difficulty: "medium",
    expectedDurationSec: 240,
    favorite: false,
    material: "三名考生依次作答后，需要相互点评并回应。请围绕基层数字化治理如何避免形式主义展开。",
    practiceCount: 0,
    prompt: "请先完成个人作答，再点评其他考生观点，并回应他人对你的点评。",
    source: "面试训练示例",
    tags: ["结构化小组", "数字治理"],
    title: "数字化治理与形式主义",
    type: "structured_group",
  },
  {
    difficulty: "hard",
    expectedDurationSec: 420,
    favorite: false,
    material:
      "某地计划对老旧社区公共空间进行改造，备选方案包括增设停车位、建设儿童活动区、增加适老设施、扩大绿化空间。小组需讨论并形成优先级方案。",
    practiceCount: 0,
    prompt: "请进行个人陈述，并在自由讨论中推动形成小组结论，最后完成总结陈词。",
    source: "面试训练示例",
    tags: ["无领导小组", "公共决策"],
    title: "老旧社区公共空间改造优先级",
    type: "leaderless_group",
  },
];

// 面试训练主工作台只负责页面编排、选中态和跨模块跳转；业务读写放在 useInterviewFlow 中。
export function InterviewWorkspace({
  textConnection,
  knowledgeEntries,
  mistakes,
  personalizationSettings,
  speechConnection,
  onNotice,
  onOpenSettings,
}: {
  textConnection?: ApiConnectionProfile;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  personalizationSettings: PersonalizationSettings;
  speechConnection?: ApiConnectionProfile;
  onNotice: (message: string) => void;
  onOpenSettings: () => void;
}) {
  const [tab, setTab] = useState<InterviewTab>("session");
  const [typeFilter, setTypeFilter] = useState<InterviewType | "all">("all");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const interviewData = useInterviewFlow({ textConnection, onNotice, personalizationSettings });
  const speech = useInterviewSpeech(resolvePersonaVoice(personalizationSettings, "interview"), speechConnection);

  const filteredQuestions = useMemo(
    () => interviewData.snapshot.questions.filter((question) => typeFilter === "all" || question.type === typeFilter),
    [interviewData.snapshot.questions, typeFilter],
  );
  const selectedQuestion = interviewData.snapshot.questions.find((question) => question.id === selectedQuestionId) ?? filteredQuestions[0] ?? null;
  const activeSession = interviewData.snapshot.sessions.find((session) => session.id === activeSessionId) ?? interviewData.snapshot.sessions[0] ?? null;
  const activeSessionQuestion = activeSession ? interviewData.snapshot.questions.find((question) => question.id === activeSession.questionId) : undefined;
  const activeTurns = activeSession ? interviewData.turnsBySessionId.get(activeSession.id) ?? [] : [];
  const activeEvaluation = activeSession ? interviewData.evaluationBySessionId.get(activeSession.id) : undefined;
  const questionLinks = selectedQuestion ? interviewData.snapshot.links.filter((link) => link.sourceType === "question" && link.sourceId === selectedQuestion.id) : [];
  const sessionLinks = activeSession ? interviewData.snapshot.links.filter((link) => link.sourceType === "session" && link.sourceId === activeSession.id) : [];

  const tabs: Array<{ key: InterviewTab; label: string; count?: number }> = [
    { key: "session", label: "模拟现场" },
    { key: "questions", label: "题库", count: interviewData.snapshot.questions.length },
    { key: "plans", label: "训练计划", count: interviewData.snapshot.practicePlans.length },
    { key: "records", label: "复盘记录", count: interviewData.snapshot.sessions.length },
  ];

  // 启动 AI 模拟前检查 API 配置；无配置时跳转设置页，避免静默失败。
  async function startSession(question: InterviewQuestion, planId?: string) {
    if (!textConnection) {
      onOpenSettings();
      onNotice("请先在 AI 连接中配置默认文本连接，再开始 AI 模拟面试");
      return;
    }
    const session = await interviewData.startSession(question, planId);
    if (session) {
      setActiveSessionId(session.id);
      setTab("session");
    }
  }

  return (
    <div className="grid gap-5">
      <Panel eyebrow="INTERVIEW" title="面试训练">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm leading-6 text-muted">聚焦当前阶段、实时文字稿和结束后的证据化复盘；原始录音不会保存。</p>
          {!textConnection && (
            <Button variant="primary" onClick={onOpenSettings}>
              配置 AI 连接
            </Button>
          )}
        </div>
        <Toolbar className="mt-4">
          <SegmentedTabs active={tab} items={tabs} onChange={setTab} />
        </Toolbar>
      </Panel>

      {tab === "questions" && (
        <>
          <InterviewQuestionBank
            apiReady={Boolean(textConnection)}
            busy={interviewData.busy}
            questionDrafts={interviewData.questionDrafts}
            questions={filteredQuestions}
            selectedQuestionId={selectedQuestion?.id ?? null}
            selectedType={typeFilter}
            onAddQuestion={interviewData.addQuestion}
            onAddStarterQuestions={async () => {
              const existingKeys = new Set(interviewData.snapshot.questions.map((question) => `${question.source}\u0000${question.title}`));
              const missing = starterQuestions.filter((question) => !existingKeys.has(`${question.source}\u0000${question.title}`));
              if (!missing.length) {
                onNotice("三类面试示例题已全部载入，无需重复添加");
                return;
              }
              await interviewData.addQuestions(missing);
              onNotice(`已载入 ${missing.length} 道面试示例题`);
            }}
            onChangeType={setTypeFilter}
            onClearQuestionDrafts={interviewData.clearQuestionDrafts}
            onConfirmQuestionDrafts={interviewData.confirmQuestionDrafts}
            onDeleteQuestion={async (id) => {
              const remaining = filteredQuestions.filter((question) => question.id !== id);
              await interviewData.deleteQuestion(id);
              if (selectedQuestionId === id) setSelectedQuestionId(remaining[0]?.id ?? null);
            }}
            onGenerateQuestionDrafts={interviewData.generateQuestionDrafts}
            onSelectQuestion={setSelectedQuestionId}
            onStartSession={(question) => void startSession(question)}
            onToggleFavorite={interviewData.toggleQuestionFavorite}
            onToggleQuestionDraft={interviewData.toggleQuestionDraft}
          />
          {selectedQuestion && (
            <InterviewLinkPanel
              knowledgeEntries={knowledgeEntries}
              links={questionLinks}
              mistakes={mistakes}
              sourceId={selectedQuestion.id}
              sourceType="question"
              onAddLink={interviewData.addLink}
              onDeleteLink={interviewData.deleteLink}
            />
          )}
          <details className="ui-detail-card">
            <summary className="cursor-pointer font-bold">题组与评分标准</summary>
            <div className="mt-4 grid gap-5">
              <InterviewQuestionSetsView
                busy={interviewData.busy}
                questionSets={interviewData.snapshot.questionSets}
                questions={interviewData.snapshot.questions}
                onAddQuestionSet={interviewData.addQuestionSet}
                onDeleteQuestionSet={interviewData.deleteQuestionSet}
                onStartQuestion={(question) => void startSession(question)}
              />
              <InterviewRubricView />
            </div>
          </details>
        </>
      )}

      {tab === "plans" && (
        <InterviewPracticePlansView
          apiReady={Boolean(textConnection)}
          busy={interviewData.busy}
          plans={interviewData.snapshot.practicePlans}
          questionSets={interviewData.snapshot.questionSets}
          questions={interviewData.snapshot.questions}
          onAddPracticePlan={interviewData.addPracticePlan}
          onDeletePracticePlan={interviewData.deletePracticePlan}
          onGeneratePracticePlan={interviewData.generatePracticePlan}
          onStartPlanQuestion={(question, planId) => void startSession(question, planId)}
          onUpdatePracticePlan={interviewData.updatePracticePlan}
        />
      )}

      {tab === "session" && (
        <>
          <InterviewSessionPanel
            key={activeSession?.id ?? "empty-interview-session"}
            busy={interviewData.busy}
            evaluation={activeEvaluation}
            expectedDurationSec={activeSessionQuestion?.expectedDurationSec}
            session={activeSession}
            speech={speech}
            turns={activeTurns}
            onFinishSession={(sessionId) => void interviewData.finishSession(sessionId)}
            onPauseTimer={interviewData.pauseTimer}
            onResumeTimer={interviewData.resumeTimer}
            onSubmitAnswer={interviewData.submitCandidateTurn}
          />
          {activeSession && (
            <InterviewLinkPanel
              knowledgeEntries={knowledgeEntries}
              links={sessionLinks}
              mistakes={mistakes}
              sourceId={activeSession.id}
              sourceType="session"
              onAddLink={interviewData.addLink}
              onDeleteLink={interviewData.deleteLink}
            />
          )}
        </>
      )}

      {tab === "records" && (
        <InterviewRecordsView
          evaluationBySessionId={interviewData.evaluationBySessionId}
          sessions={interviewData.snapshot.sessions}
          onDeleteSession={interviewData.deleteSession}
          onOpenSession={(id) => {
            setActiveSessionId(id);
            setTab("session");
          }}
        />
      )}

      <p className="text-xs text-muted">
        当前评分表覆盖：{Object.values(interviewTypeLabels).join("、")}。AI 评分仅作为训练反馈，最终以正式面试规则和考官判断为准。
      </p>
    </div>
  );
}
