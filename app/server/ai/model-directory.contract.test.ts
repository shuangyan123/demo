import assert from "node:assert/strict";
import test from "node:test";
import type { AiModelsRequest } from "../../services/api-client.ts";
import { fetchProviderModelDirectory, providerModelDirectoryHeaders, providerModelDirectoryUrl } from "./model-directory.ts";

function request(provider: AiModelsRequest["provider"], baseUrl: string): AiModelsRequest {
  return { provider, baseUrl, apiKey: "secret" };
}

test("Google directory follows nextPageToken until the complete model list is collected", async () => {
  const urls: string[] = [];
  const result = await fetchProviderModelDirectory(request("google", "https://generativelanguage.googleapis.com/v1beta"), async (input) => {
    const url = String(input);
    urls.push(url);
    const second = url.includes("pageToken=next-page");
    return Response.json(second
      ? { models: [{ name: "models/gemini-second", displayName: "Gemini Second", supportedGenerationMethods: ["generateContent"] }] }
      : { models: [{ name: "models/gemini-first", displayName: "Gemini First", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "next-page" });
  });
  assert.equal(urls.length, 2);
  assert.match(urls[0] ?? "", /pageSize=1000/);
  assert.match(urls[1] ?? "", /pageToken=next-page/);
  assert.deepEqual(result.models.map((model) => model.id), ["gemini-first", "gemini-second"]);
  assert.equal(result.complete, true);
});

test("MiniMax directory uses X-Api-Key and cursor pagination while preserving M3", async () => {
  const urls: string[] = [];
  const input = { ...request("minimax", "https://api.minimaxi.com/anthropic"), providerOptions: { region: "cn" } };
  const result = await fetchProviderModelDirectory(input, async (url) => {
    const value = String(url);
    urls.push(value);
    return Response.json(value.includes("after_id=MiniMax-M3")
      ? { data: [{ id: "MiniMax-M2.7", display_name: "MiniMax-M2.7" }], has_more: false, last_id: "MiniMax-M2.7" }
      : { data: [{ id: "MiniMax-M3", display_name: "MiniMax-M3" }], has_more: true, last_id: "MiniMax-M3" });
  });
  assert.deepEqual(providerModelDirectoryHeaders("minimax", "secret"), { "X-Api-Key": "secret" });
  assert.equal("Authorization" in providerModelDirectoryHeaders("minimax", "secret"), false);
  assert.match(urls[1] ?? "", /after_id=MiniMax-M3/);
  assert.deepEqual(result.models.map((model) => model.id), ["MiniMax-M2.7", "MiniMax-M3"]);
});

test("Qwen uses the official deployable-model pagination endpoint instead of inference /models", async () => {
  const urls: string[] = [];
  const result = await fetchProviderModelDirectory(request("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1"), async (url) => {
    const value = String(url);
    urls.push(value);
    const page = value.includes("page_no=2") ? 2 : 1;
    return Response.json({ models: [{ model_name: page === 1 ? "qwen-first" : "qwen-second" }], page_no: page, page_size: 1, total: 2 });
  });
  assert.equal(urls.length, 2);
  assert.match(urls[0] ?? "", /api\/v1\/deployments\/models/);
  assert.doesNotMatch(urls[0] ?? "", /compatible-mode\/v1\/models/);
  assert.deepEqual(result.models.map((model) => model.id), ["qwen-first", "qwen-second"]);
});

test("compatible providers keep official metadata without guessing unknown vision support", async () => {
  const kimi = await fetchProviderModelDirectory(request("kimi", "https://api.moonshot.cn/v1"), async () => Response.json({
    data: [{ id: "kimi-vision", supports_image_in: true, supports_video_in: true, supports_reasoning: true }],
  }));
  assert.equal(kimi.models[0]?.capabilities.includes("vision"), true);
  assert.equal(kimi.models[0]?.capabilitySource, "provider");

  const groq = await fetchProviderModelDirectory(request("groq", "https://api.groq.com/openai/v1"), async () => Response.json({ data: [{ id: "unknown-model" }] }));
  assert.equal(groq.models[0]?.capabilities.includes("vision"), false);
  assert.equal(groq.models[0]?.capabilitySource, "unknown");
});

test("directory URL and auth stay provider-specific", () => {
  assert.equal(providerModelDirectoryHeaders("openrouter", "secret").Authorization, "Bearer secret");
  assert.match(providerModelDirectoryUrl(request("siliconflow", "https://api.siliconflow.cn/v1")), /type=text/);
  assert.match(providerModelDirectoryUrl(request("kimi", "https://api.moonshot.cn/v1")), /\/v1\/models$/);
});
