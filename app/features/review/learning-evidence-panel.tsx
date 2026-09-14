import type { DelayedRecallPair, LearningCalibrationMismatch, LearningCalibrationRecord, LearningEvidence } from "../../lib/learning-calibration.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import styles from "./learning-insight-view.module.css";

const selfReportedResultLabels = { correct: "自评答对", uncertain: "自评不确定", wrong: "自评答错" } as const;

function evidenceDomain(sourceType: LearningCalibrationRecord["sourceType"]): string {
  return sourceType === "review_attempt" ? "错题复盘" : "知识训练";
}

function evidenceSubject(record: LearningCalibrationRecord, mistakes: Mistake[], knowledgeEntries: KnowledgeEntry[]): string {
  if (record.subjectType === "mistake") return mistakes.find((item) => item.id === record.subjectId)?.stem ?? record.subjectId;
  return knowledgeEntries.find((item) => item.id === record.subjectId)?.title ?? record.subjectId;
}

function mismatchLabel(mismatch: LearningCalibrationMismatch): string {
  return mismatch.kind === "high_confidence_wrong" ? "高把握后自评答错" : "低把握后自评答对";
}

function delayedDomain(pair: DelayedRecallPair): string {
  return pair.subjectType === "mistake" ? "错题复盘" : "知识训练";
}

export function LearningEvidencePanel({ evidence, mistakes, knowledgeEntries }: { evidence: LearningEvidence; mistakes: Mistake[]; knowledgeEntries: KnowledgeEntry[] }) {
  const calibration = evidence.calibration;
  const delayed = evidence.delayedRecall;
  const confidenceText = calibration.eligibleAttemptCount === 0
    ? "尚无学习记录"
    : calibration.confidenceCount === 0
      ? `尚无自信度记录（0/${calibration.eligibleAttemptCount} 次）`
      : `自信度记录 ${calibration.confidenceCount}/${calibration.eligibleAttemptCount} 次`;
  const delayedText = delayed.denominator === 0
    ? "尚无跨日再测证据"
    : `跨日自评答对 ${delayed.correctCount}/${delayed.denominator} 个对象日`;
  const highConfidenceText = calibration.highConfidenceCount === 0
    ? "暂无高把握记录"
    : `高把握记录中自评答错 ${calibration.highConfidenceWrongCount}/${calibration.highConfidenceCount} 次`;
  const lowConfidenceText = calibration.lowConfidenceCount === 0
    ? "暂无低把握记录"
    : `低把握记录中自评答对 ${calibration.lowConfidenceCorrectCount}/${calibration.lowConfidenceCount} 次`;
  const confidenceRecords = calibration.confidenceRecords.slice(0, 5);
  const mismatches = calibration.mismatches.slice(0, 5);
  const delayedPairs = delayed.pairs.slice(0, 5);

  return (
    <section className={styles.panel} aria-label="学习证据">
      <div className={styles.sectionHeader}><h3>学习证据</h3><span>本地保存的自评记录</span></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <p><strong>{confidenceText}</strong><br /><span className="text-sm text-muted">N 为所选范围内有效来源尝试，C 只计固定协议的无争议记录。</span></p>
        <p><strong>{delayedText}</strong><br /><span className="text-sm text-muted">按对象和不同学习日计算，前一日可以在所选范围之外。</span></p>
        <p><strong>{highConfidenceText}</strong><br /><span className="text-sm text-muted">仅标记 4-5 分且本轮自评答错的记录。</span></p>
        <p><strong>{lowConfidenceText}</strong><br /><span className="text-sm text-muted">仅标记 1-2 分且本轮自评答对的记录。</span></p>
      </div>
      <p className={styles.note}>基于本地保存的自评记录；同一对象同一天的跨日结果按保守规则合并，不代表记忆保持概率或校准能力。</p>
      <details className="mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer text-sm font-bold">查看学习证据明细</summary>
        <div className="mt-3 grid gap-4 text-sm">
          <section>
            <h4 className="font-bold">自信度记录（最新 5 条）</h4>
            {confidenceRecords.length ? <ul className="mt-2 grid gap-2">{confidenceRecords.map((record) => <li className="break-all text-muted" key={`${record.sourceType}:${record.sourceId}`}><span className="text-foreground">{evidenceDomain(record.sourceType)} · {evidenceSubject(record, mistakes, knowledgeEntries)}</span> · 来源尝试 {record.sourceId} · 学习日 {record.studyDay} · {selfReportedResultLabels[record.outcome]} · 自信度 {record.selfConfidence}/5 · 协议 {record.selfConfidenceProtocol}{record.practiceKind ? ` · ${record.practiceKind}` : ""}</li>)}</ul> : <p className="mt-2 text-muted">暂无固定协议的自信度明细。</p>}
          </section>
          <section>
            <h4 className="font-bold">把握程度不一致（最新 5 条）</h4>
            {mismatches.length ? <ul className="mt-2 grid gap-2">{mismatches.map((record) => <li className="break-all text-muted" key={`mismatch:${record.sourceType}:${record.sourceId}`}><span className="text-foreground">{mismatchLabel(record)}</span> · {evidenceDomain(record.sourceType)} · 来源尝试 {record.sourceId} · 学习日 {record.studyDay} · 自信度 {record.selfConfidence}/5</li>)}</ul> : <p className="mt-2 text-muted">暂无把握程度不一致记录。</p>}
          </section>
          <section>
            <h4 className="font-bold">跨日对象日（最新 5 条）</h4>
            {delayedPairs.length ? <ul className="mt-2 grid gap-2">{delayedPairs.map((pair) => <li className="break-all text-muted" key={`${pair.subjectType}:${pair.subjectId}:${pair.currentStudyDay}`}><span className="text-foreground">{delayedDomain(pair)} · {pair.subjectId}</span> · 前一学习日 {pair.previousStudyDay}（{selfReportedResultLabels[pair.previousOutcome]}）→ 当前学习日 {pair.currentStudyDay}（{selfReportedResultLabels[pair.currentOutcome]}）</li>)}</ul> : <p className="mt-2 text-muted">暂无跨日对象日明细。</p>}
          </section>
        </div>
      </details>
    </section>
  );
}
