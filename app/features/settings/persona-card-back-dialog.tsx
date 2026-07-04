"use client";

import type { PersonaCustomization, PersonaProfile } from "../../types/review";
import { PersonaEditorDialog } from "./persona-editor-dialog";
import { PersonaVoiceSection } from "./persona-voice-section";

/**
 * 定制卡片背面只编辑角色名称、描述和独立音色，不渲染头像或任何金色镶边。
 */
export function PersonaCardBackDialog({
  customization,
  persona,
  onClose,
  onPreviewVoice,
  onStopVoice,
  onUpdate,
  speechError,
  speaking,
}: {
  customization: PersonaCustomization;
  persona: PersonaProfile;
  onClose: () => void;
  onPreviewVoice: () => void;
  onStopVoice: () => void;
  onUpdate: (patch: Partial<PersonaCustomization>) => void;
  speechError?: string;
  speaking: boolean;
}) {
  const inputClass = "settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm";

  return (
    <PersonaEditorDialog label={`编辑${persona.name}`} variant="card-back" onClose={onClose}>
      <div className="persona-card-back-content h-full overflow-y-auto p-6 max-sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted">角色卡背面</p>
            <h3 className="mt-1 text-xl font-semibold">{persona.name}</h3>
          </div>
          <button className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground" type="button" onClick={onClose}>完成</button>
        </div>
        <label className="mt-5 grid gap-1.5 text-xs font-medium">角色名称
          <input className={inputClass} value={persona.name} onChange={(event) => onUpdate({ name: event.target.value })} />
        </label>
        <label className="mt-4 grid gap-1.5 text-xs font-medium">角色描述
          <textarea className={`${inputClass} min-h-28 resize-y`} value={persona.role} onChange={(event) => onUpdate({ role: event.target.value })} />
        </label>
        <PersonaVoiceSection
          customization={customization}
          onPreviewVoice={onPreviewVoice}
          onStopVoice={onStopVoice}
          onUpdate={onUpdate}
          speechError={speechError}
          speaking={speaking}
        />
      </div>
    </PersonaEditorDialog>
  );
}
