import assert from "node:assert/strict";
import test from "node:test";
// 复用已纳入门禁的服务端安全测试入口，确保路由与外联策略不会被遗漏。
import "../http/route-security.contract.test.ts";
import { toMcpError, validateMcpEndpoint } from "./client.ts";

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
