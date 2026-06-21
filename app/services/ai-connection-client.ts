import type { ApiConnectionProfile } from "../types/review";
import {
  callAiGenerate,
  callAiSpeech,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiSpeechRequest,
} from "./api-client.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";

export type GenerateConnectionPurpose = "text" | "vision";
type ConnectionGenerateInput = Omit<AiGenerateRequest, "provider" | "apiKey" | "baseUrl" | "model" | "providerOptions">;
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
  return callAiGenerate({
    ...input,
    provider: connection.provider,
    apiKey,
    baseUrl: connection.baseUrl,
    model: connection.model,
    providerOptions: connection.providerOptions,
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
    model: input.model || connection.model,
    providerOptions: connection.providerOptions,
  });
}
