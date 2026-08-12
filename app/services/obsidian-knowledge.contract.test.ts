import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reviewDb } from "../db/review-db.ts";
import type { KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { KnowledgeEvolutionProposal, ObsidianVaultConfig } from "../types/domains/obsidian.ts";
import {
  applyAiEvolutionSection,
  buildObsidianNotePath,
  buildObsidianUri,
  parseObsidianMarkdown,
  serializeObsidianEntry,
} from "./obsidian-markdown.ts";
import { obsidianKnowledgeRepository } from "./obsidian-knowledge-repository.ts";

test("Obsidian 应用级运行时串行防抖、合并补跑且不泄露路径", () => {
  const runtime = readFileSync(new URL("./obsidian-sync-runtime.ts", import.meta.url), "utf8");
  const desktopVault = readFileSync(new URL("../../desktop/vault.ts", import.meta.url), "utf8");
  const preload = readFileSync(new URL("../../desktop/preload.cts", import.meta.url), "utf8");
  assert.match(runtime, /CHANGE_DEBOUNCE_MS = 1_000/);
  assert.match(runtime, /POLL_INTERVAL_MS = 30_000/);
  assert.match(runtime, /rerunRequested = true/);
  assert.match(runtime, /visibilityState === "visible" && navigator\.onLine/);
  assert.match(runtime, /"needs-permission"/);
  assert.match(desktopVault, /review-vault:changed/);
  assert.match(desktopVault, /revision: watcherRevision/);
  assert.match(preload, /onVaultChanged/);
  assert.doesNotMatch(preload.split("\n").find((line) => line.includes("onVaultChanged")) ?? "", /relativePath|markdown/);
});
import { normalizeObsidianPath, ObsidianVaultError, obsidianVaultAdapter } from "./obsidian-vault-adapter.ts";

const today = new Date("2026-06-21T08:00:00.000Z");

function knowledgeEntry(id: string, content = "# 行政许可\n\n行政机关依法审查申请。", updatedAt = today.toISOString()): KnowledgeEntry {
  return {
    id, category: "常识判断", title: "行政许可", summary: "行政许可基本规则", content,
    tags: ["法律"], source: "Obsidian / 常识判断/行政许可.md", favorite: false,
    mastery: 2, nextReviewAt: updatedAt, reviewCount: 0, createdAt: updatedAt, updatedAt,
  };
}

test("Obsidian Properties、中文分类和 Wikilink 可稳定往返", async () => {
  const markdown = `---\nreview-id: knowledge-1\ntitle: 行政许可\ncategory: 常识判断\ntags:\n  - 法律\n  - 行政法\nsource-refs:\n  - mistake:1\n---\n\n# 行政许可\n\n行政机关依法审查申请。\n\n## 关联知识\n\n- [[行政处罚]]\n`;
  const parsed = await parseObsidianMarkdown(markdown, "常识判断/行政许可.md");
  assert.equal(parsed.reviewId, "knowledge-1");
  assert.equal(parsed.category, "常识判断");
  assert.deepEqual(parsed.tags, ["法律", "行政法"]);
  assert.deepEqual(parsed.sourceRefs, ["mistake:1"]);
  assert.deepEqual(parsed.wikilinks, ["行政处罚"]);
  assert.equal(parsed.content.includes("## 关联知识"), false);

  const serialized = await serializeObsidianEntry(knowledgeEntry("knowledge-1"), parsed.wikilinks, parsed.sourceRefs);
  const roundTrip = await parseObsidianMarkdown(serialized, "常识判断/行政许可.md");
  assert.equal(roundTrip.reviewId, "knowledge-1");
  assert.deepEqual(roundTrip.wikilinks, ["行政处罚"]);
});
test("AI 演进区只替换托管边界且路径与 Obsidian URI 可读", () => {
  const first = applyAiEvolutionSection("# 原文\n\n用户正文", "第一次演进");
  const second = applyAiEvolutionSection(first, "第二次演进");
  assert.equal(second.includes("用户正文"), true);
  assert.equal(second.includes("第一次演进"), false);
  assert.equal(second.match(/review-workspace:ai-start/g)?.length, 1);
  assert.equal(buildObsidianNotePath(knowledgeEntry("12345678-abcd")).startsWith("常识判断/行政许可--12345678"), true);
  assert.equal(buildObsidianUri("公务员知识库", "AI知识库", "常识判断/行政许可.md"), "obsidian://open?vault=%E5%85%AC%E5%8A%A1%E5%91%98%E7%9F%A5%E8%AF%86%E5%BA%93&file=AI%E7%9F%A5%E8%AF%86%E5%BA%93%2F%E5%B8%B8%E8%AF%86%E5%88%A4%E6%96%AD%2F%E8%A1%8C%E6%94%BF%E8%AE%B8%E5%8F%AF.md");
});

test("Vault 三方同步区分导入、应用写回、冲突和文件断开", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const fakeHandle = { name: "测试 Vault" } as unknown as FileSystemDirectoryHandle;
  const config: ObsidianVaultConfig = { id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: fakeHandle, createdAt: today.toISOString(), updatedAt: today.toISOString() };
  await reviewDb.obsidianVaultConfigs.put(config);
  const originalMarkdown = await serializeObsidianEntry(knowledgeEntry("knowledge-1"), ["行政处罚"], ["mistake:1"]);
  let files = [{ path: "常识判断/行政许可.md", markdown: originalMarkdown }];
  const writes: Array<{ path: string; markdown: string }> = [];
  const originalPermission = obsidianVaultAdapter.permission;
  const originalList = obsidianVaultAdapter.listMarkdown;
  const originalWrite = obsidianVaultAdapter.writeMarkdown;
  obsidianVaultAdapter.permission = async () => "granted";
  obsidianVaultAdapter.listMarkdown = async () => files;
  obsidianVaultAdapter.writeMarkdown = async (_handle, _root, path, markdown) => { writes.push({ path, markdown }); };

  try {
    const imported = await obsidianKnowledgeRepository.sync(today);
    assert.equal(imported.imported, 1);
    assert.equal((await reviewDb.knowledgeEntries.get("knowledge-1"))?.title, "行政许可");
    assert.equal((await reviewDb.knowledgeEntries.get("knowledge-1"))?.nextReviewAt, "2026-06-21");
    assert.equal((await reviewDb.obsidianNoteMappings.get("常识判断/行政许可.md"))?.status, "synced");

    await reviewDb.knowledgeEntries.update("knowledge-1", { content: "# 行政许可\n\n应用侧补充。", updatedAt: "2026-06-21T09:00:00.000Z" });
    const exported = await obsidianKnowledgeRepository.sync(new Date("2026-06-21T09:00:00.000Z"));
    assert.equal(exported.exported, 1);
    assert.equal(writes.length, 1);

    files = [{ path: "常识判断/行政许可.md", markdown: originalMarkdown.replace("行政机关依法审查申请。", "Vault 侧补充。") }];
    await reviewDb.knowledgeEntries.update("knowledge-1", { content: "# 行政许可\n\n应用再次修改。", updatedAt: "2026-06-21T10:00:00.000Z" });
    const conflicted = await obsidianKnowledgeRepository.sync(new Date("2026-06-21T10:00:00.000Z"));
    assert.equal(conflicted.conflicts, 1);
    assert.equal((await reviewDb.obsidianNoteMappings.get("常识判断/行政许可.md"))?.status, "conflict");

    files = [];
    const disconnected = await obsidianKnowledgeRepository.sync(new Date("2026-06-21T11:00:00.000Z"));
    assert.equal(disconnected.disconnected, 1);
    assert.equal((await reviewDb.obsidianNoteMappings.get("常识判断/行政许可.md"))?.status, "disconnected");
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    obsidianVaultAdapter.listMarkdown = originalList;
    obsidianVaultAdapter.writeMarkdown = originalWrite;
    await reviewDb.delete();
  }
});

test("本地未映射知识资料首次同步会写入托管 Vault", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const fakeHandle = { name: "测试 Vault" } as unknown as FileSystemDirectoryHandle;
  await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: fakeHandle, createdAt: today.toISOString(), updatedAt: today.toISOString() });
  await reviewDb.knowledgeEntries.put(knowledgeEntry("local-knowledge-1"));
  const writes: Array<{ path: string; markdown: string }> = [];
  const originalPermission = obsidianVaultAdapter.permission;
  const originalList = obsidianVaultAdapter.listMarkdown;
  const originalWrite = obsidianVaultAdapter.writeMarkdown;
  obsidianVaultAdapter.permission = async () => "granted";
  obsidianVaultAdapter.listMarkdown = async () => [];
  obsidianVaultAdapter.writeMarkdown = async (_handle, _root, path, markdown) => { writes.push({ path, markdown }); };

  try {
    const report = await obsidianKnowledgeRepository.sync(today);
    assert.equal(report.exported, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path.startsWith("常识判断/行政许可--local-kn"), true);
    assert.equal(writes[0].markdown.includes("review-id: local-knowledge-1"), true);
    const mapping = await reviewDb.obsidianNoteMappings.where("knowledgeId").equals("local-knowledge-1").first();
    assert.equal(mapping?.status, "synced");
    assert.equal(mapping?.path, writes[0].path);

    const second = await obsidianKnowledgeRepository.sync(new Date("2026-06-21T09:00:00.000Z"));
    assert.equal(second.exported, 0);
    assert.equal(writes.length, 1);
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    obsidianVaultAdapter.listMarkdown = originalList;
    obsidianVaultAdapter.writeMarkdown = originalWrite;
    await reviewDb.delete();
  }
});

test("Obsidian 图谱从 Wikilink 生成内部和外部关系", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const entryA = knowledgeEntry("knowledge-a", "# 行政许可\n\nA");
  const entryB = { ...knowledgeEntry("knowledge-b", "# 行政处罚\n\nB"), title: "行政处罚" };
  await reviewDb.knowledgeEntries.bulkPut([entryA, entryB]);
  await reviewDb.obsidianNoteMappings.bulkPut([
    {
      path: "常识判断/行政许可.md",
      knowledgeId: entryA.id,
      category: entryA.category,
      baseHash: "base-a",
      vaultHash: "base-a",
      appHash: "base-a",
      status: "synced",
      wikilinks: ["行政处罚", "外部概念"],
      sourceRefs: [],
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    },
    {
      path: "常识判断/行政处罚.md",
      knowledgeId: entryB.id,
      category: entryB.category,
      baseHash: "base-b",
      vaultHash: "base-b",
      appHash: "base-b",
      status: "conflict",
      wikilinks: [],
      sourceRefs: [],
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    },
  ]);
  try {
    const graph = await obsidianKnowledgeRepository.loadGraphSnapshot();
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.syncedCount, 1);
    assert.equal(graph.issueCount, 1);
    assert.equal(graph.externalCount, 1);
    assert.equal(graph.edges.some((edge) => edge.sourceId === "knowledge-a" && edge.targetId === "knowledge-b"), true);
    assert.equal(graph.nodes.some((node) => node.id === "external:外部概念" && node.status === "external"), true);
  } finally {
    await reviewDb.delete();
  }
});

test("Vault 路径、权限状态和失效句柄在浏览器边界被明确区分", async () => {
  assert.equal(normalizeObsidianPath("AI知识库/常识判断"), "AI知识库/常识判断");
  assert.throws(() => normalizeObsidianPath("../私有目录"), (error) => error instanceof ObsidianVaultError && error.code === "path_invalid");
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { window: { showDirectoryPicker: async () => ({}) } });
  try {
    const promptHandle = { queryPermission: async () => "prompt" } as unknown as FileSystemDirectoryHandle;
    const deniedHandle = { queryPermission: async () => "denied" } as unknown as FileSystemDirectoryHandle;
    const invalidHandle = { queryPermission: async () => { throw new DOMException("stale", "InvalidStateError"); } } as unknown as FileSystemDirectoryHandle;
    assert.equal(await obsidianVaultAdapter.permission(promptHandle), "prompt");
    assert.equal(await obsidianVaultAdapter.permission(deniedHandle), "denied");
    await assert.rejects(obsidianVaultAdapter.permission(invalidHandle), (error) => error instanceof ObsidianVaultError && error.code === "handle_invalid");
  } finally {
    if (originalWindow) Object.assign(globalThis, { window: originalWindow });
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("同步预检失败不会更新映射或最后同步时间", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const fakeHandle = { name: "测试 Vault" } as unknown as FileSystemDirectoryHandle;
  await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: fakeHandle, lastSyncedAt: today.toISOString(), createdAt: today.toISOString(), updatedAt: today.toISOString() });
  const duplicateMarkdown = await serializeObsidianEntry(knowledgeEntry("duplicate-id"), [], []);
  const originalPermission = obsidianVaultAdapter.permission;
  const originalList = obsidianVaultAdapter.listMarkdown;
  obsidianVaultAdapter.permission = async () => "granted";
  obsidianVaultAdapter.listMarkdown = async () => [
    { path: "常识判断/甲.md", markdown: duplicateMarkdown },
    { path: "常识判断/乙.md", markdown: duplicateMarkdown },
  ];
  try {
    await assert.rejects(obsidianKnowledgeRepository.sync(), /重复 review-id/);
    assert.equal(await reviewDb.obsidianNoteMappings.count(), 0);
    assert.equal((await reviewDb.obsidianVaultConfigs.get("default"))?.lastSyncedAt, today.toISOString());
    obsidianVaultAdapter.listMarkdown = async () => { throw new ObsidianVaultError("managed_root_missing", "托管目录不存在"); };
    await assert.rejects(obsidianKnowledgeRepository.sync(), /托管目录不存在/);
    assert.equal(await reviewDb.obsidianNoteMappings.count(), 0);
    let releaseList: () => void = () => {};
    let markEntered: () => void = () => {};
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    obsidianVaultAdapter.listMarkdown = async () => new Promise((resolve) => {
      markEntered();
      releaseList = () => resolve([]);
    });
    const firstSync = obsidianKnowledgeRepository.sync();
    await entered;
    await assert.rejects(obsidianKnowledgeRepository.sync(), /正在进行/);
    releaseList();
    await firstSync;
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    obsidianVaultAdapter.listMarkdown = originalList;
    await reviewDb.delete();
  }
});

test("过期冲突拒绝覆盖，提案失败可重试且 link 不修改正文", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const fakeHandle = { name: "测试 Vault" } as unknown as FileSystemDirectoryHandle;
  await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: fakeHandle, createdAt: today.toISOString(), updatedAt: today.toISOString() });
  const originalMarkdown = await serializeObsidianEntry(knowledgeEntry("knowledge-1"), [], []);
  let vaultMarkdown = originalMarkdown;
  let failNextWrite = false;
  const originalPermission = obsidianVaultAdapter.permission;
  const originalList = obsidianVaultAdapter.listMarkdown;
  const originalRead = obsidianVaultAdapter.readMarkdown;
  const originalWrite = obsidianVaultAdapter.writeMarkdown;
  obsidianVaultAdapter.permission = async () => "granted";
  obsidianVaultAdapter.listMarkdown = async () => [{ path: "常识判断/行政许可.md", markdown: vaultMarkdown }];
  obsidianVaultAdapter.readMarkdown = async () => vaultMarkdown;
  obsidianVaultAdapter.writeMarkdown = async (_handle, _root, _path, markdown) => {
    if (failNextWrite) { failNextWrite = false; throw new Error("模拟磁盘写入失败"); }
    vaultMarkdown = markdown;
  };
  try {
    await obsidianKnowledgeRepository.sync(today);
    await reviewDb.knowledgeEntries.update("knowledge-1", { content: "# 行政许可\n\n应用修改。" });
    vaultMarkdown = originalMarkdown.replace("行政机关依法审查申请。", "Vault 修改。");
    await obsidianKnowledgeRepository.sync(new Date("2026-06-21T09:00:00.000Z"));
    vaultMarkdown = vaultMarkdown.replace("Vault 修改。", "Vault 再次修改。");
    await assert.rejects(obsidianKnowledgeRepository.resolveConflict("常识判断/行政许可.md", "app"), /又发生变化/);
    assert.equal((await reviewDb.obsidianNoteMappings.get("常识判断/行政许可.md"))?.status, "conflict");

    // 先采用 Vault 恢复干净基线，再验证 link 提案只改链接且写入失败可重试。
    await obsidianKnowledgeRepository.sync(new Date("2026-06-21T10:00:00.000Z"));
    await obsidianKnowledgeRepository.resolveConflict("常识判断/行政许可.md", "vault");
    const before = await reviewDb.knowledgeEntries.get("knowledge-1");
    const proposal: KnowledgeEvolutionProposal = {
      id: "proposal-link", mode: "link", status: "pending", category: "常识判断", sourceType: "mistake",
      sourceIds: ["mistake:1"], targetKnowledgeId: "knowledge-1", title: "建立关联", summary: "不得写入",
      content: "不得写入正文", tags: ["不得写入"], proposedLinks: ["行政处罚", "行政许可"], reason: "测试", confidence: 0.9,
      createdAt: today.toISOString(), updatedAt: today.toISOString(),
    };
    await reviewDb.knowledgeEvolutionProposals.put(proposal);
    failNextWrite = true;
    await assert.rejects(obsidianKnowledgeRepository.acceptProposal(proposal.id), /模拟磁盘写入失败/);
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(proposal.id))?.status, "pending");
    assert.equal((await reviewDb.knowledgeEntries.get("knowledge-1"))?.content, before?.content);
    await obsidianKnowledgeRepository.acceptProposal(proposal.id);
    const after = await reviewDb.knowledgeEntries.get("knowledge-1");
    assert.equal(after?.content, before?.content);
    assert.equal(after?.summary, before?.summary);
    assert.equal(vaultMarkdown.includes("[[行政处罚]]"), true);
    assert.equal(vaultMarkdown.includes("[[行政许可]]"), false);
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(proposal.id))?.status, "accepted");

    const blockedProposal = { ...proposal, id: "proposal-blocked", status: "pending" as const, updatedAt: new Date().toISOString() };
    await reviewDb.knowledgeEvolutionProposals.put(blockedProposal);
    await reviewDb.obsidianNoteMappings.update("常识判断/行政许可.md", { status: "disconnected" });
    await assert.rejects(obsidianKnowledgeRepository.acceptProposal(blockedProposal.id), /disconnected/);
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(blockedProposal.id))?.status, "pending");
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    obsidianVaultAdapter.listMarkdown = originalList;
    obsidianVaultAdapter.readMarkdown = originalRead;
    obsidianVaultAdapter.writeMarkdown = originalWrite;
    await reviewDb.delete();
  }
});

test("merge 提案只替换 AI 演进区并保留用户手写正文", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const fakeHandle = { name: "测试 Vault" } as unknown as FileSystemDirectoryHandle;
  await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: fakeHandle, createdAt: today.toISOString(), updatedAt: today.toISOString() });
  const originalEntry = knowledgeEntry("knowledge-merge", "# 行政许可\n\nUSER_WRITTEN_BODY\n\nUser keeps this paragraph.");
  const originalMarkdown = await serializeObsidianEntry(originalEntry, ["原有关联"], ["mistake:old"]);
  let vaultMarkdown = originalMarkdown;
  const originalPermission = obsidianVaultAdapter.permission;
  const originalList = obsidianVaultAdapter.listMarkdown;
  const originalRead = obsidianVaultAdapter.readMarkdown;
  const originalWrite = obsidianVaultAdapter.writeMarkdown;
  obsidianVaultAdapter.permission = async () => "granted";
  obsidianVaultAdapter.listMarkdown = async () => [{ path: "常识判断/行政许可.md", markdown: vaultMarkdown }];
  obsidianVaultAdapter.readMarkdown = async () => vaultMarkdown;
  obsidianVaultAdapter.writeMarkdown = async (_handle, _root, _path, markdown) => { vaultMarkdown = markdown; };

  try {
    await obsidianKnowledgeRepository.sync(today);
    const proposal: KnowledgeEvolutionProposal = {
      id: "proposal-merge",
      mode: "merge",
      status: "pending",
      category: "常识判断",
      sourceType: "mistake",
      sourceIds: ["mistake:new"],
      targetKnowledgeId: "knowledge-merge",
      title: "补充行政许可边界",
      summary: "AI updated summary",
      content: "AI_EVOLUTION_BLOCK",
      tags: ["法律", "新标签"],
      proposedLinks: ["新增关联", originalEntry.title],
      reason: "验证 merge 只维护托管区块",
      confidence: 0.91,
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    };
    await reviewDb.knowledgeEvolutionProposals.put(proposal);

    const accepted = await obsidianKnowledgeRepository.acceptProposal(proposal.id, new Date("2026-06-21T12:00:00.000Z"));
    const stored = await reviewDb.knowledgeEntries.get("knowledge-merge");
    const mapping = await reviewDb.obsidianNoteMappings.where("knowledgeId").equals("knowledge-merge").first();

    assert.equal(accepted.content.includes("USER_WRITTEN_BODY"), true);
    assert.equal(accepted.content.includes("AI_EVOLUTION_BLOCK"), true);
    assert.equal(accepted.content.match(/review-workspace:ai-start/g)?.length, 1);
    assert.equal(stored?.summary, proposal.summary);
    assert.equal(stored?.tags.includes("法律"), true);
    assert.equal(stored?.tags.includes("新标签"), true);
    assert.equal(mapping?.status, "synced");
    assert.equal(mapping?.sourceRefs.includes("mistake:old"), true);
    assert.equal(mapping?.sourceRefs.includes("mistake:new"), true);
    assert.equal(mapping?.wikilinks.includes("原有关联"), true);
    assert.equal(mapping?.wikilinks.includes("新增关联"), true);
    assert.equal(mapping?.wikilinks.includes(originalEntry.title), false);
    assert.equal(vaultMarkdown.includes("USER_WRITTEN_BODY"), true);
    assert.equal(vaultMarkdown.includes("AI_EVOLUTION_BLOCK"), true);
    assert.equal(vaultMarkdown.includes("[[新增关联]]"), true);
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(proposal.id))?.status, "accepted");
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    obsidianVaultAdapter.listMarkdown = originalList;
    obsidianVaultAdapter.readMarkdown = originalRead;
    obsidianVaultAdapter.writeMarkdown = originalWrite;
    await reviewDb.delete();
  }
});

test("批量确认先预检来源并保留部分失败项，外部 URL 写入 sourceRefs", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const fakeHandle = { name: "测试 Vault" } as unknown as FileSystemDirectoryHandle;
  await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: fakeHandle, createdAt: today.toISOString(), updatedAt: today.toISOString() });
  const baseProposal: KnowledgeEvolutionProposal = {
    id: "batch-1", mode: "create", status: "pending", category: "申论", sourceType: "external",
    sourceIds: ["https://www.gov.cn/policy"], title: "政策证据", summary: "带来源的摘要",
    content: "政策事实[^e1]\n\n## 来源与证据\n\n[^e1]: 原文摘录 — [来源](https://www.gov.cn/policy)",
    tags: ["政策"], proposedLinks: [], reason: "外部采集", confidence: 0.9,
    provenance: {
      domain: "shenlun", documents: [{ url: "https://www.gov.cn/policy", title: "政策原文", fetchedAt: today.toISOString(), contentHash: "hash-1", acquisitionMethod: "url" }],
      evidence: [{ id: "e1", documentId: "doc-1", url: "https://www.gov.cn/policy", quote: "原文摘录", contentHash: "hash-1" }],
      claimEvidence: [{ claimId: "p1", evidenceIds: ["e1"] }], schemaVersion: "acquisition-proposal-v1", promptVersion: "scheduled-collection-v1",
      reviewStatus: "agreed", reviewIssues: [], trust: { authority: 25, evidenceCoverage: 25, corroboration: 15, recency: 10, modelAgreement: 15, completeness: 10, total: 100, grade: "A", blockingIssues: [] },
    },
    createdAt: today.toISOString(), updatedAt: today.toISOString(),
  };
  const second = { ...baseProposal, id: "batch-2", title: "第二条政策证据", sourceIds: ["https://www.gov.cn/policy-2"], provenance: undefined };
  const blocked = { ...baseProposal, id: "batch-blocked", title: "争议证据", provenance: { ...baseProposal.provenance!, trust: { ...baseProposal.provenance!.trust, blockingIssues: ["整理模型与复核模型存在事实冲突"] } } };
  await reviewDb.knowledgeEvolutionProposals.bulkPut([baseProposal, second, blocked]);

  const originalPermission = obsidianVaultAdapter.permission;
  const originalWrite = obsidianVaultAdapter.writeMarkdown;
  let writeCount = 0;
  const writes: string[] = [];
  obsidianVaultAdapter.permission = async () => "granted";
  obsidianVaultAdapter.writeMarkdown = async (_handle, _root, _path, markdown) => {
    writeCount += 1;
    if (writeCount === 2) throw new Error("模拟第二项写入失败");
    writes.push(markdown);
  };
  try {
    const verified: string[] = [];
    const result = await obsidianKnowledgeRepository.acceptProposals([baseProposal.id, second.id, blocked.id], { verifySource: async (proposal) => { verified.push(proposal.id); } });
    assert.deepEqual(result.acceptedIds, [baseProposal.id]);
    assert.equal(result.failures.length, 2);
    assert.deepEqual(verified, [baseProposal.id, second.id]);
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(baseProposal.id))?.status, "accepted");
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(second.id))?.status, "pending");
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(blocked.id))?.status, "pending");
    assert.equal(writes[0].includes("[^e1]"), true);
    assert.equal(writes[0].includes("https://www.gov.cn/policy"), true);
    assert.equal((await reviewDb.obsidianNoteMappings.where("knowledgeId").equals(baseProposal.id).first())?.sourceRefs.includes("https://www.gov.cn/policy"), true);
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    obsidianVaultAdapter.writeMarkdown = originalWrite;
    await reviewDb.delete();
  }
});

test("确认演进提案前复读 Vault 并拒绝过期 hash", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const fakeHandle = { name: "测试 Vault" } as unknown as FileSystemDirectoryHandle;
  await reviewDb.obsidianVaultConfigs.put({ id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: fakeHandle, createdAt: today.toISOString(), updatedAt: today.toISOString() });
  const originalEntry = knowledgeEntry("knowledge-stale", "# 行政许可\n\nUSER_WRITTEN_BODY");
  const originalMarkdown = await serializeObsidianEntry(originalEntry, [], []);
  let vaultMarkdown = originalMarkdown;
  const originalPermission = obsidianVaultAdapter.permission;
  const originalList = obsidianVaultAdapter.listMarkdown;
  const originalRead = obsidianVaultAdapter.readMarkdown;
  const originalWrite = obsidianVaultAdapter.writeMarkdown;
  obsidianVaultAdapter.permission = async () => "granted";
  obsidianVaultAdapter.listMarkdown = async () => [{ path: "常识判断/行政许可.md", markdown: vaultMarkdown }];
  obsidianVaultAdapter.readMarkdown = async () => vaultMarkdown;
  obsidianVaultAdapter.writeMarkdown = async (_handle, _root, _path, markdown) => { vaultMarkdown = markdown; };

  try {
    await obsidianKnowledgeRepository.sync(today);
    const proposal: KnowledgeEvolutionProposal = {
      id: "proposal-stale",
      mode: "link",
      status: "pending",
      category: "常识判断",
      sourceType: "mistake",
      sourceIds: ["mistake:stale"],
      targetKnowledgeId: "knowledge-stale",
      title: "过期确认",
      summary: "不得写入",
      content: "STALE_AI_CONTENT",
      tags: ["不得写入"],
      proposedLinks: ["新增关联"],
      reason: "验证确认前复读",
      confidence: 0.8,
      createdAt: today.toISOString(),
      updatedAt: today.toISOString(),
    };
    await reviewDb.knowledgeEvolutionProposals.put(proposal);
    vaultMarkdown = originalMarkdown.replace("USER_WRITTEN_BODY", "VAULT_CHANGED_AFTER_PREVIEW");

    await assert.rejects(obsidianKnowledgeRepository.acceptProposal(proposal.id), /发生变化/);
    assert.equal((await reviewDb.knowledgeEvolutionProposals.get(proposal.id))?.status, "pending");
    assert.equal((await reviewDb.knowledgeEntries.get("knowledge-stale"))?.content.includes("STALE_AI_CONTENT"), false);
    assert.equal(vaultMarkdown.includes("[[新增关联]]"), false);
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    obsidianVaultAdapter.listMarkdown = originalList;
    obsidianVaultAdapter.readMarkdown = originalRead;
    obsidianVaultAdapter.writeMarkdown = originalWrite;
    await reviewDb.delete();
  }
});
