import type { AiGenerateRequest } from "../../services/api-client";
import { isGoogleInteractionsOnlyError } from "./google-error.ts";
import { getProviderTransport, type ProviderTransportContext } from "./provider-transport.ts";

/** 执行单次厂商请求，并仅为连接测试提供一次明确的 Google 协议恢复。 */
export async function executeProviderGenerate(body: AiGenerateRequest, context?: ProviderTransportContext): Promise<{ body: AiGenerateRequest; response: Response }> {
  let effectiveBody = body;

  async function send(input: AiGenerateRequest): Promise<Response> {
    const transport = getProviderTransport(input);
    return input.stream ? transport.stream(input, context) : transport.generate(input, context);
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
