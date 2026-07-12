"use client";

import { useEffect, useMemo, useState } from "react";
import { listModelsWithConnection } from "../../services/ai-connection-client";
import { getModelReasoningDescriptor } from "../../services/model-reasoning";
import { providerModelCache } from "../../services/provider-model-cache";
import { getProviderContract, getProviderModelCatalog } from "../../services/provider-contracts";
import type { AiConnectionPurpose, AiModelCatalogEntry, ApiConnectionProfile, ApiProvider } from "../../types/review";
import { ProviderIcon } from "../shared/provider-icon";
import { cx } from "../shared/ui-primitives";

type ModelSelection = { connection: ApiConnectionProfile; modelId: string; reasoningEffort?: string };

type ConversationModelPickerProps = {
  connections: ApiConnectionProfile[];
  purpose: AiConnectionPurpose;
  selectedConnectionId?: string;
  selectedModelId?: string;
  selectedReasoningEffort?: string;
  onOpenConnections: () => void;
  onSelect: (selection: ModelSelection) => void;
};

const groupLabels: Record<string, string> = { text: "文本", multimodal: "多模态", speech: "语音", transcription: "转写", realtime: "实时语音" };
const sourceLabels: Record<AiModelCatalogEntry["source"], string> = { official_live: "在线目录", official_fallback: "官方回退", manual: "手动" };
const providerCollator = new Intl.Collator("en", { sensitivity: "base" });

function toCatalogEntry(connection: ApiConnectionProfile, purpose: AiConnectionPurpose, model: Awaited<ReturnType<typeof listModelsWithConnection>>["models"][number]): AiModelCatalogEntry {
  return { id: model.id, label: model.label, provider: connection.provider, purposes: [purpose], capabilities: model.capabilities, status: model.status === "preview" ? "preview" : model.status === "deprecated" ? "deprecated" : "stable", source: "official_live", family: model.family, generation: model.generation, modalityGroup: model.modalityGroup, lifecycle: model.status === "deprecated" ? "deprecated" : model.status === "preview" ? "preview" : "active", verifiedAt: model.updatedAt.slice(0, 10) };
}

/** 单栏钻取选择器：厂商、模型和推理强度都在同一纵向路径完成。 */
export function ConversationModelPicker({ connections, purpose, selectedConnectionId, selectedModelId, selectedReasoningEffort, onOpenConnections, onSelect }: ConversationModelPickerProps) {
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
  const [onlineModels, setOnlineModels] = useState<AiModelCatalogEntry[]>([]);
  const [modelId, setModelId] = useState("");
  const [manualModelId, setManualModelId] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const staticCatalog = activeConnection ? getProviderModelCatalog(activeConnection.provider, purpose) : [];
  const models = onlineModels.length ? onlineModels : staticCatalog;
  const effectiveModelId = modelId || manualModelId;
  const reasoning = activeConnection && effectiveModelId ? getModelReasoningDescriptor(activeConnection.provider, effectiveModelId) : undefined;

  useEffect(() => {
    if (!activeConnection || !provider || getProviderContract(provider).modelListStrategy !== "official_api") return;
    let active = true;
    const cached = providerModelCache.load(provider, activeConnection.baseUrl);
    if (cached && !providerModelCache.isStale(cached)) {
      queueMicrotask(() => { if (active) setOnlineModels(cached.models.filter((model) => model.capabilities.includes(purpose) && model.status !== "deprecated").map((model) => toCatalogEntry(activeConnection, purpose, model))); });
      return;
    }
    void listModelsWithConnection(activeConnection).then((result) => {
      providerModelCache.save(provider, activeConnection.baseUrl, result);
      if (active) setOnlineModels(result.models.filter((model) => model.capabilities.includes(purpose) && model.status !== "deprecated").map((model) => toCatalogEntry(activeConnection, purpose, model)));
    }).catch(() => { if (active) setOnlineModels([]); });
    return () => { active = false; };
  }, [activeConnection, provider, purpose]);

  function openProvider(providerId: ApiProvider) {
    const connectionsForProvider = eligible.filter((connection) => connection.provider === providerId);
    const nextConnection = connectionsForProvider.find((connection) => connection.id === selectedConnectionId) ?? connectionsForProvider[0];
    const catalog = getProviderModelCatalog(providerId, purpose);
    const nextModel = nextConnection?.id === selectedConnectionId && selectedModelId ? selectedModelId : catalog[0]?.id ?? "";
    const descriptor = nextModel ? getModelReasoningDescriptor(providerId, nextModel) : undefined;
    setProvider(providerId); setConnectionId(nextConnection?.id ?? ""); setOnlineModels([]); setModelId(nextModel); setManualModelId(""); setReasoningEffort(descriptor?.options.some((option) => option.id === selectedReasoningEffort) ? selectedReasoningEffort! : descriptor?.defaultValue ?? "");
  }

  function chooseModel(nextModelId: string) {
    const descriptor = activeConnection ? getModelReasoningDescriptor(activeConnection.provider, nextModelId) : undefined;
    setModelId(nextModelId); setManualModelId(""); setReasoningEffort(descriptor?.defaultValue ?? "");
  }

  if (!eligible.length) return <button className="conversation-model-empty" type="button" onClick={onOpenConnections}>配置支持当前能力的连接</button>;

  return <div className="conversation-model-picker" role="dialog" aria-label="选择对话模型">
    {!provider ? <nav aria-label="厂商">{providers.map((providerId) => { const contract = getProviderContract(providerId); return <button key={providerId} type="button" title={contract.label} onClick={() => openProvider(providerId)}><ProviderIcon provider={providerId} size={20} /><span>{contract.label}</span></button>; })}</nav> : <div className="conversation-model-drilldown">
      <header><button type="button" className="conversation-model-back" aria-label="返回厂商" onClick={() => setProvider(undefined)}>←</button><ProviderIcon provider={provider} size={20} /><strong>{getProviderContract(provider).label}</strong></header>
      {providerConnections.length > 1 ? <label className="conversation-model-profile">连接档案<select value={activeConnection?.id ?? ""} onChange={(event) => { const next = providerConnections.find((item) => item.id === event.currentTarget.value); setConnectionId(event.currentTarget.value); setOnlineModels([]); const firstModel = next ? getProviderModelCatalog(next.provider, purpose)[0]?.id ?? "" : ""; chooseModel(firstModel); }}>{providerConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}</select></label> : <p className="conversation-model-profile-name">{activeConnection?.label}</p>}
      <div className="conversation-model-list">{models.map((model) => <button key={model.id} className={cx(model.id === effectiveModelId && "is-selected")} type="button" onClick={() => chooseModel(model.id)}><span><strong>{model.label}</strong><small>{groupLabels[model.modalityGroup ?? "text"] ?? "文本"} · {model.lifecycle === "preview" ? "预览" : "有效"} · {sourceLabels[model.source]}{model.verifiedAt ? ` · 核验 ${model.verifiedAt}` : ""}</small></span>{model.id === effectiveModelId ? <span aria-hidden="true">✓</span> : null}</button>)}</div>
      {!models.length || provider === "custom" ? <label className="conversation-model-manual">模型 ID<input value={manualModelId} placeholder="输入厂商支持的模型 ID" onChange={(event) => { setManualModelId(event.currentTarget.value); setModelId(""); setReasoningEffort(""); }} /></label> : null}
      {reasoning ? <fieldset className="conversation-model-reasoning"><legend>推理强度</legend>{reasoning.options.map((option) => <label key={option.id}><input type="radio" name="reasoning-effort" value={option.id} checked={(reasoningEffort || reasoning.defaultValue) === option.id} disabled={reasoning.readOnly} onChange={() => setReasoningEffort(option.id)} /><span>{option.label}</span></label>)}</fieldset> : null}
      <div className="conversation-model-actions"><button type="button" className="ui-button ui-button-primary" disabled={!activeConnection || !effectiveModelId.trim()} onClick={() => activeConnection && onSelect({ connection: activeConnection, modelId: effectiveModelId.trim(), reasoningEffort: reasoning ? reasoningEffort || reasoning.defaultValue : undefined })}>使用此模型</button><button type="button" onClick={onOpenConnections}>管理 AI 连接</button></div>
    </div>}
  </div>;
}
