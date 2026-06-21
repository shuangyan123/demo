"use client";

import { Button, MetricCard, Panel, ScoreBar, StatGrid, Timeline } from "../shared/ui-primitives";
import { interviewTypeLabels } from "../../services/interview-rubric";
import type { InterviewEvaluation, InterviewPracticePlan, InterviewQuestion, InterviewSession, InterviewType } from "../../types/review";

// 面试总览把题库、计划和最近复盘压缩成一屏，帮助用户决定下一步训练动作。
export function InterviewOverview({
  evaluations,
  plans,
  questions,
  sessions,
  onOpenPlans,
  onOpenQuestions,
  onOpenRecords,
}: {
  evaluations: InterviewEvaluation[];
  plans: InterviewPracticePlan[];
  questions: InterviewQuestion[];
  sessions: InterviewSession[];
  onOpenPlans: () => void;
  onOpenQuestions: () => void;
  onOpenRecords: () => void;
}) {
  const activePlans = plans.filter((plan) => plan.status === "active");
  const averageScore = evaluations.length ? Math.round(evaluations.reduce((sum, item) => sum + item.totalScore, 0) / evaluations.length) : 0;
  const favoriteCount = questions.filter((question) => question.favorite).length;
  const typeCounts = questions.reduce<Record<InterviewType, number>>(
    (acc, question) => {
      acc[question.type] += 1;
      return acc;
    },
    { leaderless_group: 0, structured: 0, structured_group: 0 },
  );

  return (
    <div className="grid gap-5">
      <Panel eyebrow="OVERVIEW" title="面试训练总览">
        <StatGrid>
          <MetricCard label="题库总量" value={questions.length} hint="本地面试题" tone="text-blue" />
          <MetricCard label="收藏题目" value={favoriteCount} hint="可优先加入计划" tone="text-yellow" />
          <MetricCard label="训练计划" value={activePlans.length} hint="正在推进" tone="text-green" />
          <MetricCard label="模拟记录" value={sessions.length} hint="只保存文字稿" tone="text-blue" />
          <MetricCard label="平均评分" value={averageScore || "-"} hint="已评分会话" tone="text-red" />
        </StatGrid>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onOpenQuestions}>
            进入题库
          </Button>
          <Button variant="soft" onClick={onOpenPlans}>
            制定训练计划
          </Button>
          <Button variant="outline" onClick={onOpenRecords}>
            查看复盘记录
          </Button>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel eyebrow="QUESTION MIX" title="题库结构">
          <div className="grid gap-4">
            {Object.entries(typeCounts).map(([type, count]) => (
              <ScoreBar key={type} label={interviewTypeLabels[type as InterviewType]} max={Math.max(1, questions.length)} value={count} />
            ))}
          </div>
        </Panel>

        <Panel eyebrow="NEXT" title="近期训练线索">
          <Timeline
            items={[
              {
                id: "plan",
                title: activePlans[0]?.title ?? "先创建一个训练计划",
                description: activePlans[0] ? `下次训练：${new Date(activePlans[0].nextPracticeAt).toLocaleString("zh-CN")}` : "可以从题组或收藏题目生成计划。",
                active: Boolean(activePlans[0]),
              },
              {
                id: "session",
                title: sessions[0]?.title ?? "暂无模拟记录",
                description: sessions[0] ? `最近状态：${sessions[0].status === "evaluated" ? "已评分" : "进行中"}` : "完成一次模拟后会在这里出现。",
                done: Boolean(sessions[0]?.status === "evaluated"),
              },
              {
                id: "score",
                title: averageScore ? `当前平均 ${averageScore} 分` : "等待首次评分",
                description: "评分只作为训练反馈，便于复盘表达、逻辑和互动质量。",
              },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
