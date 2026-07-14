"use client";

import { useEffect, useMemo, useState } from "react";
import { preparePersonaImage } from "../../lib/persona-image";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
import { personalMemoryRepository } from "../../services/personal-memory-repository";
import {
  BUILT_IN_PERSONAS,
  createCustomPersonaDraft,
  createDefaultPersonalizationSettings,
  getPersonaImageValidationError,
  personalizationSettingsRepository,
  removeCustomPersona,
  resolvePersonaById,
  resolvePersonaImage,
} from "../../services/personalization-settings-repository";
import type { AiConnectionSnapshot, PersonaCustomization, PersonaModule, PersonaProfile, PersonalizationSettings } from "../../types/review";
import { Button } from "../shared/ui-primitives";
import { useConnectionSpeechPlayback } from "../shared/use-connection-speech-playback";
import { PersonaCardBackDialog } from "./persona-card-back-dialog";
import { PersonaCustomGallery } from "./persona-custom-gallery";
import { PersonaDefaultEditor } from "./persona-default-editor";
import { PersonaDefaultPanel } from "./persona-default-panel";
import { PersonalMemorySettingsPanel } from "./personal-memory-settings-panel";

// 个性化页只编排模式、持久化和连接状态；头像列表、定制卡库与弹层由独立组件维护。
export function PersonalizationSettingsView({
  onChanged,
}: {
  onChanged?: (settings: PersonalizationSettings) => void;
  onOpenConnections?: () => void;
}) {
  const [settings, setSettings] = useState<PersonalizationSettings>(() => createDefaultPersonalizationSettings());
  const [connections, setConnections] = useState<AiConnectionSnapshot>({ profiles: [], defaults: { id: "default", updatedAt: "" } });
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [draftPersona, setDraftPersona] = useState<PersonaProfile | null>(null);
  const [activeTab, setActiveTab] = useState<"roles" | "memory">("roles");
  const basePersonas = useMemo(() => [...BUILT_IN_PERSONAS, ...settings.customPersonas], [settings.customPersonas]);
  const personas = useMemo(() => basePersonas.map((persona) => resolvePersonaById(settings, persona.id)), [basePersonas, settings]);
  const customPersonas = useMemo(() => settings.customPersonas.map((persona) => resolvePersonaById(settings, persona.id)), [settings]);
  const editingPersona = editingPersonaId ? personas.find((persona) => persona.id === editingPersonaId) : undefined;
  const selectedSpeechConnection = connections.profiles.find((profile) => profile.id === connections.defaults.speechConnectionId);
  const activePreviewVoice = editingPersonaId ? settings.personaCustomizations[editingPersonaId]?.voice : undefined;
  const speech = useConnectionSpeechPlayback({ connection: selectedSpeechConnection, voice: activePreviewVoice });

  useEffect(() => {
    Promise.all([personalizationSettingsRepository.load(), aiConnectionsRepository.loadSnapshot()])
      .then(([saved, connectionSnapshot]) => {
        setSettings(saved);
        setConnections(connectionSnapshot);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "角色设置读取失败"));
  }, []);

  useEffect(() => {
    if (notice !== "角色设置已保存") return;
    const timer = window.setTimeout(() => setNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function closeEditor() {
    speech.stopSpeaking();
    setEditingPersonaId(null);
  }

  async function save() {
    setSaving(true);
    setNotice("正在保存…");
    try {
      const saved = await personalizationSettingsRepository.save(settings);
      setSettings(saved);
      onChanged?.(saved);
      setNotice(draftPersona ? "角色设置已保存；未添加图片的空卡仍是临时草稿" : "角色设置已保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "角色设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  function updateCustomization(personaId: string, patch: Partial<PersonaCustomization>) {
    setSettings((current) => ({
      ...current,
      personaCustomizations: {
        ...current.personaCustomizations,
        [personaId]: { ...current.personaCustomizations[personaId], ...patch },
      },
    }));
  }

  async function loadPersonaImage(persona: PersonaProfile, file: File | undefined, isDraft = false) {
    if (!file) return;
    const validationError = getPersonaImageValidationError(file);
    if (validationError) {
      setNotice(validationError);
      return;
    }
    try {
      const imageDataUrl = await preparePersonaImage(file);
      setSettings((current) => ({
        ...current,
        customPersonas: isDraft ? [...current.customPersonas, persona] : current.customPersonas,
        personaCustomizations: {
          ...current.personaCustomizations,
          [persona.id]: { ...current.personaCustomizations[persona.id], imageDataUrl },
        },
      }));
      if (isDraft) setDraftPersona(null);
      setEditingPersonaId(persona.id);
      setNotice(isDraft ? "角色已创建，完成编辑后请保存设置" : "角色图已更新，保存后会持久化");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "图片读取失败");
    }
  }

  async function updateEditorImage(persona: PersonaProfile, file: File | undefined) {
    if (!file) return;
    const validationError = getPersonaImageValidationError(file);
    if (validationError) {
      setNotice(validationError);
      return;
    }
    try {
      updateCustomization(persona.id, { imageDataUrl: await preparePersonaImage(file) });
      setNotice("图片已更新，保存后会持久化");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "图片读取失败");
    }
  }

  /** 三类重置动作分别操作角色、记忆或全部个性化，避免误删。 */
  async function resetPersonalization(kind: "roles" | "memory" | "all"): Promise<void> {
    const confirmed = kind === "roles"
      ? window.confirm("重置角色会恢复默认人设，但保留全部记忆。继续吗？")
      : kind === "memory"
        ? window.confirm(`确认清空 ${settings.memoryEntries?.length ?? 0} 条记忆吗？角色不会受影响。`)
        : window.confirm("重置全部个性化会恢复默认角色、清空记忆并关闭自动建议。继续吗？");
    if (!confirmed) return;
    try {
      const saved = kind === "roles"
        ? await personalMemoryRepository.resetRoles()
        : kind === "memory"
          ? await personalMemoryRepository.clear()
          : await personalMemoryRepository.resetAll();
      setSettings(saved);
      onChanged?.(saved);
      setNotice(kind === "roles" ? "角色已重置，记忆已保留" : kind === "memory" ? "记忆已清空，角色已保留" : "个性化已全部重置");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "个性化重置失败");
    }
  }

  return (
    <section>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">个性化</h1>
        <p className="mt-2 text-sm text-muted">分别管理 AI 的交流角色和经你确认的长期记忆。</p>
      </div>
      <div className="mt-5 inline-flex rounded-lg bg-surface-muted p-1" aria-label="个性化设置分区">
        {(["roles", "memory"] as const).map((tab) => <button key={tab} className={`min-h-9 rounded-md px-4 text-sm max-lg:min-h-11 ${activeTab === tab ? "bg-surface text-foreground shadow-sm" : "text-muted"}`} type="button" onClick={() => setActiveTab(tab)}>{tab === "roles" ? "角色" : "记忆"}</button>)}
      </div>

      {activeTab === "memory" ? (
        <div className="mt-7">
          <PersonalMemorySettingsPanel settings={settings} onSettingsChange={(saved) => { setSettings(saved); onChanged?.(saved); }} onNotice={setNotice} />
          <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            <Button type="button" variant="danger" onClick={() => void resetPersonalization("memory")}>清空记忆</Button>
            <Button type="button" variant="ghost" onClick={() => void resetPersonalization("all")}>重置全部个性化</Button>
            {notice ? <span className="text-sm text-muted" role="status">{notice}</span> : null}
          </div>
        </div>
      ) : (
      <>
      <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">角色</h2>
          <p className="mt-2 text-sm text-muted">默认人设使用头像快速选择；定制模式只管理你创建的角色卡。</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface-muted p-1" aria-label="人设展示模式">
          {(["default", "custom"] as const).map((mode) => (
            <button
              key={mode}
              className={`min-h-8 rounded-md px-4 text-sm ${settings.personaDisplayMode === mode ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}
              type="button"
              onClick={() => setSettings((current) => ({ ...current, personaDisplayMode: mode }))}
            >
              {mode === "default" ? "默认" : "定制"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-5">
        <section className={`rounded-xl border border-line bg-surface ${settings.personaDisplayMode === "custom" ? "persona-custom-surface p-5" : "p-5"}`}>
          {settings.personaDisplayMode === "default" ? (
            <PersonaDefaultPanel
              defaultPersonaId={settings.defaultPersonaId}
              modulePersonaIds={settings.modulePersonaIds}
              personas={personas}
              resolveImage={(personaId) => resolvePersonaImage(settings, personaId)}
              onDefaultChange={(personaId) => setSettings((current) => ({ ...current, defaultPersonaId: personaId }))}
              onEdit={setEditingPersonaId}
              onModuleChange={(module: PersonaModule, personaId) => setSettings((current) => ({ ...current, modulePersonaIds: { ...current.modulePersonaIds, [module]: personaId } }))}
            />
          ) : (
            <PersonaCustomGallery
              draftPersona={draftPersona}
              personas={customPersonas}
              viewMode={settings.customPersonaViewMode}
              resolveImage={(personaId) => resolvePersonaImage(settings, personaId)}
              onAddDraft={() => setDraftPersona(createCustomPersonaDraft(crypto.randomUUID()))}
              onDelete={(persona, isDraft) => {
                if (!window.confirm(`确认删除“${persona.name}”吗？`)) return;
                if (isDraft) setDraftPersona(null);
                else setSettings((current) => removeCustomPersona(current, persona.id));
              }}
              onEdit={setEditingPersonaId}
              onImageChange={(persona, file, isDraft) => void loadPersonaImage(persona, file, isDraft)}
              onViewModeChange={(customPersonaViewMode) => setSettings((current) => ({ ...current, customPersonaViewMode }))}
            />
          )}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3"><Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>{saving ? <><span className="ui-spinner" />保存中</> : "保存角色设置"}</Button><Button type="button" variant="ghost" onClick={() => void resetPersonalization("roles")}>重置角色</Button><Button type="button" variant="ghost" onClick={() => void resetPersonalization("all")}>重置全部个性化</Button>{notice ? <span className="text-sm text-muted" role="status">{notice}</span> : null}</div>

      {editingPersona ? (
        editingPersona.builtIn ? (
          <PersonaDefaultEditor
            customization={settings.personaCustomizations[editingPersona.id] ?? {}}
            imageSrc={resolvePersonaImage(settings, editingPersona.id)}
            persona={editingPersona}
            onClose={closeEditor}
            onImageChange={(file) => void updateEditorImage(editingPersona, file)}
            onPreviewVoice={() => void speech.previewVoice()}
            onRestoreImage={() => updateCustomization(editingPersona.id, { imageDataUrl: undefined })}
            onStopVoice={speech.stopSpeaking}
            onUpdate={(patch) => updateCustomization(editingPersona.id, patch)}
            speechError={speech.error}
            speechConnection={selectedSpeechConnection}
            speaking={speech.speaking}
          />
        ) : (
          <PersonaCardBackDialog
            customization={settings.personaCustomizations[editingPersona.id] ?? {}}
            persona={editingPersona}
            onClose={closeEditor}
            onPreviewVoice={() => void speech.previewVoice()}
            onStopVoice={speech.stopSpeaking}
            onUpdate={(patch) => updateCustomization(editingPersona.id, patch)}
            speechError={speech.error}
            speechConnection={selectedSpeechConnection}
            speaking={speech.speaking}
          />
        )
      ) : null}
      </>
      )}
    </section>
  );
}
