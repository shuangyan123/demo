"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  AiModelReasoningDescriptor,
  AiModelRuntimeOption,
  AiModelRuntimeValue,
  AiSelectedRuntimeValues,
} from "../../types/domains/ai-model.ts";
import { AppIcon } from "../shared/app-icon";
import styles from "./conversation-reasoning-control.module.css";

type ConversationReasoningControlProps = {
  disabled?: boolean;
  reasoning?: AiModelReasoningDescriptor;
  values: AiSelectedRuntimeValues;
  onChange: (values: AiSelectedRuntimeValues) => void;
};

const effortOrder = new Map<string, number>([
  ["none", 0],
  ["off", 0],
  ["disabled", 0],
  ["minimal", 1],
  ["low", 2],
  ["medium", 3],
  ["high", 4],
  ["xhigh", 5],
  ["max", 6],
]);

/** 枚举档位按统一语义排序，厂商未使用标准命名时保持目录声明顺序。 */
function orderedOptions(options: AiModelRuntimeOption[]): AiModelRuntimeOption[] {
  return options
    .map((option, index) => ({ option, index, order: effortOrder.get(String(option.value).toLowerCase()) }))
    .sort((left, right) => {
      if (left.order === undefined || right.order === undefined) return left.index - right.index;
      return left.order - right.order;
    })
    .map(({ option }) => option);
}

function optionLabel(options: AiModelRuntimeOption[], value: AiModelRuntimeValue | undefined): string {
  return options.find((option) => option.value === value)?.label
    ?? (typeof value === "number" ? value.toLocaleString() : String(value ?? ""));
}

/**
 * 模型旁的独立推理控制。
 * 拖动只更新本地预览，指针释放、键盘操作结束或失焦时才提交持久化。
 */
export function ConversationReasoningControl({
  disabled = false,
  reasoning,
  values,
  onChange,
}: ConversationReasoningControlProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mobileBottom, setMobileBottom] = useState(124);
  const options = useMemo(() => orderedOptions(reasoning?.options ?? []), [reasoning]);
  const selected = values.reasoning ?? reasoning?.defaultValue;
  const [draft, setDraft] = useState<AiModelRuntimeValue | undefined>(selected);
  const draftRef = useRef(draft);
  const selectedRef = useRef(selected);
  const valuesRef = useRef(values);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    draftRef.current = draft;
    selectedRef.current = selected;
    valuesRef.current = values;
    onChangeRef.current = onChange;
  }, [draft, onChange, selected, values]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (draftRef.current !== undefined && draftRef.current !== selectedRef.current) {
        onChangeRef.current({ ...valuesRef.current, reasoning: draftRef.current });
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  /** 附件换行时按 Composer 实际顶部抬高移动弹层，避免覆盖输入区。 */
  useLayoutEffect(() => {
    if (!open) return;
    const composer = rootRef.current?.closest<HTMLElement>("[data-conversation-composer]");
    if (!composer) return;
    const update = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      setMobileBottom(Math.max(10, Math.round(viewportHeight - composer.getBoundingClientRect().top + 8)));
    };
    const observer = new ResizeObserver(update);
    observer.observe(composer);
    update();
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open]);

  if (!reasoning || (reasoning.kind !== "budget" && options.length < 2)) return null;

  const visibleDraft = open ? draft : selected;
  const customRange = reasoning.kind === "budget" ? reasoning.customRange : undefined;
  const rangeOptions = customRange
    ? options.filter((option) => typeof option.value === "number"
      && option.value >= customRange.min
      && option.value <= customRange.max)
    : options;
  const sentinelOptions = customRange
    ? options.filter((option) => typeof option.value === "number"
      && (option.value < customRange.min || option.value > customRange.max))
    : [];
  const enumIndex = Math.max(0, options.findIndex((option) => option.value === visibleDraft));
  const budgetDraft = typeof visibleDraft === "number" && customRange
    ? Math.max(customRange.min, Math.min(customRange.max, visibleDraft))
    : (rangeOptions[0]?.value as number | undefined) ?? customRange?.min ?? 0;

  function commit(nextValue: AiModelRuntimeValue | undefined = draft) {
    if (nextValue === undefined || nextValue === selected) return;
    onChange({ ...values, reasoning: nextValue });
  }

  function preview(nextValue: AiModelRuntimeValue | undefined) {
    draftRef.current = nextValue;
    setDraft(nextValue);
  }

  function selectSentinel(option: AiModelRuntimeOption) {
    preview(option.value);
    commit(option.value);
  }

  const currentLabel = optionLabel(options, visibleDraft);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={{ "--model-picker-mobile-bottom": `${mobileBottom}px` } as CSSProperties}
    >
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`调整推理强度，当前 ${currentLabel}`}
        className={styles.trigger}
        disabled={disabled}
        type="button"
        onClick={() => {
          preview(selected);
          setOpen((current) => !current);
        }}
      >
        <AppIcon name="configuration" size={16} />
        <span>推理 {currentLabel}</span>
      </button>
      {open ? (
        <section className={styles.popover} role="dialog" aria-label="推理强度">
          <div className={styles.header}>
            <strong>推理强度</strong>
            <button aria-label="关闭推理设置" type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>
              <AppIcon name="close" size={16} />
            </button>
          </div>
          <div className={styles.valueRow}>
            <span>{reasoning.kind === "budget" ? "思考预算" : "档位"}</span>
            <strong>{currentLabel}</strong>
          </div>
          {customRange ? (
            <>
              <input
                aria-label="推理预算"
                className={styles.range}
                max={customRange.max}
                min={customRange.min}
                step={1}
                type="range"
                value={budgetDraft}
                onChange={(event) => preview(event.currentTarget.valueAsNumber)}
                onPointerUp={() => commit()}
                onKeyUp={() => commit()}
                onBlur={() => commit()}
              />
              <div className={styles.scale}><span>{customRange.min}</span><span>{customRange.max}</span></div>
              <label className={styles.budgetInput}>
                <span>精确值</span>
                <input
                  aria-label="自定义推理预算"
                  max={customRange.max}
                  min={customRange.min}
                  step={1}
                  type="number"
                  value={budgetDraft}
                  onChange={(event) => {
                    if (Number.isFinite(event.currentTarget.valueAsNumber)) preview(event.currentTarget.valueAsNumber);
                  }}
                  onBlur={() => commit()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
              {sentinelOptions.length ? (
                <div className={styles.sentinels} aria-label="特殊预算值">
                  {sentinelOptions.map((option) => (
                    <button
                      key={option.id}
                      aria-pressed={draft === option.value}
                      type="button"
                      onClick={() => selectSentinel(option)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <input
                aria-label="推理档位"
                className={styles.range}
                max={Math.max(0, options.length - 1)}
                min={0}
                step={1}
                type="range"
                value={enumIndex}
                onChange={(event) => preview(options[event.currentTarget.valueAsNumber]?.value)}
                onPointerUp={() => commit()}
                onKeyUp={() => commit()}
                onBlur={() => commit()}
              />
              <div className={styles.scale}>
                <span>{options[0]?.label}</span>
                <span>{options.at(-1)?.label}</span>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
