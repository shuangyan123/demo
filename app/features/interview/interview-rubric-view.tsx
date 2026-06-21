"use client";

import { DataList, DetailBlock, Panel } from "../shared/ui-primitives";
import { interviewRubrics } from "../../services/interview-rubric";

// 评分标准页把三类面试的维度透明展示给用户，避免 AI 评分像黑箱。
export function InterviewRubricView() {
  return (
    <div className="grid gap-5">
      {Object.values(interviewRubrics).map((rubric) => (
        <Panel key={rubric.type} eyebrow="RUBRIC" title={rubric.label}>
          <p className="mb-4 text-sm leading-6 text-muted">{rubric.description}</p>
          <DataList>
            {rubric.dimensions.map((dimension) => (
              <DetailBlock key={dimension.name} title={`${dimension.name} · ${dimension.maxScore} 分`}>
                <p className="text-sm leading-6">{dimension.focus}</p>
              </DetailBlock>
            ))}
          </DataList>
        </Panel>
      ))}
    </div>
  );
}
