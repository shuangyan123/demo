import { interviewRubrics } from "../../services/interview-rubric";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import { LearningSessionInsightSection } from "../shared/learning-session-layout";
import { ScoreBar } from "../shared/ui-primitives";
import styles from "./interview-session-panel.module.css";

/** 面试侧栏只展示题型量表与最终评价，不制造实时分数。 */
export function InterviewSessionInsights({
  evaluation,
  session,
}: {
  evaluation?: InterviewEvaluation;
  session: InterviewSession;
}) {
  const rubric = interviewRubrics[session.type];
  return (
    <>
      <LearningSessionInsightSection title="本题要点">
        <ol className={styles.focusList}>
          {rubric.dimensions.slice(0, 3).map((dimension) => (
            <li key={dimension.name}><strong>{dimension.name}</strong><span>{dimension.focus}</span></li>
          ))}
        </ol>
      </LearningSessionInsightSection>
      <LearningSessionInsightSection title="当前表现">
        {evaluation ? (
          <div className={styles.scoreList}>
            {evaluation.dimensions.slice(0, 3).map((dimension) => (
              <ScoreBar key={dimension.name} label={dimension.name} max={dimension.maxScore} value={dimension.score} />
            ))}
          </div>
        ) : <p>评分将在结束作答后生成，不展示伪实时分数。</p>}
      </LearningSessionInsightSection>
      <LearningSessionInsightSection title="下一步">
        <p>{evaluation ? evaluation.suggestions[0] || "根据复盘结果进入下一题。" : "结束本题后自动生成评分、证据和改进建议。"}</p>
        <details className={styles.privacy}>
          <summary>语音与隐私</summary>
          语音识别只持久化最终文字稿，原始录音和浏览器事件不会保存。
        </details>
      </LearningSessionInsightSection>
    </>
  );
}
