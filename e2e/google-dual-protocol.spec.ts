import { expect, test } from "@playwright/test";
import { startMockAiProvider } from "./helpers/mock-ai-provider";

/**
 * 通过生产态 Next 路由验证 Google 两种协议不会混用字段或 endpoint。
 */
test("Google 2.5 与 3.5 分别使用 GenerateContent 和 Interactions", async ({ request }) => {
  const generateContent = await startMockAiProvider({ protocol: "google_generate_content", response: "generate ok" });
  const interactions = await startMockAiProvider({ protocol: "google_interactions", response: "interaction ok" });

  try {
    const generateResponse = await request.post("/api/ai/generate", {
      data: {
        provider: "google",
        apiKey: "fixture-key",
        baseUrl: generateContent.baseUrl,
        model: "gemini-2.5-flash",
        generationProtocol: "google_generate_content",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    expect(generateResponse.ok()).toBe(true);
    expect(await generateResponse.json()).toMatchObject({ content: "generate ok", generationProtocol: "google_generate_content" });
    expect(generateContent.requests.at(-1)?.url).toBe("/v1/models/gemini-2.5-flash:generateContent");
    expect(generateContent.requests.at(-1)?.body).toMatchObject({ contents: [{ role: "user" }] });

    const interactionsResponse = await request.post("/api/ai/generate", {
      data: {
        provider: "google",
        apiKey: "fixture-key",
        baseUrl: interactions.baseUrl,
        model: "gemini-3.5-flash",
        generationProtocol: "google_interactions",
        messages: [{ role: "user", content: "hello" }],
        runtime: { reasoning: "high", speed: "priority" },
      },
    });
    expect(interactionsResponse.ok()).toBe(true);
    expect(await interactionsResponse.json()).toMatchObject({ content: "interaction ok", generationProtocol: "google_interactions" });
    expect(interactions.requests.at(-1)?.url).toBe("/v1/interactions");
    expect(interactions.requests.at(-1)?.body).toMatchObject({ store: false, service_tier: "priority", generation_config: { thinking_level: "high" } });
    expect(interactions.requests.at(-1)?.body).not.toHaveProperty("contents");
    expect(interactions.requests.at(-1)?.body).not.toHaveProperty("generationConfig");
  } finally {
    await generateContent.stop();
    await interactions.stop();
  }
});
