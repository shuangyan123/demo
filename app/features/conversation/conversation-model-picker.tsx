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
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import type { AiConnectionPurpose, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { AiModelCatalogEntry } from "../../types/domains/provider-catalog.ts";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import { UiTooltip } from "../shared/ui-tooltip";
import { ConversationModelRuntimeControls } from "./conversation-model-runtime-controls";
import { useConnectionModelCatalog } from "./use-connection-model-catalog.ts";
import { useConversationModelNavigation, type ConversationModelRuntimeDimension, type ConversationModelPickerView } from "./use-conversation-model-navigation.ts";
import { useModelPickerOverflow } from "./use-model-picker-overflow.ts";
import styles from "./conversation-model-picker.module.css";

export type ConversationModelSelection = {
  connection: ApiConnectionProfile;
  modelId: string;
  selectedRuntimeValues: AiSelectedRuntimeValues;
};

export type ConversationModelPickerProps = {
  id?: string;
  initialRuntimeDimension?: ConversationModelRuntimeDimension;
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
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-picker-focus-key]:not([disabled])"));
  if (!items.length) return;
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  const direction = event.key === "ArrowDown" ? 1 : -1;
  items[(currentIndex + direction + items.length) % items.length]?.focus();
}

/**
 * 模型选择器：桌面厂商/模型浏览保持双栏外框，移动端继续按步骤进入模型层；
 * 普通模型和档位使用原生 radio，选择后立即保存且菜单保持打开。
 */
export const ConversationModelPicker = forwardRef<HTMLDivElement, ConversationModelPickerProps>(function ConversationModelPicker({
  id,
  initialRuntimeDimension,
  connections,
  purpose,
  selectedConnectionId,
  selectedModelId,
  selectedRuntimeValues,
  onOpenConnections,
  onSelect,
}, forwardedRef) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const modelRadioName = useId();
  const eligible = useMemo(() => connections.filter((connection) => connection.capabilities.includes(purpose)), [connections, purpose]);
  const selectedConnection = eligible.find((connection) => connection.id === selectedConnectionId);
  const initialView: ConversationModelPickerView = initialRuntimeDimension && selectedConnection && selectedModelId
    ? { kind: "runtime", provider: selectedConnection.provider, connectionId: selectedConnection.id, dimension: initialRuntimeDimension }
    : { kind: "controls" };
  const { back, changeConnection, showModels, showProviders, showRuntime, view } = useConversationModelNavigation({ initialView, pickerRef });
  const providers = useMemo(() => Array.from(new Set(eligible.map((connection) => connection.provider))).sort((left, right) => {
    if (left === selectedConnection?.provider) return -1;
    if (right === selectedConnection?.provider) return 1;
    return providerCollator.compare(getProviderContract(left).label, getProviderContract(right).label);
  }), [eligible, selectedConnection?.provider]);
  const [requestedProviderId, setActiveProviderId] = useState<ApiProvider | undefined>(() => selectedConnection?.provider);
  const activeProviderId = requestedProviderId && providers.includes(requestedProviderId)
    ? requestedProviderId
    : selectedConnection?.provider ?? providers[0];
  const providerConnections = activeProviderId ? eligible.filter((connection) => connection.provider === activeProviderId) : [];
  const preferredConnectionId = (view.kind === "models" || view.kind === "runtime") && view.provider === activeProviderId
    ? view.connectionId
    : selectedConnectionId;
  const activeConnection = view.kind === "controls"
    ? selectedConnection
    : providerConnections.find((connection) => connection.id === preferredConnectionId) ?? providerConnections[0];
  const catalog = useConnectionModelCatalog(activeConnection, purpose);
  const activeSelectedModelId = activeConnection?.id === selectedConnectionId ? selectedModelId : undefined;
  const models = catalog.models;
  const selectedDescriptor = selectedConnection && selectedModelId
    ? getAiModelRuntimeDescriptor(selectedConnection.provider, selectedModelId)
    : undefined;
  const runtimeValues = normalizeAiSelectedRuntimeValues(selectedDescriptor, selectedRuntimeValues);
  const pickerView = view.kind === "runtime" ? view.dimension : view.kind;
  const hasCustomBudget = view.kind === "runtime"
    && view.dimension === "reasoning"
    && selectedDescriptor?.reasoning?.kind === "budget";
  useModelPickerOverflow({ pickerRef, viewportRef, viewKey: `${pickerView}:${activeConnection?.id ?? "none"}` });

  const assignPickerRef = useCallback((node: HTMLDivElement | null) => {
    pickerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) (forwardedRef as MutableRefObject<HTMLDivElement | null>).current = node;
  }, [forwardedRef]);

  function usesDesktopFlyout() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function activateProvider(provider: ApiProvider) {
    if (providers.includes(provider)) setActiveProviderId(provider);
  }

  function enterProvider(provider: ApiProvider, focusModels = false) {
    const connectionsForProvider = eligible.filter((connection) => connection.provider === provider);
    const nextConnection = connectionsForProvider.find((connection) => connection.id === selectedConnectionId) ?? connectionsForProvider[0];
    if (!nextConnection) return;
    setActiveProviderId(provider);
    showModels(provider, nextConnection.id, focusModels);
  }

  function handleModelPaneKeyNavigation(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowLeft") return;
    event.preventDefault();
    back();
  }

  function openModelBrowser(focusProviders = false) {
    showProviders(focusProviders);
  }

  function openSelectedRuntime(dimension: ConversationModelRuntimeDimension, focusOptions = false) {
    if (!selectedConnection || !selectedModelId) return;
    setActiveProviderId(selectedConnection.provider);
    showRuntime(selectedConnection.provider, selectedConnection.id, dimension, focusOptions);
  }

  function handleControlKeyDown(event: KeyboardEvent<HTMLButtonElement>, openSection: (focusDetail: boolean) => void) {
    if (event.key !== "ArrowRight" && event.key !== "Enter") return;
    event.preventDefault();
    openSection(true);
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
    if (!selectedConnection || !selectedModelId) return;
    onSelect({
      connection: selectedConnection,
      modelId: selectedModelId,
      selectedRuntimeValues: normalizeAiSelectedRuntimeValues(selectedDescriptor, nextValues),
    });
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
      <div ref={viewportRef} className={styles.scrollViewport} data-scrollable="false">
      <div className={styles.controlFlyout}>
        <nav aria-label="模型配置" className={`${styles.layer} ${styles.controlPane}`} onKeyDown={handleProviderArrowNavigation}>
          <button
            className={styles.controlRow}
            data-control-active={view.kind === "providers" || view.kind === "models" ? "true" : undefined}
            data-picker-default-focus={view.kind === "controls" ? "true" : undefined}
            data-picker-focus-key="control-entry:model"
            type="button"
            onFocus={() => { if (usesDesktopFlyout()) openModelBrowser(); }}
            onMouseEnter={() => openModelBrowser()}
            onKeyDown={(event) => handleControlKeyDown(event, openModelBrowser)}
            onClick={() => openModelBrowser()}
          >
            <span>模型</span><span>{selectedModelId ?? "选择模型"}<AppIcon name="chevronRight" size={16} /></span>
          </button>
          <button
            className={styles.controlRow}
            data-control-active={view.kind === "runtime" && view.dimension === "reasoning" ? "true" : undefined}
            data-picker-focus-key="runtime-entry:reasoning"
            disabled={!selectedDescriptor?.reasoning}
            type="button"
            onFocus={() => { if (usesDesktopFlyout()) openSelectedRuntime("reasoning"); }}
            onMouseEnter={() => openSelectedRuntime("reasoning")}
            onKeyDown={(event) => handleControlKeyDown(event, (focus) => openSelectedRuntime("reasoning", focus))}
            onClick={() => openSelectedRuntime("reasoning")}
          >
            <span>推理强度</span><span>{selectedDescriptor?.reasoning?.options.find((option) => option.value === runtimeValues.reasoning)?.label ?? "不可用"}<AppIcon name="chevronRight" size={16} /></span>
          </button>
          <button
            className={styles.controlRow}
            data-control-active={view.kind === "runtime" && view.dimension === "speed" ? "true" : undefined}
            data-picker-focus-key="runtime-entry:speed"
            disabled={!selectedDescriptor?.speed}
            type="button"
            onFocus={() => { if (usesDesktopFlyout()) openSelectedRuntime("speed"); }}
            onMouseEnter={() => openSelectedRuntime("speed")}
            onKeyDown={(event) => handleControlKeyDown(event, (focus) => openSelectedRuntime("speed", focus))}
            onClick={() => openSelectedRuntime("speed")}
          >
            <span>速度</span><span>{selectedDescriptor?.speed?.options.find((option) => option.value === runtimeValues.speed)?.label ?? "不可用"}<AppIcon name="chevronRight" size={16} /></span>
          </button>
        </nav>

      {view.kind !== "controls" ? <div className={styles.detailPane}>
      {view.kind === "providers" || view.kind === "models" ? (
        <div className={styles.flyout}>
          <nav key="providers" aria-label="厂商" className={`${styles.layer} ${styles.providerPane}`} onKeyDown={handleProviderArrowNavigation}>
            <button aria-label="返回模型配置" className={styles.flyoutBack} type="button" onClick={back}><AppIcon name="back" size={16} /></button>
            {providers.length ? providers.map((provider, index) => {
              const contract = getProviderContract(provider);
              return (
                <button
                  key={provider}
                  className={styles.providerRow}
                  data-picker-default-focus={view.kind === "providers" && index === 0 ? "true" : undefined}
                  data-picker-focus-key={`provider:${provider}`}
                  data-provider-active={provider === activeProviderId ? "true" : undefined}
                  type="button"
                  onFocus={() => activateProvider(provider)}
                  onMouseEnter={() => activateProvider(provider)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      back();
                      return;
                    }
                    if (event.key !== "ArrowRight" && event.key !== "Enter") return;
                    event.preventDefault();
                    enterProvider(provider, true);
                  }}
                  onClick={() => enterProvider(provider)}
                >
                  <ProviderIcon provider={provider} size={16} />
                  <span>{contract.label}</span>
                  <span className={styles.mobileDisclosure} aria-hidden="true"><AppIcon name="chevronRight" size={16} /></span>
                </button>
              );
            }) : null}
          </nav>

      {!providers.length ? (
        <section className={styles.connectionEmptyState} aria-label="尚未配置 AI 连接">
          <strong>尚未配置 AI 连接</strong>
          <p>配置 AI 服务后即可选择模型。</p>
          <button type="button" onClick={onOpenConnections}>前往设置</button>
        </section>
      ) : null}

      {(view.kind === "providers" || view.kind === "models") && activeProviderId && activeConnection ? (
        <section key={catalog.key} className={`${styles.layer} ${styles.modelPane}`} aria-label={`${getProviderContract(activeProviderId).label} 模型`} onKeyDown={handleModelPaneKeyNavigation}>
          <button aria-label="返回厂商" className={styles.flyoutBack} type="button" onClick={back}><AppIcon name="back" size={16} /></button>
          {providerConnections.length > 1 ? (
            <label className={styles.profileRow}>
              <span className="sr-only">连接</span>
              <select
                aria-label="连接"
                value={activeConnection.id}
                onChange={(event) => {
                  changeConnection(activeProviderId, event.currentTarget.value);
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
            {!models.length ? <p className={styles.modelEmptyState}>{catalog.loading ? "正在加载模型…" : "暂无可用模型"}</p> : null}
          </div>
        </section>
      ) : null}
        </div>
      ) : null}

      {view.kind === "runtime" && selectedDescriptor ? (
        <div key={`${view.dimension}:${activeConnection?.id ?? "missing"}`} className={styles.layer} onKeyDown={handleModelPaneKeyNavigation}>
          <ConversationModelRuntimeControls
            descriptor={selectedDescriptor}
            dimension={view.dimension}
            values={runtimeValues}
            onBack={back}
            onChange={chooseRuntime}
          />
        </div>
      ) : null}
      </div> : null}
      </div>
      </div>
    </div>
  );
});
