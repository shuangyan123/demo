"use client";

import { forwardRef, useMemo, useState, type KeyboardEvent } from "react";
import { getAiModelRuntimeDescriptor, normalizeAiSelectedRuntimeValues } from "../../services/model-runtime-descriptors";
import { getProviderContract } from "../../services/provider-contracts";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import type { ApiProvider } from "../../types/domains/ai-provider";
import type { AiConnectionPurpose, AiModelCatalogEntry, ApiConnectionProfile } from "../../types/review";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import { cx } from "../shared/ui-primitives";
import { ConversationModelRuntimeControls } from "./conversation-model-runtime-controls";
import { useConnectionModelCatalog } from "./use-connection-model-catalog";

export type ConversationModelSelection = {
  connection: ApiConnectionProfile;
  modelId: string;
  selectedRuntimeValues: AiSelectedRuntimeValues;
};

type ConversationModelPickerProps = {
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

/** 模型详情只通过短 tooltip 暴露，不再占用静态推理/速度列。 */
function modelTooltip(model: AiModelCatalogEntry): string {
  const descriptor = getAiModelRuntimeDescriptor(model.provider, model.id);
  const capabilities = model.capabilities.map((capability) => capabilityLabels.get(capability) ?? capability).join(" · ");
  const runtime = descriptor
    ? [descriptor.reasoning ? "可选推理" : "", descriptor.speed ? "可选速度" : ""].filter(Boolean).join(" · ")
    : "运行参数尚未核验";
  return `${capabilities}${capabilities && runtime ? "；" : ""}${runtime}`;
}

/** 方向键在当前钻取层循环移动，Enter/Space 继续使用原生按钮行为。 */
function handleArrowNavigation(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")).filter((item) => item.offsetParent !== null);
  if (!items.length) return;
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  const direction = event.key === "ArrowDown" ? 1 : -1;
  items[(currentIndex + direction + items.length) % items.length]?.focus();
}

/** 单栏钻取选择器：厂商、具体模型、推理和速度都在同一紧凑路径中完成。 */
export const ConversationModelPicker = forwardRef<HTMLDivElement, ConversationModelPickerProps>(function ConversationModelPicker({
  id,
  connections,
  purpose,
  selectedConnectionId,
  selectedModelId,
  selectedRuntimeValues,
  onOpenConnections,
  onSelect,
}, ref) {
  const eligible = useMemo(() => connections.filter((connection) => connection.capabilities.includes(purpose)), [connections, purpose]);
  const selectedConnection = eligible.find((connection) => connection.id === selectedConnectionId);
  const providers = useMemo(() => Array.from(new Set(eligible.map((connection) => connection.provider))).sort((left, right) => {
    if (left === selectedConnection?.provider) return -1;
    if (right === selectedConnection?.provider) return 1;
    return providerCollator.compare(getProviderContract(left).label, getProviderContract(right).label);
  }), [eligible, selectedConnection?.provider]);
  const [provider, setProvider] = useState<ApiProvider>();
  const providerConnections = eligible.filter((connection) => connection.provider === provider);
  const [connectionId, setConnectionId] = useState("");
  const activeConnection = providerConnections.find((connection) => connection.id === connectionId) ?? providerConnections[0];
  const catalog = useConnectionModelCatalog(activeConnection, purpose);
  const [manualModelId, setManualModelId] = useState("");
  const activeSelectedModelId = activeConnection?.id === selectedConnectionId ? selectedModelId : undefined;
  const manualSelectedModel = activeSelectedModelId && !catalog.some((model) => model.id === activeSelectedModelId)
    ? { id: activeSelectedModelId, label: activeSelectedModelId, provider: activeConnection!.provider, purposes: [purpose], capabilities: [purpose], status: "manual" as const, source: "manual" as const }
    : undefined;
  const models = manualSelectedModel ? [manualSelectedModel, ...catalog] : catalog;
  const selectedDescriptor = activeConnection && activeSelectedModelId ? getAiModelRuntimeDescriptor(activeConnection.provider, activeSelectedModelId) : undefined;
  const runtimeValues = normalizeAiSelectedRuntimeValues(selectedDescriptor, selectedRuntimeValues);

  function openProvider(providerId: ApiProvider) {
    const connectionsForProvider = eligible.filter((connection) => connection.provider === providerId);
    const nextConnection = connectionsForProvider.find((connection) => connection.id === selectedConnectionId) ?? connectionsForProvider[0];
    setProvider(providerId);
    setConnectionId(nextConnection?.id ?? "");
    setManualModelId("");
  }

  function chooseModel(nextModelId: string) {
    if (!activeConnection) return;
    const descriptor = getAiModelRuntimeDescriptor(activeConnection.provider, nextModelId);
    onSelect({ connection: activeConnection, modelId: nextModelId, selectedRuntimeValues: normalizeAiSelectedRuntimeValues(descriptor, selectedRuntimeValues) });
  }

  function chooseRuntime(nextValues: AiSelectedRuntimeValues) {
    if (!activeConnection || !activeSelectedModelId) return;
    onSelect({ connection: activeConnection, modelId: activeSelectedModelId, selectedRuntimeValues: normalizeAiSelectedRuntimeValues(selectedDescriptor, nextValues) });
  }

  if (!eligible.length) return <button className="conversation-model-empty" type="button" onClick={onOpenConnections}>配置支持当前能力的连接</button>;

  return <div ref={ref} id={id} className="conversation-model-picker" role="dialog" aria-label="选择对话模型" onKeyDown={handleArrowNavigation}>
    {!provider ? <nav aria-label="厂商">{providers.map((providerId) => {
      const contract = getProviderContract(providerId);
      return <button key={providerId} type="button" onClick={() => openProvider(providerId)}><ProviderIcon provider={providerId} size={16} /><span>{contract.label}</span><AppIcon name="chevronRight" size={16} /></button>;
    })}</nav> : <div className="conversation-model-drilldown">
      <header><button type="button" className="conversation-model-back" aria-label="返回厂商" onClick={() => setProvider(undefined)}><AppIcon name="back" size={16} /></button><ProviderIcon provider={provider} size={18} /><strong>{getProviderContract(provider).label}</strong></header>
      {providerConnections.length > 1 ? <label className="conversation-model-profile"><span className="sr-only">连接</span><select aria-label="连接" value={activeConnection?.id ?? ""} onChange={(event) => { setConnectionId(event.currentTarget.value); setManualModelId(""); }}>{providerConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}</select></label> : null}
      <div className="conversation-model-list" role="listbox" aria-label="模型">
        {models.map((model) => <button key={model.id} className={cx(model.id === activeSelectedModelId && "is-selected")} type="button" role="option" aria-selected={model.id === activeSelectedModelId} onClick={() => chooseModel(model.id)}>
          <span className="conversation-model-name"><strong>{model.label}</strong><span className="conversation-model-info" title={modelTooltip(model)} aria-label={`${model.label} 能力`}>i</span></span>
          {model.id === activeSelectedModelId ? <AppIcon name="check" size={16} /> : null}
        </button>)}
      </div>
      {activeSelectedModelId && selectedDescriptor ? <ConversationModelRuntimeControls key={`${activeConnection?.id}:${activeSelectedModelId}`} descriptor={selectedDescriptor} values={runtimeValues} onChange={chooseRuntime} /> : null}
      {!models.length || provider === "custom" ? <label className="conversation-model-manual"><span>模型 ID</span><input value={manualModelId} placeholder="输入模型 ID" onChange={(event) => setManualModelId(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && manualModelId.trim()) { event.preventDefault(); chooseModel(manualModelId.trim()); } }} /></label> : null}
      <button className="conversation-model-manage" type="button" onClick={onOpenConnections}>管理 AI 连接</button>
    </div>}
  </div>;
});
