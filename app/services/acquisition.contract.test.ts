import assert from "node:assert/strict";
import test from "node:test";
import { parseAcquisitionDocument } from "../server/acquisition/document-parser.ts";
import { isPrivateAddress, normalizeAllowedOrigin, safeFetchAcquisition } from "../server/acquisition/safe-fetch.ts";
import type { AcquisitionDocument, AutomationCollectionConfig } from "../types/domains/acquisition.ts";
import { buildAcquisitionEvidence } from "./acquisition-proposal-service.ts";
import { extractCandidateUrls, normalizeCollectionConfig, previewCollectionConfig } from "./acquisition-source-service.ts";
import { calculateAcquisitionTrust } from "./acquisition-trust.ts";

const now = new Date("2026-07-21T00:00:00.000Z");

function document(overrides: Partial<AcquisitionDocument> = {}): AcquisitionDocument {
  return {
    id: "doc-1", url: "https://www.gov.cn/policy/1", title: "政策原文", publisher: "中国政府网",
    publishedAt: "2026-07-15T00:00:00.000Z", fetchedAt: now.toISOString(), contentHash: "abc",
    text: "第一段政策事实。第二段政策依据。第三段作答启示。", excerpt: "第一段政策事实。",
    sourceKind: "url", authority: "official", contentPolicy: "summary_only", ...overrides,
  };
}

test("SSRF 地址、协议与允许 origin 使用精确边界", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  assert.equal(normalizeAllowedOrigin("https://www.gov.cn/path?q=1"), "https://www.gov.cn");
  assert.equal(normalizeAllowedOrigin("file:///tmp/a"), undefined);
});

test("HTML 与 RSS 提取正文、发布日期、哈希和候选 URL", () => {
  const html = parseAcquisitionDocument({
    url: "https://example.com/article", contentType: "text/html",
    body: "<html><head><title>标题</title><meta property='article:published_time' content='2026-07-20'></head><body><nav>菜单</nav><article><h1>政策解读</h1><p>有效正文</p></article><script>secret()</script></body></html>",
  });
  assert.equal(html.title, "标题");
  assert.equal(html.text.includes("有效正文"), true);
  assert.equal(html.text.includes("secret"), false);
  assert.equal(html.publishedAt, "2026-07-20");
  assert.equal(html.contentHash.length, 64);

  const rss = parseAcquisitionDocument({
    url: "https://example.com/feed.xml", contentType: "application/rss+xml",
    body: "<?xml version='1.0'?><rss><channel><title>官方发布</title><item><title>文章一</title><link>/a</link><pubDate>2026-07-19</pubDate><description>摘要</description></item></channel></rss>",
  });
  assert.deepEqual(rss.discoveredUrls, ["https://example.com/a"]);
  assert.equal(rss.publisher, "官方发布");
});

test("安全抓取逐跳阻止非白名单重定向和 DNS 变更到私网", async () => {
  const redirect = new Response(null, { status: 302, headers: { location: "https://evil.test/private" } });
  await assert.rejects(() => safeFetchAcquisition({
    url: "https://example.com/start", allowedOrigins: ["https://example.com"],
    fetchImpl: async () => redirect,
    lookupImpl: async () => [{ address: "8.8.8.8" }],
  }), /不在允许域名/);

  let lookupCount = 0;
  await assert.rejects(() => safeFetchAcquisition({
    url: "https://example.com/start", allowedOrigins: ["https://example.com"],
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "/next" } }),
    lookupImpl: async () => [{ address: lookupCount++ === 0 ? "8.8.8.8" : "127.0.0.1" }],
  }), /私网、环回或保留地址/);
});

test("来源配置归一化限制内容策略、数量和 MCP 候选 URL", () => {
  const config: AutomationCollectionConfig = {
    domain: "shenlun", queries: [" 政策 ", ""], allowedOrigins: ["https://www.gov.cn/a", "file:///tmp"], freshnessDays: 0, maxDocuments: 99,
    sources: [{ id: "source-1", kind: "url", label: " 官方 ", enabled: false, urls: ["https://www.gov.cn/a"], allowedOrigins: ["https://www.gov.cn/path"], authority: "official", contentPolicy: "summary_only" }],
  };
  const normalized = normalizeCollectionConfig(config);
  assert.deepEqual(normalized.queries, ["政策"]);
  assert.deepEqual(normalized.allowedOrigins, ["https://www.gov.cn"]);
  assert.equal(normalized.maxDocuments, 10);
  assert.equal(normalized.freshnessDays, 30);
  assert.deepEqual(previewCollectionConfig(normalized), { sourceLabels: [], allowedOrigins: ["https://www.gov.cn"], estimatedDocuments: 1 });
  assert.deepEqual(extractCandidateUrls({ items: [{ url: "https://www.gov.cn/a" }, "忽略 javascript:x https://other.test/b."] }), ["https://www.gov.cn/a", "https://other.test/b"]);
});

test("可信度按固定权重评分，缺复核降级且争议与无证据阻止确认", () => {
  const docs = [document()];
  const evidence = buildAcquisitionEvidence(docs);
  assert.equal(evidence.every((item) => item.quote.length <= 360), true);
  const agreed = calculateAcquisitionTrust({ documents: docs, claimEvidence: [{ claimId: "p1", evidenceIds: [evidence[0].id] }], evidenceIds: new Set([evidence[0].id]), reviewStatus: "agreed", freshnessDays: 30, now, urlVerified: true, requiredFieldsComplete: 1 });
  assert.deepEqual({ total: agreed.total, grade: agreed.grade, blocked: agreed.blockingIssues.length }, { total: 100, grade: "A", blocked: 0 });

  const missingReviewer = calculateAcquisitionTrust({ documents: docs, claimEvidence: [{ claimId: "p1", evidenceIds: [evidence[0].id] }], evidenceIds: new Set([evidence[0].id]), reviewStatus: "not_configured", freshnessDays: 30, now, urlVerified: true, requiredFieldsComplete: 1 });
  assert.equal(missingReviewer.grade, "B");
  const disputed = calculateAcquisitionTrust({ documents: docs, claimEvidence: [{ claimId: "p1", evidenceIds: [] }], evidenceIds: new Set(), reviewStatus: "disputed", freshnessDays: 30, now, urlVerified: false, hashChanged: true, exactDuplicate: true, contentPolicyViolation: true, requiredFieldsComplete: 0.5 });
  assert.equal(disputed.grade, "C");
  assert.deepEqual(disputed.blockingIssues, ["来源 URL 无法验证", "存在没有证据的正文段落", "来源内容哈希已变化", "与现有提案或知识条目精确重复", "仅摘要来源包含疑似长段原文", "整理模型与复核模型存在事实冲突"]);
});
