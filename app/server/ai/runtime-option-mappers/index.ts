import type { ApiProvider } from "../../../types/domains/ai-provider";
import { mapAnthropicRuntimeOptions } from "./anthropic.ts";
import { mapDeepSeekRuntimeOptions } from "./deepseek.ts";
import { mapGoogleRuntimeOptions } from "./google.ts";
import { mapMiniMaxRuntimeOptions } from "./minimax.ts";
import { mapOpenAiRuntimeOptions } from "./openai.ts";
import type { ProviderRuntimeMapper, ProviderRuntimeRequestMapping } from "./types";
import { mapXaiRuntimeOptions } from "./xai.ts";
import { mapZhipuRuntimeOptions } from "./zhipu.ts";

const mappers = new Map<ApiProvider, ProviderRuntimeMapper>([
  ["openai", mapOpenAiRuntimeOptions],
  ["google", mapGoogleRuntimeOptions],
  ["anthropic", mapAnthropicRuntimeOptions],
  ["deepseek", mapDeepSeekRuntimeOptions],
  ["zhipu", mapZhipuRuntimeOptions],
  ["minimax", mapMiniMaxRuntimeOptions],
  ["xai", mapXaiRuntimeOptions],
]);

/** 未核验厂商返回空映射，绝不把归一化值直接透传。 */
export function mapProviderRuntimeOptions(provider: ApiProvider, input: Parameters<ProviderRuntimeMapper>[0]): ProviderRuntimeRequestMapping {
  return mappers.get(provider)?.(input) ?? {};
}
