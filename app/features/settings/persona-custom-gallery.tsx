import type { PersonaProfile } from "../../types/review";
import { PersonaFlashCard } from "./persona-flash-card";

export function PersonaCustomGallery({
  draftPersona,
  personas,
  resolveImage,
  onAddDraft,
  onDelete,
  onEdit,
  onImageChange,
}: {
  draftPersona: PersonaProfile | null;
  personas: PersonaProfile[];
  resolveImage: (personaId: string) => string | undefined;
  onAddDraft: () => void;
  onDelete: (persona: PersonaProfile, isDraft: boolean) => void;
  onEdit: (personaId: string) => void;
  onImageChange: (persona: PersonaProfile, file: File | undefined, isDraft: boolean) => void;
}) {
  const cards = draftPersona ? [...personas, draftPersona] : personas;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">定制角色</h2>
          <p className="mt-1 text-sm text-muted">正面使用原始金色镶边；点击卡片进入无镶边背面，编辑名称、描述与角色音色。</p>
        </div>
        <span className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted">固定 3:4</span>
      </div>

      <div className={`persona-card-grid mt-6 ${cards.length === 0 ? "is-empty" : ""}`}>
        {cards.map((persona) => {
          const isDraft = persona.id === draftPersona?.id;
          return (
            <PersonaFlashCard
              key={persona.id}
              imageSrc={isDraft ? undefined : resolveImage(persona.id)}
              persona={persona}
              onActivate={() => onEdit(persona.id)}
              onDelete={() => onDelete(persona, isDraft)}
              onImageChange={(file) => onImageChange(persona, file, isDraft)}
            />
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
