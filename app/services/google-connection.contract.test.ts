import assert from "node:assert/strict";
import test from "node:test";
import { googleUpstreamFailureMessage } from "../server/ai/google-error.ts";
import { normalizeGoogleApiBaseUrl } from "./google-connection.ts";

test("Google Base URL 兼容版本根、models 和完整生成 endpoint", () => {
  assert.equal(normalizeGoogleApiBaseUrl("https://generativelanguage.googleapis.com/v1beta/"), "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(normalizeGoogleApiBaseUrl("https://generativelanguage.googleapis.com/v1beta/models"), "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(
    normalizeGoogleApiBaseUrl("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=secret"),
    "https://generativelanguage.googleapis.com/v1beta",
  );
  assert.equal(normalizeGoogleApiBaseUrl("https://proxy.example/google/v1beta/models"), "https://proxy.example/google/v1beta");
});

test("Google 400 只返回脱敏的参数诊断", async () => {
  const response = new Response(JSON.stringify({
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message: "Unknown name service_tier at https://example.test key AIza012345678901234567890123456789",
    },
  }), { status: 400 });
  const message = await googleUpstreamFailureMessage(response);
  assert.match(message, /参数不兼容/);
  assert.doesNotMatch(message, /AIza012/);
  assert.doesNotMatch(message, /example\.test/);
});
