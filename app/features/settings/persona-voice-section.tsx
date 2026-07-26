import { normalizeVoiceProfile } from "../../services/personalization-settings-repository";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { PersonaCustomization } from "../../types/domains/personalization.ts";
import { VoiceProfileEditor } from "./voice-profile-editor";

/**
 * 每个人设独立维护自己的云端音色；未启用时保持静音，不读取任何全局回退。
 */
export function PersonaVoiceSection({
  customization,
  onPreviewVoice,
  onStopVoice,
  onUpdate,
  speechError,
  speechConnection,
  speaking,
}: {
  customization: PersonaCustomization;
  onPreviewVoice: () => void;
  onStopVoice: () => void;
  onUpdate: (patch: Partial<PersonaCustomization>) => void;
  speechError?: string;
  speechConnection?: ApiConnectionProfile;
  speaking: boolean;
}) {
  const dedicatedVoice = customization.voice;
  const emptyVoice = normalizeVoiceProfile();

  return (
    <section className="persona-voice-section mt-5 border-t border-line pt-4">
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>角色音色</span>
        <input
          checked={Boolean(dedicatedVoice)}
          className="h-4 w-4 accent-[var(--blue)]"
          type="checkbox"
          onChange={(event) => onUpdate({ voice: event.target.checked ? emptyVoice : undefined })}
        />
      </label>
      <p className="mt-1 text-xs text-muted">每个角色单独配置；未启用时朗读保持静音。</p>
      <div className="mt-3">
        <VoiceProfileEditor
          disabled={!dedicatedVoice}
          speechConnection={speechConnection}
          voice={dedicatedVoice ?? emptyVoice}
          onChange={(patch) => onUpdate({ voice: { ...(dedicatedVoice ?? emptyVoice), ...patch } })}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-lg border border-line px-3 py-2 text-xs" disabled={!dedicatedVoice || speaking} type="button" onClick={onPreviewVoice}>
          {speaking ? "试听中" : "试听角色音色"}
        </button>
        {speaking ? <button className="px-3 py-2 text-xs text-muted" type="button" onClick={onStopVoice}>停止</button> : null}
      </div>
      {speechError ? <p className="mt-2 text-xs text-red">{speechError}</p> : null}
    </section>
  );
}
