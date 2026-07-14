import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerateProviderRequest, parseGenerateProviderResponse } from "./provider-adapter.ts";

const enabled = process.env.RUN_LIVE_MINIMAX_TESTS === "1";
const apiKey = process.env.MINIMAX_API_KEY;

/** 真实 smoke 只发送极小文本与单像素图片，不记录密钥、响应正文或额度。 */
test("live MiniMax-M3 text and image smoke", { skip: !enabled || !apiKey }, async () => {
  const input = {
    provider: "minimax" as const,
    apiKey: apiKey!,
    baseUrl: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/anthropic",
    providerOptions: { region: process.env.MINIMAX_REGION === "global" ? "global" : "cn", credentialPlan: "pay_as_you_go" },
    model: process.env.MINIMAX_LIVE_MODEL ?? "MiniMax-M3",
    maxOutputTokens: 16,
    runtime: { reasoning: "disabled", speed: "standard" },
    messages: [{ role: "user" as const, content: [
      { type: "text" as const, text: "只回答图片中的主要颜色。" },
      { type: "image_url" as const, image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4QAAAABJRU5ErkJggg==" } },
    ] }],
  };
  const request = buildGenerateProviderRequest(input);
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(20_000) });
  assert.equal(response.ok, true);
  const result = parseGenerateProviderResponse(input, await response.json(), response.headers);
  assert.ok(result.content.trim().length > 0);
});
