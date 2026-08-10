import type { AiSelectedRuntimeValues } from "../types/domains/ai-model.ts";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import {
  callAiGenerate,
  callAiGenerateStream,
  callAiModels,
  callAiSpeech,
  callAiTranscription,
  type AiGenerateStreamEvent,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiModelsResult,
  type AiSpeechRequest,
  type AiTranscriptionResult,
} from "./api-client.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import { AiCapabilityContractError, type ModelCapabilityProfile } from "../types/domains/ai-capability.ts";
import { assertEffectiveModelCapability, resolveEffectiveModelCapability, resolveModelCapabilityProfile } from "./ai-capability-resolution.ts";
import { getAiModelRuntimeDescriptor, resolveRuntimeModelId, validateAiSelectedRuntimeValues } from "./model-runtime-descriptors.ts";
import { getProviderModelCatalog } from "./provider-contracts.ts";
import { providerModelCache } from "./provider-model-cache.ts";
import { isUiReviewRecordId } from "./workspace-data-scope.ts";
import { isUiReviewRuntimeActive } from "./ui-review-runtime-guard.ts";

export type GenerateConnectionPurpose = "text" | "vision";
type ConnectionGenerateInput = Omit<AiGenerateRequest, "provider" | "apiKey" | "baseUrl" | "model" | "providerOptions" | "runtime"> & { modelId?: string; selectedRuntimeValues?: AiSelectedRuntimeValues };
type ConnectionSpeechInput = Omit<AiSpeechRequest, "provider" | "apiKey" | "baseUrl" | "model" | "providerOptions"> & {
  model?: string;
};

/** 以完整连接身份读取可信目录事实，再交给纯 capability core 解析。 */
export function resolveConnectionModelCapabilityProfile(connection: ApiConnectionProfile, modelId: string): ModelCapabilityProfile {
  const discovered = providerModelCache.load(connection.id, connection.provider, connection.baseUrl)?.models.find((model) => model.id === modelId);
  return resolveModelCapabilityProfile(connection.provider, modelId, discovered);
}

function assertExternalCallsAllowed(connection?: ApiConnectionProfile): void {
  if (isUiReviewRuntimeActive() || (connection && isUiReviewRecordId(connection.id))) {
    throw new Error("UI 审查 AI 连接只用于检查界面，不会请求外部模型。");
  }
}

function applyStructuredOutputFallback(input: ConnectionGenerateInput): ConnectionGenerateInput {
  if (!input.structuredOutput) return input;
  const { name, schema } = input.structuredOutput;
  const instruction = `输出契约 ${name}：只输出符合以下 JSON Schema 的 JSON，不要附加 Markdown。\n${JSON.stringify(schema)}`;
  const systemIndex = input.messages.findIndex((message) => message.role === "system");
  const messages = systemIndex >= 0
    ? input.messages.map((message, index) => index !== systemIndex
      ? message
      : {
          ...message,
          content: typeof message.content === "string"
            ? `${message.content}\n\n${instruction}`
            : [...message.content, { type: "text" as const, text: instruction }],
        })
    : [{ role: "system" as const, content: instruction }, ...input.messages];
  return {
    ...input,
    messages,
  };
}

async function resolveGenerationContract(
  connection: ApiConnectionProfile,
  purpose: GenerateConnectionPurpose,
  input: ConnectionGenerateInput,
) {
  const selectedModel = await aiConnectionsRepository.resolveRuntimeModel(connection, purpose, input.modelId);
  const capabilityProfile = resolveConnectionModelCapabilityProfile(connection, selectedModel);
  assertEffectiveModelCapability(capabilityProfile, purpose);
  const structuredOutput = input.structuredOutput
    ? resolveEffectiveModelCapability(capabilityProfile, "structured_output")
    : undefined;
  if (structuredOutput?.support === "unsupported") {
    assertEffectiveModelCapability(capabilityProfile, "structured_output");
  }
  if (input.stream) assertEffectiveModelCapability(capabilityProfile, "streaming");

  const descriptor = getAiModelRuntimeDescriptor(connection.provider, selectedModel);
  for (const option of ["reasoning", "speed"] as const) {
    if (input.selectedRuntimeValues?.[option] !== undefined) assertEffectiveModelCapability(capabilityProfile, option);
  }
  const validation = validateAiSelectedRuntimeValues(descriptor, input.selectedRuntimeValues);
  if (validation.status === "invalid") {
    const label = validation.option === "reasoning" ? "推理" : "速度";
    const message = validation.code === "invalid-runtime-value"
      ? `${label}运行值不在所选模型允许范围内`
      : validation.code === "runtime-capability-unsupported"
        ? `所选模型不支持${label}运行选项`
        : `所选模型的${label}运行能力尚未验证`;
    throw new AiCapabilityContractError({
      code: validation.code,
      capability: validation.option,
      provider: connection.provider,
      modelId: selectedModel,
      message,
    });
  }
  return {
    descriptor,
    runtime: validation.values,
    model: resolveRuntimeModelId(descriptor, selectedModel, validation.values),
    // 未验证的 custom/compatible 模型仍可执行普通文本 JSON 提示，但不得发送未经证实的协议参数。
    includeStructuredOutput: structuredOutput?.support === "supported",
  };
}

/** 按精确 descriptor、连接目录缓存顺序解析 Google 模型协议。 */
function resolveConnectionGenerationProtocol(connection: ApiConnectionProfile, modelId: string) {
  if (connection.provider !== "google") return undefined;
  const verified = getProviderModelCatalog("google").find((model) => model.id === modelId)?.generationProtocol;
  if (verified) return verified;
  const cached = providerModelCache.load(connection.id, connection.provider, connection.baseUrl)?.models.find((model) => model.id === modelId);
  return cached?.generationProtocol
    ?? (cached?.supportedGenerationMethods?.includes("generateContent") ? "google_generate_content" : undefined);
}

// 使用连接档案发起文本或多模态请求，业务服务不再自行解密密钥或判断厂商协议。
export async function generateWithConnection(
  connection: ApiConnectionProfile,
  purpose: GenerateConnectionPurpose,
  input: ConnectionGenerateInput,
): Promise<AiGenerateResult> {
  assertExternalCallsAllowed(connection);
  if (!connection.capabilities.includes(purpose)) {
    throw new Error(`当前连接不支持${purpose === "vision" ? "多模态" : "文本"}能力`);
  }
  const resolved = await resolveGenerationContract(connection, purpose, input);
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  const runtimePayload = Object.keys(resolved.runtime).length ? { runtime: resolved.runtime } : {};
  const request = { ...(resolved.includeStructuredOutput ? input : applyStructuredOutputFallback(input)) };
  delete request.modelId;
  delete request.selectedRuntimeValues;
  if (!resolved.includeStructuredOutput) delete request.structuredOutput;
  return callAiGenerate({
    ...request,
    provider: connection.provider,
    apiKey,
    baseUrl: connection.baseUrl,
    model: resolved.model,
    generationProtocol: resolveConnectionGenerationProtocol(connection, resolved.model),
    ...runtimePayload,
    providerOptions: connection.providerOptions,
  });
}

/** 使用连接档案发起流式生成；调用方只能消费归一化事件，不能接触明文 Key。 */
export async function* generateWithConnectionStream(
  connection: ApiConnectionProfile,
  purpose: GenerateConnectionPurpose,
  input: ConnectionGenerateInput,
): AsyncGenerator<AiGenerateStreamEvent> {
  assertExternalCallsAllowed(connection);
  if (!connection.capabilities.includes(purpose)) {
    throw new Error(`当前连接不支持${purpose === "vision" ? "多模态" : "文本"}能力`);
  }
  if (!connection.capabilities.includes("streaming")) {
    throw new Error("当前连接未声明流式输出能力");
  }
  const resolved = await resolveGenerationContract(connection, purpose, { ...input, stream: true });
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  const runtimePayload = Object.keys(resolved.runtime).length ? { runtime: resolved.runtime } : {};
  const request = { ...(resolved.includeStructuredOutput ? input : applyStructuredOutputFallback(input)) };
  delete request.modelId;
  delete request.selectedRuntimeValues;
  if (!resolved.includeStructuredOutput) delete request.structuredOutput;
  yield* callAiGenerateStream({
    ...request,
    provider: connection.provider,
    apiKey,
    baseUrl: connection.baseUrl,
    model: resolved.model,
    generationProtocol: resolveConnectionGenerationProtocol(connection, resolved.model),
    ...runtimePayload,
    providerOptions: connection.providerOptions,
  });
}

// 云端语音允许个性化设置覆盖模型和音色，其余连接参数始终来自默认语音连接。
export async function synthesizeWithConnection(
  connection: ApiConnectionProfile,
  input: ConnectionSpeechInput,
): Promise<Blob> {
  assertExternalCallsAllowed(connection);
  if (!connection.capabilities.includes("speech")) {
    throw new Error("当前连接不支持语音能力");
  }
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  return callAiSpeech({
    ...input,
    provider: connection.provider,
    apiKey,
    baseUrl: connection.baseUrl,
    model: await aiConnectionsRepository.resolveRuntimeModel(connection, "speech", input.model),
    providerOptions: connection.providerOptions,
  });
}

/** 使用独立转写连接请求 Gemini 音频理解；业务层永远接触不到 API Key。 */
export async function transcribeWithConnection(
  connection: ApiConnectionProfile,
  input: { audioBase64: string; mimeType: string },
): Promise<AiTranscriptionResult> {
  assertExternalCallsAllowed(connection);
  if (!connection.capabilities.includes("transcription")) throw new Error("当前连接未启用录音转写能力");
  if (connection.provider !== "google") throw new Error("当前仅支持 Google Gemini 录音转写连接");
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  return callAiTranscription({
    provider: connection.provider,
    apiKey,
    baseUrl: connection.baseUrl,
    model: await aiConnectionsRepository.resolveRuntimeModel(connection, "transcription"),
    mimeType: input.mimeType,
    audioBase64: input.audioBase64,
    providerOptions: connection.providerOptions,
  });
}

/** 使用已保存连接读取官方模型目录，密钥仍只在连接客户端内解密。 */
export async function listModelsWithConnection(connection: ApiConnectionProfile): Promise<AiModelsResult> {
  assertExternalCallsAllowed(connection);
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  return callAiModels({ provider: connection.provider, apiKey, baseUrl: connection.baseUrl, providerOptions: connection.providerOptions });
}

/** 新建连接保存前读取模型目录；明文密钥只存在于本次请求内存。 */
export async function listModelsWithDraft(input: { provider: ApiConnectionProfile["provider"]; apiKey: string; baseUrl: string; providerOptions?: Record<string, string> }): Promise<AiModelsResult> {
  return callAiModels(input);
}

/** 编辑草稿可复用已保存密钥，但厂商、地址和模型必须始终来自当前草稿。 */
export async function resolveConnectionDraftSecret(input: { apiKey: string; existingConnection?: ApiConnectionProfile }): Promise<string> {
  assertExternalCallsAllowed(input.existingConnection);
  if (input.apiKey.trim()) return input.apiKey.trim();
  if (input.existingConnection) return aiConnectionsRepository.resolveSecret(input.existingConnection);
  return "";
}

/** 新建或编辑连接时使用当前草稿读取模型目录，不回退到旧档案地址。 */
export async function listModelsWithConnectionDraft(input: {
  provider: ApiConnectionProfile["provider"];
  apiKey: string;
  baseUrl: string;
  providerOptions?: Record<string, string>;
  existingConnection?: ApiConnectionProfile;
}): Promise<AiModelsResult> {
  const apiKey = await resolveConnectionDraftSecret(input);
  return callAiModels({ provider: input.provider, apiKey, baseUrl: input.baseUrl, providerOptions: input.providerOptions ?? input.existingConnection?.providerOptions });
}

/** 使用当前连接草稿执行极小真实测试，并以紧凑结果卡展示活动。 */
export async function testConnectionDraft(input: {
  provider: ApiConnectionProfile["provider"];
  apiKey: string;
  baseUrl: string;
  modelId: string;
  label?: string;
  providerOptions?: Record<string, string>;
  existingConnection?: ApiConnectionProfile;
}): Promise<AiGenerateResult> {
  const apiKey = await resolveConnectionDraftSecret(input);
  const generationProtocol = input.existingConnection
    ? resolveConnectionGenerationProtocol(input.existingConnection, input.modelId)
    : getProviderModelCatalog(input.provider).find((model) => model.id === input.modelId)?.generationProtocol;
  const result = await callAiGenerate({
    provider: input.provider,
    apiKey,
    baseUrl: input.baseUrl,
    model: input.modelId,
    generationProtocol,
    allowProtocolFallback: input.provider === "google" && !generationProtocol,
    messages: [{ role: "user", content: "仅回复 OK" }],
    maxOutputTokens: 12,
    providerOptions: input.providerOptions ?? input.existingConnection?.providerOptions,
    activity: { connectionLabel: input.label, presentation: "compact-test", purpose: "connection-test" },
  });
  if (input.existingConnection && result.generationProtocol) {
    providerModelCache.rememberProtocol(input.existingConnection.id, input.existingConnection.provider, input.existingConnection.baseUrl, input.modelId, result.generationProtocol);
  }
  return result;
}
