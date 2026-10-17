import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { outboundTransport } from "../http/outbound-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { queryOfficialMcpRegistry } from "./registry-client.ts";

test("官方 MCP Registry 代理固定上游并只保留最新 active Streamable HTTP", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input) => {
    requested = String(input);
    return Response.json({
      servers: [
        {
          server: {
            name: "io.example/remote",
            title: "Remote",
            description: "safe remote",
            version: "1.2.3",
            repository: { url: "https://github.com/example/remote" },
            remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
          },
          _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true, updatedAt: "2026-07-30T00:00:00Z" } },
        },
        {
          server: { name: "io.example/stdio", version: "1.0.0", packages: [{ registryType: "npm" }] },
          _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } },
        },
      ],
      metadata: { nextCursor: "opaque:cursor" },
    });
  };
  try {
    const page = await queryOfficialMcpRegistry({ query: "remote", cursor: "cursor-1" });
    const url = new URL(requested);
    assert.equal(url.origin, "https://registry.modelcontextprotocol.io");
    assert.equal(url.pathname, "/v0.1/servers");
    assert.equal(url.searchParams.get("version"), "latest");
    assert.equal(url.searchParams.get("search"), "remote");
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].compatibility, "streamable-http");
    assert.equal(page.nextCursor, "opaque:cursor");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// DNS 和 HTTP 成对 mock，未登记主机立即失败，测试不使用真实网络。
test.beforeEach(context => {
  if (!("mock" in context)) throw new Error("fixture requires TestContext");
  context.mock.method(outboundTransport, "fetch", (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
  context.mock.method(dns, "lookup", async (hostname: string) => {
    assert.ok(["registry.modelcontextprotocol.io"].includes(hostname), `unexpected fixture host: ${hostname}`);
    return [{ address: "8.8.8.8", family: 4 }];
  });
  syncBuiltinESMExports();
});
test.afterEach(context => { if ("mock" in context) context.mock.restoreAll(); syncBuiltinESMExports(); });
