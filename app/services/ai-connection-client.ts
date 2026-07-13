import type { ApiConnectionProfile } from "../types/review";
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
import { reasoningProviderOptions } from "./model-reasoning.ts";
import { speedProviderOptions, type ConversationSpeedMode } from "./model-speed.ts";

export type GenerateConnectionPurpose = "text" | "vision";
type ConnectionGenerateInput = Omit<AiGenerateRequest, "provider" | "apiKey" | "baseUrl" | "model" | "providerOptions"> & { modelId?: string; reasoningEffort?: string; speedMode?: ConversationSpeedMode };
type ConnectionSpeechInput = Omit<AiSpeechRequest, "provider" | "apiKey" | "baseUrl" | "model" | "providerOptions"> & {
  model?: string;
};

// 使用连接档案发起文本或多模态请求，业务服务不再自行解密密钥或判断厂商协议。
export async function generateWithConnection(
  connection: ApiConnectionProfile,
  purpose: GenerateConnectionPurpose,
  input: ConnectionGenerateInput,
): Promise<AiGenerateResult> {
  if (!connection.capabilities.includes(purpose)) {
    throw new Error(`当前连接不支持${purpose === "vision" ? "多模态" : "文本"}能力`);
  }
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  const model = await aiConnectionsRepository.resolveRuntimeModel(connection, purpose, input.modelId);
  const request = { ...input };
  const reasoningEffort = request.reasoningEffort;
  const speedMode = request.speedMode;
  delete request.modelId;
  delete request.reasoningEffort;
  delete request.speedMode;
  return callAiGenerate({
    ...request,
    provider: connection.provider,
    apiKey,
    baseUrl: connection.baseUrl,
    model,
    providerOptions: { ...connection.providerOptions, ...reasoningProviderOptions(connection.provider, model, reasoningEffort), ...speedProviderOptions(connection.provider, speedMode) },
  });
}

/** 使用连接档案发起流式生成；调用方只能消费归一化事件，不能接触明文 Key。 */
export async function* generateWithConnectionStream(
  connection: ApiConnectionProfile,
  purpose: GenerateConnectionPurpose,
  input: ConnectionGenerateInput,
): AsyncGenerator<AiGenerateStreamEvent> {
  if (!connection.capabilities.includes(purpose)) {
    throw new Error(`当前连接不支持${purpose === "vision" ? "多模态" : "文本"}能力`);
  }
  if (!connection.capabilities.includes("streaming")) {
    throw new Error("当前连接未声明流式输出能力");
  }
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  const model = await aiConnectionsRepository.resolveRuntimeModel(connection, purpose, input.modelId);
  const request = { ...input };
  const reasoningEffort = request.reasoningEffort;
  const speedMode = request.speedMode;
  delete request.modelId;
  delete request.reasoningEffort;
  delete request.speedMode;
  yield* callAiGenerateStream({
    ...request,
    provider: connection.provider,
    apiKey,
    baseUrl: connection.baseUrl,
    model,
    providerOptions: { ...connection.providerOptions, ...reasoningProviderOptions(connection.provider, model, reasoningEffort), ...speedProviderOptions(connection.provider, speedMode) },
  });
}

// 云端语音允许个性化设置覆盖模型和音色，其余连接参数始终来自默认语音连接。
export async function synthesizeWithConnection(
  connection: ApiConnectionProfile,
  input: ConnectionSpeechInput,
): Promise<Blob> {
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
  const apiKey = await aiConnectionsRepository.resolveSecret(connection);
  return callAiModels({ provider: connection.provider, apiKey, baseUrl: connection.baseUrl });
}

/** 新建连接保存前读取模型目录；明文密钥只存在于本次请求内存。 */
export async function listModelsWithDraft(input: { provider: ApiConnectionProfile["provider"]; apiKey: string; baseUrl: string }): Promise<AiModelsResult> {
  return callAiModels(input);
}

/** 新建连接保存前使用具体模型做极小真实测试，不把模型写入连接档案。 */
export async function testConnectionDraft(input: { provider: ApiConnectionProfile["provider"]; apiKey: string; baseUrl: string; modelId: string }): Promise<AiGenerateResult> {
  return callAiGenerate({ provider: input.provider, apiKey: input.apiKey, baseUrl: input.baseUrl, model: input.modelId, messages: [{ role: "user", content: "仅回复 OK" }], maxOutputTokens: 12 });
}
