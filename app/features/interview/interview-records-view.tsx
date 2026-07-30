"use client";

import { Button, DataList, EmptyState, ListRow, Panel } from "../shared/ui-primitives";
import { interviewTypeLabels } from "../../services/interview-rubric";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";

// 面试记录视图展示历史会话和评分入口，删除时由 repository 清理文字稿与关联。
export function InterviewRecordsView({
  evaluationBySessionId,
  sessions,
  onDeleteSession,
  onOpenSession,
}: {
  evaluationBySessionId: Map<string, InterviewEvaluation>;
  sessions: InterviewSession[];
  onDeleteSession: (id: string) => Promise<void>;
  onOpenSession: (id: string) => void;
}) {
  return (
    <Panel eyebrow="RECORDS" title="复盘记录">
      <DataList>
        {sessions.length ? (
          sessions.map((session) => {
            const evaluation = evaluationBySessionId.get(session.id);
            return (
              <ListRow key={session.id}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{interviewTypeLabels[session.type]}</p>
                  <h3 className="mt-1 truncate text-lg font-extrabold">{session.title}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {session.status === "evaluated" ? `得分 ${evaluation?.totalScore ?? 0}/100` : session.status === "cancelled" ? "已中止 · 未评分" : "进行中"} · {session.startedAt.slice(0, 10)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => onOpenSession(session.id)}>
                    查看
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void onDeleteSession(session.id)}>
                    删除
                  </Button>
                </div>
              </ListRow>
            );
          })
        ) : (
          <EmptyState>完成一次模拟后，复盘记录会显示在这里。</EmptyState>
        )}
      </DataList>
    </Panel>
  );
}
