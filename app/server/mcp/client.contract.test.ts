import assert from "node:assert/strict";
import test from "node:test";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import "./registry-client.contract.test.ts";
// 复用已纳入门禁的服务端安全测试入口，确保路由与外联策略不会被遗漏。
import "../http/route-security.contract.test.ts";
import { toMcpError, validateMcpEndpoint, withMcpClient } from "./client.ts";

test("MCP 地址只允许远程 HTTPS 与 loopback HTTP", () => {
  assert.equal(validateMcpEndpoint("https://mcp.example.com/path#fragment").href, "https://mcp.example.com/path");
  assert.equal(validateMcpEndpoint("http://127.0.0.8:8765/mcp").hostname, "127.0.0.8");
  assert.equal(validateMcpEndpoint("http://localhost:8765/mcp").protocol, "http:");
  assert.throws(() => validateMcpEndpoint("http://192.168.1.3/mcp"), /必须使用 HTTPS/);
  assert.equal(validateMcpEndpoint("http://192.168.1.3/mcp", true).hostname, "192.168.1.3");
  assert.throws(() => validateMcpEndpoint("https://user:secret@example.com/mcp"), /不得包含用户名或密码/);
  assert.throws(() => validateMcpEndpoint("file:///tmp/mcp"), /仅支持 Streamable HTTP/);
});

test("MCP 错误会过滤 Bearer 凭据并限制长度", () => {
  assert.equal(toMcpError(new Error("401 Unauthorized Bearer abc-secret")), "MCP 认证失败，请检查 Bearer Token");
  assert.equal(toMcpError(new Error("request timeout")), "MCP 请求超时，请检查服务状态");
});

test("AUD-09 MCP: DNS 与 SDK connect 均 mock，LAN 授权不包含特殊网络", async (context) => {
  let address = "192.168.0.9";
  let connects = 0;
  context.mock.method(dns, "lookup", async (hostname: string) => {
    assert.equal(hostname, "mcp.test");
    return [{ address, family: address.includes(":") ? 6 : 4 }];
  });
  syncBuiltinESMExports();
  context.mock.method(Client.prototype, "connect", async () => { connects += 1; });
  context.mock.method(Client.prototype, "close", async () => undefined);
  try {
    await assert.rejects(withMcpClient({ endpoint: "https://mcp.test" }, async () => "fixture"), /显式开启/);
    assert.equal(connects, 0);
    assert.equal(await withMcpClient({ endpoint: "https://mcp.test", allowPrivateNetwork: true }, async () => "fixture"), "fixture");
    assert.equal(connects, 1);
    address = "::ffff:a00:1";
    await withMcpClient({ endpoint: "https://mcp.test", allowPrivateNetwork: true }, async () => "fixture");
    assert.equal(connects, 2);
    for (address of ["100.64.0.1", "198.18.0.1", "169.254.169.254"]) {
      await assert.rejects(withMcpClient({ endpoint: "https://mcp.test", allowPrivateNetwork: true }, async () => "fixture"), /特殊网络/);
      assert.equal(connects, 2);
    }
    await withMcpClient({ endpoint: "http://127.0.0.1:8765/mcp" }, async () => "fixture");
    await withMcpClient({ endpoint: "http://[::1]:8765/mcp" }, async () => "fixture");
    await withMcpClient({ endpoint: "http://10.0.0.1/mcp", allowPrivateNetwork: true }, async () => "fixture");
    assert.equal(connects, 5);
    // HTTP 语法授权保持既有范围；共享分类器不能扩大 MCP 的明文 LAN 入口。
    assert.throws(() => validateMcpEndpoint("http://[fd00::1]/mcp", true), /必须使用 HTTPS/);
    assert.throws(() => validateMcpEndpoint("http://[::ffff:7f00:1]/mcp"), /必须使用 HTTPS/);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
