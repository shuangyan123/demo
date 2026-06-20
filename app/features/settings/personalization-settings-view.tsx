"use client";

import { useEffect, useMemo, useState } from "react";
import { preparePersonaImage } from "../../lib/persona-image";
import { aiConnectionsRepository } from "../../services/ai-connections-repository";
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

// 个性化页只编排模式、持久化和连接状态；头像列表、定制卡库与弹层由独立组件维护。
export function PersonalizationSettingsView({
  onChanged,
  onOpenConnections,
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
      .catch((error) => setNotice(error instanceof Error ? error.message : "个性化设置读取失败"));
  }, []);

  useEffect(() => {
    if (notice !== "个性化设置已保存") return;
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
      setNotice(draftPersona ? "个性化设置已保存；未添加图片的空卡仍是临时草稿" : "个性化设置已保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "个性化设置保存失败");
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

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">个性化</h1>
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
              resolveImage={(personaId) => resolvePersonaImage(settings, personaId)}
              onAddDraft={() => setDraftPersona(createCustomPersonaDraft(crypto.randomUUID()))}
              onDelete={(persona, isDraft) => {
                if (!window.confirm(`确认删除“${persona.name}”吗？`)) return;
                if (isDraft) setDraftPersona(null);
                else setSettings((current) => removeCustomPersona(current, persona.id));
              }}
              onEdit={setEditingPersonaId}
              onImageChange={(persona, file, isDraft) => void loadPersonaImage(persona, file, isDraft)}
            />
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-lg font-semibold">语音连接</h2>
          <p className="mt-1 text-sm text-muted">音色在每个角色中单独配置；朗读只使用默认语音连接，缺失配置时保持静音。</p>
          <div className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm">
            <span className="truncate">{selectedSpeechConnection ? `${selectedSpeechConnection.label} · ${selectedSpeechConnection.maskedKey}` : "未配置默认语音连接"}</span>
            {onOpenConnections ? <Button type="button" size="sm" variant="ghost" onClick={onOpenConnections}>前往 AI 连接</Button> : null}
          </div>
        </section>
      </div>

      <div className="mt-5 flex items-center gap-3"><Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>{saving ? <><span className="ui-spinner" />保存中</> : "保存个性化设置"}</Button>{notice ? <span className="text-sm text-muted" role="status">{notice}</span> : null}</div>

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
            speaking={speech.speaking}
          />
        )
      ) : null}
    </section>
  );
}
