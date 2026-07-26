import assert from "node:assert/strict";
import test from "node:test";
import {
  RouteSecurityError,
  apiErrorResponse,
  readRouteJson,
  sanitizeRouteMessage,
  validateOutboundHttpUrl,
} from "./route-security.ts";

test("Route JSON 拒绝跨来源和超过预算的请求体", async () => {
  await assert.rejects(
    readRouteJson(new Request("http://127.0.0.1/api/test", {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    })),
    (error) => error instanceof RouteSecurityError && error.code === "cross_origin_request",
  );
  await assert.rejects(
    readRouteJson(new Request("http://127.0.0.1/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(64) }),
    }), 16),
    (error) => error instanceof RouteSecurityError && error.status === 413,
  );
});

test("Route JSON 接受 Next 内部 localhost 与浏览器 loopback Host 的同源请求", async () => {
  const body = await readRouteJson<{ value: string }>(new Request("http://localhost:4320/api/test", {
    method: "POST",
    headers: {
      host: "127.0.0.1:4320",
      origin: "http://127.0.0.1:4320",
      "content-type": "application/json",
    },
    body: JSON.stringify({ value: "ok" }),
  }));
  assert.deepEqual(body, { value: "ok" });
});

test("外联地址只允许 HTTP(S) 且不接受内嵌凭据", () => {
  assert.equal(validateOutboundHttpUrl("https://api.example.com/v1").origin, "https://api.example.com");
  assert.throws(() => validateOutboundHttpUrl("file:///tmp/data"), /HTTP/);
  assert.throws(() => validateOutboundHttpUrl("https://user:secret@example.com"), /用户名或密码/);
});

test("统一错误响应隐藏凭据并提供稳定关联字段", async () => {
  assert.equal(sanitizeRouteMessage("Authorization: Bearer secret-value"), "Authorization: ***");
  const response = apiErrorResponse(new Error("Bearer abc123"), {
    code: "upstream_failed",
    message: "上游调用失败",
    status: 502,
    retryable: true,
  }, "request-test");
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("x-request-id"), "request-test");
  assert.deepEqual(await response.json(), {
    code: "upstream_failed",
    message: "上游调用失败",
    requestId: "request-test",
    retryable: true,
  });
});
