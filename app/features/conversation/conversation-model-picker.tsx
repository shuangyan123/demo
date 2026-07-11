"use client";

import { useMemo, useState } from "react";
import { getProviderContract, getProviderModelCatalog } from "../../services/provider-contracts";
import type { AiConnectionPurpose, AiModelCatalogEntry, ApiConnectionProfile, ApiProvider } from "../../types/review";
import { ProviderIcon } from "../shared/provider-icon";
import { cx } from "../shared/ui-primitives";

type ModelSelection = { connection: ApiConnectionProfile; modelId: string };

type ConversationModelPickerProps = {
  connections: ApiConnectionProfile[];
  purpose: AiConnectionPurpose;
  selectedConnectionId?: string;
  selectedModelId?: string;
  onOpenConnections: () => void;
  onSelect: (selection: ModelSelection) => void;
};

const groupLabels: Record<string, string> = { text: "文本", multimodal: "多模态", speech: "语音", transcription: "转写" };

/** 两级模型选择器：先选择厂商，再在同一密钥档案下选择具体模型。 */
export function ConversationModelPicker({ connections, purpose, selectedConnectionId, selectedModelId, onOpenConnections, onSelect }: ConversationModelPickerProps) {
  const eligible = useMemo(() => connections.filter((connection) => connection.capabilities.includes(purpose)), [connections, purpose]);
  const providers = useMemo(() => Array.from(new Set(eligible.map((connection) => connection.provider))), [eligible]);
  const selectedConnection = eligible.find((connection) => connection.id === selectedConnectionId) ?? eligible[0];
  const [provider, setProvider] = useState<ApiProvider | undefined>(selectedConnection?.provider ?? providers[0]);
  const providerConnections = eligible.filter((connection) => connection.provider === provider);
  const activeConnection = providerConnections.find((connection) => connection.id === selectedConnection?.id) ?? providerConnections[0];

  const catalog = activeConnection ? getProviderModelCatalog(activeConnection.provider, purpose).filter((entry) => entry.lifecycle !== "deprecated").slice(0, 12) : [];
  const models: AiModelCatalogEntry[] = activeConnection && !catalog.some((entry) => entry.id === activeConnection.model)
    ? [{ id: activeConnection.model, label: activeConnection.model, provider: activeConnection.provider, purposes: [purpose], capabilities: activeConnection.capabilities, status: "manual", source: "manual", lifecycle: "active", family: activeConnection.model, modalityGroup: purpose === "vision" ? "multimodal" : purpose }, ...catalog]
    : catalog;

  if (!eligible.length) return <button className="conversation-model-empty" type="button" onClick={onOpenConnections}>配置支持当前能力的连接</button>;

  return (
    <div className="conversation-model-picker" role="dialog" aria-label="选择对话模型">
      <nav aria-label="厂商">
        {providers.map((providerId) => {
          const contract = getProviderContract(providerId);
          return (
            <button key={providerId} className={cx(provider === providerId && "is-selected")} type="button" title={contract.label} onClick={() => setProvider(providerId)}>
              <ProviderIcon provider={providerId} size={20} /><span>{contract.label}</span>
            </button>
          );
        })}
      </nav>
      <section>
        {providerConnections.length > 1 ? (
          <label className="conversation-model-profile">连接档案<select value={activeConnection?.id} onChange={(event) => {
            const connection = providerConnections.find((item) => item.id === event.currentTarget.value);
            if (connection) onSelect({ connection, modelId: connection.model });
          }}>{providerConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}</select></label>
        ) : <p className="conversation-model-profile-name">{activeConnection?.label}</p>}
        <div className="conversation-model-list">
          {models.map((model) => (
            <button key={model.id} className={cx(model.id === selectedModelId && activeConnection?.id === selectedConnectionId && "is-selected")} type="button" onClick={() => activeConnection && onSelect({ connection: activeConnection, modelId: model.id })}>
              <span><strong>{model.label}</strong><small>{groupLabels[model.modalityGroup ?? "text"] ?? model.modalityGroup ?? "文本"}{model.generation ? ` · ${model.generation}` : ""}</small></span>
              {model.id === selectedModelId && activeConnection?.id === selectedConnectionId ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
        <button className="conversation-model-manage" type="button" onClick={onOpenConnections}>管理 AI 连接</button>
      </section>
    </div>
  );
}
