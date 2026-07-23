import type { AiModelRuntimeDescriptor, AiModelRuntimeOption, AiModelRuntimeValue, AiSelectedRuntimeValues } from "../types/domains/ai-model.ts";
import type { ApiProvider } from "../types/domains/ai-provider.ts";

const VERIFIED_AT = "2026-07-15";
const OPENAI_REASONING_URL = "https://developers.openai.com/api/docs/guides/reasoning";
const OPENAI_PRIORITY_URL = "https://developers.openai.com/api/docs/guides/priority-processing";
const GEMINI_THINKING_URL = "https://ai.google.dev/gemini-api/docs/generate-content/thinking";
const GEMINI_PRIORITY_URL = "https://ai.google.dev/gemini-api/docs/generate-content/priority-inference";
const CLAUDE_THINKING_URL = "https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking";
const DEEPSEEK_THINKING_URL = "https://api-docs.deepseek.com/guides/thinking_mode";
const GLM_THINKING_URL = "https://docs.bigmodel.cn/cn/guide/capabilities/thinking";
const MINIMAX_MODEL_URL = "https://platform.minimaxi.com/docs/api-reference/text-anthropic-api";
const XAI_REASONING_URL = "https://docs.x.ai/developers/model-capabilities/text/reasoning";

const effortOptions = (values: string[]): AiModelRuntimeOption[] => values.map((value) => ({ id: value, label: value, value }));
const serviceTierOptions = [
  { id: "standard", label: "标准", value: "standard" },
  { id: "priority", label: "优先", value: "priority", tooltip: "按厂商优先档计费，实际档位以响应为准" },
];

function descriptor(input: Omit<AiModelRuntimeDescriptor, "verifiedAt">): AiModelRuntimeDescriptor {
  return { ...input, verifiedAt: VERIFIED_AT };
}

const descriptors = new Map<string, AiModelRuntimeDescriptor>();

/** 使用厂商与完整模型 ID 建立稳定键，禁止通过模糊名称猜测能力。 */
function descriptorKey(provider: ApiProvider, modelId: string): string {
  return `${provider}:${modelId.trim().toLowerCase()}`;
}

function register(input: AiModelRuntimeDescriptor): void {
  descriptors.set(descriptorKey(input.provider, input.modelId), input);
}

for (const modelId of ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
  register(descriptor({
    provider: "openai",
    modelId,
    reasoning: { kind: "effort", options: effortOptions(["none", "low", "medium", "high", "xhigh", "max"]), defaultValue: "medium" },
    speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
    documentationUrl: `${OPENAI_REASONING_URL}#how-reasoning-works`,
  }));
}

register(descriptor({
  provider: "openai",
  modelId: "gpt-5.5",
  reasoning: { kind: "effort", options: effortOptions(["none", "low", "medium", "high", "xhigh"]), defaultValue: "medium" },
  speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
  documentationUrl: OPENAI_PRIORITY_URL,
}));

const geminiDescriptors: AiModelRuntimeDescriptor[] = [
  descriptor({
    provider: "google",
    modelId: "gemini-3.5-flash",
    reasoning: { kind: "effort", options: effortOptions(["minimal", "low", "medium", "high"]), defaultValue: "medium" },
    speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
    documentationUrl: GEMINI_THINKING_URL,
  }),
  descriptor({
    provider: "google",
    modelId: "gemini-3.1-pro-preview",
    reasoning: { kind: "effort", options: effortOptions(["low", "medium", "high"]), defaultValue: "high" },
    speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
    documentationUrl: GEMINI_THINKING_URL,
  }),
  descriptor({
    provider: "google",
    modelId: "gemini-3.1-flash-lite",
    reasoning: { kind: "effort", options: effortOptions(["minimal", "low", "medium", "high"]), defaultValue: "minimal" },
    speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
    documentationUrl: GEMINI_PRIORITY_URL,
  }),
  descriptor({
    provider: "google",
    modelId: "gemini-2.5-pro",
    reasoning: {
      kind: "budget",
      options: [{ id: "dynamic", label: "动态", value: -1 }, { id: "8192", label: "8K", value: 8192 }],
      defaultValue: -1,
      customRange: { min: 128, max: 32768 },
    },
    speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
    documentationUrl: GEMINI_THINKING_URL,
  }),
  descriptor({
    provider: "google",
    modelId: "gemini-2.5-flash",
    reasoning: {
      kind: "budget",
      options: [{ id: "dynamic", label: "动态", value: -1 }, { id: "disabled", label: "关闭", value: 0 }, { id: "8192", label: "8K", value: 8192 }],
      defaultValue: -1,
      customRange: { min: 0, max: 24576 },
    },
    speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
    documentationUrl: GEMINI_THINKING_URL,
  }),
  descriptor({
    provider: "google",
    modelId: "gemini-2.5-flash-lite",
    reasoning: {
      kind: "budget",
      options: [{ id: "dynamic", label: "动态", value: -1 }, { id: "disabled", label: "关闭", value: 0 }, { id: "8192", label: "8K", value: 8192 }],
      defaultValue: 0,
      customRange: { min: 512, max: 24576 },
    },
    speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
    documentationUrl: GEMINI_THINKING_URL,
  }),
];
geminiDescriptors.forEach(register);

for (const modelId of ["claude-fable-5", "claude-sonnet-5", "claude-opus-4-8"]) {
  register(descriptor({
    provider: "anthropic",
    modelId,
    reasoning: { kind: "adaptive", options: effortOptions(["low", "medium", "high", "xhigh", "max"]), defaultValue: "high" },
    ...(modelId === "claude-opus-4-8" ? { speed: { kind: "fast_mode" as const, options: [{ id: "standard", label: "标准", value: "standard" }, { id: "fast", label: "Fast", value: "fast", tooltip: "研究预览，需要账户资格并按溢价计费" }], defaultValue: "standard" } } : {}),
    documentationUrl: CLAUDE_THINKING_URL,
  }));
}

register(descriptor({
  provider: "anthropic",
  modelId: "claude-haiku-4-5",
  reasoning: {
    kind: "budget",
    options: [{ id: "1024", label: "1K", value: 1024 }, { id: "8192", label: "8K", value: 8192 }, { id: "16000", label: "16K", value: 16000 }],
    defaultValue: 1024,
    customRange: { min: 1024, max: 32000 },
  },
  documentationUrl: "https://platform.claude.com/docs/en/build-with-claude/extended-thinking",
}));

for (const modelId of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
  register(descriptor({
    provider: "deepseek",
    modelId,
    reasoning: { kind: "effort", options: [{ id: "disabled", label: "关闭", value: "disabled" }, ...effortOptions(["high", "max"])], defaultValue: "high" },
    documentationUrl: DEEPSEEK_THINKING_URL,
  }));
}

register(descriptor({
  provider: "minimax",
  modelId: "MiniMax-M3",
  capabilities: ["text", "vision", "video", "tools"],
  contextWindow: 1_000_000,
  reasoning: { kind: "adaptive", options: [{ id: "disabled", label: "关闭", value: "disabled" }, { id: "adaptive", label: "自适应", value: "adaptive" }], defaultValue: "disabled" },
  speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
  documentationUrl: MINIMAX_MODEL_URL,
}));

for (const modelId of ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed"]) {
  register(descriptor({
    provider: "minimax",
    modelId,
    reasoning: { kind: "fixed", options: [{ id: "fixed", label: "固定思考", value: "fixed", tooltip: "该模型不提供请求级推理档位" }], defaultValue: "fixed" },
    speed: { kind: "paired_model", options: [{ id: "standard", label: "标准", value: "standard" }, { id: "highspeed", label: "高速", value: "highspeed", tooltip: "切换到同代 highspeed 配对模型，需要对应套餐资格" }], defaultValue: modelId.toLowerCase().endsWith("-highspeed") ? "highspeed" : "standard" },
    documentationUrl: MINIMAX_MODEL_URL,
  }));
}

register(descriptor({
  provider: "xai",
  modelId: "grok-4.5",
  reasoning: { kind: "effort", options: effortOptions(["low", "medium", "high"]), defaultValue: "high" },
  speed: { kind: "service_tier", options: serviceTierOptions, defaultValue: "standard" },
  documentationUrl: XAI_REASONING_URL,
}));

const glmSevenOptions: AiModelRuntimeOption[] = [
  { id: "max", label: "max", value: "max", tooltip: "默认且推荐，深度推理" },
  { id: "xhigh", label: "xhigh", value: "xhigh", tooltip: "兼容值，服务端映射到 max" },
  { id: "high", label: "high", value: "high", tooltip: "增强推理" },
  { id: "medium", label: "medium", value: "medium", tooltip: "兼容值，服务端映射到 high" },
  { id: "low", label: "low", value: "low", tooltip: "兼容值，服务端映射到 high" },
  { id: "minimal", label: "minimal", value: "minimal", tooltip: "不思考，直接回答" },
  { id: "none", label: "none", value: "none", tooltip: "不思考，直接回答" },
];

register(descriptor({
  provider: "zhipu",
  modelId: "glm-5.2",
  reasoning: { kind: "effort", options: glmSevenOptions, defaultValue: "max" },
  documentationUrl: GLM_THINKING_URL,
}));

/** GLM 运行能力只登记官方已核验模型，未来型号不得依赖版本字符串自动继承。 */
for (const modelId of ["glm-5.1", "glm-5", "glm-5-turbo", "glm-5v-turbo", "glm-4.7", "glm-4.6", "glm-4.6v", "glm-4.5", "glm-4.5v"]) {
  register(descriptor({
    provider: "zhipu",
    modelId,
    reasoning: { kind: "toggle", options: [{ id: "enabled", label: "开启", value: "enabled" }, { id: "disabled", label: "关闭", value: "disabled" }], defaultValue: "enabled" },
    documentationUrl: GLM_THINKING_URL,
  }));
}

/** 返回具体模型的运行 descriptor；未知模型明确返回 undefined。 */
export function getAiModelRuntimeDescriptor(provider: ApiProvider, modelId: string): AiModelRuntimeDescriptor | undefined {
  return descriptors.get(descriptorKey(provider, modelId));
}

function includesValue(options: AiModelRuntimeOption[], value: AiModelRuntimeValue | undefined): value is AiModelRuntimeValue {
  return value !== undefined && options.some((option) => option.value === value);
}

/** 预算值先匹配动态/关闭等显式哨兵，再接受自定义范围内的整数。 */
function supportsReasoningValue(descriptorValue: AiModelRuntimeDescriptor, value: AiModelRuntimeValue | undefined): value is AiModelRuntimeValue {
  const reasoning = descriptorValue.reasoning;
  if (!reasoning || value === undefined) return false;
  if (includesValue(reasoning.options, value)) return true;
  return reasoning.kind === "budget"
    && typeof value === "number"
    && Number.isInteger(value)
    && value >= reasoning.customRange.min
    && value <= reasoning.customRange.max;
}

/** 保留新模型仍支持的值；不支持或缺失时回退到 descriptor 默认值。 */
export function normalizeAiSelectedRuntimeValues(descriptorValue: AiModelRuntimeDescriptor | undefined, current?: AiSelectedRuntimeValues): AiSelectedRuntimeValues {
  if (!descriptorValue) return {};
  return {
    ...(descriptorValue.reasoning ? { reasoning: supportsReasoningValue(descriptorValue, current?.reasoning) ? current.reasoning : descriptorValue.reasoning.defaultValue } : {}),
    ...(descriptorValue.speed ? { speed: includesValue(descriptorValue.speed.options, current?.speed) ? current.speed : descriptorValue.speed.defaultValue } : {}),
  };
}

/** 把旧会话字段一次性折叠到新运行值，仓储读取后不再要求 UI 识别旧字段。 */
export function legacyRuntimeValues(reasoningEffort?: string, speedMode?: "standard" | "priority"): AiSelectedRuntimeValues | undefined {
  if (reasoningEffort === undefined && speedMode === undefined) return undefined;
  return { ...(reasoningEffort !== undefined ? { reasoning: reasoningEffort } : {}), ...(speedMode !== undefined ? { speed: speedMode } : {}) };
}

/** Gemini 2.5 与旧 Claude 的自定义预算范围由具体模型核验。 */
export function getReasoningBudgetRange(provider: ApiProvider, modelId: string): { min: number; max: number } | undefined {
  const reasoning = getAiModelRuntimeDescriptor(provider, modelId)?.reasoning;
  return reasoning?.kind === "budget" ? { ...reasoning.customRange } : undefined;
}

/** MiniMax 高速档通过同代配对模型实现，不伪装成请求级 service tier。 */
export function resolveRuntimeModelId(descriptorValue: AiModelRuntimeDescriptor | undefined, modelId: string, values?: AiSelectedRuntimeValues): string {
  if (descriptorValue?.speed?.kind !== "paired_model") return modelId;
  const base = modelId.replace(/-highspeed$/i, "");
  return values?.speed === "highspeed" ? `${base}-highspeed` : base;
}
