import type { CustomPersonaViewMode, PersonaProfile } from "../../types/review";
import { PersonaAvatarCard } from "./persona-avatar-card";
import { PersonaFlashCard } from "./persona-flash-card";

export function PersonaCustomGallery({
  draftPersona,
  personas,
  viewMode,
  resolveImage,
  onAddDraft,
  onDelete,
  onEdit,
  onImageChange,
  onViewModeChange,
}: {
  draftPersona: PersonaProfile | null;
  personas: PersonaProfile[];
  viewMode: CustomPersonaViewMode;
  resolveImage: (personaId: string) => string | undefined;
  onAddDraft: () => void;
  onDelete: (persona: PersonaProfile, isDraft: boolean) => void;
  onEdit: (personaId: string) => void;
  onImageChange: (persona: PersonaProfile, file: File | undefined, isDraft: boolean) => void;
  onViewModeChange: (mode: CustomPersonaViewMode) => void;
}) {
  const cards = draftPersona ? [...personas, draftPersona] : personas;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">定制角色</h2>
          <p className="mt-1 text-sm text-muted">正面使用原始金色镶边；点击卡片进入无镶边背面，编辑名称、描述与角色音色。</p>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface-muted p-1" aria-label="定制角色显示方式">
          {(["flashcard", "avatar"] as const).map((mode) => (
            <button
              key={mode}
              className={`min-h-8 rounded-md px-3 text-xs ${viewMode === mode ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}
              type="button"
              aria-pressed={viewMode === mode}
              onClick={() => onViewModeChange(mode)}
            >
              {mode === "flashcard" ? "闪卡" : "头像"}
            </button>
          ))}
        </div>
      </div>

      <div className={`${viewMode === "flashcard" ? "persona-card-grid" : "persona-avatar-grid"} mt-6 ${cards.length === 0 ? "is-empty" : ""}`}>
        {cards.map((persona) => {
          const isDraft = persona.id === draftPersona?.id;
          const sharedProps = {
            imageSrc: isDraft ? undefined : resolveImage(persona.id),
            persona,
            onActivate: () => onEdit(persona.id),
            onDelete: () => onDelete(persona, isDraft),
            onImageChange: (file: File | undefined) => onImageChange(persona, file, isDraft),
          };
          return viewMode === "flashcard" ? (
            <PersonaFlashCard
              key={persona.id}
              {...sharedProps}
            />
          ) : (
            <PersonaAvatarCard key={persona.id} {...sharedProps} />
          );
        })}
        {!draftPersona ? (
          <button className="persona-add-button" type="button" onClick={onAddDraft}>
            <span aria-hidden="true" className="persona-add-icon">＋</span>
            <strong>新建角色</strong>
          </button>
        ) : null}
      </div>
    </div>
  );
}
