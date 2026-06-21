import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import type { KnowledgeEntry, ObsidianVaultConfig } from "../types/review.ts";
import {
  applyAiEvolutionSection,
  buildObsidianNotePath,
  buildObsidianUri,
  parseObsidianMarkdown,
  serializeObsidianEntry,
} from "./obsidian-markdown.ts";
import { obsidianKnowledgeRepository } from "./obsidian-knowledge-repository.ts";
import { obsidianVaultAdapter } from "./obsidian-vault-adapter.ts";

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
