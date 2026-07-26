import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerateProviderRequest, parseGenerateProviderResponse } from "./provider-adapter.ts";

const enabled = process.env.RUN_LIVE_GEMINI_TESTS === "1";
const apiKey = process.env.GEMINI_API_KEY;

test("live Gemini multimodal smoke", { skip: !enabled || !apiKey }, async () => {
  const input = {
    provider: "google" as const,
    apiKey: apiKey!,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash",
    maxOutputTokens: 16,
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
