"use client";

import Image from "next/image";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef } from "react";
import type { PersonaProfile } from "../../types/review";

export function PersonaFlashCard({
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

  // 高频指针位置只写 CSS 变量，避免光箔移动触发 React 重渲染。
  function updateFoil(event: ReactPointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--foil-x", `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
    event.currentTarget.style.setProperty("--foil-y", `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
  }

  function activateCard() {
    if (imageSrc) {
      onActivate();
      return;
    }
    fileInputRef.current?.click();
  }

  return (
    <article
      className="persona-flash-card"
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--foil-x", "50%");
        event.currentTarget.style.setProperty("--foil-y", "35%");
      }}
      onPointerMove={updateFoil}
    >
      <div className="persona-card-front relative h-full overflow-hidden">
        <button
          aria-label={imageSrc ? `编辑${persona.name}` : `为${persona.name}添加图片`}
          className="persona-card-front-button absolute inset-0 z-10 h-full w-full text-left"
          type="button"
          onClick={activateCard}
        >
          {imageSrc ? (
            <Image
              alt={`${persona.name}角色图`}
              className="persona-card-art object-cover"
              fill
              sizes="(max-width: 640px) 30vw, (max-width: 1200px) 18vw, 150px"
              src={imageSrc}
              unoptimized={imageSrc.startsWith("data:")}
            />
          ) : (
            <span className="persona-card-placeholder grid h-full place-items-center text-center">
              <span aria-hidden="true" className="persona-card-placeholder-plus">＋</span>
            </span>
          )}
          {imageSrc ? <span aria-hidden="true" className="persona-card-vignette absolute inset-0" /> : null}
          <span aria-hidden="true" className="persona-card-foil absolute inset-0" />
          {imageSrc ? <span className="persona-card-name absolute inset-x-3 bottom-[6%] z-20 text-center"><strong className="text-[11px] font-semibold tracking-[0.04em]">{persona.name}</strong></span> : null}
        </button>
        <Image
          aria-hidden="true"
          alt=""
          className="persona-card-frame-image pointer-events-none absolute inset-0 z-40 h-full w-full"
          fill
          loading="eager"
          sizes="(max-width: 640px) 30vw, (max-width: 1200px) 18vw, 150px"
          src="/personas/persona-card-frame-2x3.png"
          unoptimized
        />
        <div className="persona-card-actions absolute right-2 top-2 z-50 flex gap-1">
          <button className="persona-card-icon-button" type="button" aria-label={`更换${persona.name}角色图`} onClick={() => fileInputRef.current?.click()}>
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8"/><path d="m13.5 7 3.5 3.5" stroke="currentColor" strokeWidth="1.8"/></svg>
          </button>
          <button className="persona-card-icon-button is-danger" type="button" aria-label={`删除${persona.name}`} onClick={onDelete}>
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"/></svg>
          </button>
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
      </div>
    </article>
  );
}
