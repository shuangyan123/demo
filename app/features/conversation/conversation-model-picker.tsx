"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { UiHint } from "../shared/ui-tooltip";
import { ConversationModelRuntimeControls } from "./conversation-model-runtime-controls";
import { useConnectionModelCatalog } from "./use-connection-model-catalog.ts";
import { useConversationModelFlyoutPosition } from "./use-conversation-model-flyout-position.ts";
import { useConversationModelNavigation, type ConversationModelRuntimeDimension, type ConversationModelPickerView } from "./use-conversation-model-navigation.ts";
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
  providerOrder: readonly ApiProvider[];
  selectedConnectionId?: string;
  selectedModelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  onOpenConnections: () => void;
  onRequestClose: (restoreFocus?: boolean) => void;
  onSelect: (selection: ConversationModelSelection) => void;
};

type PickerAnchorKey = "model" | ConversationModelRuntimeDimension;

// The compact panel now overlaps the active provider row vertically; retain a
// small forgiving bridge for the few pixels between sibling surfaces.
const POINTER_GRACE_MS = 240;

type ModelOptionRowProps = {
  model: AiModelCatalogEntry;
  checked: boolean;
  defaultFocus: boolean;
  name: string;
  onChange: () => void;
};

/** 模型名只有真实溢出时才启用 UiHint，短名称不会制造无意义的视觉提示。 */
function ModelOptionRow({ model, checked, defaultFocus, name, onChange }: ModelOptionRowProps) {
  const nameRef = useRef<HTMLElement | null>(null);
  const rowRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const update = () => {
      const nameElement = nameRef.current;
      const rowElement = rowRef.current;
      if (!nameElement || !rowElement) return;
      const next = nameElement.scrollWidth > nameElement.clientWidth + 1;
      setOverflowing((current) => current === next ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    if (nameRef.current) observer.observe(nameRef.current);
    if (rowRef.current) observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [model.label]);

  const renderRow = (describedBy?: string) => (
    <label className={styles.radioLabel} data-model-picker-row="true">
      <input
        aria-describedby={describedBy}
        checked={checked}
        className={styles.radioInput}
        data-picker-default-focus={checked || defaultFocus ? "true" : undefined}
        data-picker-focus-key={`model:${model.id}`}
        data-model-id={model.id}
        name={name}
        type="radio"
        value={model.id}
        onChange={onChange}
      />
      <span ref={rowRef} className={styles.radioRow}>
        <strong ref={nameRef}>{model.label}</strong>
        <span className={styles.checkmarkSlot} aria-hidden="true">{checked ? <AppIcon name="check" size={16} /> : null}</span>
      </span>
    </label>
  );

  return overflowing
    ? <UiHint label={`完整模型名称：${model.label}`} placement={["right", "left", "top", "bottom"]}>{({ describedBy }) => renderRow(describedBy)}</UiHint>
    : renderRow();
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
 * 桌面端由独立 root/provider/model surface 组成级联菜单；移动端由 CSS 隐藏父层，
 * 继续使用同一 navigation state 逐层 step-in，避免两套 provider/model 数据源。
 */
export const ConversationModelPicker = forwardRef<HTMLDivElement, ConversationModelPickerProps>(function ConversationModelPicker({
  id,
  initialRuntimeDimension,
  connections,
  purpose,
  providerOrder,
  selectedConnectionId,
  selectedModelId,
  selectedRuntimeValues,
  onOpenConnections,
  onRequestClose,
  onSelect,
}, forwardedRef) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const modelRadioName = useId();
  const rootRowRefs = useRef(new Map<PickerAnchorKey, HTMLButtonElement>());
  const providerRowRefs = useRef(new Map<ApiProvider, HTMLButtonElement>());
  const modelAnchorRef = useRef<HTMLElement | null>(null);
  const providerAnchorRef = useRef<HTMLElement | null>(null);
  const runtimeAnchorRef = useRef<HTMLElement | null>(null);
  const providerSurfaceRef = useRef<HTMLElement | null>(null);
  const modelSurfaceRef = useRef<HTMLElement | null>(null);
  const runtimeSurfaceRef = useRef<HTMLElement | null>(null);
  const [modelPreviewProvider, setModelPreviewProvider] = useState<ApiProvider>();
  const closePreviewTimerRef = useRef<number | undefined>(undefined);
  const cascadePointerInsideRef = useRef(false);
  const modelSelectionCommittedRef = useRef(false);
  const modelSearchRef = useRef<HTMLInputElement | null>(null);
  const eligible = useMemo(() => connections.filter((connection) => connection.capabilities.includes(purpose)), [connections, purpose]);
  const selectedConnection = eligible.find((connection) => connection.id === selectedConnectionId);
  const initialView: ConversationModelPickerView = initialRuntimeDimension && selectedConnection && selectedModelId
    ? { kind: "runtime", provider: selectedConnection.provider, connectionId: selectedConnection.id, dimension: initialRuntimeDimension }
    : { kind: "controls" };
  const { back, changeConnection, reset, showModels, showProviders, showRuntime, view } = useConversationModelNavigation({ initialView, pickerRef });
  // 顺序由 selector 在 CLOSED -> OPEN 时生成；picker 会话内只读这个快照。
  const providers = providerOrder;
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
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedSearchQuery) return models;
    return models.filter((model) => model.label.toLowerCase().includes(normalizedSearchQuery) || model.id.toLowerCase().includes(normalizedSearchQuery));
  }, [models, normalizedSearchQuery]);
  const selectedDescriptor = selectedConnection && selectedModelId
    ? getAiModelRuntimeDescriptor(selectedConnection.provider, selectedModelId)
    : undefined;
  const runtimeValues = normalizeAiSelectedRuntimeValues(selectedDescriptor, selectedRuntimeValues);
  const pickerView = view.kind === "runtime" ? view.dimension : view.kind;
  const hasCustomBudget = view.kind === "runtime"
    && view.dimension === "reasoning"
    && selectedDescriptor?.reasoning?.kind === "budget";
  const providerSurfaceVisible = view.kind === "providers" || view.kind === "models";
  const modelSurfaceVisible = view.kind === "models"
    || (view.kind === "providers" && modelPreviewProvider === activeProviderId);
  const runtimeSurfaceVisible = view.kind === "runtime";
  const surfaceKey = `${pickerView}:${activeConnection?.id ?? "none"}:${activeProviderId ?? "none"}:${modelSurfaceVisible ? "model" : "provider"}`;

  const runtimeDimension = view.kind === "runtime" ? view.dimension : undefined;
  useLayoutEffect(() => {
    modelAnchorRef.current = rootRowRefs.current.get("model") ?? null;
    providerAnchorRef.current = activeProviderId ? providerRowRefs.current.get(activeProviderId) ?? null : null;
    runtimeAnchorRef.current = runtimeDimension ? rootRowRefs.current.get(runtimeDimension) ?? null : null;
  }, [activeProviderId, modelSurfaceVisible, providerSurfaceVisible, providers, runtimeDimension]);

  const { direction, positions } = useConversationModelFlyoutPosition({
    pickerRef,
    modelAnchorRef,
    providerAnchorRef,
    runtimeAnchorRef,
    providerSurfaceRef,
    modelSurfaceRef,
    runtimeSurfaceRef,
    surfaceKey,
  });

  useEffect(() => () => {
    if (closePreviewTimerRef.current !== undefined) window.clearTimeout(closePreviewTimerRef.current);
  }, []);

  const assignPickerRef = useCallback((node: HTMLDivElement | null) => {
    pickerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) (forwardedRef as MutableRefObject<HTMLDivElement | null>).current = node;
  }, [forwardedRef]);

  const assignRootRowRef = useCallback((key: PickerAnchorKey, node: HTMLButtonElement | null) => {
    if (node) rootRowRefs.current.set(key, node);
    else rootRowRefs.current.delete(key);
  }, []);

  const assignProviderRowRef = useCallback((provider: ApiProvider, node: HTMLButtonElement | null) => {
    if (node) providerRowRefs.current.set(provider, node);
    else providerRowRefs.current.delete(provider);
  }, []);

  function usesDesktopFlyout() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function clearClosePreviewTimer() {
    if (closePreviewTimerRef.current === undefined) return;
    window.clearTimeout(closePreviewTimerRef.current);
    closePreviewTimerRef.current = undefined;
  }

  function keepCascadeOpen() {
    cascadePointerInsideRef.current = true;
    clearClosePreviewTimer();
  }

  function scheduleCascadeClose() {
    cascadePointerInsideRef.current = false;
    clearClosePreviewTimer();
    closePreviewTimerRef.current = window.setTimeout(() => {
      closePreviewTimerRef.current = undefined;
      if (!cascadePointerInsideRef.current && view.kind === "providers") setModelPreviewProvider(undefined);
    }, POINTER_GRACE_MS);
  }

  function activateProvider(provider: ApiProvider) {
    if (!providers.includes(provider)) return;
    keepCascadeOpen();
    setSearchQuery("");
    setActiveProviderId(provider);
    setModelPreviewProvider(provider);
  }

  function enterProvider(provider: ApiProvider, focusModels = false) {
    const connectionsForProvider = eligible.filter((connection) => connection.provider === provider);
    const nextConnection = connectionsForProvider.find((connection) => connection.id === selectedConnectionId) ?? connectionsForProvider[0];
    if (!nextConnection) return;
    keepCascadeOpen();
    setSearchQuery("");
    setActiveProviderId(provider);
    setModelPreviewProvider(provider);
    showModels(provider, nextConnection.id, focusModels);
  }

  function goBack() {
    clearClosePreviewTimer();
    cascadePointerInsideRef.current = false;
    setModelPreviewProvider(undefined);
    setSearchQuery("");
    back();
  }

  function closeProviderPreview() {
    clearClosePreviewTimer();
    cascadePointerInsideRef.current = false;
    setModelPreviewProvider(undefined);
  }

  function handleModelPaneKeyNavigation(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowLeft") return;
    event.preventDefault();
    goBack();
  }

  function handleModelResultsKeyNavigation(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>("input[data-model-id]:not([disabled])"));
    if (!target || !items.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      chooseModel(target.dataset.modelId ?? "");
      return;
    }
    event.preventDefault();
    const currentIndex = items.indexOf(target);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const next = items[(currentIndex + direction + items.length) % items.length];
    if (!next) return;
    next.focus();
    next.closest<HTMLElement>("[data-model-picker-row]")?.scrollIntoView({ block: "nearest" });
  }

  /** Escape 由 picker 按深度消费：搜索框先清 query，空 query 才返回/关闭一层。 */
  function handlePickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (view.kind === "models") {
      if (searchQuery.trim() && event.target === modelSearchRef.current) {
        setSearchQuery("");
        return;
      }
      goBack();
      return;
    }
    if (view.kind === "providers" && modelPreviewProvider) {
      closeProviderPreview();
      return;
    }
    if (view.kind === "providers" || view.kind === "controls") {
      onRequestClose(true);
      return;
    }
    goBack();
  }

  function openModelBrowser(focusProviders = false) {
    keepCascadeOpen();
    setModelPreviewProvider(undefined);
    setSearchQuery("");
    showProviders(focusProviders);
  }

  function openSelectedRuntime(dimension: ConversationModelRuntimeDimension, focusOptions = false) {
    if (!selectedConnection || !selectedModelId) return;
    keepCascadeOpen();
    setModelPreviewProvider(undefined);
    setSearchQuery("");
    setActiveProviderId(selectedConnection.provider);
    showRuntime(selectedConnection.provider, selectedConnection.id, dimension, focusOptions);
  }

  function handleControlKeyDown(event: KeyboardEvent<HTMLButtonElement>, openSection: (focusDetail: boolean) => void) {
    if (event.key !== "ArrowRight" && event.key !== "Enter") return;
    event.preventDefault();
    openSection(true);
  }

  function chooseModel(nextModelId: string) {
    if (!activeConnection || !nextModelId) return;
    if (modelSelectionCommittedRef.current) return;
    const descriptor = getAiModelRuntimeDescriptor(activeConnection.provider, nextModelId);
    modelSelectionCommittedRef.current = true;
    clearClosePreviewTimer();
    cascadePointerInsideRef.current = false;
    setModelPreviewProvider(undefined);
    setActiveProviderId(undefined);
    modelAnchorRef.current = null;
    providerAnchorRef.current = null;
    runtimeAnchorRef.current = null;
    reset();
    onRequestClose(true);
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

  const surfaceStyle = (surface: "provider" | "model" | "runtime"): CSSProperties => ({
    left: positions[surface].left,
    top: positions[surface].top,
    visibility: positions[surface].visible ? "visible" : "hidden",
  });

  return (
    <div
      ref={assignPickerRef}
      id={id}
      aria-label="选择对话模型"
      className={styles.picker}
      data-cascade-direction={direction}
      data-model-picker-view={pickerView}
      data-picker-has-budget={hasCustomBudget ? "true" : undefined}
      role="dialog"
      onKeyDownCapture={handlePickerKeyDown}
    >
      <nav
        aria-label="模型配置"
        className={`${styles.surface} ${styles.rootSurface}`}
        data-model-picker-surface="root"
        onKeyDown={handleProviderArrowNavigation}
        onPointerEnter={keepCascadeOpen}
        onPointerLeave={scheduleCascadeClose}
      >
        <button
          ref={(node) => assignRootRowRef("model", node)}
          className={styles.controlRow}
          data-control-active={view.kind === "providers" || view.kind === "models" ? "true" : undefined}
          data-picker-default-focus={view.kind === "controls" ? "true" : undefined}
          data-picker-focus-key="control-entry:model"
          type="button"
          onFocus={(event) => { if (usesDesktopFlyout() && event.currentTarget.dataset.pickerProgrammaticFocus !== "true") openModelBrowser(); }}
          onPointerEnter={() => openModelBrowser()}
          onKeyDown={(event) => handleControlKeyDown(event, openModelBrowser)}
          onClick={() => openModelBrowser()}
        >
          <span>模型</span><span>{selectedModelId ?? "选择模型"}<AppIcon name="chevronRight" size={16} /></span>
        </button>
        <button
          ref={(node) => assignRootRowRef("reasoning", node)}
          className={styles.controlRow}
          data-control-active={view.kind === "runtime" && view.dimension === "reasoning" ? "true" : undefined}
          data-picker-focus-key="runtime-entry:reasoning"
          disabled={!selectedDescriptor?.reasoning}
          type="button"
          onFocus={(event) => { if (usesDesktopFlyout() && event.currentTarget.dataset.pickerProgrammaticFocus !== "true") openSelectedRuntime("reasoning"); }}
          onPointerEnter={() => openSelectedRuntime("reasoning")}
          onKeyDown={(event) => handleControlKeyDown(event, (focus) => openSelectedRuntime("reasoning", focus))}
          onClick={() => openSelectedRuntime("reasoning")}
        >
          <span>推理强度</span><span>{selectedDescriptor?.reasoning?.options.find((option) => option.value === runtimeValues.reasoning)?.label ?? "不可用"}<AppIcon name="chevronRight" size={16} /></span>
        </button>
        <button
          ref={(node) => assignRootRowRef("speed", node)}
          className={styles.controlRow}
          data-control-active={view.kind === "runtime" && view.dimension === "speed" ? "true" : undefined}
          data-picker-focus-key="runtime-entry:speed"
          disabled={!selectedDescriptor?.speed}
          type="button"
          onFocus={(event) => { if (usesDesktopFlyout() && event.currentTarget.dataset.pickerProgrammaticFocus !== "true") openSelectedRuntime("speed"); }}
          onPointerEnter={() => openSelectedRuntime("speed")}
          onKeyDown={(event) => handleControlKeyDown(event, (focus) => openSelectedRuntime("speed", focus))}
          onClick={() => openSelectedRuntime("speed")}
        >
          <span>速度</span><span>{selectedDescriptor?.speed?.options.find((option) => option.value === runtimeValues.speed)?.label ?? "不可用"}<AppIcon name="chevronRight" size={16} /></span>
        </button>
      </nav>

      {providerSurfaceVisible ? (
        <div
          ref={(node) => { providerSurfaceRef.current = node; }}
          className={`${styles.surface} ${styles.providerSurface}`}
          data-model-picker-surface="provider"
          onPointerEnter={keepCascadeOpen}
          onPointerLeave={scheduleCascadeClose}
          style={surfaceStyle("provider")}
        >
          <nav aria-label="厂商" className={styles.providerPane} onKeyDown={handleProviderArrowNavigation}>
            <button aria-label="返回模型配置" className={styles.flyoutBack} type="button" onClick={goBack}><AppIcon name="back" size={16} /></button>
            {providers.length ? providers.map((provider, index) => {
              const contract = getProviderContract(provider);
              return (
                <button
                  key={provider}
                  ref={(node) => assignProviderRowRef(provider, node)}
                  className={styles.providerRow}
                  data-picker-default-focus={view.kind === "providers" && index === 0 ? "true" : undefined}
                  data-picker-focus-key={`provider:${provider}`}
                  data-provider-active={provider === activeProviderId ? "true" : undefined}
                  type="button"
                  onFocus={(event) => { if (event.currentTarget.dataset.pickerProgrammaticFocus !== "true") activateProvider(provider); }}
                  onPointerEnter={() => activateProvider(provider)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      goBack();
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
        </div>
      ) : null}

      {modelSurfaceVisible && activeProviderId && activeConnection ? (
        <section
          key={catalog.key}
          ref={(node) => { modelSurfaceRef.current = node; }}
          className={`${styles.surface} ${styles.modelSurface}`}
          data-model-picker-surface="model"
          aria-label={`${getProviderContract(activeProviderId).label} 模型`}
          onKeyDown={handleModelPaneKeyNavigation}
          onPointerEnter={keepCascadeOpen}
          onPointerLeave={scheduleCascadeClose}
          style={surfaceStyle("model")}
        >
          <div className={styles.modelPanelHeader} data-model-picker-sticky-header="true">
            <header className={styles.header}>
              <button aria-label="返回厂商" className={styles.backButton} type="button" onClick={goBack}><AppIcon name="back" size={16} /></button>
              <ProviderIcon provider={activeProviderId} size={16} />
              <strong>{getProviderContract(activeProviderId).label}</strong>
            </header>
            {providerConnections.length > 1 ? (
              <label className={styles.profileRow}>
                <span className="sr-only">连接</span>
                <select
                  aria-label="连接"
                  value={activeConnection.id}
                  onChange={(event) => { setSearchQuery(""); changeConnection(activeProviderId, event.currentTarget.value); }}
                >
                  {providerConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
                </select>
              </label>
            ) : null}
            <label className={styles.searchField}>
              <AppIcon name="search" size={16} />
              <span className="sr-only">搜索模型</span>
              <input
                ref={modelSearchRef}
                aria-label="搜索模型"
                className={styles.searchInput}
                data-picker-default-focus="true"
                placeholder="搜索模型"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
              />
            </label>
          </div>
          <div className={styles.modelResults} data-model-picker-results="true">
            <div className={styles.modelList} role="radiogroup" aria-label="模型" onKeyDown={handleModelResultsKeyNavigation}>
              {filteredModels.map((model, index) => (
                <ModelOptionRow
                  key={model.id}
                  checked={model.id === activeSelectedModelId}
                  defaultFocus={!activeSelectedModelId && index === 0}
                  model={model}
                  name={modelRadioName}
                  onChange={() => chooseModel(model.id)}
                />
              ))}
              {!filteredModels.length ? <p className={styles.modelEmptyState} role="status">{catalog.loading && !models.length ? "正在加载模型…" : models.length ? "未找到匹配模型" : "暂无可用模型"}</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {runtimeSurfaceVisible && selectedDescriptor ? (
        <section
          ref={(node) => { runtimeSurfaceRef.current = node; }}
          className={`${styles.surface} ${styles.runtimeSurface}`}
          data-model-picker-surface="runtime"
          onKeyDown={handleModelPaneKeyNavigation}
          style={surfaceStyle("runtime")}
        >
          <ConversationModelRuntimeControls
            descriptor={selectedDescriptor}
            dimension={view.kind === "runtime" ? view.dimension : undefined}
            values={runtimeValues}
            onBack={goBack}
            onChange={chooseRuntime}
          />
        </section>
      ) : null}
    </div>
  );
});
