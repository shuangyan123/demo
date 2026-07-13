"use client";

import {
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { getAiModelRuntimeDescriptor, normalizeAiSelectedRuntimeValues } from "../../services/model-runtime-descriptors";
import { getProviderContract } from "../../services/provider-contracts";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import type { ApiProvider } from "../../types/domains/ai-provider";
import type { AiConnectionPurpose, AiModelCatalogEntry, ApiConnectionProfile } from "../../types/review";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import { UiTooltip } from "../shared/ui-tooltip";
import { ConversationModelRuntimeControls } from "./conversation-model-runtime-controls";
import { useConnectionModelCatalog } from "./use-connection-model-catalog";
import { useConversationModelNavigation } from "./use-conversation-model-navigation";
import styles from "./conversation-model-picker.module.css";

export type ConversationModelSelection = {
  connection: ApiConnectionProfile;
  modelId: string;
  selectedRuntimeValues: AiSelectedRuntimeValues;
};

export type ConversationModelPickerProps = {
  id?: string;
  connections: ApiConnectionProfile[];
  purpose: AiConnectionPurpose;
  selectedConnectionId?: string;
  selectedModelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  onOpenConnections: () => void;
  onSelect: (selection: ConversationModelSelection) => void;
};

const providerCollator = new Intl.Collator("en", { sensitivity: "base" });
const capabilityLabels = new Map([
  ["text", "文本"], ["vision", "视觉"], ["structured_output", "结构化输出"], ["streaming", "流式输出"],
]);

/** 模型能力只在整行 tooltip 中简述，未知模型明确标记为未核验。 */
function modelTooltip(model: AiModelCatalogEntry): string {
  const descriptor = getAiModelRuntimeDescriptor(model.provider, model.id);
  const capabilities = model.capabilities.map((capability) => capabilityLabels.get(capability) ?? capability).join(" · ");
  const runtime = descriptor
    ? [descriptor.reasoning ? "可选推理" : "", descriptor.speed ? "可选速度" : ""].filter(Boolean).join(" · ")
    : "运行参数尚未核验";
  return `${capabilities}${capabilities && runtime ? "；" : ""}${runtime}`;
}

/** 厂商层没有选择语义，只让方向键在当前按钮组内循环，不干扰 select 和数字输入。 */
function handleProviderArrowNavigation(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
  if (!items.length) return;
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  const direction = event.key === "ArrowDown" ? 1 : -1;
  items[(currentIndex + direction + items.length) % items.length]?.focus();
}

/**
 * 单栏模型选择器：任何时刻只挂载厂商、模型或一个运行档位层，避免覆盖层继续占据
 * Tab 顺序。普通模型和档位使用原生 radio，选择后立即保存且菜单保持打开。
 */
export const ConversationModelPicker = forwardRef<HTMLDivElement, ConversationModelPickerProps>(function ConversationModelPicker({
  id,
  connections,
  purpose,
  selectedConnectionId,
  selectedModelId,
  selectedRuntimeValues,
  onOpenConnections,
  onSelect,
}, forwardedRef) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const modelRadioName = useId();
  const [manualModelId, setManualModelId] = useState("");
  const { back, changeConnection, showModels, showRuntime, view } = useConversationModelNavigation({ pickerRef });
  const eligible = useMemo(() => connections.filter((connection) => connection.capabilities.includes(purpose)), [connections, purpose]);
  const selectedConnection = eligible.find((connection) => connection.id === selectedConnectionId);
  const providers = useMemo(() => Array.from(new Set(eligible.map((connection) => connection.provider))).sort((left, right) => {
    if (left === selectedConnection?.provider) return -1;
    if (right === selectedConnection?.provider) return 1;
    return providerCollator.compare(getProviderContract(left).label, getProviderContract(right).label);
  }), [eligible, selectedConnection?.provider]);
  const activeProvider = view.kind === "providers" ? undefined : view.provider;
  const providerConnections = activeProvider ? eligible.filter((connection) => connection.provider === activeProvider) : [];
  const activeConnection = view.kind === "providers"
    ? undefined
    : providerConnections.find((connection) => connection.id === view.connectionId) ?? providerConnections[0];
  const catalog = useConnectionModelCatalog(activeConnection, purpose);
  const activeSelectedModelId = activeConnection?.id === selectedConnectionId ? selectedModelId : undefined;
  const manualSelectedModel = activeConnection && activeSelectedModelId && !catalog.some((model) => model.id === activeSelectedModelId)
    ? {
        id: activeSelectedModelId,
        label: activeSelectedModelId,
        provider: activeConnection.provider,
        purposes: [purpose],
        capabilities: [purpose],
        status: "manual" as const,
        source: "manual" as const,
      }
    : undefined;
  const models = manualSelectedModel ? [manualSelectedModel, ...catalog] : catalog;
  const selectedDescriptor = activeConnection && activeSelectedModelId
    ? getAiModelRuntimeDescriptor(activeConnection.provider, activeSelectedModelId)
    : undefined;
  const runtimeValues = normalizeAiSelectedRuntimeValues(selectedDescriptor, selectedRuntimeValues);
  const pickerView = view.kind === "runtime" ? view.dimension : view.kind;
  const hasCustomBudget = view.kind === "runtime"
    && view.dimension === "reasoning"
    && selectedDescriptor?.reasoning?.kind === "budget";

  const assignPickerRef = useCallback((node: HTMLDivElement | null) => {
    pickerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) (forwardedRef as MutableRefObject<HTMLDivElement | null>).current = node;
  }, [forwardedRef]);

  function openProvider(provider: ApiProvider) {
    const connectionsForProvider = eligible.filter((connection) => connection.provider === provider);
    const nextConnection = connectionsForProvider.find((connection) => connection.id === selectedConnectionId) ?? connectionsForProvider[0];
    if (!nextConnection) return;
    setManualModelId("");
    showModels(provider, nextConnection.id);
  }

  function chooseModel(nextModelId: string) {
    if (!activeConnection) return;
    const descriptor = getAiModelRuntimeDescriptor(activeConnection.provider, nextModelId);
    onSelect({
      connection: activeConnection,
      modelId: nextModelId,
      selectedRuntimeValues: normalizeAiSelectedRuntimeValues(descriptor, selectedRuntimeValues),
    });
  }

  function chooseRuntime(nextValues: AiSelectedRuntimeValues) {
    if (!activeConnection || !activeSelectedModelId) return;
    onSelect({
      connection: activeConnection,
      modelId: activeSelectedModelId,
      selectedRuntimeValues: normalizeAiSelectedRuntimeValues(selectedDescriptor, nextValues),
    });
  }

  function submitManualModel() {
    const nextModelId = manualModelId.trim();
    if (!nextModelId) return;
    chooseModel(nextModelId);
  }

  return (
    <div
      ref={assignPickerRef}
      id={id}
      aria-label="选择对话模型"
      className={styles.picker}
      data-model-picker-view={pickerView}
      data-picker-has-budget={hasCustomBudget ? "true" : undefined}
      role="dialog"
    >
      {view.kind === "providers" ? (
        <nav key="providers" aria-label="厂商" className={styles.layer} onKeyDown={handleProviderArrowNavigation}>
          {providers.length ? providers.map((provider, index) => {
            const contract = getProviderContract(provider);
            return (
              <button
                key={provider}
                className={styles.providerRow}
                data-picker-default-focus={index === 0 ? "true" : undefined}
                data-picker-focus-key={`provider:${provider}`}
                type="button"
                onClick={() => openProvider(provider)}
              >
                <ProviderIcon provider={provider} size={16} />
                <span>{contract.label}</span>
                <AppIcon name="chevronRight" size={16} />
              </button>
            );
          }) : (
            <button className={styles.emptyRow} type="button" onClick={onOpenConnections}>配置支持当前能力的连接</button>
          )}
        </nav>
      ) : null}

      {view.kind === "models" && activeProvider && activeConnection ? (
        <section key={`models:${activeConnection.id}`} className={styles.layer} aria-label={`${getProviderContract(activeProvider).label} 模型`}>
          <header className={styles.header}>
            <button aria-label="返回厂商" className={styles.backButton} type="button" onClick={back}><AppIcon name="back" size={16} /></button>
            <ProviderIcon provider={activeProvider} size={18} />
            <strong>{getProviderContract(activeProvider).label}</strong>
          </header>
          {providerConnections.length > 1 ? (
            <label className={styles.profileRow}>
              <span className="sr-only">连接</span>
              <select
                aria-label="连接"
                value={activeConnection.id}
                onChange={(event) => {
                  setManualModelId("");
                  changeConnection(activeProvider, event.currentTarget.value);
                }}
              >
                {providerConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
              </select>
            </label>
          ) : null}
          <div className={styles.modelList} role="radiogroup" aria-label="模型">
            {models.map((model, index) => {
              const checked = model.id === activeSelectedModelId;
              return (
                <UiTooltip key={model.id} content={modelTooltip(model)}>
                  {({ describedBy }) => (
                    <label className={styles.radioLabel}>
                      <input
                        aria-describedby={describedBy}
                        checked={checked}
                        className={styles.radioInput}
                        data-picker-default-focus={checked || (!activeSelectedModelId && index === 0) ? "true" : undefined}
                        data-picker-focus-key={`model:${model.id}`}
                        name={modelRadioName}
                        type="radio"
                        value={model.id}
                        onChange={() => chooseModel(model.id)}
                      />
                      <span className={styles.radioRow}>
                        <strong>{model.label}</strong>
                        {checked ? <AppIcon name="check" size={16} /> : null}
                      </span>
                    </label>
                  )}
                </UiTooltip>
              );
            })}
          </div>
          {activeSelectedModelId && selectedDescriptor ? (
            <ConversationModelRuntimeControls
              descriptor={selectedDescriptor}
              values={runtimeValues}
              onChange={chooseRuntime}
              onOpen={(dimension) => showRuntime(activeProvider, activeConnection.id, dimension)}
            />
          ) : null}
          <div className={styles.manualRow}>
            <label htmlFor={`${id ?? modelRadioName}-manual-model`}>手动模型 ID</label>
            <div>
              <input
                id={`${id ?? modelRadioName}-manual-model`}
                aria-label="手动模型 ID"
                placeholder="输入模型 ID"
                value={manualModelId}
                onChange={(event) => setManualModelId(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  submitManualModel();
                }}
              />
              <button aria-label="使用手动模型" disabled={!manualModelId.trim()} type="button" onClick={submitManualModel}>
                <AppIcon name="check" size={16} />
              </button>
            </div>
          </div>
          <button className={styles.manageRow} type="button" onClick={onOpenConnections}>管理 AI 连接</button>
        </section>
      ) : null}

      {view.kind === "runtime" && selectedDescriptor ? (
        <div key={`${view.dimension}:${activeConnection?.id ?? "missing"}`} className={styles.layer}>
          <ConversationModelRuntimeControls
            descriptor={selectedDescriptor}
            dimension={view.dimension}
            values={runtimeValues}
            onBack={back}
            onChange={chooseRuntime}
          />
        </div>
      ) : null}
    </div>
  );
});
