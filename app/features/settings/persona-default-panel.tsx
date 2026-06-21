import Image from "next/image";
import type { PersonaModule, PersonaProfile } from "../../types/review";

const moduleLabels: Record<PersonaModule, string> = {
  tutoring: "AI 辅导",
  interview: "面试训练",
  knowledge_internalization: "知识内化",
};

export function PersonaDefaultPanel({
  defaultPersonaId,
  modulePersonaIds,
  personas,
  resolveImage,
  onDefaultChange,
  onEdit,
  onModuleChange,
}: {
  defaultPersonaId: string;
  modulePersonaIds: Partial<Record<PersonaModule, string>>;
  personas: PersonaProfile[];
  resolveImage: (personaId: string) => string | undefined;
  onDefaultChange: (personaId: string) => void;
  onEdit: (personaId: string) => void;
  onModuleChange: (module: PersonaModule, personaId: string | undefined) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">默认人设</h2>
          <p className="mt-1 text-sm text-muted">快速选择人设，并为不同模块设置覆盖。</p>
        </div>
        <select className="settings-select min-w-56 rounded-xl border border-line bg-surface px-3 py-2.5" value={defaultPersonaId} onChange={(event) => onDefaultChange(event.target.value)}>
          {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
        </select>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 max-lg:grid-cols-1">
        {(Object.keys(moduleLabels) as PersonaModule[]).map((module) => (
          <label key={module} className="grid gap-2 text-sm font-medium">
            {moduleLabels[module]}
            <select className="settings-select rounded-xl border border-line bg-surface px-3 py-2.5" value={modulePersonaIds[module] ?? ""} onChange={(event) => onModuleChange(module, event.target.value || undefined)}>
              <option value="">跟随默认</option>
              {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="persona-default-list mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {personas.map((persona) => {
          const image = resolveImage(persona.id);
          const selected = persona.id === defaultPersonaId;
          return (
            <article
              key={persona.id}
              className={`persona-default-persona grid min-h-16 grid-cols-[1fr_auto] items-center gap-1 rounded-xl border p-1.5 ${selected ? "border-blue bg-surface-muted" : "border-line"}`}
            >
              <button className="grid min-w-0 grid-cols-[42px_1fr] items-center gap-2 rounded-lg p-1 text-left hover:bg-surface" type="button" onClick={() => onEdit(persona.id)}>
                <span className="relative h-[42px] w-[42px] overflow-hidden rounded-full border border-line bg-surface-muted">
                  {image ? <Image alt={`${persona.name}头像`} className="object-cover object-center" fill sizes="42px" src={image} unoptimized={image.startsWith("data:")} /> : <span className="grid h-full place-items-center font-semibold">{persona.name.slice(0, 1)}</span>}
                </span>
                <span className="min-w-0"><strong className="block truncate text-sm">{persona.name}</strong><span className="mt-1 block truncate text-xs text-muted">{persona.role}</span></span>
              </button>
              <button className={`persona-default-select rounded-lg px-2.5 py-2 text-xs ${selected ? "text-blue" : "text-muted"}`} type="button" onClick={() => onDefaultChange(persona.id)}>
                {selected ? "当前" : "设为默认"}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
