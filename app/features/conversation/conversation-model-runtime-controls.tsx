"use client";

import { useId, type KeyboardEvent } from "react";
import type {
  AiModelRuntimeDescriptor,
  AiModelRuntimeOption,
  AiModelRuntimeValue,
  AiSelectedRuntimeValues,
} from "../../types/domains/ai-model.ts";
import { AppIcon } from "../shared/app-icon";
import { UiTooltip } from "../shared/ui-tooltip";
import type { ConversationModelRuntimeDimension } from "./use-conversation-model-navigation.ts";
import styles from "./conversation-model-picker.module.css";

type ConversationModelRuntimeControlsProps = {
  descriptor: AiModelRuntimeDescriptor;
  dimension?: ConversationModelRuntimeDimension;
  values: AiSelectedRuntimeValues;
  onBack?: () => void;
  onChange: (values: AiSelectedRuntimeValues) => void;
  onOpen?: (dimension: ConversationModelRuntimeDimension) => void;
};

type RuntimeOptionRowProps = {
  checked: boolean;
  name: string;
  option: AiModelRuntimeOption;
  onChange: () => void;
};

function selectedLabel(options: AiModelRuntimeOption[], value: AiModelRuntimeValue | undefined): string {
  return options.find((option) => option.value === value)?.label ?? (typeof value === "number" ? `${value}` : String(value ?? ""));
}

/** 单个运行档位使用真实 radio；tooltip 绑定整行，不再常驻圆形信息图标。 */
function RuntimeOptionRow({ checked, name, option, onChange }: RuntimeOptionRowProps) {
  function renderRow(describedBy?: string) {
    return (
      <label className={styles.radioLabel}>
        <input
          aria-describedby={describedBy}
          checked={checked}
          className={styles.radioInput}
          data-picker-default-focus={checked ? "true" : undefined}
          data-picker-focus-key={`runtime-option:${option.id}`}
          name={name}
          type="radio"
          value={option.id}
          onChange={onChange}
        />
        <span className={styles.radioRow}>
          <span>{option.label}</span>
          {checked ? <AppIcon name="check" size={16} /> : null}
        </span>
      </label>
    );
  }

  return option.tooltip
    ? <UiTooltip content={option.tooltip}>{({ describedBy }) => renderRow(describedBy)}</UiTooltip>
    : renderRow();
}

/**
 * 模型层只渲染推理/速度入口；运行层只渲染当前 radio 组，因此旧模型层不会继续
 * 留在视觉或键盘焦点树中。档位点击立即向上提交，不增加确认按钮。
 */
export function ConversationModelRuntimeControls({
  descriptor,
  dimension,
  values,
  onBack,
  onChange,
  onOpen,
}: ConversationModelRuntimeControlsProps) {
  const radioName = useId();
  const reasoning = descriptor.reasoning;
  const speed = descriptor.speed;
  const selectableReasoning = reasoning && (reasoning.options.length > 1 || reasoning.kind === "budget");
  const selectableSpeed = speed && speed.options.length > 1;

  if (!dimension) {
    if (!selectableReasoning && !selectableSpeed) return null;
    return (
      <div className={styles.runtimeEntries} aria-label="模型运行选项">
        {selectableReasoning ? (
          <button
            data-picker-focus-key="runtime-entry:reasoning"
            type="button"
            onClick={() => onOpen?.("reasoning")}
          >
            <span>推理</span>
            <span>{selectedLabel(reasoning.options, values.reasoning)}<AppIcon name="chevronRight" size={16} /></span>
          </button>
        ) : null}
        {selectableSpeed ? (
          <button
            data-picker-focus-key="runtime-entry:speed"
            type="button"
            onClick={() => onOpen?.("speed")}
          >
            <span>速度</span>
            <span>{selectedLabel(speed.options, values.speed)}<AppIcon name="chevronRight" size={16} /></span>
          </button>
        ) : null}
      </div>
    );
  }

  const runtime = dimension === "reasoning" ? reasoning : speed;
  if (!runtime) return null;
  const title = dimension === "reasoning" ? "推理" : "速度";
  const customRange = reasoning?.kind === "budget" && dimension === "reasoning" ? reasoning.customRange : undefined;
  const usesCustomBudget = Boolean(
    customRange
      && typeof values.reasoning === "number"
      && !reasoning?.options.some((option) => option.value === values.reasoning),
  );

  function updateBudget(value: number, clampToRange = true) {
    if (!customRange || !Number.isFinite(value)) return;
    const rounded = Math.round(value);
    if (!clampToRange && (rounded < customRange.min || rounded > customRange.max)) return;
    const normalized = Math.max(customRange.min, Math.min(customRange.max, rounded));
    if (values.reasoning === normalized) return;
    onChange({ ...values, reasoning: normalized });
  }

  function budgetKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.currentTarget.blur();
  }

  return (
    <section className={styles.runtimePanel} aria-label={`选择${title}档位`}>
      <header className={styles.header}>
        <button aria-label="返回模型" className={styles.backButton} type="button" onClick={onBack}>
          <AppIcon name="back" size={16} />
        </button>
        <strong>{title}</strong>
      </header>
      <div className={styles.radioGroup} role="radiogroup" aria-label={`${title}档位`}>
        {runtime.options.map((option) => (
          <RuntimeOptionRow
            key={option.id}
            checked={(dimension === "reasoning" ? values.reasoning : values.speed) === option.value}
            name={radioName}
            option={option}
            onChange={() => onChange(dimension === "reasoning"
              ? { ...values, reasoning: option.value }
              : { ...values, speed: String(option.value) })}
          />
        ))}
        {customRange ? (
          <label className={styles.budgetRow}>
            <span>自定义预算</span>
            <input
              key={String(values.reasoning)}
              aria-label="自定义推理预算"
              data-picker-default-focus={usesCustomBudget ? "true" : undefined}
              defaultValue={usesCustomBudget ? values.reasoning : ""}
              max={customRange.max}
              min={customRange.min}
              placeholder={`${customRange.min}–${customRange.max}`}
              type="number"
              onInput={(event) => updateBudget(event.currentTarget.valueAsNumber, false)}
              onBlur={(event) => updateBudget(event.currentTarget.valueAsNumber)}
              onKeyDown={budgetKeyDown}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}
