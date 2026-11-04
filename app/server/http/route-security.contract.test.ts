import "./ip-address-classification.contract.test.ts";
import "./outbound-network-policy.contract.test.ts";
import "./policy-fetch.contract.test.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "./outbound-network-policy.contract.test.ts";
import {
  RouteSecurityError,
  apiErrorResponse,
  readRouteJson,
  sanitizeRouteMessage,
  validateOutboundHttpUrl,
} from "./route-security.ts";
import { validateOutboundNetworkTarget } from "./outbound-network-policy.ts";
import nextConfig from "../../../next.config.ts";

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

test("外联网络策略默认拒绝局域网并始终阻止元数据和链路本地地址", async () => {
  const lookupPrivate = async () => [{ address: "192.168.1.9", family: 4 }];
  const lookupPublic = async () => [{ address: "8.8.8.8", family: 4 }];
  await assert.rejects(
    validateOutboundNetworkTarget("https://lan.example.invalid", {}, lookupPrivate),
    (error) => error instanceof RouteSecurityError && error.code === "private_network_confirmation_required",
  );
  assert.equal(
    (await validateOutboundNetworkTarget("https://lan.example.invalid", { allowPrivateNetwork: true }, lookupPrivate)).hostname,
    "lan.example.invalid",
  );
  assert.equal(
    (await validateOutboundNetworkTarget("https://public.example.invalid", {}, lookupPublic)).hostname,
    "public.example.invalid",
  );
  await assert.rejects(
    validateOutboundNetworkTarget("http://169.254.169.254/latest/meta-data", { allowPrivateNetwork: true }),
    (error) => error instanceof RouteSecurityError && error.code === "blocked_outbound_target",
  );
  await assert.rejects(
    validateOutboundNetworkTarget("http://metadata.google.internal", { allowPrivateNetwork: true }),
    (error) => error instanceof RouteSecurityError && error.code === "blocked_metadata_target",
  );
});

test("外联网络策略在 DNS 预检中拒绝包含任一私网的混合响应", async () => {
  await assert.rejects(
    validateOutboundNetworkTarget("https://rebind.example.invalid", {}, async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]),
    (error) => error instanceof RouteSecurityError && error.code === "private_network_confirmation_required",
  );
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

test("全局安全响应头禁止脚本属性、嵌套页面和跨来源资源复用", async () => {
  const groups = await nextConfig.headers?.();
  const headers = new Map(groups?.[0]?.headers.map((item) => [item.key, item.value]));
  const csp = headers.get("Content-Security-Policy") ?? "";
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /manifest-src 'self'/);
  if (process.env.NODE_ENV !== "development") {
    assert.doesNotMatch(csp, /'unsafe-eval'/);
  }
  assert.equal(headers.get("Cross-Origin-Resource-Policy"), "same-origin");
});
