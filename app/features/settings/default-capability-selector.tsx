"use client";

/**
 * 默认能力选择器把连接和模型作为一次原子选择保存。
 * 在线目录与手动模型始终并存，避免连接保存后被静态回退目录锁死。
 */
import { useEffect, useMemo, useState } from "react";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
import { getCachedConnectionModelCatalog, loadConnectionModelCatalog } from "../../services/model-directory-service";
import type { AiConnectionPurpose, AiConnectionSnapshot, AiModelCatalogEntry } from "../../types/review";
import { Button } from "../shared/ui-primitives";

export const defaultPurposeLabels: Record<AiConnectionPurpose, string> = {
  text: "默认文本",
  vision: "默认多模态",
  speech: "默认语音",
  transcription: "默认转写",
  realtime: "默认实时语音",
};

type DefaultCapabilitySelectorProps = {
  snapshot: AiConnectionSnapshot;
  onSnapshotChange: (snapshot: AiConnectionSnapshot) => void;
  onChanged?: () => void;
  onFeedback: (message: string, tone?: "success" | "error" | "neutral") => void;
};

const purposes = Object.keys(defaultPurposeLabels) as AiConnectionPurpose[];

/** 从目录中选择保留值或推荐回退，未知手动值不会被名字规则误判。 */
function selectCompatibleModel(models: AiModelCatalogEntry[], currentModelId?: string): string | undefined {
  if (currentModelId && models.some((model) => model.id === currentModelId)) return currentModelId;
  return models.find((model) => model.status === "recommended")?.id ?? models[0]?.id;
}

/** 渲染五类默认能力，所有写入都通过 repository 的原子接口完成。 */
export function DefaultCapabilitySelector({ snapshot, onSnapshotChange, onChanged, onFeedback }: DefaultCapabilitySelectorProps) {
  const [catalogs, setCatalogs] = useState<Partial<Record<AiConnectionPurpose, AiModelCatalogEntry[]>>>({});
  const [loading, setLoading] = useState<AiConnectionPurpose>();
  const [manualValues, setManualValues] = useState<Partial<Record<AiConnectionPurpose, string>>>({});

  const selectedProfiles = useMemo(() => Object.fromEntries(purposes.map((purpose) => {
    const connectionId = snapshot.defaults[`${purpose}ConnectionId`];
    return [purpose, snapshot.profiles.find((profile) => profile.id === connectionId)];
  })) as Partial<Record<AiConnectionPurpose, AiConnectionSnapshot["profiles"][number]>>, [snapshot]);

  useEffect(() => {
    let active = true;
    void Promise.all(purposes.map(async (purpose) => {
      const profile = selectedProfiles[purpose];
      if (!profile) return [purpose, []] as const;
      const cached = getCachedConnectionModelCatalog(profile, purpose);
      const result = cached.length ? cached : (await loadConnectionModelCatalog(profile, purpose)).models;
      return [purpose, result] as const;
    })).then((entries) => {
      if (active) setCatalogs(Object.fromEntries(entries));
    });
    return () => { active = false; };
  }, [selectedProfiles]);

  /** 刷新设置快照，确保连接与模型的乐观 UI 最终以持久化结果为准。 */
  async function refreshSnapshot(): Promise<void> {
    onSnapshotChange(await aiConnectionsRepository.loadSnapshot());
    onChanged?.();
  }

  /** 连接变化时先解析目录，再以同一写入保存连接和兼容模型。 */
  async function selectConnection(purpose: AiConnectionPurpose, connectionId: string): Promise<void> {
    setLoading(purpose);
    try {
      if (!connectionId) {
        await aiConnectionsRepository.setDefaultSelection(purpose, undefined, undefined);
        setCatalogs((current) => ({ ...current, [purpose]: [] }));
        await refreshSnapshot();
        onFeedback(`${defaultPurposeLabels[purpose]}已清除`);
        return;
      }
      const profile = snapshot.profiles.find((item) => item.id === connectionId);
      if (!profile) throw new Error("连接不存在，请刷新后重试");
      const result = await loadConnectionModelCatalog(profile, purpose);
      const currentModelId = snapshot.defaults[`${purpose}ModelId`];
      const modelId = selectCompatibleModel(result.models, currentModelId);
      if (!modelId) throw new Error("该连接没有可用目录模型，请使用手动模型 ID");
      await aiConnectionsRepository.setDefaultSelection(purpose, connectionId, modelId);
      setCatalogs((current) => ({ ...current, [purpose]: result.models }));
      await refreshSnapshot();
      onFeedback(currentModelId === modelId ? `${defaultPurposeLabels[purpose]}已切换，模型已保留` : `${defaultPurposeLabels[purpose]}已切换为 ${modelId}`);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "默认连接更新失败", "error");
    } finally {
      setLoading(undefined);
    }
  }

  /** 保存目录选择或手动模型 ID，不修改连接凭据。 */
  async function selectModel(purpose: AiConnectionPurpose, modelId: string): Promise<void> {
    const connectionId = snapshot.defaults[`${purpose}ConnectionId`];
    if (!connectionId || !modelId.trim()) return;
    try {
      await aiConnectionsRepository.setDefaultSelection(purpose, connectionId, modelId.trim());
      await refreshSnapshot();
      setManualValues((current) => ({ ...current, [purpose]: "" }));
      onFeedback(`${defaultPurposeLabels[purpose]}模型已更新`);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "默认模型更新失败", "error");
    }
  }

  return (
    <section className="mt-7 rounded-lg border border-line bg-surface" aria-label="默认能力分配">
      <div className="divide-y divide-line">
        {purposes.map((purpose) => {
          const connectionKey = `${purpose}ConnectionId` as const;
          const modelKey = `${purpose}ModelId` as const;
          const options = snapshot.profiles.filter((profile) => profile.capabilities.includes(purpose));
          const selectedProfile = selectedProfiles[purpose];
          const models = catalogs[purpose] ?? [];
          const selectedModelId = snapshot.defaults[modelKey] ?? "";
          const knownModel = models.some((model) => model.id === selectedModelId);
          return (
            <div key={purpose} className="grid min-h-14 grid-cols-[8rem_minmax(10rem,1fr)_minmax(11rem,1fr)] items-center gap-3 px-3 py-2 max-md:grid-cols-1 max-md:gap-2">
              <span className="text-sm font-medium">{defaultPurposeLabels[purpose]}</span>
              <select aria-label={`${defaultPurposeLabels[purpose]}连接`} className="settings-select min-h-9" disabled={loading === purpose} value={snapshot.defaults[connectionKey] ?? ""} onChange={(event) => void selectConnection(purpose, event.currentTarget.value)}>
                <option value="">未指定</option>
                {options.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </select>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <select aria-label={`${defaultPurposeLabels[purpose]}模型`} className="settings-select min-h-9" disabled={!selectedProfile || loading === purpose} value={knownModel ? selectedModelId : ""} onChange={(event) => void selectModel(purpose, event.currentTarget.value)}>
                  <option value="">{selectedModelId && !knownModel ? `手动：${selectedModelId}` : "选择目录模型"}</option>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.label}{model.capabilitySource === "unknown" ? " · 待核验" : ""}</option>)}
                </select>
                <div className="grid grid-cols-[8.5rem_2rem] overflow-hidden rounded-md border border-line bg-surface">
                  <input aria-label={`${defaultPurposeLabels[purpose]}手动模型 ID`} className="min-w-0 bg-transparent px-2 text-sm outline-none" disabled={!selectedProfile} placeholder="手动模型 ID" value={manualValues[purpose] ?? ""} onChange={(event) => setManualValues((current) => ({ ...current, [purpose]: event.currentTarget.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void selectModel(purpose, event.currentTarget.value); } }} />
                  <Button aria-label={`保存${defaultPurposeLabels[purpose]}手动模型`} size="sm" type="button" variant="ghost" disabled={!selectedProfile || !manualValues[purpose]?.trim()} onClick={() => void selectModel(purpose, manualValues[purpose] ?? "")}>↵</Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
