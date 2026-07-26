import { getProviderContract } from "../../services/provider-contracts";
import { getVoiceProviderDescriptor } from "../../services/voice-provider-descriptors";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { VoiceProfile } from "../../types/domains/personalization.ts";

export function VoiceProfileEditor({
  disabled = false,
  speechConnection,
  voice,
  onChange,
}: {
  disabled?: boolean;
  speechConnection?: ApiConnectionProfile;
  voice: VoiceProfile;
  onChange: (patch: Partial<VoiceProfile>) => void;
}) {
  const contract = speechConnection ? getProviderContract(speechConnection.provider) : undefined;
  const descriptor = getVoiceProviderDescriptor(speechConnection?.provider);
  const voiceOptions = descriptor?.voices ?? contract?.speechVoices ?? [];
  return (
    <div className={`grid gap-3 ${disabled ? "opacity-55" : ""}`}>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="grid gap-1.5 text-xs font-medium">语音模型
          {descriptor?.models.length ? <select disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={voice.model || descriptor.models[0]} onChange={(event) => onChange({ model: event.target.value })}>{descriptor.models.map((model) => <option key={model} value={model}>{model}</option>)}</select> : <input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="留空则使用默认语音模型" value={voice.model} onChange={(event) => onChange({ model: event.target.value })} />}
        </label>
        <label className="grid gap-1.5 text-xs font-medium">Voice ID
          {voiceOptions.length ? (
            <div className="grid gap-2">
              <select disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={voiceOptions.some((item) => item.id === voice.voiceId) ? voice.voiceId : ""} onChange={(event) => onChange({ voiceId: event.target.value })}>
                <option value="">选择官方内置音色</option>
                {voiceOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="或粘贴自定义 voice_ ID" value={voiceOptions.some((item) => item.id === voice.voiceId) ? "" : voice.voiceId} onChange={(event) => onChange({ voiceId: event.target.value })} />
            </div>
          ) : (
            <input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="在厂商控制台复制 voice_id" value={voice.voiceId} onChange={(event) => onChange({ voiceId: event.target.value })} />
          )}
        </label>
      </div>
      <p className="text-xs leading-5 text-muted">
        {contract?.speechVoices?.length ? "可直接选择官方内置音色；自定义 OpenAI 音色仍可在厂商控制台复制 voice_ 开头 ID 后手动填入。" : "该厂商没有内置音色清单，请从厂商控制台或文档复制 Voice ID。"}
      </p>
      {descriptor?.supports.style ? <label className="grid gap-1.5 text-xs font-medium">风格提示
        <input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="neutral / cheerful / 教学语气" value={voice.style} onChange={(event) => onChange({ style: event.target.value })} />
      </label> : null}
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {descriptor?.supports.speed ? <label className="grid gap-1.5 text-xs font-medium">语速 {voice.rate.toFixed(2)}
          <input disabled={disabled} className="contrast-slider" type="range" min="0.5" max="2" step="0.05" value={voice.rate} onChange={(event) => onChange({ rate: Number(event.target.value) })} />
        </label> : null}
        {descriptor?.supports.volume ? <label className="grid gap-1.5 text-xs font-medium">音量 {voice.volume.toFixed(2)}
          <input disabled={disabled} className="contrast-slider" type="range" min="0" max="1" step="0.05" value={voice.volume} onChange={(event) => onChange({ volume: Number(event.target.value) })} />
        </label> : null}
      </div>
      {descriptor?.supports.pitch ? <label className="grid gap-1.5 text-xs font-medium">音调 {voice.pitch ?? 0}<input disabled={disabled} className="contrast-slider" type="range" min="-12" max="12" step="1" value={voice.pitch ?? 0} onChange={(event) => onChange({ pitch: Number(event.target.value) })} /></label> : null}
      {descriptor?.supports.emotion ? <label className="grid gap-1.5 text-xs font-medium">情绪<input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={voice.emotion ?? "neutral"} onChange={(event) => onChange({ emotion: event.target.value })} /></label> : null}
      {descriptor?.supports.languageBoost ? <label className="grid gap-1.5 text-xs font-medium">语言增强<input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="auto / Chinese" value={voice.languageBoost ?? "auto"} onChange={(event) => onChange({ languageBoost: event.target.value })} /></label> : null}
    </div>
  );
}
