import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationCollectionConfig } from "../types/domains/acquisition.ts";
import { acquireCollectionDocuments } from "./acquisition-source-service.ts";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";

const now = new Date("2026-08-11T00:00:00.000Z");

test("HTTP source partial failure preserves documents and sanitized external counts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
    if (request.url?.endsWith("/failed")) {
      return new Response(JSON.stringify({ message: "raw upstream detail should stay diagnostic" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      url: request.url,
      title: "Available source",
      publisher: "Official source",
      publishedAt: now.toISOString(),
      fetchedAt: now.toISOString(),
      contentHash: "successful-hash",
      text: "Document text remains outside the external execution summary",
      excerpt: "Available excerpt",
      discoveredUrls: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const config: AutomationCollectionConfig = {
      domain: "xingce",
      queries: [],
      allowedOrigins: ["https://example.com"],
      sources: [{
        id: "partial-http-source",
        label: "Partial HTTP source",
        enabled: true,
        kind: "url",
        urls: ["https://example.com/success", "https://example.com/failed"],
        allowedOrigins: ["https://example.com"],
        authority: "official",
        contentPolicy: "summary_only",
      }],
      freshnessDays: 30,
      maxDocuments: 10,
    };
    const result = await acquireCollectionDocuments(config);

    assert.equal(result.discoveredCount, 2);
    assert.equal(result.fetchedCount, 1);
    assert.equal(result.documents.length, 1);
    assert.deepEqual(result.externalExecution, {
      sourceKinds: ["url"],
      mcpTools: [],
      httpOrigins: ["https://example.com"],
      externalCallCount: 2,
      successfulCallCount: 1,
      failedCallCount: 1,
    });
    assert.doesNotMatch(JSON.stringify(result.externalExecution), /raw upstream detail|Document text/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MCP source failure preserves tool identity and failed count", async () => {
  const originalCallScheduledTool = mcpSettingsRepository.callScheduledTool;
  mcpSettingsRepository.callScheduledTool = async () => {
    throw new Error("raw MCP result should stay diagnostic");
  };
  try {
    const result = await acquireCollectionDocuments({
      domain: "xingce",
      queries: ["method"],
      allowedOrigins: ["https://example.com"],
      sources: [{
        id: "partial-mcp-source",
        label: "Partial MCP source",
        enabled: true,
        kind: "mcp_search",
        serverId: "server-a",
        toolName: "search-y",
        argumentTemplate: '{"query":"{{query}}"}',
        allowedOrigins: ["https://example.com"],
        authority: "other",
        contentPolicy: "summary_only",
      }],
      freshnessDays: 30,
      maxDocuments: 10,
    });

    assert.equal(result.documents.length, 0);
    assert.deepEqual(result.externalExecution, {
      sourceKinds: ["mcp_search"],
      mcpTools: [{ serverId: "server-a", toolName: "search-y" }],
      httpOrigins: ["https://example.com"],
      externalCallCount: 1,
      successfulCallCount: 0,
      failedCallCount: 1,
    });
    assert.doesNotMatch(JSON.stringify(result.externalExecution), /raw MCP result/);
  } finally {
    mcpSettingsRepository.callScheduledTool = originalCallScheduledTool;
  }
});
