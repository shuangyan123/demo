"use client";

import Image from "next/image";
import { useRef } from "react";
import type { PersonaProfile } from "../../types/domains/personalization.ts";

/** 定制人设的紧凑头像卡；编辑、换图和删除行为与闪卡模式保持一致。 */
export function PersonaAvatarCard({
  imageSrc,
  persona,
  onActivate,
  onDelete,
  onImageChange,
}: {
  imageSrc?: string;
  persona: PersonaProfile;
  onActivate: () => void;
  onDelete: () => void;
  onImageChange: (file: File | undefined) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function activate() {
    if (imageSrc) onActivate();
    else fileInputRef.current?.click();
  }

  return (
    <article className="persona-avatar-card">
      <button className="persona-avatar-main" type="button" onClick={activate} aria-label={imageSrc ? `编辑${persona.name}` : `为${persona.name}添加图片`}>
        <span className="persona-avatar-image relative overflow-hidden rounded-full border border-line bg-surface-muted">
          {imageSrc ? (
            <Image alt={`${persona.name}头像`} className="object-cover object-center" fill sizes="72px" src={imageSrc} unoptimized={imageSrc.startsWith("data:")} />
          ) : (
            <span className="grid h-full place-items-center text-xl text-muted" aria-hidden="true">＋</span>
          )}
        </span>
        <strong className="max-w-full truncate text-xs">{persona.name}</strong>
      </button>
      <div className="persona-avatar-actions" aria-label={`${persona.name}操作`}>
        <button type="button" onClick={() => fileInputRef.current?.click()}>换图</button>
        <button className="is-danger" type="button" onClick={onDelete}>删除</button>
      </div>
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        tabIndex={-1}
        onChange={(event) => {
          onImageChange(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </article>
  );
}
