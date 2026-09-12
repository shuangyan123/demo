"use client";

import { useEffect, useRef } from "react";
import { Button } from "../shared/ui-primitives";
import { resolveLearningNextSteps } from "./learning-next-step.ts";
import type { ReviewWorkspaceController } from "./use-review-workspace-controller.ts";

/** 两类训练共用轻量完成反馈；所有目的地仍调用工作台既有导航。 */
export function LearningCompletion({ controller, activity }: { controller: ReviewWorkspaceController; activity: "review" | "knowledge" }) {
  const { data, learning, knowledge, automation, workspace } = controller;
  const submission = activity === "review" ? learning.snapshot.submission : knowledge.snapshot.submission;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const actions = resolveLearningNextSteps({
    recommendations: data.learnerState.recommendations,
    mistakeIds: data.mistakes.map((item) => item.id),
    knowledgeIds: data.knowledgeEntries.map((item) => item.id),
    hasScheduledWork: automation.snapshot.definitions.some((item) => item.enabled) || automation.snapshot.unreadCount > 0,
  });
  return (
    <section style={{ maxWidth: 672 }} className="mx-auto w-full rounded-xl border border-line bg-surface p-6 max-sm:p-3" aria-label="本轮学习完成">
      <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">{activity === "review" ? "本轮复盘完成" : "本轮知识训练完成"}</h2>
      <p className="mt-3 text-sm text-muted">已完成 {submission.committedIds.length} {activity === "review" ? "道" : "条"} · 结果已保存</p>
      {submission.busy ? <p role="status" className="mt-6">正在更新学习状态…</p> : submission.refreshFailed ? (
        <div className="mt-6"><p role="alert">结果已保存，暂时无法读取下一步。</p><Button className="mt-3" onClick={() => void submission.refresh()}>重新读取学习状态</Button></div>
      ) : (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="font-bold">下一步</h3>
          <p className="mt-2 text-sm leading-6 text-muted">{actions[0].summary}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {actions.map((action, index) => <Button key={action.destination} style={{ minHeight: 44 }} className="max-w-full whitespace-normal text-left" variant={index === 0 ? "primary" : "outline"} onClick={() => {
              if (action.destination === "review") learning.actions.openReview(action.targetId);
              else if (action.destination === "knowledgeTraining") knowledge.actions.openTraining(action.targetId);
              else if (action.destination === "library") {
                const mistake = data.mistakes.find((item) => item.id === action.targetId);
                if (mistake) learning.actions.openMistake(mistake);
              } else workspace.switchView(action.destination);
            }}>{action.label}</Button>)}
          </div>
        </div>
      )}
    </section>
  );
}

export function LearningRefreshNotice({ submission }: { submission: ReviewWorkspaceController["learning"]["snapshot"]["submission"] }) {
  if (!submission.refreshFailed) return null;
  return <div role="alert" className="mb-4 flex flex-wrap items-center gap-3"><p>结果已保存，请刷新学习状态后继续。</p><Button disabled={submission.busy} onClick={() => void submission.refresh()}>重新读取学习状态</Button></div>;
}
