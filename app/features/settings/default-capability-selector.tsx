"use client";

/**
 * 默认能力选择器把连接和模型作为一次原子选择保存。
 * 在线目录与手动模型始终并存，避免连接保存后被静态回退目录锁死。
 */
import { useEffect, useMemo, useState } from "react";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
import { getCachedConnectionModelCatalog, loadConnectionModelCatalog } from "../../services/model-directory-service";
import type { AiConnectionPurpose, AiConnectionSnapshot, AiModelCatalogEntry } from "../../types/review";
import { AppIcon } from "../shared/app-icon";
import { Button } from "../shared/ui-primitives";
import { BrandedOptionSelect } from "./branded-option-select";
import styles from "./settings-compact.module.css";

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
const primaryPurposes: AiConnectionPurpose[] = ["text", "vision"];
const secondaryPurposes: AiConnectionPurpose[] = ["speech", "transcription", "realtime"];

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
  const [manualOpen, setManualOpen] = useState<Partial<Record<AiConnectionPurpose, boolean>>>({});
  const [pendingConnectionIds, setPendingConnectionIds] = useState<Partial<Record<AiConnectionPurpose, string>>>({});

  const selectedProfiles = useMemo(() => Object.fromEntries(purposes.map((purpose) => {
    const connectionId = pendingConnectionIds[purpose] ?? snapshot.defaults[`${purpose}ConnectionId`];
    return [purpose, snapshot.profiles.find((profile) => profile.id === connectionId)];
  })) as Partial<Record<AiConnectionPurpose, AiConnectionSnapshot["profiles"][number]>>, [pendingConnectionIds, snapshot]);

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
        setPendingConnectionIds((current) => ({ ...current, [purpose]: undefined }));
        await refreshSnapshot();
        onFeedback(`${defaultPurposeLabels[purpose]}已清除`);
        return;
      }
      const profile = snapshot.profiles.find((item) => item.id === connectionId);
      if (!profile) throw new Error("连接不存在，请刷新后重试");
      const result = await loadConnectionModelCatalog(profile, purpose);
      const currentModelId = snapshot.defaults[`${purpose}ModelId`];
      const modelId = selectCompatibleModel(result.models, currentModelId);
      if (!modelId) {
        setCatalogs((current) => ({ ...current, [purpose]: [] }));
        setPendingConnectionIds((current) => ({ ...current, [purpose]: connectionId }));
        onFeedback(`${defaultPurposeLabels[purpose]}连接已选择，请输入手动模型 ID`, "neutral");
        return;
      }
      await aiConnectionsRepository.setDefaultSelection(purpose, connectionId, modelId);
      setCatalogs((current) => ({ ...current, [purpose]: result.models }));
      setPendingConnectionIds((current) => ({ ...current, [purpose]: undefined }));
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
    const connectionId = pendingConnectionIds[purpose] ?? snapshot.defaults[`${purpose}ConnectionId`];
    if (!connectionId || !modelId.trim()) return;
    try {
      await aiConnectionsRepository.setDefaultSelection(purpose, connectionId, modelId.trim());
      await refreshSnapshot();
      setManualValues((current) => ({ ...current, [purpose]: "" }));
      setManualOpen((current) => ({ ...current, [purpose]: false }));
      setPendingConnectionIds((current) => ({ ...current, [purpose]: undefined }));
      onFeedback(`${defaultPurposeLabels[purpose]}模型已更新`);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "默认模型更新失败", "error");
    }
  }

  /** 单行同时展示连接、目录模型和按需出现的手动模型编辑入口。 */
  function renderPurpose(purpose: AiConnectionPurpose) {
    const connectionKey = `${purpose}ConnectionId` as const;
    const modelKey = `${purpose}ModelId` as const;
    const options = snapshot.profiles.filter((profile) => profile.capabilities.includes(purpose));
    const selectedProfile = selectedProfiles[purpose];
    const models = catalogs[purpose] ?? [];
    const selectedModelId = snapshot.defaults[modelKey] ?? "";
    const editing = manualOpen[purpose] === true;
    return (
      <div key={purpose} className={`${styles.tableRow} ${styles.capabilityRow}`}>
        <strong className="text-sm font-medium">{defaultPurposeLabels[purpose]}</strong>
        <BrandedOptionSelect
          ariaLabel={`${defaultPurposeLabels[purpose]}连接`}
          disabled={loading === purpose}
          value={pendingConnectionIds[purpose] ?? snapshot.defaults[connectionKey] ?? ""}
          placeholder="未指定"
          options={[
            { value: "", label: "未指定" },
            ...options.map((profile) => ({ value: profile.id, label: profile.label, provider: profile.provider })),
          ]}
          onChange={(value) => void selectConnection(purpose, value)}
        />
        <BrandedOptionSelect
          ariaLabel={`${defaultPurposeLabels[purpose]}模型`}
          disabled={!selectedProfile || loading === purpose}
          provider={selectedProfile?.provider}
          value={selectedModelId}
          placeholder="选择目录模型"
          options={models.map((model) => ({ value: model.id, label: model.label, provider: selectedProfile?.provider, description: model.capabilitySource === "unknown" ? "待核验" : undefined }))}
          onChange={(value) => void selectModel(purpose, value)}
        />
        <button
          aria-expanded={editing}
          aria-label={`编辑${defaultPurposeLabels[purpose]}手动模型 ID`}
          className={styles.iconButton}
          disabled={!selectedProfile}
          type="button"
          onClick={() => {
            setManualOpen((current) => ({ ...current, [purpose]: !current[purpose] }));
            if (!editing && !manualValues[purpose]) setManualValues((current) => ({ ...current, [purpose]: selectedModelId }));
          }}
        >
          <AppIcon name="edit" size={16} />
        </button>
        {editing ? (
          <div className={styles.manualEditor}>
            <input
              aria-label={`${defaultPurposeLabels[purpose]}手动模型 ID`}
              className={styles.input}
              disabled={!selectedProfile}
              placeholder="手动模型 ID"
              value={manualValues[purpose] ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setManualValues((current) => ({ ...current, [purpose]: value }));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void selectModel(purpose, event.currentTarget.value);
                }
              }}
            />
            <Button size="sm" type="button" variant="soft" disabled={!manualValues[purpose]?.trim()} onClick={() => void selectModel(purpose, manualValues[purpose] ?? "")}>保存</Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className={styles.capabilitySection} aria-label="默认能力分配">
      <div className={styles.table}>
        {primaryPurposes.map(renderPurpose)}
        <details className={styles.disclosure}>
          <summary><span>更多默认能力</span><AppIcon name="chevronDown" size={16} /></summary>
          {secondaryPurposes.map(renderPurpose)}
        </details>
      </div>
    </section>
  );
}
