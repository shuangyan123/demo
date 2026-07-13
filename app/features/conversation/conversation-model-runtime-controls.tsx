"use client";

import { useState, type KeyboardEvent } from "react";
import { getReasoningBudgetRange } from "../../services/model-runtime-descriptors";
import type { AiModelRuntimeDescriptor, AiModelRuntimeOption, AiModelRuntimeValue, AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import { AppIcon } from "../shared/app-icon";

type RuntimePanel = "reasoning" | "speed";

type ConversationModelRuntimeControlsProps = {
  descriptor: AiModelRuntimeDescriptor;
  values: AiSelectedRuntimeValues;
  onChange: (values: AiSelectedRuntimeValues) => void;
};

function selectedLabel(options: AiModelRuntimeOption[], value: AiModelRuntimeValue | undefined): string {
  return options.find((option) => option.value === value)?.label ?? (typeof value === "number" ? `${value}` : String(value ?? ""));
}

/** 推理和速度以独立钻取列表呈现，点击选项立即保存，不增加确认步骤。 */
export function ConversationModelRuntimeControls({ descriptor, values, onChange }: ConversationModelRuntimeControlsProps) {
  const [panel, setPanel] = useState<RuntimePanel>();
  const budgetRange = getReasoningBudgetRange(descriptor.provider, descriptor.modelId);

  function updateBudget(value: number) {
    if (!budgetRange || !Number.isFinite(value)) return;
    onChange({ ...values, reasoning: Math.max(budgetRange.min, Math.min(budgetRange.max, Math.round(value))) });
  }

  function budgetKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  if (panel === "reasoning" && descriptor.reasoning) {
    return <section className="conversation-model-runtime-panel" aria-label="选择推理档位">
      <header><button type="button" aria-label="返回模型" onClick={() => setPanel(undefined)}><AppIcon name="back" size={16} /></button><strong>推理</strong></header>
      <div role="radiogroup" aria-label="推理档位">
        {descriptor.reasoning.options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={values.reasoning === option.value} onClick={() => onChange({ ...values, reasoning: option.value })}>
          <span>{option.label}{option.tooltip ? <span className="conversation-model-info" title={option.tooltip} aria-label={option.tooltip}>i</span> : null}</span>
          {values.reasoning === option.value ? <AppIcon name="check" size={16} /> : null}
        </button>)}
        {budgetRange ? <label className="conversation-model-budget"><span>自定义预算</span><input key={String(values.reasoning)} aria-label="自定义推理预算" type="number" min={budgetRange.min} max={budgetRange.max} defaultValue={typeof values.reasoning === "number" ? values.reasoning : ""} placeholder={`${budgetRange.min}–${budgetRange.max}`} onBlur={(event) => updateBudget(event.currentTarget.valueAsNumber)} onKeyDown={budgetKeyDown} /></label> : null}
      </div>
    </section>;
  }

  if (panel === "speed" && descriptor.speed) {
    return <section className="conversation-model-runtime-panel" aria-label="选择速度档位">
      <header><button type="button" aria-label="返回模型" onClick={() => setPanel(undefined)}><AppIcon name="back" size={16} /></button><strong>速度</strong></header>
      <div role="radiogroup" aria-label="速度档位">
        {descriptor.speed.options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={values.speed === option.value} onClick={() => onChange({ ...values, speed: option.value })}>
          <span>{option.label}{option.tooltip ? <span className="conversation-model-info" title={option.tooltip} aria-label={option.tooltip}>i</span> : null}</span>
          {values.speed === option.value ? <AppIcon name="check" size={16} /> : null}
        </button>)}
      </div>
    </section>;
  }

  const selectableReasoning = descriptor.reasoning && (descriptor.reasoning.options.length > 1 || descriptor.reasoning.kind === "budget");
  const selectableSpeed = descriptor.speed && descriptor.speed.options.length > 1;
  if (!selectableReasoning && !selectableSpeed) return null;
  return <div className="conversation-model-runtime-rows">
    {selectableReasoning ? <button type="button" onClick={() => setPanel("reasoning")}><span>推理</span><span>{selectedLabel(descriptor.reasoning!.options, values.reasoning)}<AppIcon name="chevronRight" size={16} /></span></button> : null}
    {selectableSpeed ? <button type="button" onClick={() => setPanel("speed")}><span>速度</span><span>{selectedLabel(descriptor.speed!.options, values.speed)}<AppIcon name="chevronRight" size={16} /></span></button> : null}
  </div>;
}
