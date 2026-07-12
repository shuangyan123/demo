"use client";

import { useEffect, useMemo, useState } from "react";
import { listModelsWithConnection } from "../../services/ai-connection-client";
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
  const [manualModelId, setManualModelId] = useState("");
  const staticCatalog = activeConnection ? getProviderModelCatalog(activeConnection.provider, purpose) : [];
  const models = onlineModels.length ? onlineModels : staticCatalog;

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
    setProvider(providerId); setConnectionId(nextConnection?.id ?? ""); setOnlineModels([]); setManualModelId("");
  }

  function chooseModel(nextModelId: string) {
    if (!activeConnection) return;
    onSelect({ connection: activeConnection, modelId: nextModelId, reasoningEffort: activeConnection.id === selectedConnectionId && nextModelId === selectedModelId ? selectedReasoningEffort : undefined });
  }

  if (!eligible.length) return <button className="conversation-model-empty" type="button" onClick={onOpenConnections}>配置支持当前能力的连接</button>;

  return <div className="conversation-model-picker" role="dialog" aria-label="选择对话模型">
    {!provider ? <nav aria-label="厂商">{providers.map((providerId) => { const contract = getProviderContract(providerId); return <button key={providerId} type="button" title={contract.label} onClick={() => openProvider(providerId)}><ProviderIcon provider={providerId} size={20} /><span>{contract.label}</span></button>; })}</nav> : <div className="conversation-model-drilldown">
      <header><button type="button" className="conversation-model-back" aria-label="返回厂商" onClick={() => setProvider(undefined)}>←</button><ProviderIcon provider={provider} size={20} /><strong>{getProviderContract(provider).label}</strong></header>
      {providerConnections.length > 1 ? <label className="conversation-model-profile"><span className="sr-only">连接</span><select aria-label="连接" value={activeConnection?.id ?? ""} onChange={(event) => { setConnectionId(event.currentTarget.value); setOnlineModels([]); }}>{providerConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}</select></label> : null}
      <div className="conversation-model-list">{models.map((model) => <button key={model.id} className={cx(model.id === selectedModelId && "is-selected")} type="button" onClick={() => chooseModel(model.id)}><strong>{model.label}</strong>{model.id === selectedModelId ? <span aria-hidden="true">✓</span> : null}</button>)}</div>
      {!models.length || provider === "custom" ? <label className="conversation-model-manual">模型 ID<input value={manualModelId} placeholder="输入模型 ID" onChange={(event) => setManualModelId(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && manualModelId.trim()) { event.preventDefault(); chooseModel(manualModelId.trim()); } }} /></label> : null}
      <button className="conversation-model-manage" type="button" onClick={onOpenConnections}>管理 AI 连接</button>
    </div>}
  </div>;
}
