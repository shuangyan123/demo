import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { withMcpClient } from "./client.ts";

test("real MCP SDK initialize, notification, GET, tool read and DELETE all use isolated approved connections", async () => {
  const methods: string[] = [];
  let connections = 0;
  const server = createServer(async (request, response) => {
    methods.push(request.method ?? "");
    assert.equal(request.url, "/mcp");
    assert.equal(request.headers.authorization, "Bearer manufactured-fixture-token");
    if (request.method === "GET") { response.writeHead(405); response.end(); return; }
    if (request.method === "DELETE") { response.writeHead(200); response.end(); return; }
    let body = ""; for await (const chunk of request) body += String(chunk);
    const message = JSON.parse(body) as { id?: number; method: string };
    if (message.id === undefined) { response.writeHead(202); response.end(); return; }
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "owned-fixture", version: "1" } }
      : { tools: [] };
    response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "manufactured-session" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  server.on("connection", () => { connections++; });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await withMcpClient({ endpoint: `http://127.0.0.1:${address.port}/mcp`, token: "manufactured-fixture-token" }, async client => {
      assert.deepEqual((await client.listTools()).tools, []);
      assert.ok(client.transport instanceof StreamableHTTPClientTransport);
      await client.transport.terminateSession();
    });
    assert.ok(methods.includes("GET")); assert.ok(methods.includes("DELETE"));
    assert.equal(methods.filter(method => method === "POST").length, 3);
    assert.equal(connections, methods.length, "no connection reuse between SDK requests or policies");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("MCP SDK redirect cannot replay initialize or forward a bearer token", async () => {
  const paths: string[] = [];
  const server = createServer((request, response) => { paths.push(request.url ?? ""); response.writeHead(307, { location: "/other" }); response.end(); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(withMcpClient({ endpoint: `http://127.0.0.1:${address.port}/mcp`, token: "manufactured-fixture-token" }, async () => undefined));
    assert.deepEqual(paths, ["/mcp"]);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
