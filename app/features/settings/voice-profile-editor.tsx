import type { VoiceProfile } from "../../types/review";

export function VoiceProfileEditor({
  disabled = false,
  voice,
  onChange,
}: {
  disabled?: boolean;
  voice: VoiceProfile;
  onChange: (patch: Partial<VoiceProfile>) => void;
}) {
  return (
    <div className={`grid gap-3 ${disabled ? "opacity-55" : ""}`}>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="grid gap-1.5 text-xs font-medium">语音模型
          <input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="留空则使用连接模型" value={voice.model} onChange={(event) => onChange({ model: event.target.value })} />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">Voice ID
          <input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={voice.voiceId} onChange={(event) => onChange({ voiceId: event.target.value })} />
        </label>
      </div>
      <label className="grid gap-1.5 text-xs font-medium">风格 / 情绪
        <input disabled={disabled} className="settings-input rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="neutral / cheerful / 教学语气" value={voice.style} onChange={(event) => onChange({ style: event.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="grid gap-1.5 text-xs font-medium">语速 {voice.rate.toFixed(2)}
          <input disabled={disabled} className="contrast-slider" type="range" min="0.5" max="2" step="0.05" value={voice.rate} onChange={(event) => onChange({ rate: Number(event.target.value) })} />
        </label>
        <label className="grid gap-1.5 text-xs font-medium">音量 {voice.volume.toFixed(2)}
          <input disabled={disabled} className="contrast-slider" type="range" min="0" max="1" step="0.05" value={voice.volume} onChange={(event) => onChange({ volume: Number(event.target.value) })} />
        </label>
      </div>
    </div>
  );
}
