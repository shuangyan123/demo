import type { ApiProvider } from "../types/domains/ai-provider.ts";
import type { VoiceProviderDescriptor } from "../types/domains/voice.ts";
import { getProviderContract } from "./provider-contracts.ts";

const googleVoices = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"];

const descriptors: Partial<Record<ApiProvider, VoiceProviderDescriptor>> = {
  openai: { provider: "openai", models: ["tts-1-hd", "tts-1"], voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"].map((id) => ({ id, label: id })), supports: { style: true, speed: true, volume: false, pitch: false, emotion: false, languageBoost: false } },
  google: { provider: "google", models: ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"], voices: googleVoices.map((id) => ({ id, label: id })), supports: { style: true, speed: false, volume: false, pitch: false, emotion: false, languageBoost: false } },
  minimax: { provider: "minimax", models: ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd"], voices: [], supports: { style: false, speed: true, volume: true, pitch: true, emotion: true, languageBoost: true } },
  zhipu: { provider: "zhipu", models: ["glm-tts"], voices: [], supports: { style: false, speed: true, volume: true, pitch: false, emotion: false, languageBoost: false } },
};

/** 返回厂商专属语音能力，未知兼容连接只保留基础 Voice ID。 */
export function getVoiceProviderDescriptor(provider?: ApiProvider): VoiceProviderDescriptor | undefined {
  if (!provider) return undefined;
  return descriptors[provider] ?? { provider, models: getProviderContract(provider).models.speech ?? [], voices: getProviderContract(provider).speechVoices ?? [], supports: { style: false, speed: true, volume: false, pitch: false, emotion: false, languageBoost: false } };
}
