"use client";

import Image from "next/image";
import type { ApiConnectionProfile, PersonaCustomization, PersonaProfile } from "../../types/review";
import { PersonaEditorDialog } from "./persona-editor-dialog";
import { PersonaVoiceSection } from "./persona-voice-section";

/**
 * 默认人设使用宽版可滚动编辑面，头像置顶，完整行为字段和角色音色都可访问。
 */
export function PersonaDefaultEditor({
  customization,
  imageSrc,
  persona,
  onClose,
  onImageChange,
  onPreviewVoice,
  onRestoreImage,
  onStopVoice,
  onUpdate,
  speechError,
  speechConnection,
  speaking,
}: {
  customization: PersonaCustomization;
  imageSrc?: string;
  persona: PersonaProfile;
  onClose: () => void;
  onImageChange: (file: File | undefined) => void;
  onPreviewVoice: () => void;
  onRestoreImage: () => void;
  onStopVoice: () => void;
  onUpdate: (patch: Partial<PersonaCustomization>) => void;
  speechError?: string;
  speechConnection?: ApiConnectionProfile;
  speaking: boolean;
}) {
  const inputClass = "settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm";

  return (
    <PersonaEditorDialog label={`编辑${persona.name}`} variant="default" onClose={onClose}>
      <div className="persona-default-editor-content grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-6 py-4 max-sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-line bg-surface-muted">
              {imageSrc ? <Image alt={`${persona.name}头像`} className="object-cover" fill sizes="56px" src={imageSrc} unoptimized={imageSrc.startsWith("data:")} /> : <span className="grid h-full place-items-center font-semibold">{persona.name.slice(0, 1)}</span>}
            </span>
            <div className="min-w-0"><p className="text-xs text-muted">默认人设编辑</p><h3 className="mt-0.5 truncate text-xl font-semibold">{persona.name}</h3></div>
          </div>
          <button className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground" type="button" onClick={onClose}>完成</button>
        </header>

        <div className="min-h-0 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 max-sm:px-5">
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <label className="grid gap-1.5 text-xs font-medium">角色名称
            <input className={inputClass} value={persona.name} onChange={(event) => onUpdate({ name: event.target.value })} />
          </label>
          <div className="grid gap-1.5 text-xs font-medium">
            <span>角色头像</span>
            <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <label className="cursor-pointer rounded-md bg-surface-muted px-2.5 py-1.5 text-xs hover:text-foreground">上传高清图片
                <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onImageChange(event.currentTarget.files?.[0])} />
              </label>
              {customization.imageDataUrl ? <button className="text-xs text-muted hover:text-foreground" type="button" onClick={onRestoreImage}>恢复默认头像</button> : null}
            </div>
          </div>
        </div>
        <label className="mt-4 grid gap-1.5 text-xs font-medium">角色描述
          <textarea className={`${inputClass} min-h-20 resize-y`} value={persona.role} onChange={(event) => onUpdate({ role: event.target.value })} />
        </label>
        <div className="mt-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <label className="grid gap-1.5 text-xs font-medium">教学风格
            <textarea className={`${inputClass} min-h-20 resize-y`} value={persona.teachingStyle} onChange={(event) => onUpdate({ teachingStyle: event.target.value })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">追问方式
            <textarea className={`${inputClass} min-h-20 resize-y`} value={persona.questioningStyle} onChange={(event) => onUpdate({ questioningStyle: event.target.value })} />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <label className="grid gap-1.5 text-xs font-medium">严格度
            <select className={inputClass} value={persona.strictness} onChange={(event) => onUpdate({ strictness: event.target.value as PersonaProfile["strictness"] })}>
              <option value="gentle">温和</option><option value="balanced">平衡</option><option value="strict">严格</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">回答长度
            <select className={inputClass} value={persona.verbosity} onChange={(event) => onUpdate({ verbosity: event.target.value as PersonaProfile["verbosity"] })}>
              <option value="concise">简洁</option><option value="balanced">适中</option><option value="detailed">详细</option>
            </select>
          </label>
        </div>
        <label className="mt-4 grid gap-1.5 text-xs font-medium">补充要求
          <textarea className={`${inputClass} min-h-20 resize-y`} value={persona.customInstructions} onChange={(event) => onUpdate({ customInstructions: event.target.value })} />
        </label>
        <PersonaVoiceSection
          customization={customization}
          onPreviewVoice={onPreviewVoice}
          onStopVoice={onStopVoice}
          onUpdate={onUpdate}
          speechError={speechError}
          speechConnection={speechConnection}
          speaking={speaking}
        />
        </div>
      </div>
    </PersonaEditorDialog>
  );
}
