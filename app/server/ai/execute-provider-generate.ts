import type { AiGenerateRequest } from "../../services/api-client";
import { isGoogleInteractionsOnlyError } from "./google-error.ts";
import { getProviderAdapter } from "./provider-adapter-registry.ts";

/** 执行单次厂商请求，并仅为连接测试提供一次明确的 Google 协议恢复。 */
export async function executeProviderGenerate(body: AiGenerateRequest): Promise<{ body: AiGenerateRequest; response: Response }> {
  const adapter = getProviderAdapter(body.provider);
  let effectiveBody = body;

  async function send(input: AiGenerateRequest): Promise<Response> {
    const providerRequest = adapter.buildGenerate(input);
    return fetch(providerRequest.url, {
      method: "POST",
      headers: providerRequest.headers,
      body: JSON.stringify(providerRequest.body),
      cache: "no-store",
    });
  }

  let response = await send(effectiveBody);
  if (!response.ok
    && body.provider === "google"
    && body.allowProtocolFallback === true
    && body.generationProtocol !== "google_interactions"
    && await isGoogleInteractionsOnlyError(response)) {
    effectiveBody = { ...body, generationProtocol: "google_interactions", allowProtocolFallback: false };
    response = await send(effectiveBody);
  }
  return { body: effectiveBody, response };
}
