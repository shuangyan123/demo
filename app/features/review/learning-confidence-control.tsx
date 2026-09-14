import type { SelfConfidence } from "../../types/domains/learning-event.ts";
import { Button } from "../shared/ui-primitives";

const confidenceOptions: Array<{ value: SelfConfidence; label: string }> = [
  { value: 1, label: "完全没把握" },
  { value: 2, label: "较没把握" },
  { value: 3, label: "一般" },
  { value: 4, label: "较有把握" },
  { value: 5, label: "很有把握" },
];

/** 反馈前可选的窄化自评控件；显示为自评，不暗示独立评分或预测。 */
export function LearningConfidenceControl({
  disabled = false,
  feedbackRevealed,
  selectedConfidence,
  subjectId,
  onClear,
  onChange,
}: {
  disabled?: boolean;
  feedbackRevealed: boolean;
  selectedConfidence?: SelfConfidence;
  subjectId: string;
  onClear: () => void;
  onChange: (value: SelfConfidence) => void;
}) {
  const name = `learning-confidence-${subjectId}`;
  return (
    <fieldset className="mt-6 border-t border-line pt-5" disabled={disabled}>
      <legend className="text-sm font-bold">本轮开始前的把握程度（可选）</legend>
      <p className="mt-1 text-sm leading-6 text-muted">这是你在查看答案或资料前的自评，不是独立评分；跳过即可不记录。</p>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="本轮开始前的把握程度">
        {confidenceOptions.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <label key={option.value} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input
                id={id}
                name={name}
                type="radio"
                value={option.value}
                checked={selectedConfidence === option.value}
                disabled={feedbackRevealed}
                onChange={() => onChange(option.value)}
              />
              <span>{option.value} · {option.label}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-sm text-muted">
        {selectedConfidence === undefined ? <span>未记录</span> : <span>已选择 {selectedConfidence} / 5</span>}
        <Button size="sm" variant="ghost" disabled={selectedConfidence === undefined || disabled || feedbackRevealed} onClick={onClear}>清除自评</Button>
        {feedbackRevealed ? <span>已查看反馈，选择已冻结</span> : null}
      </div>
    </fieldset>
  );
}
