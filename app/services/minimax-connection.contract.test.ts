import assert from "node:assert/strict";
import test from "node:test";
import { MINIMAX_ANTHROPIC_BASE_URLS, inferMiniMaxRegion, miniMaxBearerHeaders, miniMaxFailureMessage, normalizeMiniMaxAnthropicBaseUrl } from "./minimax-connection.ts";

test("MiniMax 国内与国际站地址归一化且不会重复拼接路径", () => {
  assert.equal(normalizeMiniMaxAnthropicBaseUrl("https://api.minimaxi.com/v1", "cn"), MINIMAX_ANTHROPIC_BASE_URLS.cn);
  assert.equal(normalizeMiniMaxAnthropicBaseUrl("https://api.minimaxi.com/anthropic/v1/messages", "cn"), MINIMAX_ANTHROPIC_BASE_URLS.cn);
  assert.equal(normalizeMiniMaxAnthropicBaseUrl("https://api.minimax.io/anthropic/", "global"), MINIMAX_ANTHROPIC_BASE_URLS.global);
  assert.equal(normalizeMiniMaxAnthropicBaseUrl("https://proxy.example/v1", "cn"), "https://proxy.example/anthropic");
  assert.equal(inferMiniMaxRegion("https://api.minimaxi.com/anthropic"), "cn");
  assert.equal(inferMiniMaxRegion("https://api.minimax.io/anthropic"), "global");
});

test("MiniMax 直连只使用 Bearer 鉴权并分类区域、套餐和余额错误", () => {
  const headers = miniMaxBearerHeaders("fixture-key");
  assert.deepEqual(headers, { Authorization: "Bearer fixture-key", "Content-Type": "application/json" });
  assert.equal("x-api-key" in headers, false);
  assert.match(miniMaxFailureMessage(401, "generate", "cn"), /中国大陆站/);
  assert.match(miniMaxFailureMessage(403, "generate", "cn", "token_plan"), /Token Plan/);
  assert.match(miniMaxFailureMessage(402, "generate", "cn"), /余额不足/);
  assert.match(miniMaxFailureMessage(404, "generate", "cn"), /未开通/);
  assert.match(miniMaxFailureMessage(429, "directory", "global"), /限流/);
});
